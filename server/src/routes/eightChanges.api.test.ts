import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { DEMO_AS_OF_HEADER } from "../lib/requestTime";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

const WEEKDAY_MORNING = "2023-01-02T06:00:00Z"; // Monday 10:00 Dubai — before 15:00, US pool asleep
const WEEKDAY_EVENING = "2023-01-02T12:00:00Z"; // Monday 16:00 Dubai — after 15:00, US pool live

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

describe("change 4 — project type changes goal and staffing", () => {
  it("Pitch at N=0 suggests a flat default goal of 8, staffed to 1", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 0, projectType: "Pitch" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ goal: 8, staffing: { delivererCount: 1 } });
  });

  it("Due Diligence at N=10 -> 30 profiles, 5 deliverers, 6 each", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 10, projectType: "Due Diligence" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.goal).toBe(30);
    expect(body.staffing.delivererCount).toBe(5);
    expect(body.goal / body.staffing.delivererCount).toBe(6);
  });

  it("rejects N=0 for a non-Pitch type", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 0, projectType: "Strategy" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("a no-calls Pitch's load is a flat 1 end-to-end (capacity ranking), regardless of remaining profiles", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_PitchZero', 'https://example.test/proj/pitchzero', 'Pitch', 'US only', 'active') RETURNING id`,
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
      // US pool, evening -- would otherwise double-weight this if it weren't pinned.
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
    });
    const row = res.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha);
    expect(row.load).toBe(1);
  });

  it("a Pitch converts to normal load the moment its calls_n is set above 0", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_PitchConverts', 'https://example.test/proj/pitchconverts', 'Pitch', 'Global', 'active') RETURNING id`,
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

    const before = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(before.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha).load).toBe(1);

    // The client agrees to calls -> PATCH calls_n above 0. goalTotal pinned
    // explicitly at 8 so this test isolates the Pitch-conversion load
    // calculation, not the separate "editing N re-suggests goal" cascade.
    await app.inject({
      method: "PATCH",
      url: `/angles/${angleRows[0].id}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 3, goalTotal: 8 },
    });

    const after = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    // remaining(8) * First Deliverable(2) * Global(1) = 16, not pinned at 1 anymore.
    expect(after.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha).load).toBe(16);
  });
});

describe("BUG 1 (fixed) — pool weight never gates logging work", () => {
  it("a deliverer can log delivered/custom profiles on a dormant US-pool project before 15:00 Dubai", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_Dormant', 'https://example.test/proj/dormant', 'Strategy', 'US only', 'active') RETURNING id`,
      [fx.plAlpha]
    );
    const { rows: angleRows } = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 4, 8) RETURNING id`,
      [rows[0].id]
    );
    const { rows: aRows } = await pool.query<{ id: string }>(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, delivered, custom_goal, custom_delivered)
       VALUES ($1, $2, 8, 0, 3, 0) RETURNING id`,
      [angleRows[0].id, fx.delivererAlpha]
    );

    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${aRows[0].id}/progress`,
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING }, // US pool dormant right now
      payload: { delivered: 3, customDelivered: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().delivered).toBe(3);
    expect(res.json().customDelivered).toBe(1);
  });
});

describe("change 5 — stage change prompts a new goal, starting a new round", () => {
  it("advancing stage then setting a new goal archives the old round and resets delivered to 0", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    // fx.assignment starts at goal 8, delivered 2, First Deliverable.
    const advanceRes = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/stage/advance`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(advanceRes.json().stage).toBe("Second Deliverable");

    const goalRes = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { goal: 12 },
    });
    expect(goalRes.statusCode).toBe(200);
    expect(goalRes.json().goal).toBe(12);
    expect(goalRes.json().delivered).toBe(0);
    expect(goalRes.json().stage).toBe("Second Deliverable");

    const roundsRes = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}/rounds`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    const { history } = roundsRes.json();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ goal: 8, delivered: 2 });
  });
});

describe("change 6 — manual override and downward goal revisions land in the audit trail", () => {
  it("an override at project creation logs who was picked instead of whom, with the justification", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_Override",
        projectLink: "https://example.test/proj/override",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [
          {
            name: "Main",
            callsN: 2,
            goalTotal: 6,
            assignments: [
              {
                delivererId: fx.otherDelivererAlpha,
                goal: 6,
                override: { justification: "client specifically asked for this person" },
              },
            ],
          },
        ],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const projectId = createRes.json().id;

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'assignment' AND action = 'manual_override' AND entity_id = $1`,
      [projectId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].new_value.pickedInstead).toBe(fx.otherDelivererAlpha);
    expect(rows[0].new_value.justification).toBe("client specifically asked for this person");
    expect(rows[0].actor_id).toBe(fx.plAlpha);
  });

  it("swapping with an override justification also logs to the audit trail", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/swap`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { newDelivererId: fx.otherDelivererAlpha, override: { justification: "prior relationship with the client" } },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'assignment' AND action = 'manual_override' AND entity_id = $1`,
      [fx.assignment]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].new_value.pickedInstead).toBe(fx.otherDelivererAlpha);
    expect(rows[0].new_value.justification).toBe("prior relationship with the client");
  });

  it("does not log an override entry when no justification is given (an ordinary swap)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/swap`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { newDelivererId: fx.otherDelivererAlpha },
    });

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'assignment' AND action = 'manual_override' AND entity_id = $1`,
      [fx.assignment]
    );
    expect(rows).toHaveLength(0);
  });

  it("revising the suggested goal downwards at intake is audit-logged", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    // Strategy at N=4 suggests goal 8 (N*2); confirm below that.
    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_LowerGoal",
        projectLink: "https://example.test/proj/lowergoal",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 4, goalTotal: 5, assignments: [] }],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const projectId = createRes.json().id;
    const { rows: angleRows } = await pool.query(`SELECT id FROM angle WHERE project_id = $1`, [projectId]);

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'angle' AND action = 'downward_goal_revision' AND entity_id = $1`,
      [angleRows[0].id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].old_value.suggestedGoal).toBe(8);
    expect(rows[0].new_value.goalTotal).toBe(5);
  });

  it("does not log a downward revision when the goal meets or exceeds the suggestion", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_MeetsGoal",
        projectLink: "https://example.test/proj/meetsgoal",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 4, goalTotal: 8, assignments: [] }],
      },
    });
    const projectId = createRes.json().id;
    const { rows: angleRows } = await pool.query(`SELECT id FROM angle WHERE project_id = $1`, [projectId]);

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'angle' AND action = 'downward_goal_revision' AND entity_id = $1`,
      [angleRows[0].id]
    );
    expect(rows).toHaveLength(0);
  });
});
