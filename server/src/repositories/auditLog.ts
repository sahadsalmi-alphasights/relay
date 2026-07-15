import { pool } from "../db";

export interface AuditLogInput {
  entityType: string;
  entityId: string;
  actorId: string | null;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export async function insertAuditLog(entry: AuditLogInput): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (entity_type, entity_id, actor_id, action, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.entityType,
      entry.entityId,
      entry.actorId,
      entry.action,
      entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
    ]
  );
}
