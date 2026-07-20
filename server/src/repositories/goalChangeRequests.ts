import { pool } from "../db";
import type { ProjectStatus } from "../rules/types";

export interface GoalChangeRequestRow {
  id: string;
  assignmentId: string;
  requestedBy: string;
  body: string;
  /** Batch S, item 4 — the actual numeric ask, required going forward; existing pre-Batch-S rows predate this and stay null. */
  requestedGoal: number | null;
  /** Batch S, item 4 — the deliverer's requested project status, required going forward alongside requestedGoal. */
  requestedStatus: ProjectStatus | null;
  resolved: boolean;
  /** Batch S, item 4 — distinguishes accept from decline; null while unresolved. */
  outcome: "accepted" | "declined" | null;
}

const SELECT = `
  SELECT id, assignment_id AS "assignmentId", requested_by AS "requestedBy", body,
         requested_goal AS "requestedGoal", requested_status AS "requestedStatus",
         resolved, outcome
  FROM goal_change_request`;

export async function createGoalChangeRequest(
  assignmentId: string,
  requestedBy: string,
  body: string,
  requestedGoal: number,
  requestedStatus: ProjectStatus
): Promise<GoalChangeRequestRow> {
  const { rows } = await pool.query(
    `INSERT INTO goal_change_request (assignment_id, requested_by, body, requested_goal, requested_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [assignmentId, requestedBy, body, requestedGoal, requestedStatus]
  );
  return (await findGoalChangeRequestById(rows[0].id))!;
}

export async function findGoalChangeRequestById(id: string): Promise<GoalChangeRequestRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Batch S, item 4 — resolve now records which way it went, not just that it's handled. */
export async function resolveGoalChangeRequest(
  id: string,
  outcome: "accepted" | "declined"
): Promise<GoalChangeRequestRow> {
  await pool.query(`UPDATE goal_change_request SET resolved = true, outcome = $2 WHERE id = $1`, [id, outcome]);
  return (await findGoalChangeRequestById(id))!;
}

export async function listUnresolvedForProject(projectId: string): Promise<GoalChangeRequestRow[]> {
  const { rows } = await pool.query(
    `SELECT gcr.id, gcr.assignment_id AS "assignmentId", gcr.requested_by AS "requestedBy",
            gcr.body, gcr.requested_goal AS "requestedGoal", gcr.requested_status AS "requestedStatus",
            gcr.resolved, gcr.outcome
     FROM goal_change_request gcr
     JOIN assignment a ON a.id = gcr.assignment_id
     JOIN angle ang ON ang.id = a.angle_id
     WHERE ang.project_id = $1 AND gcr.resolved = false`,
    [projectId]
  );
  return rows;
}
