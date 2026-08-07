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
