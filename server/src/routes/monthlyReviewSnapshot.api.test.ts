import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { snapshotClosedReviewMonths } from "../services/monthlyReviewSnapshot";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

const NOW = new Date("2026-09-15T12:00:00Z"); // September current, August closed
const DEMO = { "x-demo-as-of": NOW.toISOString() };

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  fx = await resetAndSeedFixture();
});

const cookieOf = (c: string) => c.split("=")[1];
const makeOwner = (id: string) => pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [id]);

describe("monthly-review month-end snapshot", () => {
  it("freezes a closed month; frozen figures survive live drift; current stays live", async () => {
    const { rows: pr } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status, created_at)
       VALUES ($1, 'AugCo', 'https://x.test/a', 'Strategy', 'Global', 'active', '2026-08-10T08:00:00Z') RETURNING id`,
      [fx.plAlpha]
    );
    await pool.query(`INSERT INTO angle (project_id, name, calls_n, goal_total, calls_sold) VALUES ($1, 'Main', 10, 4, 2)`, [pr[0].id]);

    expect(await snapshotClosedReviewMonths(NOW)).toBe(1); // 2026-08 frozen
    expect(await snapshotClosedReviewMonths(NOW)).toBe(0); // idempotent

    // Live drift after the month closed.
    await pool.query(`UPDATE angle SET calls_sold = 999, calls_n = 999 WHERE project_id = $1`, [pr[0].id]);

    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const cookies = { relay_session: cookieOf(cookie) };

    const aug = await app.inject({ method: "GET", url: "/analytics/monthly-review?month=2026-08", cookies, headers: DEMO });
    const b = aug.json();
    expect(b.isFrozen).toBe(true);
    expect(b.marketShare.callsSold).toBe(2); // frozen, not 999
    expect(b.marketShare.n).toBe(10);
    expect(b.byType.find((t: { type: string }) => t.type === "Strategy").callsSold).toBe(2);

    const sep = await app.inject({ method: "GET", url: "/analytics/monthly-review", cookies, headers: DEMO });
    expect(sep.json().isFrozen).toBe(false); // current month never frozen
  });
});
