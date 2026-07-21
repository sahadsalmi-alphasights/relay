import { pool } from "../db";

export type NotificationType =
  | "assigned"
  | "goal_change_requested"
  | "goal_change_resolved"
  | "stale_first_deliverable"
  | "open_pool"
  | "delivery_logged";

export interface NotificationRow {
  id: string;
  personId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

const SELECT = `
  SELECT id, person_id AS "personId", type, title, body,
         entity_type AS "entityType", entity_id AS "entityId", read, created_at AS "createdAt"
  FROM notification`;

export interface CreateNotificationInput {
  personId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationRow> {
  const { rows } = await pool.query(
    `INSERT INTO notification (person_id, type, title, body, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.personId, input.type, input.title, input.body, input.entityType ?? null, input.entityId ?? null]
  );
  return (await findNotificationById(rows[0].id))!;
}

export async function findNotificationById(id: string): Promise<NotificationRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listForPerson(personId: string, limit = 50): Promise<NotificationRow[]> {
  const { rows } = await pool.query(`${SELECT} WHERE person_id = $1 ORDER BY created_at DESC LIMIT $2`, [personId, limit]);
  return rows;
}

export async function countUnread(personId: string): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM notification WHERE person_id = $1 AND read = false`, [
    personId,
  ]);
  return Number(rows[0].n);
}

/** Scoped to `personId` so one person can never mark another's notification read. */
export async function markRead(id: string, personId: string): Promise<NotificationRow | null> {
  await pool.query(`UPDATE notification SET read = true WHERE id = $1 AND person_id = $2`, [id, personId]);
  return findNotificationById(id);
}

export async function markAllRead(personId: string): Promise<void> {
  await pool.query(`UPDATE notification SET read = true WHERE person_id = $1 AND read = false`, [personId]);
}

/**
 * "Clear all" in the bell tray — permanently removes the caller's own rows.
 * Note lastNotificationAt() below derives broadcast re-ping timing from these
 * rows; clearing can at worst cause one extra re-ping for an open seat, which
 * is acceptable for a personal housekeeping action.
 */
export async function deleteAllForPerson(personId: string): Promise<void> {
  await pool.query(`DELETE FROM notification WHERE person_id = $1`, [personId]);
}

/**
 * CHANGE 3 — the 15-minute re-ping needs to know "when did we last broadcast
 * this," and there's no dedicated broadcast table to ask (no-schema-changes
 * constraint for this batch) — so this derives it from the notification rows
 * the broadcast itself already writes (one per recipient, same entityType/
 * entityId/type every round). No new schema: just the newest timestamp
 * among rows that already exist for this entity.
 */
export async function lastNotificationAt(
  entityType: string,
  entityId: string,
  type: NotificationType
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT MAX(created_at) AS "lastAt" FROM notification WHERE entity_type = $1 AND entity_id = $2 AND type = $3`,
    [entityType, entityId, type]
  );
  return rows[0].lastAt ?? null;
}
