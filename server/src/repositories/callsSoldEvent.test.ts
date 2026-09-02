import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { updateAngleFields } from "./angles";
import { callsSoldVelocity } from "./monthlyReview";
import { resetAndSeedFixture, type Fixture } from "../test/fixtures";

let fx: Fixture;
beforeEach(async () => {
  fx = await resetAndSeedFixture();
});

const WIDE_START = "2000-01-01T00:00:00Z";
const WIDE_END = "2100-01-01T00:00:00Z";

describe("calls-sold ledger + velocity", () => {
  it("records a signed delta on each change and totals positive movement", async () => {
    const { rows: pr } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'C', 'https://x.test/c', 'Strategy', 'Global', 'active') RETURNING id`,
      [fx.plAlpha]
    );
    const { rows: ar } = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total, calls_sold) VALUES ($1, 'Main', 10, 4, 0) RETURNING id`,
      [pr[0].id]
    );
    const angleId = ar[0].id;

    await updateAngleFields(angleId, { callsSold: 3 }); // +3
    await updateAngleFields(angleId, { callsSold: 5 }); // +2
    await updateAngleFields(angleId, { callsSold: 5 }); // no change, no row
    await updateAngleFields(angleId, { callsSold: 4 }); // -1 (correction)

    const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM calls_sold_event WHERE angle_id = $1`, [angleId]);
    expect(rows[0].count).toBe(3); // no-op skipped

    const v = await callsSoldVelocity(WIDE_START, WIDE_END);
    expect(v.total).toBe(5); // sum of positive deltas: 3 + 2 (the -1 correction doesn't count as sold)
    expect(v.byWeek.length).toBeGreaterThan(0);
  });
});
