const paymentService = require('../src/services/payment.service');
const accountRepository = require('../src/repositories/account.repository');
const transactionRepository = require('../src/repositories/transaction.repository');
const auditLogRepository = require('../src/repositories/auditLog.repository');
const db = require('../src/config/db');
const ApiError = require('../src/utils/apiError');

jest.mock('../src/repositories/account.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/auditLog.repository');
jest.mock('../src/config/db');

describe('PaymentService Transfer Tests', () => {
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    db.getClient = jest.fn().mockResolvedValue(mockClient);
  });

  it('should return original result on duplicate idempotency key without beginning DB transaction', async () => {
    const existingTx = {
      id: 'tx-existing-1',
      idempotency_key: 'idem-key-1',
      status: 'posted',
    };
    const entries = [
      { id: 'le-1', account_id: 'acc-1', entry_type: 'debit', amount: 50 },
      { id: 'le-2', account_id: 'acc-2', entry_type: 'credit', amount: 50 },
    ];

    transactionRepository.findByIdempotencyKey.mockResolvedValue(existingTx);
    transactionRepository.getEntriesByTransactionId.mockResolvedValue(entries);

    const result = await paymentService.transferFunds({
      idempotencyKey: 'idem-key-1',
      sourceAccountId: 'acc-1',
      destinationAccountId: 'acc-2',
      amount: 50,
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.id).toBe('tx-existing-1');
    expect(result.entries).toEqual(entries);
    // DB transaction should not even be started
    expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
  });

  it('should lock accounts in consistent alphabetical/ascending order to prevent deadlocks', async () => {
    transactionRepository.findByIdempotencyKey.mockResolvedValue(null);

    // acc-Z and acc-A -> lock order should be acc-A then acc-Z
    const sourceAccountId = 'acc-Z';
    const destinationAccountId = 'acc-A';

    accountRepository.lockAccountsInOrder.mockResolvedValue({
      'acc-Z': { id: 'acc-Z' },
      'acc-A': { id: 'acc-A' },
    });

    accountRepository.getDerivedBalance.mockResolvedValue(500); // Plenty of balance
    transactionRepository.createTransaction.mockResolvedValue({
      id: 'tx-new-1',
      idempotency_key: 'key-123',
    });
    transactionRepository.createLedgerEntries.mockResolvedValue([
      { id: 'le-1', entry_type: 'debit', amount: 100 },
      { id: 'le-2', entry_type: 'credit', amount: 100 },
    ]);

    await paymentService.transferFunds({
      idempotencyKey: 'key-123',
      sourceAccountId,
      destinationAccountId,
      amount: 100,
    });

    // Check locking order is sorted ascending ['acc-A', 'acc-Z']
    expect(accountRepository.lockAccountsInOrder).toHaveBeenCalledWith(
      ['acc-A', 'acc-Z'],
      mockClient
    );

    // Verify BEGIN and COMMIT executed
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should roll back and throw 400 if sender derived balance is insufficient', async () => {
    transactionRepository.findByIdempotencyKey.mockResolvedValue(null);

    accountRepository.lockAccountsInOrder.mockResolvedValue({
      'acc-1': { id: 'acc-1' },
      'acc-2': { id: 'acc-2' },
    });

    // Sender only has 30, but transfer requires 100
    accountRepository.getDerivedBalance.mockResolvedValue(30);

    await expect(
      paymentService.transferFunds({
        idempotencyKey: 'key-insufficient',
        sourceAccountId: 'acc-1',
        destinationAccountId: 'acc-2',
        amount: 100,
      })
    ).rejects.toThrow(ApiError);

    // Should ROLLBACK and release client
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
    expect(transactionRepository.createTransaction).not.toHaveBeenCalled();
  });

  it('should insert debit on sender and credit on receiver atomically within the transaction', async () => {
    transactionRepository.findByIdempotencyKey.mockResolvedValue(null);

    accountRepository.lockAccountsInOrder.mockResolvedValue({
      'acc-1': { id: 'acc-1' },
      'acc-2': { id: 'acc-2' },
    });

    accountRepository.getDerivedBalance.mockResolvedValue(250);

    transactionRepository.createTransaction.mockResolvedValue({
      id: 'tx-success-1',
      idempotency_key: 'key-atomic',
    });

    transactionRepository.createLedgerEntries.mockResolvedValue([
      { id: 'e1', transactionId: 'tx-success-1', accountId: 'acc-1', entry_type: 'debit', amount: 50 },
      { id: 'e2', transactionId: 'tx-success-1', accountId: 'acc-2', entry_type: 'credit', amount: 50 },
    ]);

    const result = await paymentService.transferFunds({
      idempotencyKey: 'key-atomic',
      sourceAccountId: 'acc-1',
      destinationAccountId: 'acc-2',
      amount: 50,
      currency: 'USD',
      initiatedBy: 'user-1',
    });

    expect(result.id).toBe('tx-success-1');
    expect(result.isDuplicate).toBe(false);

    // Verify debit on sender and credit on receiver
    expect(transactionRepository.createLedgerEntries).toHaveBeenCalledWith(
      [
        { transactionId: 'tx-success-1', accountId: 'acc-1', entryType: 'debit', amount: 50 },
        { transactionId: 'tx-success-1', accountId: 'acc-2', entryType: 'credit', amount: 50 },
      ],
      mockClient
    );

    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('should trigger asynchronous audit logging upon successful transfer', async () => {
    transactionRepository.findByIdempotencyKey.mockResolvedValue(null);
    accountRepository.lockAccountsInOrder.mockResolvedValue({
      'acc-1': { id: 'acc-1' },
      'acc-2': { id: 'acc-2' },
    });
    accountRepository.getDerivedBalance.mockResolvedValue(200);
    transactionRepository.createTransaction.mockResolvedValue({
      id: 'tx-audit-test',
      idempotency_key: 'key-audit',
    });
    transactionRepository.createLedgerEntries.mockResolvedValue([]);
    auditLogRepository.create.mockResolvedValue({});

    await paymentService.transferFunds({
      idempotencyKey: 'key-audit',
      sourceAccountId: 'acc-1',
      destinationAccountId: 'acc-2',
      amount: 50,
      initiatedBy: 'user-audit',
    });

    // Wait for setImmediate to execute
    await new Promise((resolve) => setImmediate(resolve));

    expect(auditLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-audit',
        action: 'TRANSFER_EXECUTED',
        entityType: 'TRANSACTION',
        entityId: 'tx-audit-test',
      })
    );
  });
});
