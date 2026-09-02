import { pool, type Queryable } from "../db";

export interface AuditLogInput {
  entityType: string;
  entityId: string;
  actorId: string | null;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export async function insertAuditLog(entry: AuditLogInput, db: Queryable = pool): Promise<void> {
  await db.query(
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
  /** Actions to omit (e.g. the high-volume auth events) — an action <> ALL clause. */
  excludeActions?: string[];
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
  /** Human label for the entity (person name / project client / …); null if it can't be resolved (e.g. a hard-deleted row). */
  entityLabel: string | null;
  action: string;
  actor: AuditLogActor | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

/**
 * Resolve entity UUIDs to human labels by type, batched (one query per type) to
 * avoid an N+1. person → name; project → client; angle → "client · angle";
 * assignment → "deliverer · client". Unknown/other types resolve to null and
 * the UI falls back to the short id.
 */
async function resolveEntityLabels(rows: { entityType: string; entityId: string }[]): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byType.has(r.entityType)) byType.set(r.entityType, new Set());
    byType.get(r.entityType)!.add(r.entityId);
  }
  const labels = new Map<string, string>();
  const ids = (t: string) => [...(byType.get(t) ?? [])];

  if (byType.has("person")) {
    const { rows: p } = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM person WHERE id = ANY($1)`, [ids("person")]);
    for (const r of p) labels.set(r.id, r.name);
  }
  if (byType.has("project")) {
    const { rows: p } = await pool.query<{ id: string; client: string }>(`SELECT id, client FROM project WHERE id = ANY($1)`, [ids("project")]);
    for (const r of p) labels.set(r.id, r.client);
  }
  if (byType.has("angle")) {
    const { rows: a } = await pool.query<{ id: string; label: string }>(
      `SELECT ang.id, p.client || ' · ' || ang.name AS label FROM angle ang JOIN project p ON p.id = ang.project_id WHERE ang.id = ANY($1)`,
      [ids("angle")]
    );
    for (const r of a) labels.set(r.id, r.label);
  }
  if (byType.has("assignment")) {
    const { rows: a } = await pool.query<{ id: string; label: string }>(
      `SELECT a.id, d.name || ' · ' || p.client AS label
       FROM assignment a JOIN person d ON d.id = a.deliverer_id
       JOIN angle ang ON ang.id = a.angle_id JOIN project p ON p.id = ang.project_id
       WHERE a.id = ANY($1)`,
      [ids("assignment")]
    );
    for (const r of a) labels.set(r.id, r.label);
  }
  return labels;
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
  if (filters.excludeActions && filters.excludeActions.length > 0) {
    params.push(filters.excludeActions);
    where.push(`al.action <> ALL($${params.length})`);
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

  const labels = await resolveEntityLabels(rows.map((r) => ({ entityType: r.entityType, entityId: r.entityId })));
  const items: AuditLogRow[] = rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    entityLabel: labels.get(r.entityId) ?? null,
    action: r.action,
    actor: r.actorId ? { id: r.actorId, name: r.actorName, email: r.actorEmail } : null,
    oldValue: r.oldValue,
    newValue: r.newValue,
    createdAt: r.createdAt,
  }));

  return { items, total };
}

/** Distinct (person, Dubai-day) pairs where a person turned a self-toggle ON in the window. */
export async function toggleOnDays(action: string, startIso: string, endIso: string): Promise<{ personId: string; day: string }[]> {
  const { rows } = await pool.query<{ personId: string; day: string }>(
    `SELECT entity_id AS "personId",
            to_char((created_at AT TIME ZONE 'UTC') + interval '4 hours', 'YYYY-MM-DD') AS day
     FROM audit_log
     WHERE action = $1 AND new_value->>'on' = 'true'
       AND created_at >= $2 AND created_at < $3
     GROUP BY entity_id, day`,
    [action, startIso, endIso]
  );
  return rows;
}

/** Active, non-ghost people for the toggle matrix (so non-togglers still appear). */
export async function listPeopleForToggleMatrix(): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM person WHERE is_ghost = false AND deactivated_at IS NULL ORDER BY name`
  );
  return rows;
}
