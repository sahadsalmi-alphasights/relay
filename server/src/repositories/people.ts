import { pool } from "../db";
import type { PersonStatus } from "../rules/types";

export type Role = "owner" | "manager" | "member";

export interface PersonRow {
  id: string;
  email: string;
  name: string;
  teamId: string | null;
  isManager: boolean;
  isOwner: boolean;
  practiceArea: string | null;
  status: PersonStatus;
  eveningCoverage: boolean;
  /** "Invisible competition" — manager-set, team-scoped, reversible. Never defaulted true. */
  isGhost: boolean;
  lastLoginAt: string | null;
  deactivatedAt: string | null;
}

/** role(person) = owner ? 'owner' : manager ? 'manager' : 'member'. */
export function roleOf(p: { isOwner: boolean; isManager: boolean }): Role {
  return p.isOwner ? "owner" : p.isManager ? "manager" : "member";
}

const SELECT = `
  SELECT id, email, name, team_id AS "teamId", is_manager AS "isManager",
         is_owner AS "isOwner", practice_area AS "practiceArea", status,
         evening_coverage AS "eveningCoverage", is_ghost AS "isGhost",
         last_login_at AS "lastLoginAt", deactivated_at AS "deactivatedAt"
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

/** Manager-only (enforced at the route), team-scoped, reversible. */
export async function setGhostFlag(id: string, isGhost: boolean): Promise<PersonRow> {
  await pool.query(`UPDATE person SET is_ghost = $2 WHERE id = $1`, [id, isGhost]);
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

// ---------------------------------------------------------------------------
// User management (owner portal) — role changes, login tracking, deactivation.
// ---------------------------------------------------------------------------

/** Stamp the last successful login; called from the OIDC callback. */
export async function markLogin(id: string): Promise<void> {
  await pool.query(`UPDATE person SET last_login_at = now() WHERE id = $1`, [id]);
}

/** Grant/revoke Owner. Owner is a superset of Manager, enforced in rules. */
export async function setOwner(id: string, isOwner: boolean): Promise<PersonRow> {
  await pool.query(`UPDATE person SET is_owner = $2 WHERE id = $1`, [id, isOwner]);
  return (await findPersonById(id))!;
}

/**
 * Set a person's role from the portal. member -> neither flag; manager ->
 * is_manager only; owner -> is_owner (keeps is_manager too so nothing that
 * still checks is_manager directly loses access when someone is promoted).
 */
export async function setRole(id: string, role: Role): Promise<PersonRow> {
  const isOwner = role === "owner";
  const isManager = role === "owner" || role === "manager";
  await pool.query(`UPDATE person SET is_owner = $2, is_manager = $3 WHERE id = $1`, [id, isOwner, isManager]);
  return (await findPersonById(id))!;
}

/** Revoke sign-in access without deleting the person or their history. */
export async function setDeactivated(id: string, deactivated: boolean): Promise<PersonRow> {
  await pool.query(
    `UPDATE person SET deactivated_at = ${deactivated ? "now()" : "NULL"} WHERE id = $1`,
    [id]
  );
  return (await findPersonById(id))!;
}

/** Owner-only profile edit: name / practice area / team / status (any of them). */
export async function updateProfile(
  id: string,
  fields: { name?: string; practiceArea?: string | null; teamId?: string | null; status?: PersonStatus }
): Promise<PersonRow> {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name = $${vals.length}`); }
  if (fields.practiceArea !== undefined) { vals.push(fields.practiceArea); sets.push(`practice_area = $${vals.length}`); }
  if (fields.teamId !== undefined) { vals.push(fields.teamId); sets.push(`team_id = $${vals.length}`); }
  if (fields.status !== undefined) { vals.push(fields.status); sets.push(`status = $${vals.length}`); }
  if (sets.length > 0) {
    await pool.query(`UPDATE person SET ${sets.join(", ")} WHERE id = $1`, vals);
  }
  return (await findPersonById(id))!;
}

/** Owner-only: pre-provision a user by email so their role/team are ready on first SSO login. Throws if the email already exists. */
export async function createUser(email: string, name: string): Promise<PersonRow> {
  const existing = await findPersonByEmail(email);
  if (existing) throw new Error("exists");
  const { rows } = await pool.query(`INSERT INTO person (email, name) VALUES ($1, $2) RETURNING id`, [email, name]);
  return (await findPersonById(rows[0].id))!;
}

export interface AdminUserRow extends PersonRow {
  teamName: string | null;
  role: Role;
}

/** Full roster for the owner portal, with team name resolved and role derived. */
export async function listPeopleAdmin(): Promise<AdminUserRow[]> {
  const { rows } = await pool.query(
    `SELECT p.id, p.email, p.name, p.team_id AS "teamId", t.name AS "teamName",
            p.is_manager AS "isManager", p.is_owner AS "isOwner",
            p.practice_area AS "practiceArea", p.status,
            p.evening_coverage AS "eveningCoverage", p.is_ghost AS "isGhost",
            p.last_login_at AS "lastLoginAt", p.deactivated_at AS "deactivatedAt"
     FROM person p LEFT JOIN team t ON t.id = p.team_id
     ORDER BY p.is_owner DESC, p.is_manager DESC, p.name`
  );
  return rows.map((r) => ({ ...r, role: roleOf(r) }));
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

/**
 * CHANGE 3 — broadcast fallback recipients. Deliberately NOT the same list
 * as matching's Available-only candidates: this is "who should hear that a
 * project is stuck at zero staffing," a much wider net than "who's currently
 * biddable." Sick and On vacation are never included, at any hour. Offline
 * is excluded during the working day but INCLUDED after hours (the
 * evening-coverage window, §4 Rule 3) — someone who's toggled off for the
 * night may still see the ask and choose to come back online for it.
 */
export async function listBroadcastRecipients(afterHours: boolean): Promise<PersonRow[]> {
  const excludedStatuses = afterHours ? ["Sick", "On vacation"] : ["Sick", "On vacation", "Offline"];
  const { rows } = await pool.query(`${SELECT} WHERE status <> ALL($1) ORDER BY name`, [excludedStatuses]);
  return rows;
}
