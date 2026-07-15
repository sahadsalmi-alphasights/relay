import { pool } from "../db";

export interface GoalChangeRequestRow {
  id: string;
  assignmentId: string;
  requestedBy: string;
  body: string;
  resolved: boolean;
}

const SELECT = `
  SELECT id, assignment_id AS "assignmentId", requested_by AS "requestedBy", body, resolved
  FROM goal_change_request`;

export async function createGoalChangeRequest(
  assignmentId: string,
  requestedBy: string,
  body: string
): Promise<GoalChangeRequestRow> {
  const { rows } = await pool.query(
    `INSERT INTO goal_change_request (assignment_id, requested_by, body) VALUES ($1, $2, $3) RETURNING id`,
    [assignmentId, requestedBy, body]
  );
  return (await findGoalChangeRequestById(rows[0].id))!;
}

export async function findGoalChangeRequestById(id: string): Promise<GoalChangeRequestRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function resolveGoalChangeRequest(id: string): Promise<GoalChangeRequestRow> {
  await pool.query(`UPDATE goal_change_request SET resolved = true WHERE id = $1`, [id]);
  return (await findGoalChangeRequestById(id))!;
}

export async function listUnresolvedForProject(projectId: string): Promise<GoalChangeRequestRow[]> {
  const { rows } = await pool.query(
    `SELECT gcr.id, gcr.assignment_id AS "assignmentId", gcr.requested_by AS "requestedBy",
            gcr.body, gcr.resolved
     FROM goal_change_request gcr JOIN assignment a ON a.id = gcr.assignment_id
     WHERE a.project_id = $1 AND gcr.resolved = false`,
    [projectId]
  );
  return rows;
}
