import { pool } from "../db";

export interface TeamRow {
  id: string;
  name: string;
}

export async function listTeams(): Promise<TeamRow[]> {
  const { rows } = await pool.query(`SELECT id, name FROM team ORDER BY name`);
  return rows;
}

export async function findTeamById(id: string): Promise<TeamRow | null> {
  const { rows } = await pool.query(`SELECT id, name FROM team WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createTeam(name: string): Promise<TeamRow> {
  const { rows } = await pool.query(`INSERT INTO team (name) VALUES ($1) RETURNING id, name`, [name]);
  return rows[0];
}

export async function renameTeam(id: string, name: string): Promise<TeamRow | null> {
  const { rows } = await pool.query(`UPDATE team SET name = $2 WHERE id = $1 RETURNING id, name`, [id, name]);
  return rows[0] ?? null;
}

/** Hard delete — routes only allow this for teams with no members; other FK references (rota history, …) still make Postgres refuse. */
export async function deleteTeam(id: string): Promise<void> {
  await pool.query(`DELETE FROM team WHERE id = $1`, [id]);
}
