const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const db = require('../src/config/db');
const redis = require('../src/config/redis');

// Mock Redis and BullMQ queues to keep integration tests completely isolated & in-memory
jest.mock('../src/config/redis');
jest.mock('../src/queues/audit.queue');

/**
 * Async Mutex simulating PostgreSQL row-level locks (SELECT ... FOR UPDATE)
 */
class AsyncMutex {
  constructor() {
    this.locked = false;
    this.waiting = [];
  }

  async acquire() {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise((resolve) => this.waiting.push(resolve));
  }

  release() {
    if (this.waiting.length > 0) {
      const nextResolve = this.waiting.shift();
      nextResolve();
    } else {
      this.locked = false;
    }
  }
}

describe('POST /api/v1/transfers Integration & Concurrency Tests', () => {
  let accountsTable;
  let transactionsTable;
  let ledgerEntriesTable;
  let accountMutexes;

  const validUser = {
    userId: 'user-sender-uuid',
    email: 'sender@example.com',
    role: 'customer',
  };

  const authToken = jwt.sign(validUser, config.jwtSecret, { expiresIn: '15m' });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Redis rate limiter and cache methods to allow operations smoothly
    redis.eval.mockResolvedValue([1, 100, 0]); // Rate limiter allows request
    redis.get.mockResolvedValue(null);         // Cache miss
    redis.set.mockResolvedValue('OK');
    redis.del.mockResolvedValue(1);

    accountsTable = new Map();
    transactionsTable = new Map();
    ledgerEntriesTable = [];
    accountMutexes = new Map();

    const getMutex = (id) => {
      if (!accountMutexes.has(id)) {
        accountMutexes.set(id, new AsyncMutex());
      }
      return accountMutexes.get(id);
    };

    const computeDerivedBalance = (accountId) => {
      return ledgerEntriesTable
        .filter((entry) => entry.account_id === accountId)
        .reduce((sum, entry) => {
          const amt = Number(entry.amount);
          return entry.entry_type === 'credit' ? sum + amt : sum - amt;
        }, 0);
    };

    const handleReadQuery = (sql, params) => {
      // Check transaction by idempotency key
      if (sql.includes('FROM transactions WHERE idempotency_key = $1')) {
        const key = params[0];
        const tx = transactionsTable.get(key);
        return { rows: tx ? [tx] : [] };
      }

      // Dynamic derived balance calculation from ledger_entries
      if (sql.includes('FROM ledger_entries') && sql.includes('WHERE account_id = $1')) {
        const accId = params[0];
        const balance = computeDerivedBalance(accId);
        return { rows: [{ balance }] };
      }

      // SELECT * FROM accounts WHERE id = $1
      if (sql.includes('FROM accounts WHERE id = $1')) {
        const accId = params[0];
        const acc = accountsTable.get(accId);
        return { rows: acc ? [acc] : [] };
      }

      // Get entries by transaction ID
      if (sql.includes('FROM ledger_entries') && sql.includes('WHERE transaction_id = $1')) {
        const txId = params[0];
        const entries = ledgerEntriesTable.filter((e) => e.transaction_id === txId);
        return { rows: entries };
      }

      return { rows: [] };
    };

    // Route pool.query to in-memory reader
    db.query = jest.fn().mockImplementation(async (text, params) => {
      return handleReadQuery(text.trim(), params);
    });

    // Intercept database connection pool to simulate PostgreSQL ACID transactions with row-level locks
    db.getClient = jest.fn().mockImplementation(async () => {
      const heldLocks = [];
      let stagedEntries = [];
      let stagedTx = null;

      return {
        query: jest.fn().mockImplementation(async (text, params) => {
          const sql = text.trim();

          if (sql === 'BEGIN') {
            stagedEntries = [];
            stagedTx = null;
            return { rows: [] };
          }

          if (sql === 'COMMIT') {
            if (stagedTx) {
              transactionsTable.set(stagedTx.idempotency_key, stagedTx);
            }
            if (stagedEntries.length > 0) {
              ledgerEntriesTable.push(...stagedEntries);
            }
            // Release all row locks upon COMMIT
            while (heldLocks.length > 0) {
              const lock = heldLocks.pop();
              lock.release();
            }
            return { rows: [] };
          }

          if (sql === 'ROLLBACK') {
            stagedEntries = [];
            stagedTx = null;
            // Release all row locks upon ROLLBACK
            while (heldLocks.length > 0) {
              const lock = heldLocks.pop();
              lock.release();
            }
            return { rows: [] };
          }

          // Row-level lock: SELECT * FROM accounts WHERE id = $1 FOR UPDATE
          if (sql.includes('FROM accounts WHERE id = $1 FOR UPDATE')) {
            const accId = params[0];
            const mutex = getMutex(accId);
            await mutex.acquire();
            heldLocks.push(mutex);

            const acc = accountsTable.get(accId);
            return { rows: acc ? [acc] : [] };
          }

          // Insert into transactions
          if (sql.includes('INSERT INTO transactions')) {
            const key = params[0];
            if (transactionsTable.has(key)) {
              const err = new Error('duplicate key value violates unique constraint "idx_transactions_idempotency_key"');
              err.code = '23505';
              throw err;
            }
            stagedTx = {
              id: `tx-${Date.now()}-${Math.random()}`,
              idempotency_key: key,
              description: params[1],
              status: params[2],
              initiated_by: params[3],
              created_at: new Date().toISOString(),
            };
            return { rows: [stagedTx] };
          }

          // Insert into ledger_entries
          if (sql.includes('INSERT INTO ledger_entries')) {
            const entry = {
              id: `le-${Date.now()}-${Math.random()}`,
              transaction_id: params[0],
              account_id: params[1],
              entry_type: params[2],
              amount: params[3],
              created_at: new Date().toISOString(),
            };
            stagedEntries.push(entry);
            return { rows: [entry] };
          }

          return handleReadQuery(sql, params);
        }),
        release: jest.fn().mockImplementation(() => {
          while (heldLocks.length > 0) {
            heldLocks.pop().release();
          }
        }),
      };
    });

    // Seed test accounts: Sender has 500, Receiver has 0
    accountsTable.set('acc-sender-1', {
      id: 'acc-sender-1',
      user_id: 'user-sender-uuid',
      account_type: 'asset',
      currency: 'USD',
    });

    accountsTable.set('acc-receiver-1', {
      id: 'acc-receiver-1',
      user_id: 'user-receiver-uuid',
      account_type: 'asset',
      currency: 'USD',
    });

    // Seed ledger entry: Initial deposit of 500.00 into Sender account
    ledgerEntriesTable.push({
      id: 'le-seed-1',
      transaction_id: 'tx-seed-1',
      account_id: 'acc-sender-1',
      entry_type: 'credit',
      amount: 500.0,
      created_at: new Date().toISOString(),
    });
  });

  describe('Integration: Standard Transfer Scenarios', () => {
    it('should return 401 Unauthorized when request lacks authorization token', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Idempotency-Key', 'key-unauth-test')
        .send({
          sourceAccountId: 'acc-sender-1',
          destinationAccountId: 'acc-receiver-1',
          amount: 50,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should successfully transfer funds between two accounts (201 Created)', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', 'key-success-1')
        .send({
          sourceAccountId: 'acc-sender-1',
          destinationAccountId: 'acc-receiver-1',
          amount: 100,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.idempotency_key).toBe('key-success-1');
      expect(res.body.data.entries).toHaveLength(2);

      // Verify balances derived from ledger entries:
      // Sender: 500 - 100 = 400
      // Receiver: 0 + 100 = 100
      const senderEntries = ledgerEntriesTable.filter((e) => e.account_id === 'acc-sender-1');
      const receiverEntries = ledgerEntriesTable.filter((e) => e.account_id === 'acc-receiver-1');

      const senderBalance = senderEntries.reduce(
        (sum, e) => (e.entry_type === 'credit' ? sum + Number(e.amount) : sum - Number(e.amount)),
        0
      );
      const receiverBalance = receiverEntries.reduce(
        (sum, e) => (e.entry_type === 'credit' ? sum + Number(e.amount) : sum - Number(e.amount)),
        0
      );

      expect(senderBalance).toBe(400);
      expect(receiverBalance).toBe(100);
    });

    it('should reject transfer with 400 Bad Request when balance is insufficient', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', 'key-insufficient-1')
        .send({
          sourceAccountId: 'acc-sender-1',
          destinationAccountId: 'acc-receiver-1',
          amount: 9999, // Exceeds available 500
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/insufficient balance/i);
    });

    it('should return original result on duplicate idempotency key without duplicate processing', async () => {
      const idempotencyKey = 'key-idempotent-repeat';

      // 1. First execution
      const firstRes = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          sourceAccountId: 'acc-sender-1',
          destinationAccountId: 'acc-receiver-1',
          amount: 50,
        });

      expect(firstRes.status).toBe(201);

      // 2. Second execution with identical idempotency key
      const secondRes = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          sourceAccountId: 'acc-sender-1',
          destinationAccountId: 'acc-receiver-1',
          amount: 50,
        });

      expect(secondRes.status).toBe(200);
      expect(secondRes.headers['idempotent-replay']).toBe('true');
      expect(secondRes.body.data.id).toBe(firstRes.body.data.id);

      // Verify that money was only deducted ONCE (500 - 50 = 450, NOT 400)
      const senderEntries = ledgerEntriesTable.filter((e) => e.account_id === 'acc-sender-1');
      const senderBalance = senderEntries.reduce(
        (sum, e) => (e.entry_type === 'credit' ? sum + Number(e.amount) : sum - Number(e.amount)),
        0
      );
      expect(senderBalance).toBe(450);
    });
  });

  describe('CONCURRENCY TEST: 10 Simultaneous Transfers Against Same Account', () => {
    it('should allow exactly 5 transfers to succeed, 5 to fail with insufficient balance, and never produce a negative balance', async () => {
      // Setup: Sender has 500 initial balance.
      // We fire 10 simultaneous transfer requests, each attempting to move 100 out of sender account.
      // 5 * 100 = 500 (Exact capacity). The remaining 5 requests MUST be rejected.
      const CONCURRENT_REQUESTS = 10;
      const TRANSFER_AMOUNT = 100;

      const promises = Array.from({ length: CONCURRENT_REQUESTS }).map((_, index) => {
        return request(app)
          .post('/api/v1/transfers')
          .set('Authorization', `Bearer ${authToken}`)
          .set('Idempotency-Key', `concurrent-key-${index}-${Date.now()}`)
          .send({
            sourceAccountId: 'acc-sender-1',
            destinationAccountId: 'acc-receiver-1',
            amount: TRANSFER_AMOUNT,
          });
      });

      // Fire all 10 requests concurrently
      const responses = await Promise.all(promises);

      const successfulResponses = responses.filter((r) => r.status === 201);
      const failedResponses = responses.filter((r) => r.status === 400);

      // Assert that exactly 5 succeeded and exactly 5 failed
      expect(successfulResponses).toHaveLength(5);
      expect(failedResponses).toHaveLength(5);

      // Verify all failed responses reported insufficient balance
      for (const res of failedResponses) {
        expect(res.body.message).toMatch(/insufficient balance/i);
      }

      // Assert final sender balance is exactly 0.00 and NEVER negative
      const finalSenderEntries = ledgerEntriesTable.filter((e) => e.account_id === 'acc-sender-1');
      const finalSenderBalance = finalSenderEntries.reduce(
        (sum, e) => (e.entry_type === 'credit' ? sum + Number(e.amount) : sum - Number(e.amount)),
        0
      );

      const finalReceiverEntries = ledgerEntriesTable.filter((e) => e.account_id === 'acc-receiver-1');
      const finalReceiverBalance = finalReceiverEntries.reduce(
        (sum, e) => (e.entry_type === 'credit' ? sum + Number(e.amount) : sum - Number(e.amount)),
        0
      );

      expect(finalSenderBalance).toBe(0);
      expect(finalReceiverBalance).toBe(500);
      expect(finalSenderBalance).toBeGreaterThanOrEqual(0); // Zero or positive, never negative!
    });
  });
});
