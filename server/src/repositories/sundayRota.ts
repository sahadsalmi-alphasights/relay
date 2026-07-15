import { pool } from "../db";

export interface SundayRotaRow {
  id: string;
  rotaDate: string;
  personId: string;
  teamId: string;
}

const SELECT = `SELECT id, rota_date AS "rotaDate", person_id AS "personId", team_id AS "teamId" FROM sunday_rota`;

export async function findRotaEntryById(id: string): Promise<SundayRotaRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listRotaForTeam(teamId: string, from?: string, to?: string): Promise<SundayRotaRow[]> {
  const params: unknown[] = [teamId];
  let sql = `${SELECT} WHERE team_id = $1`;
  if (from) {
    params.push(from);
    sql += ` AND rota_date >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    sql += ` AND rota_date <= $${params.length}`;
  }
  sql += " ORDER BY rota_date";
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** §4 Rule 2 — the set of person ids rostered for one exact Dubai calendar date. */
export async function findRotaEntry(rotaDate: string, personId: string): Promise<SundayRotaRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE rota_date = $1 AND person_id = $2`, [rotaDate, personId]);
  return rows[0] ?? null;
}

export async function addRotaEntry(rotaDate: string, personId: string, teamId: string): Promise<SundayRotaRow> {
  const { rows } = await pool.query(
    `INSERT INTO sunday_rota (rota_date, person_id, team_id) VALUES ($1, $2, $3)
     ON CONFLICT (rota_date, person_id) DO NOTHING RETURNING id`,
    [rotaDate, personId, teamId]
  );
  if (rows.length === 0) {
    return (await findRotaEntry(rotaDate, personId))!;
  }
  return (await findRotaEntryById(rows[0].id))!;
}

export async function removeRotaEntry(id: string): Promise<void> {
  await pool.query(`DELETE FROM sunday_rota WHERE id = $1`, [id]);
}
