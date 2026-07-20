import { pool, type Queryable } from "../db";
import { computeCustomGoal, suggestStaffing } from "../rules/suggestedGoal";
import type { ProjectType } from "../rules/types";

/**
 * Big structural change — a project always has at least one angle (a
 * "simple" project is just a project with one angle). N (calls_n), the
 * goal, and calls_sold all live here now, not on project: they're per
 * workstream, not per project. See RELAY_BUILD_SPEC.md §3a.
 */
export interface AngleRow {
  id: string;
  projectId: string;
  name: string;
  callsN: number;
  goalTotal: number;
  callsSold: number;
  callsSoldUpdatedAt: string;
}

const SELECT = `
  SELECT id, project_id AS "projectId", name, calls_n AS "callsN", goal_total AS "goalTotal",
         calls_sold AS "callsSold", calls_sold_updated_at AS "callsSoldUpdatedAt"
  FROM angle`;

export async function findAngleById(id: string, db: Queryable = pool): Promise<AngleRow | null> {
  const { rows } = await db.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listAnglesByProject(projectId: string): Promise<AngleRow[]> {
  const { rows } = await pool.query(`${SELECT} WHERE project_id = $1 ORDER BY created_at ASC`, [projectId]);
  return rows;
}

export async function createAngle(
  projectId: string,
  name: string,
  callsN: number,
  goalTotal: number,
  db: Queryable = pool
): Promise<AngleRow> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, $2, $3, $4) RETURNING id`,
    [projectId, name, callsN, goalTotal]
  );
  return (await findAngleById(rows[0].id, db))!;
}

const PATCHABLE_COLUMNS: Record<string, string> = {
  name: "name",
  callsN: "calls_n",
  goalTotal: "goal_total",
  callsSold: "calls_sold",
};

/** Same free-form patch pattern as updateProjectFields -- stamps calls_sold_updated_at whenever callsSold is touched, same as project used to. */
export async function updateAngleFields(id: string, patch: Record<string, unknown>): Promise<AngleRow> {
  const sets: string[] = [];
  const params: unknown[] = [id];

  for (const [key, column] of Object.entries(PATCHABLE_COLUMNS)) {
    if (key in patch) {
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if ("callsSold" in patch) {
    sets.push(`calls_sold_updated_at = now()`);
  }
  if (sets.length > 0) {
    await pool.query(`UPDATE angle SET ${sets.join(", ")} WHERE id = $1`, params);
  }
  return (await findAngleById(id))!;
}

export async function deleteAngle(id: string): Promise<void> {
  await pool.query(`DELETE FROM angle WHERE id = $1`, [id]);
}

export async function countAssignmentsForAngle(angleId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM assignment WHERE angle_id = $1`, [
    angleId,
  ]);
  return Number(rows[0].count);
}

export async function countAnglesForProject(projectId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM angle WHERE project_id = $1`, [
    projectId,
  ]);
  return Number(rows[0].count);
}

/**
 * CHANGE 3 — the broadcast fallback's "seat target" for an angle, always
 * `suggestStaffing(callsN, projectType)` recomputed live from the SAME
 * formula intake itself uses — no new column stores it. Deliberate
 * simplification (no-schema-changes constraint for this batch): if the PL
 * manually dialed the intake stepper away from the suggested headcount
 * before the zero-eligible match happened, the broadcast still targets the
 * FORMULA count, not whatever the PL had set — there's nowhere to persist a
 * PL override without a new column. Revisit if a schema change is later
 * approved for this feature.
 */
export function seatTargetForAngle(callsN: number, projectType: ProjectType): number {
  return suggestStaffing(callsN, projectType).delivererCount;
}

/**
 * CHANGE 3 — atomic first-come seat claim. Locks the angle row so two
 * concurrent claims serialize: the second waits for the first's transaction
 * to commit, then re-reads the now-current assignment count and correctly
 * refuses if the target's already met. WebSockets only ever broadcast
 * "something changed" (see ws/hub.ts) — they never enforce this count
 * themselves; this transaction is the only place the count is authoritative.
 *
 * Returns null (no throw) for every "seat's gone" reason — already full,
 * already-claimed-by-this-same-person, or angle not found — so the route
 * layer can turn any of them into a plain 409 without distinguishing which.
 */
/**
 * A broadcast project stays `status = 'open'` until every angle has hit its
 * seat target; once they all have, flip it to `active` so it drops off the
 * broadcast list. Shared by the /accept and /angles/:id/claim routes so the two
 * claim paths behave identically. Returns whether the project is now fully staffed.
 */
export async function activateProjectIfFullyStaffed(projectId: string, projectType: ProjectType): Promise<boolean> {
  const angles = await listAnglesByProject(projectId);
  for (const a of angles) {
    const filled = await countAssignmentsForAngle(a.id);
    if (filled < seatTargetForAngle(a.callsN, projectType)) return false;
  }
  await pool.query(`UPDATE project SET status = 'active' WHERE id = $1 AND status = 'open'`, [projectId]);
  return true;
}

export async function claimAngleSeat(
  angleId: string,
  delivererId: string,
  goal: number
): Promise<{ id: string } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: angleRows } = await client.query<{ id: string; callsN: number; projectId: string }>(
      `SELECT id, calls_n AS "callsN", project_id AS "projectId" FROM angle WHERE id = $1 FOR UPDATE`,
      [angleId]
    );
    if (angleRows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const angle = angleRows[0];

    const { rows: projectRows } = await client.query<{ projectType: ProjectType }>(
      `SELECT project_type AS "projectType" FROM project WHERE id = $1`,
      [angle.projectId]
    );
    const projectType = projectRows[0].projectType;
    const target = seatTargetForAngle(angle.callsN, projectType);

    const { rows: countRows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM assignment WHERE angle_id = $1`,
      [angleId]
    );
    if (countRows[0].n >= target) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows: existing } = await client.query(
      `SELECT id FROM assignment WHERE angle_id = $1 AND deliverer_id = $2`,
      [angleId, delivererId]
    );
    if (existing.length > 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, custom_goal) VALUES ($1, $2, $3, $4) RETURNING id`,
      [angleId, delivererId, goal, computeCustomGoal(goal)]
    );
    await client.query("COMMIT");
    return { id: inserted[0].id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
