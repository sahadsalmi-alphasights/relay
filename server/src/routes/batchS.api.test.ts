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

function cookieHeader(cookie: string) {
  return { relay_session: cookie.split("=")[1] };
}

describe("Batch S — soft delete", () => {
  it("PL can soft-delete their project; it disappears from findById, listProjects, and capacity-ranking load", async () => {
    const cookie = await loginAs(app, fx.plAlpha);

    const before = await app.inject({ method: "GET", url: "/capacity-ranking", cookies: cookieHeader(cookie) });
    const beforeRow = before.json().find((r: { personId: string }) => r.personId === fx.delivererAlpha);
    expect(beforeRow.load).toBeGreaterThan(0);

    const del = await app.inject({ method: "POST", url: `/projects/${fx.project}/delete`, cookies: cookieHeader(cookie) });
    expect(del.statusCode).toBe(200);

    const getRes = await app.inject({ method: "GET", url: `/projects/${fx.project}`, cookies: cookieHeader(cookie) });
    expect(getRes.statusCode).toBe(404);

    const listRes = await app.inject({
      method: "GET",
      url: "/projects?role=leading&scope=mine&archived=false",
      cookies: cookieHeader(cookie),
    });
    expect(listRes.json().map((p: { id: string }) => p.id)).not.toContain(fx.project);

    const after = await app.inject({ method: "GET", url: "/capacity-ranking", cookies: cookieHeader(cookie) });
    const afterRow = after.json().find((r: { personId: string }) => r.personId === fx.delivererAlpha);
    expect(afterRow.load).toBe(0);
  });

  it("a plain member may not delete someone else's project", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({ method: "POST", url: `/projects/${fx.project}/delete`, cookies: cookieHeader(cookie) });
    expect(res.statusCode).toBe(403);
  });

  it("a manager may delete any project, even outside their team (§7b update 2026-07-21)", async () => {
    const cookie = await loginAs(app, fx.managerBeta); // manager on Team_Beta; project is Team_Alpha's
    const res = await app.inject({ method: "POST", url: `/projects/${fx.project}/delete`, cookies: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);

    const { rows } = await pool.query(`SELECT deleted_at FROM project WHERE id = $1`, [fx.project]);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("is audit-logged, and the row is flagged not removed (soft delete, never a hard delete)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({ method: "POST", url: `/projects/${fx.project}/delete`, cookies: cookieHeader(cookie) });

    const { rows: auditRows } = await pool.query(`SELECT action FROM audit_log WHERE entity_id = $1`, [fx.project]);
    expect(auditRows.map((r) => r.action)).toContain("delete");

    const { rows: projectRows } = await pool.query(`SELECT deleted_at FROM project WHERE id = $1`, [fx.project]);
    expect(projectRows).toHaveLength(1);
    expect(projectRows[0].deleted_at).not.toBeNull();
  });

  it("a second delete on an already-deleted project 404s rather than double-flagging", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({ method: "POST", url: `/projects/${fx.project}/delete`, cookies: cookieHeader(cookie) });
    const second = await app.inject({ method: "POST", url: `/projects/${fx.project}/delete`, cookies: cookieHeader(cookie) });
    expect(second.statusCode).toBe(404);
  });
});

describe("Batch S — first_deliverable_last_at stamping", () => {
  it("stamps on assignment creation (every assignment starts in First Deliverable)", async () => {
    // fx.assignment was inserted directly by the fixture's raw SQL (not
    // through createAssignment()), so it predates the stamp -- this checks a
    // fresh one added through the real "add to team" route instead.
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/assignments`,
      cookies: cookieHeader(cookie),
      payload: { delivererId: fx.otherDelivererAlpha, goal: 3 },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await pool.query(`SELECT first_deliverable_last_at FROM assignment WHERE id = $1`, [
      res.json().id,
    ]);
    expect(rows[0].first_deliverable_last_at).not.toBeNull();
  });

  it("re-stamps when a stage change lands back on First Deliverable, but not on other transitions", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const { rows: initial } = await pool.query(`SELECT first_deliverable_last_at FROM assignment WHERE id = $1`, [
      fx.assignment,
    ]);
    // fx.assignment is a raw-SQL fixture row, so it starts null.
    expect(initial[0].first_deliverable_last_at).toBeNull();

    // Advance away from First Deliverable — should NOT stamp (it's not a
    // transition into First Deliverable).
    await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/stage/advance`,
      cookies: cookieHeader(cookie),
    });
    const { rows: afterAdvance } = await pool.query(`SELECT stage, first_deliverable_last_at FROM assignment WHERE id = $1`, [
      fx.assignment,
    ]);
    expect(afterAdvance[0].stage).toBe("Second Deliverable");
    expect(afterAdvance[0].first_deliverable_last_at).toBeNull();

    // Back to First Deliverable — this IS a transition into it, should stamp.
    await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/stage/back`,
      cookies: cookieHeader(cookie),
    });
    const { rows: afterBack } = await pool.query(`SELECT stage, first_deliverable_last_at FROM assignment WHERE id = $1`, [
      fx.assignment,
    ]);
    expect(afterBack[0].stage).toBe("First Deliverable");
    expect(afterBack[0].first_deliverable_last_at).not.toBeNull();
  });
});

describe("Batch S — three-tier project ordering", () => {
  it("unstaffed projects sort before staffed ones, and a recent first_deliverable_last_at sorts before a null one", async () => {
    const cookie = await loginAs(app, fx.plAlpha);

    // fx.project is staffed (fx.assignment) with a null first_deliverable_last_at (raw fixture insert).
    // Create a second, unstaffed project — should sort to the very top.
    const unstaffed = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      payload: {
        client: "Client_Unstaffed",
        projectLink: "https://example.test/proj/unstaffed",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 4, assignments: [] }],
      },
    });
    const unstaffedId = unstaffed.json().id;

    // Create a third project, staffed, whose assignment gets a fresh
    // first_deliverable_last_at via createAssignment() (real route, not raw SQL).
    const staffedFresh = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      payload: {
        client: "Client_StaffedFresh",
        projectLink: "https://example.test/proj/staffed-fresh",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [
          {
            name: "Main",
            callsN: 2,
            goalTotal: 4,
            assignments: [{ delivererId: fx.otherDelivererAlpha, goal: 4 }],
          },
        ],
      },
    });
    const staffedFreshId = staffedFresh.json().id;

    const list = await app.inject({
      method: "GET",
      url: "/projects?role=leading&scope=mine&archived=false",
      cookies: cookieHeader(cookie),
    });
    const order = list.json().map((p: { id: string }) => p.id);

    const unstaffedIdx = order.indexOf(unstaffedId);
    const staffedFreshIdx = order.indexOf(staffedFreshId);
    const nullStampIdx = order.indexOf(fx.project);

    expect(unstaffedIdx).toBeLessThan(staffedFreshIdx);
    expect(unstaffedIdx).toBeLessThan(nullStampIdx);
    // Tier 2 (has a real timestamp) sorts before tier 3 (null timestamp).
    expect(staffedFreshIdx).toBeLessThan(nullStampIdx);
  });
});

describe("Batch S — goal-change request accept/decline", () => {
  async function createRequest(requestedGoal: number, requestedStatus: string) {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests`,
      cookies: cookieHeader(delivererCookie),
      payload: { body: "pool is thin", requestedGoal, requestedStatus },
    });
    expect(res.statusCode).toBe(200);
    return res.json().id as string;
  }

  it("rejects a request missing requestedGoal or requestedStatus", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests`,
      cookies: cookieHeader(cookie),
      payload: { body: "no numbers here" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepting applies the requested goal and status", async () => {
    const requestId = await createRequest(3, "archived");
    const plCookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/goal-change-requests/${requestId}/resolve`,
      cookies: cookieHeader(plCookie),
      payload: { outcome: "accepted" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe("accepted");

    const { rows: assignmentRows } = await pool.query(`SELECT goal FROM assignment WHERE id = $1`, [fx.assignment]);
    expect(assignmentRows[0].goal).toBe(3);
    const { rows: projectRows } = await pool.query(`SELECT status FROM project WHERE id = $1`, [fx.project]);
    expect(projectRows[0].status).toBe("archived");
  });

  it("declining leaves the goal and status untouched", async () => {
    const requestId = await createRequest(99, "archived");
    const plCookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/goal-change-requests/${requestId}/resolve`,
      cookies: cookieHeader(plCookie),
      payload: { outcome: "declined" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe("declined");

    const { rows: assignmentRows } = await pool.query(`SELECT goal FROM assignment WHERE id = $1`, [fx.assignment]);
    expect(assignmentRows[0].goal).not.toBe(99);
    const { rows: projectRows } = await pool.query(`SELECT status FROM project WHERE id = $1`, [fx.project]);
    expect(projectRows[0].status).toBe("active");
  });

  it("rejects an outcome that isn't 'accepted' or 'declined'", async () => {
    const requestId = await createRequest(3, "active");
    const plCookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/goal-change-requests/${requestId}/resolve`,
      cookies: cookieHeader(plCookie),
      payload: { outcome: "maybe" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Batch S — notes surfaced on GET /projects/:id", () => {
  it("includes notes in the project detail response", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/notes`,
      cookies: cookieHeader(cookie),
      payload: { body: "client asked for a status update", isPublic: true },
    });

    const res = await app.inject({ method: "GET", url: `/projects/${fx.project}`, cookies: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);
    const { notes } = res.json();
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe("client asked for a status update");
  });

  it("excludes a private note from someone who isn't its author", async () => {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/notes`,
      cookies: cookieHeader(delivererCookie),
      payload: { body: "private thought", isPublic: false },
    });

    const plCookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({ method: "GET", url: `/projects/${fx.project}`, cookies: cookieHeader(plCookie) });
    expect(res.json().notes).toHaveLength(0);
  });
});
