const db = require('../config/db');

class TransactionRepository {
  async findById(id, client = db) {
    const query = 'SELECT * FROM transactions WHERE id = $1';
    const result = await client.query(query, [id]);
    return result.rows[0] || null;
  }

  async findByIdempotencyKey(idempotencyKey, client = db) {
    const query = 'SELECT * FROM transactions WHERE idempotency_key = $1';
    const result = await client.query(query, [idempotencyKey]);
    return result.rows[0] || null;
  }

  // Alias for backward compatibility
  async findByReference(reference, client = db) {
    return this.findByIdempotencyKey(reference, client);
  }

  async createTransaction({ idempotencyKey, reference, description, status = 'posted', initiatedBy = null }, client) {
    const key = idempotencyKey || reference;
    const query = `
      INSERT INTO transactions (idempotency_key, description, status, initiated_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const result = await client.query(query, [key, description, status, initiatedBy]);
    return result.rows[0];
  }

  async createLedgerEntries(entries, client) {
    const results = [];
    for (const entry of entries) {
      const entryType = (entry.type || entry.entryType).toLowerCase();
      const query = `
        INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      const res = await client.query(query, [
        entry.transactionId,
        entry.accountId,
        entryType,
        entry.amount,
      ]);
      results.push(res.rows[0]);
    }
    return results;
  }

  async getEntriesByTransactionId(transactionId, client = db) {
    const query = `
      SELECT * FROM ledger_entries
      WHERE transaction_id = $1
      ORDER BY created_at ASC
    `;
    const result = await client.query(query, [transactionId]);
    return result.rows;
  }

  async getEntriesByAccountId(accountId, client = db) {
    const query = `
      SELECT * FROM ledger_entries 
      WHERE account_id = $1 
      ORDER BY created_at DESC
    `;
    const result = await client.query(query, [accountId]);
    return result.rows;
  }
}

module.exports = new TransactionRepository();
