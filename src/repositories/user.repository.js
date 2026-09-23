const db = require('../config/db');

class UserRepository {
  async findById(id) {
    const query = 'SELECT id, email, full_name, role, created_at, updated_at FROM users WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
  }

  async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await db.query(query, [email]);
    return result.rows[0] || null;
  }

  async create({ email, passwordHash, fullName, role = 'customer' }) {
    const query = `
      INSERT INTO users (email, password_hash, full_name, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, full_name, role, created_at, updated_at
    `;
    const result = await db.query(query, [email, passwordHash, fullName, role]);
    return result.rows[0];
  }
}

module.exports = new UserRepository();
