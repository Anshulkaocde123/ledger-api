const db = require('../config/db');

class AccountRepository {
  async findById(id, client = db) {
    const query = 'SELECT * FROM accounts WHERE id = $1';
    const result = await client.query(query, [id]);
    return result.rows[0] || null;
  }

  async findByIdForUpdate(id, client) {
    const query = 'SELECT * FROM accounts WHERE id = $1 FOR UPDATE';
    const result = await client.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Acquires row-level locks on multiple accounts in a strictly deterministic
   * order (sorted ascending by account ID) to prevent circular deadlocks.
   */
  async lockAccountsInOrder(accountIds, client) {
    // Sort account IDs deterministically (lexicographical/UUID order)
    const sortedIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b));
    const lockedAccounts = {};

    for (const id of sortedIds) {
      const query = 'SELECT * FROM accounts WHERE id = $1 FOR UPDATE';
      const result = await client.query(query, [id]);
      lockedAccounts[id] = result.rows[0] || null;
    }

    return lockedAccounts;
  }

  /**
   * Derives current account balance dynamically from immutable ledger_entries:
   * SUM(credits) - SUM(debits)
   */
  async getDerivedBalance(accountId, client = db) {
    const query = `
      SELECT COALESCE(
        SUM(
          CASE 
            WHEN entry_type = 'credit' THEN amount 
            WHEN entry_type = 'debit' THEN -amount 
            ELSE 0 
          END
        ), 0
      ) AS balance
      FROM ledger_entries
      WHERE account_id = $1
    `;
    const result = await client.query(query, [accountId]);
    return parseFloat(result.rows[0].balance);
  }

  async findByUserId(userId, client = db) {
    const query = 'SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at DESC';
    const result = await client.query(query, [userId]);
    return result.rows;
  }

  async create({ userId, accountType = 'asset', currency = 'USD' }, client = db) {
    const query = `
      INSERT INTO accounts (user_id, account_type, currency)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await client.query(query, [userId, accountType, currency]);
    return result.rows[0];
  }
}

module.exports = new AccountRepository();
