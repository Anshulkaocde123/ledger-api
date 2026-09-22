const db = require('../config/db');
const accountRepository = require('../repositories/account.repository');
const transactionRepository = require('../repositories/transaction.repository');
const ApiError = require('../utils/apiError');

class LedgerService {
  /**
   * Enforce double-entry invariant: Sum(DEBITS) === Sum(CREDITS)
   */
  validateDoubleEntry(entries) {
    if (!entries || entries.length < 2) {
      throw ApiError.badRequest('A transaction must contain at least two ledger entries');
    }

    let debitTotal = 0;
    let creditTotal = 0;

    for (const entry of entries) {
      const amount = Number(entry.amount);
      if (isNaN(amount) || amount <= 0) {
        throw ApiError.badRequest('Entry amount must be a positive number');
      }

      if (entry.type === 'DEBIT') {
        debitTotal += amount;
      } else if (entry.type === 'CREDIT') {
        creditTotal += amount;
      } else {
        throw ApiError.badRequest(`Invalid entry type: ${entry.type}. Must be DEBIT or CREDIT`);
      }
    }

    if (debitTotal !== creditTotal) {
      throw ApiError.badRequest(
        `Double-entry imbalance: Total debits (${debitTotal}) must equal total credits (${creditTotal})`
      );
    }
  }

  /**
   * Records a balanced double-entry transaction within a database transaction
   */
  async recordTransaction({ reference, description, entries }) {
    this.validateDoubleEntry(entries);

    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const existingTx = await transactionRepository.findByReference(reference, client);
      if (existingTx) {
        throw ApiError.badRequest(`Transaction with reference ${reference} already processed`);
      }

      const tx = await transactionRepository.createTransaction(
        { reference, description, status: 'POSTED' },
        client
      );

      // Lock and update account balances
      for (const entry of entries) {
        const account = await accountRepository.findByIdForUpdate(entry.accountId, client);
        if (!account) {
          throw ApiError.notFound(`Account ${entry.accountId} not found`);
        }

        // Apply balance adjustment based on account type & entry type
        const delta = entry.type === 'CREDIT' ? Number(entry.amount) : -Number(entry.amount);
        await accountRepository.updateBalance(account.id, delta, client);
      }

      const createdEntries = await transactionRepository.createLedgerEntries(
        entries.map((e) => ({ ...e, transactionId: tx.id })),
        client
      );

      await client.query('COMMIT');

      return {
        ...tx,
        entries: createdEntries,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = new LedgerService();
