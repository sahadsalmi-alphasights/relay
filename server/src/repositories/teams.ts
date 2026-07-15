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
