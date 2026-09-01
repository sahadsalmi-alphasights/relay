import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { snapshotClosedMonths } from "../services/marketShareSnapshot";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

// Pinned "now" so the closed/current-month split is deterministic regardless of
// the machine clock: September 2026 is current, August 2026 is closed.
const NOW = new Date("2026-09-15T12:00:00Z");
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

const cookieVal = (c: string) => c.substring(c.indexOf("=") + 1);

async function seedCard(client: string, sold: number, n: number, createdAt: string): Promise<string> {
  const { rows: pr } = await pool.query<{ id: string }>(
    `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status, created_at)
     VALUES ($1, $2, 'https://example.test/x', 'Strategy', 'Global', 'active', $3) RETURNING id`,
    [fx.plAlpha, client, createdAt]
  );
  await pool.query(`INSERT INTO angle (project_id, name, calls_n, goal_total, calls_sold) VALUES ($1, 'Main', $2, $2, $3)`, [
    pr[0].id,
    n,
    sold,
  ]);
  return pr[0].id;
}

describe("market-share month-end snapshots", () => {
  it("freezes closed months, never the current one, and is idempotent", async () => {
    await seedCard("AugCo", 2, 10, "2026-08-10T08:00:00Z");
    await seedCard("SepCo", 1, 4, "2026-09-05T08:00:00Z");

    expect(await snapshotClosedMonths(NOW)).toBe(1); // only 2026-08
    const { rows } = await pool.query<{ monthKey: string }>(
      `SELECT DISTINCT month_key AS "monthKey" FROM market_share_snapshot`
    );
    expect(rows.map((r) => r.monthKey)).toEqual(["2026-08"]);

    expect(await snapshotClosedMonths(NOW)).toBe(0); // nothing new the second time
  });

  it("a frozen month keeps its numbers even after the live angle drifts", async () => {
    const augProject = await seedCard("AugCo", 2, 10, "2026-08-10T08:00:00Z");
    await snapshotClosedMonths(NOW);

    // Someone edits the August card after the month closed.
    await pool.query(`UPDATE angle SET calls_sold = 999, calls_n = 999 WHERE project_id = $1`, [augProject]);

    const cookie = await loginAs(app, fx.plAlpha);
    const cookies = { relay_session: cookieVal(cookie) };

    const res = await app.inject({ method: "GET", url: "/projects/market-share?scope=bu&month=2026-08", cookies, headers: DEMO });
    const body = res.json();
    expect(body.final).toBe(true);
    expect(body.callsSold).toBe(2); // frozen, not 999
    expect(body.n).toBe(10);
  });

  it("the current month stays live (not final)", async () => {
    await seedCard("SepCo", 1, 4, "2026-09-05T08:00:00Z");
    await snapshotClosedMonths(NOW);

    const cookie = await loginAs(app, fx.plAlpha);
    const cookies = { relay_session: cookieVal(cookie) };
    const res = await app.inject({ method: "GET", url: "/projects/market-share?scope=bu", cookies, headers: DEMO });
    const body = res.json();
    expect(body.month).toBe("2026-09");
    expect(body.final).toBeFalsy();
    expect(body.callsSold).toBe(1);
  });

  it("the CSV export reads frozen values for a closed month", async () => {
    const augProject = await seedCard("AugCo", 2, 10, "2026-08-10T08:00:00Z");
    await snapshotClosedMonths(NOW);
    await pool.query(`UPDATE angle SET calls_sold = 999 WHERE project_id = $1`, [augProject]);

    await pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [fx.plAlpha]);
    const cookie = await loginAs(app, fx.plAlpha);
    const cookies = { relay_session: cookieVal(cookie) };

    const res = await app.inject({ method: "GET", url: "/projects/market-share/export.csv?scope=bu&month=2026-08", cookies, headers: DEMO });
    expect(res.statusCode).toBe(200);
    const body = res.body.replace(/^﻿/, "");
    const aug = body.split("\r\n").find((l) => l.includes("AugCo"))!;
    expect(aug).toContain("AugCo,Main,2,10,0.2000");
    expect(aug).not.toContain("999");
  });
});
