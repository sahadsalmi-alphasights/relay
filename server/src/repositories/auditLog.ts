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

export interface AuditLogFilters {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface AuditLogActor {
  id: string;
  name: string;
  email: string;
}

export interface AuditLogRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: AuditLogActor | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

/**
 * Docs/AUDIT_LOG_SPEC.md — the read side of the trail. Newest first, joined
 * to `person` for the actor's name/email (LEFT JOIN, not INNER: `actor_id`
 * is nullable on the write side, so a system-triggered entry with no actor
 * must still show up rather than being silently dropped).
 */
export async function listAuditLog(filters: AuditLogFilters): Promise<{ items: AuditLogRow[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.entityType) {
    params.push(filters.entityType);
    where.push(`al.entity_type = $${params.length}`);
  }
  if (filters.entityId) {
    params.push(filters.entityId);
    where.push(`al.entity_id = $${params.length}`);
  }
  if (filters.actorId) {
    params.push(filters.actorId);
    where.push(`al.actor_id = $${params.length}`);
  }
  if (filters.action) {
    params.push(filters.action);
    where.push(`al.action = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    where.push(`al.created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`al.created_at <= $${params.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT count(*)::int AS count FROM audit_log al ${whereClause}`,
    params
  );
  const total = Number(countRows[0].count);

  const limitParams = [...params, filters.limit, filters.offset];
  const { rows } = await pool.query(
    `SELECT al.id, al.entity_type AS "entityType", al.entity_id AS "entityId", al.action,
            al.old_value AS "oldValue", al.new_value AS "newValue", al.created_at AS "createdAt",
            p.id AS "actorId", p.name AS "actorName", p.email AS "actorEmail"
     FROM audit_log al
     LEFT JOIN person p ON p.id = al.actor_id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${limitParams.length - 1} OFFSET $${limitParams.length}`,
    limitParams
  );

  const items: AuditLogRow[] = rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    actor: r.actorId ? { id: r.actorId, name: r.actorName, email: r.actorEmail } : null,
    oldValue: r.oldValue,
    newValue: r.newValue,
    createdAt: r.createdAt,
  }));

  return { items, total };
}
