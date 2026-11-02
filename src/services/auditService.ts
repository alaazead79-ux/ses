import { getDb } from '@/db/db';

export interface AuditLog {
  id: number;
  user_id: string | null;
  action: string;
  module: string;
  entity_id: string | null;
  entity_type: string | null;
  details: unknown;
  created_at: string;
}

export async function logAudit(data: {
  userId: string | null;
  action: string;
  module: string;
  entityId?: string | null;
  entityType?: string | null;
  details?: unknown;
}): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO audit_logs (user_id, action, module, entity_id, entity_type, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.userId, data.action, data.module, data.entityId ?? null, data.entityType ?? null, JSON.stringify(data.details ?? {})]
  );
}

export async function listAuditLogs(limit = 100, offset = 0): Promise<AuditLog[]> {
  const db = await getDb();
  const res = await db.query<AuditLog>(
    `SELECT a.id, a.user_id, u.display_name as user_name, a.action, a.module, a.entity_id, a.entity_type, a.details, a.created_at::text
     FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
     ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows;
}
