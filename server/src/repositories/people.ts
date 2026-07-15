import { pool } from "../db";
import type { PersonStatus } from "../rules/types";

export interface PersonRow {
  id: string;
  email: string;
  name: string;
  teamId: string | null;
  isManager: boolean;
  practiceArea: string | null;
  status: PersonStatus;
  eveningCoverage: boolean;
}

const SELECT = `
  SELECT id, email, name, team_id AS "teamId", is_manager AS "isManager",
         practice_area AS "practiceArea", status, evening_coverage AS "eveningCoverage"
  FROM person`;

export async function findPersonById(id: string): Promise<PersonRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findPersonByEmail(email: string): Promise<PersonRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE lower(email) = lower($1)`, [email]);
  return rows[0] ?? null;
}

/**
 * §7 — on first OIDC login, upsert a person row from the ID token's
 * email/name claims. No team yet (team_id stays NULL) -- the existing §7a
 * onboarding screen picks that up client-side exactly as it already does
 * for a DEV_AUTH-created person.
 */
export async function findOrCreatePersonByEmail(email: string, name: string): Promise<PersonRow> {
  const existing = await findPersonByEmail(email);
  if (existing) return existing;
  const { rows } = await pool.query(`INSERT INTO person (email, name) VALUES ($1, $2) RETURNING id`, [
    email,
    name,
  ]);
  return (await findPersonById(rows[0].id))!;
}

export async function listPeople(): Promise<PersonRow[]> {
  const { rows } = await pool.query(`${SELECT} ORDER BY name`);
  return rows;
}

export async function listPeopleByTeam(teamId: string): Promise<PersonRow[]> {
  const { rows } = await pool.query(`${SELECT} WHERE team_id = $1 ORDER BY name`, [teamId]);
  return rows;
}

export async function updatePersonStatus(id: string, status: PersonStatus): Promise<PersonRow> {
  await pool.query(`UPDATE person SET status = $2 WHERE id = $1`, [id, status]);
  return (await findPersonById(id))!;
}

export async function updateEveningCoverage(id: string, eveningCoverage: boolean): Promise<PersonRow> {
  await pool.query(`UPDATE person SET evening_coverage = $2 WHERE id = $1`, [id, eveningCoverage]);
  return (await findPersonById(id))!;
}

export async function assignTeam(personId: string, teamId: string, makeManager: boolean): Promise<PersonRow> {
  await pool.query(
    `UPDATE person SET team_id = $2, is_manager = is_manager OR $3 WHERE id = $1`,
    [personId, teamId, makeManager]
  );
  return (await findPersonById(personId))!;
}

/** §7b — a manager removing a member from their team; the person becomes unassigned (re-onboards via §7a). */
export async function removeFromTeam(personId: string): Promise<PersonRow> {
  await pool.query(`UPDATE person SET team_id = NULL, is_manager = false WHERE id = $1`, [personId]);
  return (await findPersonById(personId))!;
}

/** People not yet on any team — candidates a manager can add to their own team. */
export async function listUnassignedPeople(): Promise<PersonRow[]> {
  const { rows } = await pool.query(`${SELECT} WHERE team_id IS NULL ORDER BY name`);
  return rows;
}

/** Unweighted total remaining across every assignment a person holds — used for the §7b status-change warning. */
export async function countOutstandingProfiles(personId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(goal - (delivered + custom_delivered), 0)), 0) AS outstanding
     FROM assignment WHERE deliverer_id = $1`,
    [personId]
  );
  return Number(rows[0].outstanding);
}
