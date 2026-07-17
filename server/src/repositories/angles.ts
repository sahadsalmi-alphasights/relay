import { pool } from "../db";

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

export async function findAngleById(id: string): Promise<AngleRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
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
  goalTotal: number
): Promise<AngleRow> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, $2, $3, $4) RETURNING id`,
    [projectId, name, callsN, goalTotal]
  );
  return (await findAngleById(rows[0].id))!;
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
