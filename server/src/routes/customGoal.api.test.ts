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
});

describe("domain change 7 — custom_goal is always auto-calculated, never set by hand", () => {
  it("computes custom_goal from goal on project creation, ignoring any customGoal the client sends", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_CustomGoal",
        projectLink: "https://example.test/proj/customgoal",
        projectType: "Pitch",
        expertPool: "Global",
        angles: [
          {
            name: "Main",
            callsN: 4,
            goalTotal: 10,
            // A malicious or stale client tries to set customGoal directly —
            // the server must ignore it and derive its own value from goal.
            assignments: [{ delivererId: fx.delivererAlpha, goal: 10, customGoal: 999 }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const project = res.json();

    const { rows } = await pool.query(
      "SELECT a.custom_goal FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = $1",
      [project.id]
    );
    expect(rows[0].custom_goal).toBe(4); // MAX(ROUNDUP(10*0.33), 1) = 4
  });

  it("recomputes custom_goal whenever the PL changes goal, ignoring a customGoal in the same request", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { goal: 6, customGoal: 0 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goal).toBe(6);
    expect(body.customGoal).toBe(2); // MAX(ROUNDUP(6*0.33), 1) = 2, not the 0 the client sent

    const { rows } = await pool.query("SELECT custom_goal FROM assignment WHERE id = $1", [fx.assignment]);
    expect(rows[0].custom_goal).toBe(2);
  });

  it("is 0 for a goal of 0 or 1 — too small to carve out a custom share", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { goal: 1 },
    });
    expect(res.json().customGoal).toBe(0);
  });

  it("rejects a goal-edit request with no goal at all — there is nothing else this route can change", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { customGoal: 5 },
    });
    expect(res.statusCode).toBe(400);
  });
});
