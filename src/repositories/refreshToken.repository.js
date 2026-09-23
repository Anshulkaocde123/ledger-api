const db = require('../config/db');

class RefreshTokenRepository {
  async create({ userId, tokenHash, expiresAt }, client = db) {
    const query = `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await client.query(query, [userId, tokenHash, expiresAt]);
    return result.rows[0];
  }

  async findByTokenHash(tokenHash, client = db) {
    const query = `
      SELECT * FROM refresh_tokens 
      WHERE token_hash = $1
    `;
    const result = await client.query(query, [tokenHash]);
    return result.rows[0] || null;
  }

  async revoke(id, replacedByTokenHash = null, client = db) {
    const query = `
      UPDATE refresh_tokens
      SET revoked_at = NOW(), replaced_by_token_hash = $2
      WHERE id = $1
      RETURNING *
    `;
    const result = await client.query(query, [id, replacedByTokenHash]);
    return result.rows[0] || null;
  }

  async revokeAllForUser(userId, client = db) {
    const query = `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL
    `;
    await client.query(query, [userId]);
  }
}

module.exports = new RefreshTokenRepository();
