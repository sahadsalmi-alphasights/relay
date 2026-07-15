import { pool } from "../db";
import { computeCustomGoal } from "../rules/suggestedGoal";
import type { ExpertPool, Stage } from "../rules/types";

export interface AssignmentRow {
  id: string;
  projectId: string;
  delivererId: string;
  goal: number;
  delivered: number;
  customGoal: number;
  customDelivered: number;
  /** §3/§8 (domain change 8) — stage is per-deliverer, not per-project. */
  stage: Stage;
  stageEnteredAt: string;
  /** §9 (built) — last time delivered/custom_delivered changed; feeds the stale-first-deliverable scheduler. */
  progressUpdatedAt: string;
  /** §9 (built) — highest 30-min multiple already notified for, so the scheduler never repeats itself. */
  staleNotifiedThresholdMinutes: number;
}

const SELECT = `
  SELECT id, project_id AS "projectId", deliverer_id AS "delivererId", goal, delivered,
         custom_goal AS "customGoal", custom_delivered AS "customDelivered",
         stage, stage_entered_at AS "stageEnteredAt",
         progress_updated_at AS "progressUpdatedAt",
         stale_notified_threshold_minutes AS "staleNotifiedThresholdMinutes"
  FROM assignment`;

export async function findAssignmentById(id: string): Promise<AssignmentRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listAssignmentsByProject(projectId: string): Promise<AssignmentRow[]> {
  const { rows } = await pool.query(`${SELECT} WHERE project_id = $1`, [projectId]);
  return rows;
}

export interface AssignmentWithProject extends AssignmentRow {
  projectExpertPool: ExpertPool;
}

export async function listAssignmentsWithProjectByDeliverer(delivererId: string): Promise<AssignmentWithProject[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.project_id AS "projectId", a.deliverer_id AS "delivererId", a.goal, a.delivered,
            a.custom_goal AS "customGoal", a.custom_delivered AS "customDelivered",
            a.stage, a.stage_entered_at AS "stageEnteredAt", p.expert_pool AS "projectExpertPool"
     FROM assignment a JOIN project p ON p.id = a.project_id
     WHERE a.deliverer_id = $1 AND p.archived = false`,
    [delivererId]
  );
  return rows;
}

/** §5 (domain change 7) — custom_goal is always derived from goal, never accepted from a caller. */
export async function createAssignment(projectId: string, delivererId: string, goal: number): Promise<AssignmentRow> {
  const { rows } = await pool.query(
    `INSERT INTO assignment (project_id, deliverer_id, goal, custom_goal) VALUES ($1, $2, $3, $4) RETURNING id`,
    [projectId, delivererId, goal, computeCustomGoal(goal)]
  );
  return (await findAssignmentById(rows[0].id))!;
}

export async function updateAssignmentProgress(
  id: string,
  patch: { delivered?: number; customDelivered?: number }
): Promise<AssignmentRow> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (patch.delivered !== undefined) {
    params.push(patch.delivered);
    sets.push(`delivered = $${params.length}`);
  }
  if (patch.customDelivered !== undefined) {
    params.push(patch.customDelivered);
    sets.push(`custom_delivered = $${params.length}`);
  }
  if (sets.length > 0) {
    // §9 (built) — any progress log resets the stale-first-deliverable clock
    // and its notification bookkeeping; "no progress logged" is no longer true.
    sets.push(`progress_updated_at = now()`, `stale_notified_threshold_minutes = 0`);
    await pool.query(`UPDATE assignment SET ${sets.join(", ")} WHERE id = $1`, params);
  }
  return (await findAssignmentById(id))!;
}

/**
 * §5e — the only place goal/custom_goal are ever written. Callers MUST check
 * canEditGoal() before reaching this; this function itself does not enforce
 * authorization, only persistence.
 *
 * §5 (domain change 7) — custom_goal is never accepted as input here; it's
 * always recomputed from the new goal, since it's part of the goal (not a
 * separate target the PL sets by hand).
 *
 * §3/§5 (domain change 9) — a goal change always closes the current round:
 * the existing (goal, delivered, custom_delivered) is archived to
 * delivery_round, then the assignment resets to 0 delivered under the new
 * goal. Done in one transaction with a row lock so a concurrent goal change
 * or delivery-log can't interleave with the archive.
 */
export async function updateAssignmentGoal(id: string, patch: { goal: number }): Promise<AssignmentRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT goal, delivered, custom_delivered AS "customDelivered" FROM assignment WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const current = rows[0];
    await client.query(
      `INSERT INTO delivery_round (assignment_id, goal, delivered, custom_delivered) VALUES ($1, $2, $3, $4)`,
      [id, current.goal, current.delivered, current.customDelivered]
    );
    await client.query(
      `UPDATE assignment
       SET goal = $2, custom_goal = $3, delivered = 0, custom_delivered = 0,
           progress_updated_at = now(), stale_notified_threshold_minutes = 0
       WHERE id = $1`,
      [id, patch.goal, computeCustomGoal(patch.goal)]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return (await findAssignmentById(id))!;
}

export async function updateAssignmentDeliverer(id: string, delivererId: string): Promise<AssignmentRow> {
  await pool.query(`UPDATE assignment SET deliverer_id = $2 WHERE id = $1`, [id, delivererId]);
  return (await findAssignmentById(id))!;
}

/**
 * §6/§8 — advancing/backing a stage resets stage_entered_at, per-assignment now.
 * §9 (built) — also resets the stale-first-deliverable clock: a stage change
 * is itself activity, and re-entering First Deliverable later (via "back")
 * shouldn't inherit a stale notification history from a previous stint.
 */
export async function setAssignmentStage(id: string, stage: Stage): Promise<AssignmentRow> {
  await pool.query(
    `UPDATE assignment
     SET stage = $2, stage_entered_at = now(), progress_updated_at = now(), stale_notified_threshold_minutes = 0
     WHERE id = $1`,
    [id, stage]
  );
  return (await findAssignmentById(id))!;
}

/** §9 (built) — assignments the stale-first-deliverable scheduler needs to consider, with enough project context to notify. */
export interface StaleCandidate extends AssignmentRow {
  projectPlId: string;
}

export async function listFirstDeliverableAssignments(): Promise<StaleCandidate[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.project_id AS "projectId", a.deliverer_id AS "delivererId", a.goal, a.delivered,
            a.custom_goal AS "customGoal", a.custom_delivered AS "customDelivered",
            a.stage, a.stage_entered_at AS "stageEnteredAt",
            a.progress_updated_at AS "progressUpdatedAt",
            a.stale_notified_threshold_minutes AS "staleNotifiedThresholdMinutes",
            p.pl_id AS "projectPlId"
     FROM assignment a JOIN project p ON p.id = a.project_id
     WHERE a.stage = 'First Deliverable' AND p.archived = false`
  );
  return rows;
}

/** §9 (built) — records the highest threshold notified for, so the scheduler never repeats itself for the same idle stretch. */
export async function markStaleNotified(id: string, thresholdMinutes: number): Promise<void> {
  await pool.query(`UPDATE assignment SET stale_notified_threshold_minutes = $2 WHERE id = $1`, [id, thresholdMinutes]);
}
