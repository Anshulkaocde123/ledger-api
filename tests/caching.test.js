const redis = require('../src/config/redis');
const accountService = require('../src/services/account.service');
const accountRepository = require('../src/repositories/account.repository');
const paymentService = require('../src/services/payment.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const auditLogRepository = require('../src/repositories/auditLog.repository');
const db = require('../src/config/db');

jest.mock('../src/config/redis');
jest.mock('../src/repositories/account.repository');
jest.mock('../src/repositories/transaction.repository');
jest.mock('../src/repositories/auditLog.repository');
jest.mock('../src/config/db');

describe('Account Balance Cache-Aside Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAccountBalance', () => {
    const mockAccount = {
      id: 'acc-uuid-1',
      user_id: 'user-1',
      account_type: 'asset',
      currency: 'USD',
    };

    it('should read from Redis cache on cache hit and not query database', async () => {
      accountRepository.findById.mockResolvedValue(mockAccount);
      redis.get.mockResolvedValue('1500.50');

      const result = await accountService.getAccountBalance('acc-uuid-1');

      expect(result.balance).toBe(1500.5);
      expect(result.cached).toBe(true);
      expect(redis.get).toHaveBeenCalledWith('cache:account:balance:acc-uuid-1');
      // Should NOT hit DB for derived balance calculation
      expect(accountRepository.getDerivedBalance).not.toHaveBeenCalled();
    });

    it('should query DB on cache miss and populate Redis with 30s TTL', async () => {
      accountRepository.findById.mockResolvedValue(mockAccount);
      redis.get.mockResolvedValue(null); // Cache miss
      accountRepository.getDerivedBalance.mockResolvedValue(2750.25);
      redis.set.mockResolvedValue('OK');

      const result = await accountService.getAccountBalance('acc-uuid-1');

      expect(result.balance).toBe(2750.25);
      expect(result.cached).toBe(false);
      expect(accountRepository.getDerivedBalance).toHaveBeenCalledWith('acc-uuid-1');
      // Verify Redis populated with 30s TTL
      expect(redis.set).toHaveBeenCalledWith(
        'cache:account:balance:acc-uuid-1',
        '2750.25',
        'EX',
        30
      );
    });

    it('should gracefully degrade and fetch from DB if Redis read throws an error', async () => {
      accountRepository.findById.mockResolvedValue(mockAccount);
      redis.get.mockRejectedValue(new Error('Redis connection refused'));
      accountRepository.getDerivedBalance.mockResolvedValue(800.0);
      redis.set.mockRejectedValue(new Error('Redis write timeout'));

      const result = await accountService.getAccountBalance('acc-uuid-1');

      expect(result.balance).toBe(800.0);
      expect(result.cached).toBe(false);
      expect(accountRepository.getDerivedBalance).toHaveBeenCalledWith('acc-uuid-1');
    });
  });

  describe('Cache Invalidation on Transfer', () => {
    it('should explicitly invalidate cache keys for BOTH sender and receiver on successful transfer', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      db.getClient.mockResolvedValue(mockClient);

      transactionRepository.findByIdempotencyKey.mockResolvedValue(null);
      accountRepository.lockAccountsInOrder.mockResolvedValue({
        'acc-sender': { id: 'acc-sender' },
        'acc-receiver': { id: 'acc-receiver' },
      });
      accountRepository.getDerivedBalance.mockResolvedValue(1000);
      transactionRepository.createTransaction.mockResolvedValue({ id: 'tx-1' });
      transactionRepository.createLedgerEntries.mockResolvedValue([]);
      redis.del.mockResolvedValue(2);

      const spyInvalidate = jest.spyOn(accountService, 'invalidateBalanceCache');

      await paymentService.transferFunds({
        idempotencyKey: 'key-cache-inv',
        sourceAccountId: 'acc-sender',
        destinationAccountId: 'acc-receiver',
        amount: 200,
      });

      // Verify accountService.invalidateBalanceCache called with both IDs
      expect(spyInvalidate).toHaveBeenCalledWith('acc-sender', 'acc-receiver');

      // Verify redis.del was called for both keys
      expect(redis.del).toHaveBeenCalledWith(
        'cache:account:balance:acc-sender',
        'cache:account:balance:acc-receiver'
      );
    });
  });
});
