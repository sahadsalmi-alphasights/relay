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

async function setGhost(personId: string, isGhost: boolean, plCookie: string) {
  return app.inject({
    method: "PATCH",
    url: `/people/${personId}/ghost`,
    cookies: cookieHeader(plCookie),
    payload: { isGhost },
  });
}

describe("invisible competition — person.is_ghost management", () => {
  it("a manager can set and unset a team member's ghost flag", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    const res = await setGhost(fx.otherDelivererAlpha, true, plCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().isGhost).toBe(true);

    const undo = await setGhost(fx.otherDelivererAlpha, false, plCookie);
    expect(undo.statusCode).toBe(200);
    expect(undo.json().isGhost).toBe(false);
  });

  it("a non-manager may not set anyone's ghost flag", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await setGhost(fx.otherDelivererAlpha, true, cookie);
    expect(res.statusCode).toBe(403);
  });

  it("a manager may not set ghost status for someone outside their own team", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    const res = await setGhost(fx.managerBeta, true, plCookie);
    expect(res.statusCode).toBe(403);
  });

  it("is audit-logged", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);
    const { rows } = await pool.query(`SELECT action FROM audit_log WHERE entity_id = $1`, [fx.otherDelivererAlpha]);
    expect(rows.map((r) => r.action)).toContain("set_ghost");
  });

  it("existing rows default to non-ghost", async () => {
    const { rows } = await pool.query(`SELECT is_ghost FROM person WHERE id = $1`, [fx.delivererAlpha]);
    expect(rows[0].is_ghost).toBe(false);
  });
});

describe("invisible competition — manager exclusion", () => {
  it("a manager never appears in Capacity Ranking, even though they're Available", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({ method: "GET", url: "/capacity-ranking", cookies: cookieHeader(cookie) });
    const ids = res.json().map((r: { personId: string }) => r.personId);
    expect(ids).not.toContain(fx.plAlpha);
  });

  it("a manager is never suggested/auto-picked by intake/match", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: cookieHeader(cookie),
      payload: { angles: [{ key: "0", staffCount: 5 }] },
    });
    const ids = res.json().ranked.map((r: { personId: string }) => r.personId);
    expect(ids).not.toContain(fx.plAlpha);
  });

  it("a manager CAN still be staffed manually via Edit team's add-to-team route", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/assignments`,
      cookies: cookieHeader(cookie),
      payload: { delivererId: fx.plAlpha, goal: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().delivererId).toBe(fx.plAlpha);
  });
});

describe("invisible competition — ghost allocation at project creation", () => {
  it("suggests a ghost on a Due Diligence angle when one is available, mirroring the real associate's goal", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);

    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(plCookie),
      payload: {
        client: "Client_Ghost",
        projectLink: "https://example.test/proj/ghost",
        projectType: "Due Diligence",
        expertPool: "Global",
        angles: [
          {
            name: "Main",
            callsN: 3,
            goalTotal: 9,
            assignments: [{ delivererId: fx.delivererAlpha, goal: 9 }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const project = res.json();

    const { rows } = await pool.query(
      `SELECT a.deliverer_id AS "delivererId", a.goal, a.is_ghost AS "isGhost"
       FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = $1`,
      [project.id]
    );
    expect(rows).toHaveLength(2);
    const ghostRow = rows.find((r) => r.isGhost);
    expect(ghostRow).toBeDefined();
    expect(ghostRow.delivererId).toBe(fx.otherDelivererAlpha);
    expect(ghostRow.goal).toBe(9); // mirrors the real associate's goal
  });

  it("never suggests a ghost for a Pitch project", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);

    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(plCookie),
      payload: {
        client: "Client_GhostPitch",
        projectLink: "https://example.test/proj/ghost-pitch",
        projectType: "Pitch",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 0, goalTotal: 4, assignments: [{ delivererId: fx.delivererAlpha, goal: 4 }] }],
      },
    });
    const project = res.json();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = $1 AND a.is_ghost`,
      [project.id]
    );
    expect(rows[0].n).toBe(0);
  });

  it("never suggests a ghost for an angle nobody real was staffed on", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);

    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(plCookie),
      payload: {
        client: "Client_GhostUnstaffed",
        projectLink: "https://example.test/proj/ghost-unstaffed",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 4, assignments: [] }],
      },
    });
    const project = res.json();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = $1 AND a.is_ghost`,
      [project.id]
    );
    expect(rows[0].n).toBe(0);
  });

  it("respects the per-angle invisibleCompetitionEnabled=false opt-out", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);

    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(plCookie),
      payload: {
        client: "Client_GhostOptOut",
        projectLink: "https://example.test/proj/ghost-optout",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [
          {
            name: "Main",
            callsN: 2,
            goalTotal: 4,
            assignments: [{ delivererId: fx.delivererAlpha, goal: 4 }],
            invisibleCompetitionEnabled: false,
          },
        ],
      },
    });
    const project = res.json();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = $1 AND a.is_ghost`,
      [project.id]
    );
    expect(rows[0].n).toBe(0);
  });

  it("SILENT FAILURE — no ghost available means no assignment, no warning, no broadcast, no extra notification", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    // No one is flagged ghost in this fixture at all.
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(plCookie),
      payload: {
        client: "Client_NoGhostAvailable",
        projectLink: "https://example.test/proj/no-ghost",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 4, assignments: [{ delivererId: fx.delivererAlpha, goal: 4 }] }],
      },
    });
    expect(res.statusCode).toBe(200);
    const project = res.json();
    expect(project.status).toBe("active"); // never routed through the open-pool/broadcast path

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = $1 AND a.is_ghost`,
      [project.id]
    );
    expect(rows[0].n).toBe(0);

    const { rows: auditRows } = await pool.query(`SELECT action FROM audit_log WHERE entity_type = 'assignment'`);
    expect(auditRows.map((r) => r.action)).not.toContain("ghost_assign");
  });

  it("is audit-logged when a ghost IS assigned", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);
    await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(plCookie),
      payload: {
        client: "Client_GhostAudit",
        projectLink: "https://example.test/proj/ghost-audit",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 4, assignments: [{ delivererId: fx.delivererAlpha, goal: 4 }] }],
      },
    });
    const { rows } = await pool.query(`SELECT action FROM audit_log WHERE action = 'ghost_assign'`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("invisible competition — roll-up exclusion (worked example)", () => {
  it("ghost goal/delivered are excluded from the project detail's assignment list roll-up basis, while calls_sold is untouched", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);

    const create = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(plCookie),
      payload: {
        client: "Client_RollUp",
        projectLink: "https://example.test/proj/rollup",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 5, assignments: [{ delivererId: fx.delivererAlpha, goal: 5 }] }],
      },
    });
    const project = create.json();

    const { rows: assignmentRows } = await pool.query(
      `SELECT a.id, a.deliverer_id AS "delivererId", a.goal, a.is_ghost AS "isGhost"
       FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = $1`,
      [project.id]
    );
    const real = assignmentRows.find((a) => !a.isGhost)!;
    const ghost = assignmentRows.find((a) => a.isGhost)!;
    expect(real.goal).toBe(5);
    expect(ghost.goal).toBe(5); // its own goal, a duplicate of the real associate's

    // Log delivered progress on both -- the real associate normally, the
    // ghost as its own deliverer would (ownership-gated route, so log
    // directly at the repo level here rather than needing that person's session).
    await pool.query(`UPDATE assignment SET delivered = 3 WHERE id = $1`, [real.id]);
    await pool.query(`UPDATE assignment SET delivered = 4 WHERE id = $1`, [ghost.id]);

    const detail = await app.inject({ method: "GET", url: `/projects/${project.id}`, cookies: cookieHeader(plCookie) });
    const body = detail.json();
    // The client's projStats()-equivalent basis: goal/delivered summed
    // EXCLUDING the ghost. Prove it from the raw assignment list the route
    // returns (what the client's own projStats() filters over).
    const nonGhost = body.assignments.filter((a: { isGhost: boolean }) => !a.isGhost);
    const goalSum = nonGhost.reduce((s: number, a: { goal: number }) => s + a.goal, 0);
    const deliveredSum = nonGhost.reduce((s: number, a: { delivered: number }) => s + a.delivered, 0);
    expect(goalSum).toBe(5); // NOT 10
    expect(deliveredSum).toBe(3); // NOT 7

    // angle.goal_total was never touched by ghost creation -- still the PL-set value.
    expect(body.project.goalTotal).toBe(5);

    // calls_sold is angle-level, PL-entered, untouched by ghost delivered at
    // all -- bump it and confirm it reflects exactly what was set, same as
    // any angle (the worked example's "calls_sold DOES include the ghost"
    // in the sense that nothing about ghost presence excludes it).
    await app.inject({
      method: "PATCH",
      url: `/angles/${body.angles[0].id}`,
      cookies: cookieHeader(plCookie),
      payload: { callsSold: 2 },
    });
    const after = await app.inject({ method: "GET", url: `/projects/${project.id}`, cookies: cookieHeader(plCookie) });
    expect(after.json().project.callsSold).toBe(2);
  });
});

describe("invisible competition — Ghost Ranking dashboard", () => {
  it("?ghost=true returns only ghost-flagged people, reusing the same route/query", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);

    const ghostRes = await app.inject({ method: "GET", url: "/capacity-ranking?ghost=true", cookies: cookieHeader(plCookie) });
    const ghostIds = ghostRes.json().map((r: { personId: string }) => r.personId);
    expect(ghostIds).toContain(fx.otherDelivererAlpha);
    expect(ghostIds).not.toContain(fx.delivererAlpha);

    const standardRes = await app.inject({ method: "GET", url: "/capacity-ranking", cookies: cookieHeader(plCookie) });
    const standardIds = standardRes.json().map((r: { personId: string }) => r.personId);
    expect(standardIds).toContain(fx.delivererAlpha);
    expect(standardIds).not.toContain(fx.otherDelivererAlpha);
  });

  it("a ghost's assignment counts toward their own load", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await setGhost(fx.otherDelivererAlpha, true, plCookie);

    const before = await app.inject({ method: "GET", url: "/capacity-ranking?ghost=true", cookies: cookieHeader(plCookie) });
    const beforeLoad = before.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha)?.load ?? 0;

    await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(plCookie),
      payload: {
        client: "Client_GhostLoad",
        projectLink: "https://example.test/proj/ghost-load",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 6, assignments: [{ delivererId: fx.delivererAlpha, goal: 6 }] }],
      },
    });

    const after = await app.inject({ method: "GET", url: "/capacity-ranking?ghost=true", cookies: cookieHeader(plCookie) });
    const afterLoad = after.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha)?.load ?? 0;
    expect(afterLoad).toBeGreaterThan(beforeLoad);
  });
});
