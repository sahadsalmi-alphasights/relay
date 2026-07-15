import { pool } from "../db";

export interface DeliveryRoundRow {
  id: string;
  assignmentId: string;
  goal: number;
  delivered: number;
  customDelivered: number;
  closedAt: string;
}

const SELECT = `
  SELECT id, assignment_id AS "assignmentId", goal, delivered,
         custom_delivered AS "customDelivered", closed_at AS "closedAt"
  FROM delivery_round`;

export async function listRoundsForAssignment(assignmentId: string): Promise<DeliveryRoundRow[]> {
  const { rows } = await pool.query(`${SELECT} WHERE assignment_id = $1 ORDER BY closed_at ASC`, [assignmentId]);
  return rows;
}

/**
 * §3/§5 (domain change 9) — cumulative delivered across all rounds, for future
 * analytics: the sum of every archived round's delivered plus the assignment's
 * own current (live, unarchived) round.
 */
export async function cumulativeDeliveredForAssignment(
  assignmentId: string,
  currentDelivered: number
): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(delivered), 0) AS total FROM delivery_round WHERE assignment_id = $1`,
    [assignmentId]
  );
  return Number(rows[0].total) + currentDelivered;
}
