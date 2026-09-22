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

  async findByUserId(userId, client = db) {
    const query = 'SELECT * FROM accounts WHERE user_id = $1 ORDER BY created_at DESC';
    const result = await client.query(query, [userId]);
    return result.rows;
  }

  async create({ userId, accountNumber, type, currency = 'USD' }, client = db) {
    const query = `
      INSERT INTO accounts (user_id, account_number, type, currency, balance, status)
      VALUES ($1, $2, $3, $4, 0, 'ACTIVE')
      RETURNING *
    `;
    const result = await client.query(query, [userId, accountNumber, type, currency]);
    return result.rows[0];
  }

  async updateBalance(id, deltaAmount, client) {
    const query = `
      UPDATE accounts
      SET balance = balance + $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await client.query(query, [id, deltaAmount]);
    return result.rows[0];
  }
}

module.exports = new AccountRepository();
