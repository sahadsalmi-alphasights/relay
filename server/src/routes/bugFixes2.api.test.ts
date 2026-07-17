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

describe("BUG 1 (fixed) — free/busy label consistent with the Pitch flat-load rule", () => {
  it("a person whose only work is a no-calls Pitch shows as free, not busy", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    // fx.otherDelivererAlpha starts with no assignments at all.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_PitchOnly', 'https://example.test/proj/pitchonly', 'Pitch', 'Global', 'active') RETURNING id`,
      [fx.plAlpha]
    );
    const { rows: angleRows } = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 0, 8) RETURNING id`,
      [rows[0].id]
    );
    await pool.query(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, delivered, custom_goal, custom_delivered, stage)
       VALUES ($1, $2, 8, 0, 3, 0, 'First Deliverable')`,
      [angleRows[0].id, fx.otherDelivererAlpha]
    );

    const res = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    const row = res.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha);
    expect(row.rawRemaining).toBe(0); // the Pitch's 8 remaining profiles are excluded
    expect(row.free).toBe(true);
    expect(row.load).toBe(1); // still pinned flat per the existing Pitch rule
  });

  it("the same Pitch's profiles count normally again once it converts (callsN > 0)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_PitchOnly2', 'https://example.test/proj/pitchonly2', 'Pitch', 'Global', 'active') RETURNING id`,
      [fx.plAlpha]
    );
    const { rows: angleRows } = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 0, 8) RETURNING id`,
      [rows[0].id]
    );
    await pool.query(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, delivered, custom_goal, custom_delivered, stage)
       VALUES ($1, $2, 8, 0, 3, 0, 'First Deliverable')`,
      [angleRows[0].id, fx.otherDelivererAlpha]
    );

    // goalTotal pinned explicitly at its current value (8) so this PATCH
    // isolates the Pitch-conversion behavior under test -- it doesn't also
    // exercise the separate "editing N re-suggests goal" cascade, which has
    // its own dedicated tests (see angles.api.test.ts).
    await app.inject({
      method: "PATCH",
      url: `/angles/${angleRows[0].id}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 3, goalTotal: 8 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    const row = res.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha);
    expect(row.rawRemaining).toBe(8);
  });
});

describe("BUG 2 (fixed) — staffing suggestion at low N", () => {
  it("N=1 -> 1 deliverer", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 1, projectType: "Strategy" },
    });
    expect(res.json().staffing).toEqual({ delivererCount: 1 });
  });

  it("N=2 -> 2 deliverers, not 1", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 2, projectType: "Strategy" },
    });
    expect(res.json().staffing).toEqual({ delivererCount: 2 });
  });

  it("N=3 -> ceil(3/2) = 2 deliverers", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 3, projectType: "Strategy" },
    });
    expect(res.json().staffing).toEqual({ delivererCount: 2 });
  });

  it("N=10 -> 5 deliverers (Due Diligence, same staffing rule as Strategy)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 10, projectType: "Due Diligence" },
    });
    expect(res.json().staffing).toEqual({ delivererCount: 5 });
  });
});
