const pool = require('../config/db');

/**
 * Records an entry in the lead's activity timeline.
 */
async function logActivity(client, { leadId, userId, action, fieldName = null, oldValue = null, newValue = null, notes = null }) {
  await client.query(
    `INSERT INTO activities (lead_id, user_id, action, field_name, old_value, new_value, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [leadId, userId, action, fieldName, oldValue, newValue, notes]
  );
}

/**
 * Records a system-wide audit log entry (security / compliance trail).
 */
async function logAudit({ userId, entityType, entityId, action, details = null, ip = null }) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, entity_type, entity_id, action, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, entityType, entityId, action, details ? JSON.stringify(details) : null, ip]
  );
}

/**
 * Creates an in-app notification for a user.
 */
async function notifyUser(client, { userId, leadId = null, type, message }) {
  if (!userId) return;
  await client.query(
    `INSERT INTO notifications (user_id, lead_id, type, message) VALUES ($1, $2, $3, $4)`,
    [userId, leadId, type, message]
  );
}

module.exports = { logActivity, logAudit, notifyUser };
