function nowIso() {
  return new Date().toISOString();
}

function audit(db, { userId = null, action, module, entityId = null, entityType = null, details = null }) {
  db.prepare(`
    INSERT INTO audit_logs (user_id, action, module, entity_id, entity_type, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    action,
    module,
    entityId,
    entityId ? entityType ?? module : null,
    details ? JSON.stringify(details) : null,
    nowIso(),
  );
}

module.exports = { audit, nowIso };
