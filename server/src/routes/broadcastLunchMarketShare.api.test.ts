import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { expireOutToLunch, findPersonById, updateOutToLunch } from "../repositories/people";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

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

describe("broadcast drops an angle once it's manually staffed (2026-07-29)", () => {
  it("a manually-staffed open project leaves the broadcast and flips active", async () => {
    // An OPEN Strategy project with a single unstaffed angle (callsN 1 → seat
    // target 1, so one manual assignment fully staffs it).
    const { rows: pr } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_Open', 'https://example.test/open', 'Strategy', 'Global', 'open') RETURNING id`,
      [fx.plAlpha]
    );
    const openProject = pr[0].id;
    const { rows: ar } = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Solo', 1, 4) RETURNING id`,
      [openProject]
    );
    const openAngle = ar[0].id;

    const cookie = await loginAs(app, fx.plAlpha);
    const cookies = { relay_session: cookieVal(cookie) };

    const before = await app.inject({ method: "GET", url: "/projects/broadcasts", cookies });
    expect(before.json().some((r: { angleId: string }) => r.angleId === openAngle)).toBe(true);

    const staff = await app.inject({
      method: "POST",
      url: `/projects/${openProject}/assignments`,
      cookies,
      payload: { angleId: openAngle, delivererId: fx.otherDelivererAlpha, goal: 4 },
    });
    expect(staff.statusCode).toBe(200);

    // The bug: it used to linger here. Now it's gone and the project is active.
    const after = await app.inject({ method: "GET", url: "/projects/broadcasts", cookies });
    expect(after.json().some((r: { angleId: string }) => r.angleId === openAngle)).toBe(false);

    const detail = await app.inject({ method: "GET", url: `/projects/${openProject}`, cookies });
    expect(detail.json().project.status).toBe("active");
  });
});

describe("monthly market share (2026-07-29)", () => {
  it("sums sold/N for this month and INCLUDES soft-deleted cards", async () => {
    // Fixture project (this month, pl = plAlpha, one angle callsN 4). Sell 2.
    await pool.query(`UPDATE angle SET calls_sold = 2 WHERE id = $1`, [fx.angle]);
    const cookie = await loginAs(app, fx.plAlpha);
    const cookies = { relay_session: cookieVal(cookie) };

    const res = await app.inject({ method: "GET", url: "/projects/market-share?scope=mine", cookies });
    expect(res.json()).toMatchObject({ callsSold: 2, n: 4 });
    expect(res.json().share).toBeCloseTo(0.5);

    // Soft-delete the project — market share must STILL count it (the one read
    // that deliberately ignores deleted_at).
    await pool.query(`UPDATE project SET deleted_at = now() WHERE id = $1`, [fx.project]);
    const afterDelete = await app.inject({ method: "GET", url: "/projects/market-share?scope=mine", cookies });
    expect(afterDelete.json()).toMatchObject({ callsSold: 2, n: 4 });
  });

  it("returns a null share (neutral) when in-scope N is 0", async () => {
    await pool.query(`UPDATE angle SET calls_n = 0, calls_sold = 0 WHERE id = $1`, [fx.angle]);
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "GET",
      url: "/projects/market-share?scope=mine",
      cookies: { relay_session: cookieVal(cookie) },
    });
    expect(res.json()).toMatchObject({ n: 0, callsSold: 0, share: null });
  });
});

describe("out-to-lunch auto-off window (2026-07-29)", () => {
  it("expireOutToLunch clears only sessions older than the cutoff", async () => {
    await updateOutToLunch(fx.delivererAlpha, true);
    expect((await findPersonById(fx.delivererAlpha))!.outToLunch).toBe(true);

    // Cutoff an hour in the PAST: the just-stamped lunch is newer → not cleared.
    const clearedNone = await expireOutToLunch(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    expect(clearedNone).toBe(0);
    expect((await findPersonById(fx.delivererAlpha))!.outToLunch).toBe(true);

    // Cutoff in the FUTURE (simulating >1h elapsed): now it's expired.
    const clearedOne = await expireOutToLunch(new Date(Date.now() + 1000).toISOString());
    expect(clearedOne).toBeGreaterThanOrEqual(1);
    expect((await findPersonById(fx.delivererAlpha))!.outToLunch).toBe(false);
  });
});
