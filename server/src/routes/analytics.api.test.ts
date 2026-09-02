import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
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
  await pool.query(`DELETE FROM usage_event`);
});

const cookieOf = (c: string) => c.split("=")[1];
const makeOwner = (id: string) => pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [id]);

const post = (app: FastifyInstance, cookie: string, url: string, payload: unknown) =>
  app.inject({ method: "POST", url, cookies: { relay_session: cookieOf(cookie) }, payload });
const get = (app: FastifyInstance, cookie: string, url: string) =>
  app.inject({ method: "GET", url, cookies: { relay_session: cookieOf(cookie) } });

describe("POST /usage-events", () => {
  it("records allowed events and silently drops unknown ones", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await post(app, cookie, "/usage-events", {
      events: [
        { event: "screen_view", context: { screen: "Delivery" } },
        { event: "prompt_dismissed", context: { prompt: "lunch" } },
        { event: "totally_made_up", context: { x: 1 } },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(2); // the bogus one is dropped

    const { rows } = await pool.query(`SELECT event, person_id, team_id FROM usage_event ORDER BY event`);
    expect(rows.map((r) => r.event)).toEqual(["prompt_dismissed", "screen_view"]);
    // Identity is stamped server-side from the session, not the client.
    expect(rows.every((r) => r.person_id === fx.delivererAlpha && r.team_id === fx.teamAlpha)).toBe(true);
  });

  it("drops prototype-polluting context keys without polluting Object.prototype", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await post(app, cookie, "/usage-events", {
      events: [{ event: "screen_view", context: { __proto__: { polluted: true }, screen: "PL" } }],
    });
    expect(res.statusCode).toBe(200);
    // The malicious key never reaches a prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const { rows } = await pool.query(`SELECT context FROM usage_event WHERE event = 'screen_view'`);
    // Only the safe key survives; __proto__ is stripped.
    expect(rows[0].context).toEqual({ screen: "PL" });
  });

  it("requires auth", async () => {
    const res = await app.inject({ method: "POST", url: "/usage-events", payload: { events: [{ event: "screen_view" }] } });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /analytics", () => {
  it("is owner-only", async () => {
    const managerCookie = await loginAs(app, fx.plAlpha); // manager, not owner
    expect((await get(app, managerCookie, "/analytics")).statusCode).toBe(403);

    await makeOwner(fx.plAlpha);
    const ownerCookie = await loginAs(app, fx.plAlpha);
    expect((await get(app, ownerCookie, "/analytics")).statusCode).toBe(200);
  });

  it("rejects an invalid window", async () => {
    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    expect((await get(app, cookie, "/analytics?window=nonsense")).statusCode).toBe(400);
  });

  it("aggregates recorded usage into the by-event and by-team panels", async () => {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    await post(app, delivererCookie, "/usage-events", {
      events: [
        { event: "screen_view", context: { screen: "PL" } },
        { event: "screen_view", context: { screen: "Delivery" } },
        { event: "intake_suggestion_error" },
      ],
    });

    await makeOwner(fx.plAlpha);
    const ownerCookie = await loginAs(app, fx.plAlpha);
    const res = await get(app, ownerCookie, "/analytics?window=30d");
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const screen = body.usageByEvent.find((r: { label: string }) => r.label === "screen_view");
    expect(screen?.count).toBe(2);
    // The intake error surfaces in the friction panel.
    const friction = body.friction.find((f: { key: string }) => f.key === "intake_suggestion_error");
    expect(friction?.count).toBe(1);
    // Team_Alpha has all three events (the deliverer's team).
    const team = body.byTeam.find((r: { label: string }) => r.label === "Team_Alpha");
    expect(team?.count).toBe(3);
  });
});

describe("GET /analytics/monthly-review", () => {
  it("rejects a non-owner", async () => {
    const cookie = await loginAs(app, fx.plAlpha); // manager, not owner
    const res = await get(app, cookie, "/analytics/monthly-review");
    expect(res.statusCode).toBe(403);
  });

  it("returns the month's commercial, delivery, pipeline and live capacity blocks", async () => {
    // Isolate from the fixture's seeded project so the month totals are exact.
    await pool.query(`DELETE FROM assignment`);
    await pool.query(`DELETE FROM angle`);
    await pool.query(`DELETE FROM project`);
    // A project created this month with an angle (3 sold of 10) and a
    // non-ghost assignment that hit its goal (goal 4, delivered 4).
    const { rows: pr } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status, created_at)
       VALUES ($1, 'Acme', 'https://x.test/a', 'Strategy', 'Global', 'active', now()) RETURNING id`,
      [fx.plAlpha]
    );
    const { rows: ar } = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total, calls_sold) VALUES ($1, 'Main', 10, 4, 3) RETURNING id`,
      [pr[0].id]
    );
    await pool.query(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, delivered, custom_goal, custom_delivered, stage)
       VALUES ($1, $2, 4, 4, 0, 0, 'First Deliverable')`,
      [ar[0].id, fx.delivererAlpha]
    );

    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await get(app, cookie, "/analytics/monthly-review");
    expect(res.statusCode).toBe(200);
    const b = res.json();

    expect(b.marketShare.callsSold).toBe(3);
    expect(b.marketShare.n).toBe(10);
    expect(b.byType.find((t: { type: string }) => t.type === "Strategy").callsSold).toBe(3);
    expect(b.goals.projectsTotal).toBe(1);
    expect(b.goals.projectsHit).toBe(1);
    expect(b.goals.deliveredTotal).toBe(4);
    expect(b.pipeline.created).toBe(1);
    expect(b.trend).toHaveLength(6);
    expect(b.capacityNow).toHaveProperty("medianLoad");
    // Enrich blocks are present and shaped.
    expect(b.byPool.find((p: { pool: string }) => p.pool === "Global").n).toBe(10);
    expect(b.topClients[0].client).toBe("Acme");
    expect(b.goalDistribution.find((x: { bucket: string }) => x.bucket === "100%+").count).toBe(1);
    expect(b.stageMix.find((s: { stage: string }) => s.stage === "First Deliverable").count).toBe(1);
    expect(Array.isArray(b.chase)).toBe(true);
    expect(Array.isArray(b.stuck)).toBe(true);
    expect(b.intakeByPool.find((p: { pool: string }) => p.pool === "Global").count).toBe(1);
    expect(b.goalChangeOutcomes).toHaveProperty("accepted");
    expect(typeof b.staleCallsSold).toBe("number");
    // Available-now batch present and shaped.
    expect(b.clientMix.total).toBe(1);
    expect(b.clientMix.newClients).toBe(1);
    expect(b.avgDealByType.find((t: { type: string }) => t.type === "Strategy").n).toBe(10);
    expect(b.customVsSystem.system).toBe(4);
    expect(typeof b.overdueFirstDeliverables).toBe("number");
    expect(b.deliveredByTeam.find((t: { team: string }) => t.team === "Team_Alpha").delivered).toBe(4);
    expect(b.statusBreakdown.find((s: { status: string }) => s.status === "Available").count).toBeGreaterThan(0);
    expect(b.roster).toHaveProperty("active");
    expect(b.pipelineByPL[0].pl).toBe("PL_Alpha");
    expect(typeof b.autoArchived).toBe("number");
    expect(b.hygiene).toHaveProperty("anglesNoDemand");
    expect(b.capacityNow).toHaveProperty("byPractice");
  });

  it("rejects a malformed month", async () => {
    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await get(app, cookie, "/analytics/monthly-review?month=2026-13");
    expect(res.statusCode).toBe(400);
  });
});
