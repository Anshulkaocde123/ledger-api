const db = require('../config/db');
const accountRepository = require('../repositories/account.repository');
const transactionRepository = require('../repositories/transaction.repository');
const auditLogRepository = require('../repositories/auditLog.repository');
const accountService = require('./account.service');
const { enqueueAuditLog } = require('../queues/audit.queue');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

class PaymentService {
  /**
   * Transfers funds between two accounts using strict ACID guarantees:
   * 1. Idempotency validation (returns original result if key already processed)
   * 2. Ordered row-level locking (SELECT ... FOR UPDATE) to prevent circular deadlocks
   * 3. Dynamic balance derivation from immutable ledger_entries
   * 4. Atomic debit and credit entry creation within a single DB transaction
   * 5. Asynchronous, non-blocking audit trail logging
   */
  async transferFunds({
    idempotencyKey,
    sourceAccountId,
    destinationAccountId,
    amount,
    currency = 'USD',
    description = null,
    initiatedBy = null,
  }) {
    if (!idempotencyKey) {
      throw ApiError.badRequest('Idempotency-Key is required');
    }

    const transferAmount = Number(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      throw ApiError.badRequest('Transfer amount must be a positive number');
    }

    if (sourceAccountId === destinationAccountId) {
      throw ApiError.badRequest('Source and destination accounts must be different');
    }

    // 1. Idempotency pre-check: if already processed, return original result
    const existingTx = await transactionRepository.findByIdempotencyKey(idempotencyKey);
    if (existingTx) {
      const entries = await transactionRepository.getEntriesByTransactionId(existingTx.id);
      logger.info(`Idempotent replay for transaction ${existingTx.id} with key ${idempotencyKey}`);
      return {
        ...existingTx,
        entries,
        isDuplicate: true,
      };
    }

    const client = await db.getClient();

    try {
      // 2. BEGIN single database transaction
      await client.query('BEGIN');

      // 3. Acquire row-level locks on both accounts in strictly deterministic order
      // (Ascending sorted by UUID/ID) to eliminate deadlock race conditions
      const lockOrder = [sourceAccountId, destinationAccountId].sort((a, b) =>
        a.localeCompare(b)
      );

      const lockedAccounts = await accountRepository.lockAccountsInOrder(lockOrder, client);

      const sourceAccount = lockedAccounts[sourceAccountId];
      const destinationAccount = lockedAccounts[destinationAccountId];

      if (!sourceAccount) {
        throw ApiError.notFound(`Source account ${sourceAccountId} not found`);
      }
      if (!destinationAccount) {
        throw ApiError.notFound(`Destination account ${destinationAccountId} not found`);
      }

      // 4. Derive sender balance dynamically from ledger_entries before inserting
      const senderBalance = await accountRepository.getDerivedBalance(sourceAccountId, client);

      if (senderBalance < transferAmount) {
        // Rollback and return 400
        throw ApiError.badRequest(
          `Insufficient balance: Available balance is ${senderBalance}, required ${transferAmount}`
        );
      }

      // 5. Create transaction record with idempotency key
      let tx;
      try {
        tx = await transactionRepository.createTransaction(
          {
            idempotencyKey,
            description:
              description ||
              `Transfer of ${transferAmount} ${currency} from account ${sourceAccountId} to ${destinationAccountId}`,
            status: 'posted',
            initiatedBy,
          },
          client
        );
      } catch (insertErr) {
        // Handle concurrent race condition on duplicate idempotency key (code 23505)
        if (insertErr.code === '23505') {
          await client.query('ROLLBACK');
          const original = await transactionRepository.findByIdempotencyKey(idempotencyKey);
          if (original) {
            const entries = await transactionRepository.getEntriesByTransactionId(original.id);
            return {
              ...original,
              entries,
              isDuplicate: true,
            };
          }
        }
        throw insertErr;
      }

      // 6. Insert balanced double-entry ledger records
      const entriesToCreate = [
        {
          transactionId: tx.id,
          accountId: sourceAccountId,
          entryType: 'debit',
          amount: transferAmount,
        },
        {
          transactionId: tx.id,
          accountId: destinationAccountId,
          entryType: 'credit',
          amount: transferAmount,
        },
      ];

      const createdEntries = await transactionRepository.createLedgerEntries(
        entriesToCreate,
        client
      );

      // 7. COMMIT database transaction
      await client.query('COMMIT');

      // 8. Explicitly invalidate Redis balance cache for both accounts (do not wait for TTL)
      await accountService.invalidateBalanceCache(sourceAccountId, destinationAccountId);

      // 9. Enqueue asynchronous audit log job to BullMQ queue
      enqueueAuditLog({
        actorId: initiatedBy,
        action: 'TRANSFER_EXECUTED',
        entityType: 'TRANSACTION',
        entityId: tx.id,
        metadata: {
          sourceAccountId,
          destinationAccountId,
          amount: transferAmount,
          currency,
          idempotencyKey,
        },
      });

      return {
        ...tx,
        entries: createdEntries,
        isDuplicate: false,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = new PaymentService();
