import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

// These tests hit real HTTP routes (via Fastify's inject()) backed by the
// real Postgres database — not the pure rules-engine functions, which are
// already covered in src/rules/*.test.ts. The point here is to prove
// authorization is actually wired into the API layer itself.
//
// Running this file truncates the domain tables; `npm run seed` restores
// the demo data afterward.

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

describe("authentication is required at all", () => {
  it("rejects a request with no session cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(401);
  });
});

describe("§5e — THE PL OWNS THE GOAL, ALWAYS (enforced at the HTTP layer)", () => {
  it("rejects a deliverer's attempt to write goal, and leaves the row unchanged in Postgres", async () => {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);

    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: delivererCookie.split("=")[1] },
      payload: { goal: 999 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "only the project's PL may edit goal/custom_goal" });

    // Prove it's not just the HTTP response that's wrong — the database was never touched.
    const { rows } = await pool.query("SELECT goal FROM assignment WHERE id = $1", [fx.assignment]);
    expect(rows[0].goal).toBe(8);
  });

  it("rejects a deliverer even on someone else's assignment (not just their own)", async () => {
    const otherDelivererCookie = await loginAs(app, fx.otherDelivererAlpha);

    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: otherDelivererCookie.split("=")[1] },
      payload: { customGoal: 5 },
    });

    expect(res.statusCode).toBe(403);
    const { rows } = await pool.query("SELECT custom_goal FROM assignment WHERE id = $1", [fx.assignment]);
    expect(rows[0].custom_goal).toBe(0);
  });

  it("allows the project's PL to write goal, and persists the change", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);

    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: plCookie.split("=")[1] },
      payload: { goal: 12 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().goal).toBe(12);
    const { rows } = await pool.query("SELECT goal FROM assignment WHERE id = $1", [fx.assignment]);
    expect(rows[0].goal).toBe(12);
  });
});

describe("§5e — a deliverer may edit only their own delivered/custom_delivered", () => {
  it("lets the assignment's own deliverer log progress", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/progress`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { delivered: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().delivered).toBe(5);
  });

  it("rejects a different deliverer trying to log progress on someone else's assignment", async () => {
    const cookie = await loginAs(app, fx.otherDelivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/progress`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { delivered: 5 },
    });
    expect(res.statusCode).toBe(403);
    const { rows } = await pool.query("SELECT delivered FROM assignment WHERE id = $1", [fx.assignment]);
    expect(rows[0].delivered).toBe(2); // unchanged from the fixture
  });

  it("rejects the PL trying to write progress directly — that's the deliverer's field, not the PL's", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/progress`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { delivered: 5 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("§5e — goal changes flow through a request, never a direct deliverer write", () => {
  it("lets a deliverer request a goal change, and only the PL can resolve it", async () => {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    const createRes = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests`,
      cookies: { relay_session: delivererCookie.split("=")[1] },
      payload: { body: "client wants 4 more profiles", requestedGoal: 12, requestedStatus: "active" },
    });
    expect(createRes.statusCode).toBe(200);
    const requestId = createRes.json().id as string;

    // The requester themselves cannot resolve their own request.
    const selfResolveRes = await app.inject({
      method: "PATCH",
      url: `/goal-change-requests/${requestId}/resolve`,
      cookies: { relay_session: delivererCookie.split("=")[1] },
      payload: { outcome: "accepted" },
    });
    expect(selfResolveRes.statusCode).toBe(403);

    // The PL can.
    const plCookie = await loginAs(app, fx.plAlpha);
    const plResolveRes = await app.inject({
      method: "PATCH",
      url: `/goal-change-requests/${requestId}/resolve`,
      cookies: { relay_session: plCookie.split("=")[1] },
      payload: { outcome: "accepted" },
    });
    expect(plResolveRes.statusCode).toBe(200);
    expect(plResolveRes.json().resolved).toBe(true);
  });

  it("rejects a different deliverer requesting a change on someone else's assignment", async () => {
    const cookie = await loginAs(app, fx.otherDelivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { body: "let me have this" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("§5e — project fields and stage are PL-only", () => {
  it("rejects a deliverer editing project fields", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { topic: "hijacked" },
    });
    expect(res.statusCode).toBe(403);
    const { rows } = await pool.query("SELECT topic FROM project WHERE id = $1", [fx.project]);
    expect(rows[0].topic).toBeNull();
  });

  // §8 (domain change 8) — stage is per-assignment now, not per-project.
  it("rejects a deliverer advancing their own assignment's stage", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/stage/advance`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets the PL advance an assignment's stage", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/stage/advance`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe("Second Deliverable");
  });
});

describe("§7b — manager powers are scoped to their own team", () => {
  it("rejects a manager of a different team setting someone's status", async () => {
    const cookie = await loginAs(app, fx.managerBeta);
    const res = await app.inject({
      method: "PATCH",
      url: `/people/${fx.delivererAlpha}/status`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { status: "Sick" },
    });
    expect(res.statusCode).toBe(403);
    const { rows } = await pool.query("SELECT status FROM person WHERE id = $1", [fx.delivererAlpha]);
    expect(rows[0].status).toBe("Available");
  });

  it("lets a manager set status for their own team, and warns about outstanding profiles", async () => {
    const cookie = await loginAs(app, fx.plAlpha); // plAlpha is_manager on Team_Alpha
    const res = await app.inject({
      method: "PATCH",
      url: `/people/${fx.delivererAlpha}/status`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { status: "Sick" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.person.status).toBe("Sick");
    expect(body.warning).not.toBeNull(); // fixture assignment has 6 remaining
  });

  it("rejects a non-manager setting anyone's status, including their own", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/people/${fx.delivererAlpha}/status`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { status: "Offline" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("§4 Rule 3 / §7b — evening coverage is self-serve only", () => {
  it("lets a person toggle their own evening coverage", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: "/people/me/evening-coverage",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { eveningCoverage: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().eveningCoverage).toBe(false);
  });

  it("has no route allowing a manager to set someone else's toggle (only /people/me/evening-coverage exists)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/people/${fx.delivererAlpha}/evening-coverage`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { eveningCoverage: false },
    });
    expect(res.statusCode).toBe(404);
  });
});
