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

describe("Big structural change — a single-angle project behaves exactly as before", () => {
  it("creating a project with one angle looks and works identically to the old flat shape", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_Simple",
        projectLink: "https://example.test/proj/simple",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 4, goalTotal: 8, assignments: [{ delivererId: fx.otherDelivererAlpha, goal: 8 }] }],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const projectId = createRes.json().id;

    const detail = await app.inject({
      method: "GET",
      url: `/projects/${projectId}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    const { project, angles, assignments } = detail.json();
    // Project-level totals read exactly like the pre-angle flat shape.
    expect(project.callsN).toBe(4);
    expect(project.goalTotal).toBe(8);
    expect(project.callsSold).toBe(0);
    expect(angles).toHaveLength(1);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].angleId).toBe(angles[0].id);
  });
});

describe("Big structural change — a two-angle project calculates and sums independently", () => {
  async function createTwoAngleProject(cookie: string) {
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_TwoAngles",
        projectLink: "https://example.test/proj/twoangles",
        projectType: "Due Diligence",
        expertPool: "Global",
        angles: [
          { name: "Buy-side", callsN: 3, goalTotal: 9, assignments: [{ delivererId: fx.delivererAlpha, goal: 9 }] },
          { name: "Sell-side", callsN: 10, goalTotal: 30, assignments: [{ delivererId: fx.otherDelivererAlpha, goal: 15 }] },
        ],
      },
    });
    return res;
  }

  it("each angle's goal comes from its OWN N, not the project's, and totals sum correctly", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const createRes = await createTwoAngleProject(cookie);
    expect(createRes.statusCode).toBe(200);
    const projectId = createRes.json().id;

    const detail = await app.inject({
      method: "GET",
      url: `/projects/${projectId}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    const { project, angles } = detail.json();

    const buySide = angles.find((a: { name: string }) => a.name === "Buy-side");
    const sellSide = angles.find((a: { name: string }) => a.name === "Sell-side");
    expect(buySide.callsN).toBe(3);
    expect(buySide.goalTotal).toBe(9);
    expect(sellSide.callsN).toBe(10);
    expect(sellSide.goalTotal).toBe(30);

    // Project totals are the SUM across angles (3+10=13, 9+30=39), not
    // either angle's own number and not some other derivation.
    expect(project.callsN).toBe(13);
    expect(project.goalTotal).toBe(39);
  });

  it("staffing suggestions run per angle from that angle's own N (N=10 Due Diligence -> 5 deliverers, per §5b)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const buySideSuggest = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 3, projectType: "Due Diligence" },
    });
    expect(buySideSuggest.json()).toEqual({ goal: 9, staffing: { delivererCount: 2 } });

    const sellSideSuggest = await app.inject({
      method: "POST",
      url: "/projects/intake/suggest",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 10, projectType: "Due Diligence" },
    });
    expect(sellSideSuggest.json()).toEqual({ goal: 30, staffing: { delivererCount: 5 } });
  });

  it("assignments attach to the right angle -- each assignment's angleId matches the angle it was created under", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const createRes = await createTwoAngleProject(cookie);
    const projectId = createRes.json().id;

    const detail = await app.inject({
      method: "GET",
      url: `/projects/${projectId}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    const { angles, assignments } = detail.json();
    const buySide = angles.find((a: { name: string }) => a.name === "Buy-side");
    const sellSide = angles.find((a: { name: string }) => a.name === "Sell-side");

    const buySideAssignment = assignments.find((a: { delivererId: string }) => a.delivererId === fx.delivererAlpha);
    const sellSideAssignment = assignments.find((a: { delivererId: string }) => a.delivererId === fx.otherDelivererAlpha);
    expect(buySideAssignment.angleId).toBe(buySide.id);
    expect(buySideAssignment.angleName).toBe("Buy-side");
    expect(sellSideAssignment.angleId).toBe(sellSide.id);
    expect(sellSideAssignment.angleName).toBe("Sell-side");
  });

  it("chase-client is correct per angle -- a resolved angle never masks a genuinely lagging one, or vice versa", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const createRes = await createTwoAngleProject(cookie);
    const projectId = createRes.json().id;
    const detail1 = await app.inject({
      method: "GET",
      url: `/projects/${projectId}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    const angles1 = detail1.json().angles;
    const buySide = angles1.find((a: { name: string }) => a.name === "Buy-side");
    const sellSide = angles1.find((a: { name: string }) => a.name === "Sell-side");
    const assignments1 = detail1.json().assignments;
    const buySideAssignment = assignments1.find((a: { delivererId: string }) => a.delivererId === fx.delivererAlpha);
    const sellSideAssignment = assignments1.find((a: { delivererId: string }) => a.delivererId === fx.otherDelivererAlpha);

    // Buy-side: fully delivered AND fully sold (resolved, no chase needed).
    // Progress can only be logged by the assignment's own deliverer (§5e),
    // not the PL -- use each assignee's own cookie for their PATCH.
    const delivererAlphaCookie = await loginAs(app, fx.delivererAlpha);
    await app.inject({
      method: "PATCH",
      url: `/assignments/${buySideAssignment.id}/progress`,
      cookies: { relay_session: delivererAlphaCookie.split("=")[1] },
      payload: { delivered: 9 },
    });
    await app.inject({
      method: "PATCH",
      url: `/angles/${buySide.id}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsSold: 3 },
    });
    // Sell-side: nothing delivered yet (not started -- also no chase needed,
    // since chase only fires once something has actually been delivered).
    // callsSold stays 0, delivered stays 0.
    void sellSide;

    const detail2 = await app.inject({
      method: "GET",
      url: `/projects/${projectId}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    // Neither angle individually needs chasing -- if this were computed from
    // SUMMED totals (totalDelivered=9>0, callsSold=3<13=callsN) it would
    // wrongly fire. Per-angle-then-OR gets this right.
    expect(detail2.json().project.chaseClient).toBe(false);

    // Now make sell-side actually lag: deliver some, sell none.
    const otherDelivererCookie = await loginAs(app, fx.otherDelivererAlpha);
    await app.inject({
      method: "PATCH",
      url: `/assignments/${sellSideAssignment.id}/progress`,
      cookies: { relay_session: otherDelivererCookie.split("=")[1] },
      payload: { delivered: 4 },
    });
    const detail3 = await app.inject({
      method: "GET",
      url: `/projects/${projectId}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(detail3.json().project.chaseClient).toBe(true);
  });
});

describe("Big structural change — editing an angle's N", () => {
  it("re-suggests the goal and, since the angle has an active assignment, cascades through the rounds mechanism (new round archived)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    // fx.angle starts at calls_n=4, goal_total=8 on a Pitch project; fx.assignment has goal=8, delivered=2.
    const before = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(before.json().goal).toBe(8);
    expect(before.json().delivered).toBe(2);

    // Edit N upward without pinning goalTotal -- forces a re-suggestion.
    // Pitch converts to Strategy math once N>0: suggestGoal(6, "Pitch") = 6*2=12.
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/angles/${fx.angle}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsN: 6 },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().goalTotal).toBe(12);

    // The cascade pushed the new goal through updateAssignmentGoal -- same
    // mechanism a stage-driven goal change uses: old round archived,
    // delivered reset to 0 under the new goal.
    const after = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(after.json().goal).toBe(12);
    expect(after.json().delivered).toBe(0);

    const rounds = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}/rounds`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(rounds.json().history).toHaveLength(1);
    expect(rounds.json().history[0]).toMatchObject({ goal: 8, delivered: 2 });
  });

  it("does NOT cascade/re-suggest when N is unchanged (editing just the name, say)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/angles/${fx.angle}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { name: "Renamed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Renamed");
    expect(res.json().goalTotal).toBe(8); // unchanged

    const assignment = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(assignment.json().delivered).toBe(2); // untouched, no round archived
  });

  it("is PL-only and audit-logged", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/angles/${fx.angle}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { name: "Hijacked" },
    });
    expect(res.statusCode).toBe(403);

    const plCookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "PATCH",
      url: `/angles/${fx.angle}`,
      cookies: { relay_session: plCookie.split("=")[1] },
      payload: { name: "Renamed" },
    });
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'angle' AND action = 'update_fields' AND entity_id = $1`,
      [fx.angle]
    );
    expect(rows).toHaveLength(1);
  });
});

describe("Big structural change — angle add/remove", () => {
  it("PL can add a new angle to an existing project; it starts unstaffed", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/angles`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { name: "New workstream", callsN: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("New workstream");
    expect(res.json().goalTotal).toBeGreaterThan(0); // auto-suggested since not provided

    const detail = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(detail.json().angles).toHaveLength(2);
  });

  it("deletes a staffed angle, cascading its assignments, when it isn't the project's last angle (2026-07-22)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    // Give the project a second angle so fx.angle isn't the last one.
    await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/angles`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { name: "Extra", callsN: 1, goalTotal: 3 },
    });
    // fx.angle is staffed (fx.assignment) — deleting it now cascades that
    // assignment away in one action (used to be refused with a 400).
    const res = await app.inject({
      method: "DELETE",
      url: `/angles/${fx.angle}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(200);
    // The staffed angle's assignment is gone with it.
    const gone = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(gone.statusCode).toBe(404);
    // The rest of the project (the Extra angle) is untouched.
    const detail = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(detail.json().angles).toHaveLength(1);
  });

  it("refuses to delete a project's last angle, even if empty", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    // Clear the fixture angle's one assignment first via direct SQL (no
    // route exists to delete an assignment outright), then try to delete
    // the now-empty, but only, angle.
    await pool.query(`DELETE FROM assignment WHERE id = $1`, [fx.assignment]);
    const res = await app.inject({
      method: "DELETE",
      url: `/angles/${fx.angle}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("allows deleting an empty angle when the project has another one left", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const addRes = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/angles`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { name: "Extra", callsN: 1, goalTotal: 3 },
    });
    const extraAngleId = addRes.json().id;

    const res = await app.inject({
      method: "DELETE",
      url: `/angles/${extraAngleId}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(detail.json().angles).toHaveLength(1);
  });
});

describe("Per-angle archive / resurface (2026-07-22)", () => {
  it("archives one angle (paused) and resurfaces it, without touching the rest of the project", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const session = { relay_session: cookie.split("=")[1] };
    // Add a second angle so fx.angle isn't the project's only active one.
    const addRes = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/angles`,
      cookies: session,
      payload: { name: "Extra", callsN: 1, goalTotal: 3 },
    });
    const extraAngleId = addRes.json().id;

    const archived = await app.inject({ method: "POST", url: `/angles/${fx.angle}/archive`, cookies: session });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().archivedAt).not.toBeNull();

    // The angle still exists (both angles come back on the detail fetch — the
    // Edit sheet needs the archived one to offer Resurface); it's just paused.
    const detail = await app.inject({ method: "GET", url: `/projects/${fx.project}`, cookies: session });
    expect(detail.json().angles).toHaveLength(2);
    expect(detail.json().angles.find((a: { id: string }) => a.id === fx.angle).archivedAt).not.toBeNull();
    expect(detail.json().angles.find((a: { id: string }) => a.id === extraAngleId).archivedAt).toBeNull();

    const resurfaced = await app.inject({ method: "POST", url: `/angles/${fx.angle}/resurface`, cookies: session });
    expect(resurfaced.statusCode).toBe(200);
    expect(resurfaced.json().archivedAt).toBeNull();
  });

  it("refuses to archive the project's only active angle (archive the project instead)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/angles/${fx.angle}/archive`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("is PL/manager-only", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/angles/${fx.angle}/archive`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Remove a real deliverer from an angle (2026-07-22)", () => {
  it("lets the PL delete a non-ghost assignment, leaving the angle unstaffed", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const session = { relay_session: cookie.split("=")[1] };
    // fx.assignment is a real (non-ghost) deliverer on fx.angle.
    const res = await app.inject({ method: "DELETE", url: `/assignments/${fx.assignment}`, cookies: session });
    expect(res.statusCode).toBe(200);

    const gone = await app.inject({ method: "GET", url: `/assignments/${fx.assignment}`, cookies: session });
    expect(gone.statusCode).toBe(404);

    // The angle itself survives — it's simply unstaffed now.
    const detail = await app.inject({ method: "GET", url: `/projects/${fx.project}`, cookies: session });
    expect(detail.json().angles).toHaveLength(1);
    expect(detail.json().assignments).toHaveLength(0);
  });
});
