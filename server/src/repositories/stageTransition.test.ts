import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { setAssignmentStage } from "./assignments";
import { firstDeliverableTimingForMonth, reworkForMonth } from "./monthlyReview";
import { resetAndSeedFixture, type Fixture } from "../test/fixtures";

let fx: Fixture;
beforeEach(async () => {
  fx = await resetAndSeedFixture();
});

const WIDE_START = "2000-01-01T00:00:00Z";
const WIDE_END = "2100-01-01T00:00:00Z";

async function seedAssignment(): Promise<string> {
  const { rows: pr } = await pool.query<{ id: string }>(
    `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
     VALUES ($1, 'C', 'https://x.test/c', 'Strategy', 'Global', 'active') RETURNING id`,
    [fx.plAlpha]
  );
  const { rows: ar } = await pool.query<{ id: string }>(
    `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 3, 4) RETURNING id`,
    [pr[0].id]
  );
  const { rows: asg } = await pool.query<{ id: string }>(
    `INSERT INTO assignment (angle_id, deliverer_id, goal, custom_goal, stage) VALUES ($1, $2, 4, 0, 'First Deliverable') RETURNING id`,
    [ar[0].id, fx.delivererAlpha]
  );
  return asg[0].id;
}

describe("stage-transition capture + timing metrics", () => {
  it("records a transition on stage change and computes timing + rework", async () => {
    const id = await seedAssignment();

    await setAssignmentStage(id, "Second Deliverable"); // forward: leaves First Deliverable
    await setAssignmentStage(id, "First Deliverable"); // backward: rework
    await setAssignmentStage(id, "First Deliverable"); // no-op: not recorded

    const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM stage_transition WHERE assignment_id = $1`, [id]);
    expect(rows[0].count).toBe(2); // the no-op set is skipped

    const timing = await firstDeliverableTimingForMonth(WIDE_START, WIDE_END);
    expect(timing.completed).toBe(1); // one exit from First Deliverable
    expect(timing.avgHours).not.toBeNull();

    const rework = await reworkForMonth(WIDE_START, WIDE_END);
    expect(rework).toBe(1); // Second → First is a backward move
  });
});
