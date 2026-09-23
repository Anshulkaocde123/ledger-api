const db = require('../config/db');

class AuditLogRepository {
  async create({ actorId = null, action, entityType, entityId, metadata = {} }, client = db) {
    const query = `
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await client.query(query, [
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata),
    ]);
    return result.rows[0];
  }
}

module.exports = new AuditLogRepository();
