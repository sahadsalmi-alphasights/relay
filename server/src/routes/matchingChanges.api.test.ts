import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { DEMO_AS_OF_HEADER } from "../lib/requestTime";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

const WEEKDAY_MORNING = "2023-01-02T06:00:00Z"; // Monday 10:00 Dubai
const WEEKDAY_EVENING = "2023-01-02T16:00:00Z"; // Monday 20:00 Dubai — after hours

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

describe("CHANGE 1 — POST /projects/intake/match: single snapshot, allocated across angles without replacement", () => {
  it("suggests distinct people per angle when the eligible pool is large enough — no repeats across angles", async () => {
    // Fixture's four people (plAlpha, delivererAlpha, otherDelivererAlpha,
    // managerBeta) are all Available -- a pool of 4 for a 2+2 request.
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: {
        angles: [
          { key: "a", staffCount: 2 },
          { key: "b", staffCount: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const { perAngle, totalEligible } = res.json();
    const pickedA: string[] = perAngle.find((p: { key: string }) => p.key === "a").picked.map((r: { personId: string }) => r.personId);
    const pickedB: string[] = perAngle.find((p: { key: string }) => p.key === "b").picked.map((r: { personId: string }) => r.personId);
    expect(pickedA).toHaveLength(2);
    expect(pickedB).toHaveLength(2);
    expect(pickedA.some((id) => pickedB.includes(id))).toBe(false);
    expect(totalEligible).toBe(4);
  });

  it("reuses already-placed people, least-loaded first, once the eligible pool is exhausted — never before", async () => {
    // Narrow the pool to exactly delivererAlpha (already carrying the
    // fixture's own load) and otherDelivererAlpha (no load at all).
    await pool.query(`UPDATE person SET status = 'Sick' WHERE id = ANY($1)`, [[fx.plAlpha, fx.managerBeta]]);

    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: {
        angles: [
          { key: "a", staffCount: 2 },
          { key: "b", staffCount: 1 },
        ],
      },
    });
    const { perAngle } = res.json();
    const pickedA: string[] = perAngle.find((p: { key: string }) => p.key === "a").picked.map((r: { personId: string }) => r.personId);
    const pickedB: string[] = perAngle.find((p: { key: string }) => p.key === "b").picked.map((r: { personId: string }) => r.personId);
    expect(pickedA.sort()).toEqual([fx.delivererAlpha, fx.otherDelivererAlpha].sort());
    // Angle b's fresh pool is exhausted -- reuse kicks in. otherDelivererAlpha
    // (no assignments, load 0) is reused ahead of delivererAlpha (already
    // carrying the fixture's goal-8/delivered-2 assignment, load > 0).
    expect(pickedB).toEqual([fx.otherDelivererAlpha]);
  });

  it("(Change 4) reports a partial fill honestly rather than silently reducing — perAngle picked stays short of staffCount, totalEligible > 0", async () => {
    await pool.query(`UPDATE person SET status = 'Sick' WHERE id = ANY($1)`, [
      [fx.plAlpha, fx.otherDelivererAlpha, fx.managerBeta],
    ]);
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: { angles: [{ key: "a", staffCount: 2 }] },
    });
    const { perAngle, totalEligible, projectStatus } = res.json();
    expect(totalEligible).toBe(1);
    expect(projectStatus).toBe("active"); // at least one eligible -- never the broadcast case
    expect(perAngle.find((p: { key: string }) => p.key === "a").picked).toHaveLength(1);
  });
});

describe("CHANGE 2 — first-deliverable block, end-to-end through /projects/intake/match", () => {
  it("blocks a person already on a Strategy First Deliverable assignment (pool online) from being auto-picked for a new one, but keeps them visible and overridable", async () => {
    // Global pool is always online (weight 1, never asleep) -- an
    // unambiguous "online" case regardless of the hour.
    const projectRows = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_Busy', 'https://example.test/proj/busy', 'Strategy', 'Global', 'active') RETURNING id`,
      [fx.plAlpha]
    );
    const angleRows = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 4, 8) RETURNING id`,
      [projectRows.rows[0].id]
    );
    await pool.query(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, custom_goal, stage)
       VALUES ($1, $2, 8, 0, 'First Deliverable')`,
      [angleRows.rows[0].id, fx.otherDelivererAlpha]
    );

    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: { angles: [{ key: "a", staffCount: 3 }] },
    });
    const { ranked, perAngle } = res.json();
    const blocked = ranked.find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha);
    expect(blocked.eligible).toBe(false);
    expect(blocked.ineligibleReason).toBe("first_deliverable_conflict");
    const picked: string[] = perAngle.find((p: { key: string }) => p.key === "a").picked.map((r: { personId: string }) => r.personId);
    expect(picked).not.toContain(fx.otherDelivererAlpha);
  });

  it("does NOT block the same First-Deliverable holder if their existing assignment is on a Pitch — Pitch is exempt", async () => {
    const projectRows = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_PitchBusy', 'https://example.test/proj/pitchbusy', 'Pitch', 'Global', 'active') RETURNING id`,
      [fx.plAlpha]
    );
    const angleRows = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 4, 8) RETURNING id`,
      [projectRows.rows[0].id]
    );
    await pool.query(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, custom_goal, stage)
       VALUES ($1, $2, 8, 0, 'First Deliverable')`,
      [angleRows.rows[0].id, fx.otherDelivererAlpha]
    );

    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: { angles: [{ key: "a", staffCount: 3 }] },
    });
    const ranked = res.json().ranked.find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha);
    expect(ranked.eligible).toBe(true);
  });
});

describe("CHANGE 3 — zero-eligible broadcast: wider recipient net than matching's Available-only candidates", () => {
  it("notifies an Available person who fails Rule 3 (no evening coverage) after hours — the old eligible-only notify never would have", async () => {
    // Nobody has evening coverage -- after hours, zero people are eligible
    // for matching (Rule 3), so this is the true zero-eligible case.
    await pool.query(`UPDATE person SET evening_coverage = false`);

    const cookie = await loginAs(app, fx.plAlpha);
    const matchRes = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
      payload: { angles: [{ key: "a", staffCount: 1 }] },
    });
    expect(matchRes.json().totalEligible).toBe(0);

    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
      payload: {
        client: "Client_Broadcast",
        projectLink: "https://example.test/proj/broadcast",
        projectType: "Pitch",
        expertPool: "Global",
        clientEntity: 1,
        angles: [{ name: "Main", callsN: 0, goalTotal: 8, assignments: [] }],
      },
    });
    expect(createRes.json().status).toBe("open");

    // delivererAlpha is Available (just not evening-coverage-on) -- the
    // broadcast must still reach them; the old isEligible()-filtered notify
    // would have excluded them (Rule 3 failure) and sent nothing to anyone.
    const { rows } = await pool.query(`SELECT type FROM notification WHERE person_id = $1`, [fx.delivererAlpha]);
    expect(rows.some((r) => r.type === "open_pool")).toBe(true);
  });

  it("never notifies Sick or On vacation people, even after hours", async () => {
    await pool.query(`UPDATE person SET evening_coverage = false`);
    await pool.query(`UPDATE person SET status = 'Sick' WHERE id = $1`, [fx.delivererAlpha]);
    await pool.query(`UPDATE person SET status = 'On vacation' WHERE id = $1`, [fx.otherDelivererAlpha]);

    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
      payload: {
        client: "Client_Broadcast2",
        projectLink: "https://example.test/proj/broadcast2",
        projectType: "Pitch",
        expertPool: "Global",
        clientEntity: 1,
        angles: [{ name: "Main", callsN: 0, goalTotal: 8, assignments: [] }],
      },
    });

    const sickNotifs = await pool.query(`SELECT id FROM notification WHERE person_id = $1`, [fx.delivererAlpha]);
    const vacationNotifs = await pool.query(`SELECT id FROM notification WHERE person_id = $1`, [fx.otherDelivererAlpha]);
    expect(sickNotifs.rows).toHaveLength(0);
    expect(vacationNotifs.rows).toHaveLength(0);
  });

  it("does NOT notify an Offline person during working hours, but DOES after hours (evening-coverage window)", async () => {
    await pool.query(`UPDATE person SET evening_coverage = false`);
    await pool.query(`UPDATE person SET status = 'Offline' WHERE id = $1`, [fx.otherDelivererAlpha]);
    const cookie = await loginAs(app, fx.plAlpha);

    // Daytime -- Offline excluded.
    await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: {
        client: "Client_Day",
        projectLink: "https://example.test/proj/day",
        projectType: "Pitch",
        expertPool: "Global",
        clientEntity: 1,
        angles: [{ name: "Main", callsN: 0, goalTotal: 8, assignments: [] }],
      },
    });
    const daytimeNotifs = await pool.query(`SELECT id FROM notification WHERE person_id = $1`, [fx.otherDelivererAlpha]);
    expect(daytimeNotifs.rows).toHaveLength(0);

    // Evening -- Offline included.
    await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
      payload: {
        client: "Client_Evening2",
        projectLink: "https://example.test/proj/evening2",
        projectType: "Pitch",
        expertPool: "Global",
        clientEntity: 1,
        angles: [{ name: "Main", callsN: 0, goalTotal: 8, assignments: [] }],
      },
    });
    const eveningNotifs = await pool.query(`SELECT id FROM notification WHERE person_id = $1`, [fx.otherDelivererAlpha]);
    expect(eveningNotifs.rows.length).toBeGreaterThan(0);
  });
});

describe("CHANGE 3 — GET /projects/broadcasts and POST /angles/:id/claim", () => {
  async function createOpenProject(cookie: string, callsN: number, goalTotal: number): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: {
        client: "Client_ClaimTest",
        projectLink: "https://example.test/proj/claim-test",
        projectType: "Pitch",
        expertPool: "Global",
        clientEntity: 1,
        angles: [{ name: "Main", callsN, goalTotal, assignments: [] }],
      },
    });
    return res.json().id;
  }

  it("lists a still-open angle with the correct remaining seat count", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await createOpenProject(cookie, 0, 8); // Pitch N=0 -> suggestStaffing targets 1

    const res = await app.inject({ method: "GET", url: "/projects/broadcasts", cookies: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);
    const row = res.json().find((r: { client: string }) => r.client === "Client_ClaimTest");
    expect(row).toBeTruthy();
    expect(row.remaining).toBe(1);
  });

  it("claiming a seat removes it from the broadcast list once fully staffed", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const projectId = await createOpenProject(cookie, 0, 8);
    const detail = await app.inject({ method: "GET", url: `/projects/${projectId}`, cookies: cookieHeader(cookie) });
    const angleId = detail.json().angles[0].id;

    const claimCookie = await loginAs(app, fx.delivererAlpha);
    const claimRes = await app.inject({
      method: "POST",
      url: `/angles/${angleId}/claim`,
      cookies: cookieHeader(claimCookie),
    });
    expect(claimRes.statusCode).toBe(200);
    expect(claimRes.json().fullyStaffed).toBe(true);

    const listRes = await app.inject({ method: "GET", url: "/projects/broadcasts", cookies: cookieHeader(cookie) });
    expect(listRes.json().some((r: { angleId: string }) => r.angleId === angleId)).toBe(false);
  });

  it("seat claiming is atomic — two concurrent claims on the last seat, exactly one succeeds", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const projectId = await createOpenProject(cookie, 0, 8); // target 1 seat
    const detail = await app.inject({ method: "GET", url: `/projects/${projectId}`, cookies: cookieHeader(cookie) });
    const angleId = detail.json().angles[0].id;

    const cookieA = await loginAs(app, fx.delivererAlpha);
    const cookieB = await loginAs(app, fx.otherDelivererAlpha);

    const [resA, resB] = await Promise.all([
      app.inject({ method: "POST", url: `/angles/${angleId}/claim`, cookies: cookieHeader(cookieA) }),
      app.inject({ method: "POST", url: `/angles/${angleId}/claim`, cookies: cookieHeader(cookieB) }),
    ]);

    // The invariant that actually matters (proves the row-locked transaction
    // in claimAngleSeat() worked): exactly one request wins, and the seat is
    // never overfilled. The loser's exact status code depends on timing --
    // with a single-seat angle, the winning claim also instantly fully
    // staffs the project, so the loser may either lose the race inside
    // claimAngleSeat()'s lock (409, "seat no longer available") or see the
    // project already flipped to 'active' on its own status check just
    // before that (400, "not open for claiming"). Both are the loser being
    // correctly turned away -- neither ever double-books the seat.
    const statuses = [resA.statusCode, resB.statusCode];
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409 || s === 400)).toHaveLength(1);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM assignment WHERE angle_id = $1`, [angleId]);
    expect(rows[0].n).toBe(1); // never overfilled -- the actual atomicity proof
  });

  it("seat claiming is atomic on a multi-seat angle too — 3 concurrent claims for 2 seats, exactly 2 win", async () => {
    // Due Diligence at N=2 explicitly targets 2 deliverers (suggestStaffing's
    // N=2 special case) -- a cleaner atomicity proof than the single-seat
    // case above: the project stays 'open' throughout (no status-flip race),
    // so all three requests reliably reach claimAngleSeat()'s row lock.
    const cookie = await loginAs(app, fx.plAlpha);
    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      payload: {
        client: "Client_MultiSeat",
        projectLink: "https://example.test/proj/multiseat",
        projectType: "Due Diligence",
        expertPool: "Global",
        clientEntity: 1,
        angles: [{ name: "Main", callsN: 2, goalTotal: 6, assignments: [] }],
      },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/projects/${createRes.json().id}`,
      cookies: cookieHeader(cookie),
    });
    const angleId = detail.json().angles[0].id;

    // A third claimant beyond the fixture's two deliverers.
    const thirdPersonRes = await pool.query<{ id: string }>(
      `INSERT INTO person (email, name, team_id, is_manager, practice_area, status, evening_coverage)
       VALUES ('third.alpha@test.example', 'Third_Alpha', $1, false, 'Tech', 'Available', true) RETURNING id`,
      [fx.teamAlpha]
    );
    const thirdPersonId = thirdPersonRes.rows[0].id;

    const [cookieA, cookieB, cookieC] = await Promise.all([
      loginAs(app, fx.delivererAlpha),
      loginAs(app, fx.otherDelivererAlpha),
      loginAs(app, thirdPersonId),
    ]);

    const results = await Promise.all([
      app.inject({ method: "POST", url: `/angles/${angleId}/claim`, cookies: cookieHeader(cookieA) }),
      app.inject({ method: "POST", url: `/angles/${angleId}/claim`, cookies: cookieHeader(cookieB) }),
      app.inject({ method: "POST", url: `/angles/${angleId}/claim`, cookies: cookieHeader(cookieC) }),
    ]);

    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 200)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM assignment WHERE angle_id = $1`, [angleId]);
    expect(rows[0].n).toBe(2); // never overfilled past the 2-seat target
  });

  it("rejects claiming a seat on a project that isn't open", async () => {
    const claimCookie = await loginAs(app, fx.otherDelivererAlpha);
    // fx.angle belongs to the fixture's already-active project.
    const res = await app.inject({
      method: "POST",
      url: `/angles/${fx.angle}/claim`,
      cookies: cookieHeader(claimCookie),
    });
    expect(res.statusCode).toBe(400);
  });
});
