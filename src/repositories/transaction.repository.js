const db = require('../config/db');

class TransactionRepository {
  async findById(id, client = db) {
    const query = 'SELECT * FROM transactions WHERE id = $1';
    const result = await client.query(query, [id]);
    return result.rows[0] || null;
  }

  async findByReference(reference, client = db) {
    const query = 'SELECT * FROM transactions WHERE reference = $1';
    const result = await client.query(query, [reference]);
    return result.rows[0] || null;
  }

  async createTransaction({ reference, description, status = 'POSTED' }, client) {
    const query = `
      INSERT INTO transactions (reference, description, status)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await client.query(query, [reference, description, status]);
    return result.rows[0];
  }

  async createLedgerEntries(entries, client) {
    // Inserts multiple ledger entries atomically
    const results = [];
    for (const entry of entries) {
      const query = `
        INSERT INTO ledger_entries (transaction_id, account_id, type, amount, currency)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const res = await client.query(query, [
        entry.transactionId,
        entry.accountId,
        entry.type,
        entry.amount,
        entry.currency,
      ]);
      results.push(res.rows[0]);
    }
    return results;
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
