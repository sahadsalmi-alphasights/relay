import { pool } from "../db";

export interface SundaySwapRequestRow {
  id: string;
  rotaDate: string;
  requestedBy: string;
  note: string | null;
  resolved: boolean;
}

const SELECT = `
  SELECT id, rota_date AS "rotaDate", requested_by AS "requestedBy", note, resolved
  FROM sunday_swap_request`;

export async function createSwapRequest(
  rotaDate: string,
  requestedBy: string,
  note?: string
): Promise<SundaySwapRequestRow> {
  const { rows } = await pool.query(
    `INSERT INTO sunday_swap_request (rota_date, requested_by, note) VALUES ($1, $2, $3) RETURNING id`,
    [rotaDate, requestedBy, note ?? null]
  );
  return (await findSwapRequestById(rows[0].id))!;
}

export async function findSwapRequestById(id: string): Promise<SundaySwapRequestRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listSwapRequestsForTeam(teamId: string, onlyUnresolved = true): Promise<SundaySwapRequestRow[]> {
  let sql = `
    SELECT sr.id, sr.rota_date AS "rotaDate", sr.requested_by AS "requestedBy", sr.note, sr.resolved
    FROM sunday_swap_request sr JOIN person p ON p.id = sr.requested_by
    WHERE p.team_id = $1`;
  if (onlyUnresolved) sql += " AND sr.resolved = false";
  const { rows } = await pool.query(sql, [teamId]);
  return rows;
}

export async function resolveSwapRequest(id: string): Promise<SundaySwapRequestRow> {
  await pool.query(`UPDATE sunday_swap_request SET resolved = true WHERE id = $1`, [id]);
  return (await findSwapRequestById(id))!;
}
