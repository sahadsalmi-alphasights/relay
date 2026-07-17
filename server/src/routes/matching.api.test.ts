import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { DEMO_AS_OF_HEADER } from "../lib/requestTime";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

// Reference instants (all UTC "Z"), same convention as src/rules/*.test.ts —
// a fixed, non-Sunday weekday so eligibility never depends on real time.
const WEEKDAY_MORNING = "2023-01-02T06:00:00Z"; // Monday 10:00 Dubai — before the 15:00 pool switch
const WEEKDAY_EVENING = "2023-01-02T16:00:00Z"; // Monday 20:00 Dubai — after the 15:00 pool switch

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

describe("bug 3 — POST /projects/intake/match respects staffCount authoritatively", () => {
  it("picks exactly staffCount people when at least that many are eligible", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: { angles: [{ key: "0", staffCount: 2 }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const picked = body.perAngle.find((p: { key: string }) => p.key === "0").picked;
    expect(picked).toHaveLength(2);
    expect(picked.every((p: { eligible: boolean }) => p.eligible)).toBe(true);
  });

  it("caps picks at however many are actually eligible when staffCount is set higher", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: { angles: [{ key: "0", staffCount: 50 }] },
    });
    const body = res.json();
    const picked = body.perAngle.find((p: { key: string }) => p.key === "0").picked;
    const eligibleInRanked = body.ranked.filter((r: { eligible: boolean }) => r.eligible).length;
    expect(picked.length).toBe(eligibleInRanked);
    expect(picked.length).toBeLessThan(50);
  });

  it("respects a lower staffCount than the previous suggestion (the reported symptom)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res1 = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: { angles: [{ key: "0", staffCount: 3 }] },
    });
    expect(res1.json().perAngle.find((p: { key: string }) => p.key === "0").picked).toHaveLength(3);

    const res2 = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      payload: { angles: [{ key: "0", staffCount: 1 }] },
    });
    expect(res2.json().perAngle.find((p: { key: string }) => p.key === "0").picked).toHaveLength(1);
  });
});

describe("bugs 1+2 — capacity ranking recomputes live at the previewed Dubai time", () => {
  async function seedApacAssignment(): Promise<void> {
    // A project on the APAC pool, First Deliverable (stage weight 2), with
    // 3 profiles remaining for otherDelivererAlpha — deliberately NOT
    // delivererAlpha, who already holds the fixture's own Global-pool
    // assignment (constant weight 1 regardless of hour); using them here
    // would add a hour-independent +12 baseline and mask the assertion.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
       VALUES ($1, 'Client_Apac', 'https://example.test/proj/apac', 'Pitch', 'AUS / NZ / Sing / JP', 'active')
       RETURNING id`,
      [fx.plAlpha]
    );
    const { rows: angleRows } = await pool.query<{ id: string }>(
      `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 2, 6) RETURNING id`,
      [rows[0].id]
    );
    await pool.query(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, delivered, custom_goal, custom_delivered, stage)
       VALUES ($1, $2, 3, 0, 0, 0, 'First Deliverable')`,
      [angleRows[0].id, fx.otherDelivererAlpha]
    );
  }

  it("contributes zero load after 15:00 Dubai, end-to-end through the API — not just the rules module", async () => {
    await seedApacAssignment();
    const cookie = await loginAs(app, fx.otherDelivererAlpha);

    const res = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
    });

    expect(res.statusCode).toBe(200);
    const row = res.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha);
    expect(row.load).toBe(0);
  });

  it("contributes nonzero (double-weighted) load before 15:00 Dubai, same assignment, same endpoint", async () => {
    await seedApacAssignment();
    const cookie = await loginAs(app, fx.otherDelivererAlpha);

    const res = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
    });

    const row = res.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha);
    // remaining(3) * stageWeight(First Deliverable = 2) * poolWeight(AUS, before 15:00 = 2)
    expect(row.load).toBe(12);
  });

  it("without a demo header, uses real time (the override never leaks into normal requests)", async () => {
    await seedApacAssignment();
    const cookie = await loginAs(app, fx.otherDelivererAlpha);

    const res = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: cookie.split("=")[1] },
    });

    expect(res.statusCode).toBe(200);
    // Just prove the row exists and load is a finite number — the point is
    // no demo header means no override, whatever real time happens to be.
    const row = res.json().find((r: { personId: string }) => r.personId === fx.otherDelivererAlpha);
    expect(Number.isFinite(row.load)).toBe(true);
  });
});

describe("domain change 6 — evening projects are ASSIGNED, not floated (end-to-end)", () => {
  it("creates an active project after hours when an evening-coverage volunteer exists — never open while someone is eligible", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const matchRes = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
      payload: { angles: [{ key: "0", staffCount: 1 }] },
    });
    const { perAngle, projectStatus } = matchRes.json();
    const picked = perAngle.find((p: { key: string }) => p.key === "0").picked;
    expect(projectStatus).toBe("active");
    expect(picked).toHaveLength(1);

    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
      payload: {
        client: "Client_Evening",
        projectLink: "https://example.test/proj/evening",
        projectType: "Pitch",
        expertPool: "Global",
        clientEntity: 1,
        angles: [{ name: "Main", callsN: 2, goalTotal: 6, assignments: [{ delivererId: picked[0].personId, goal: 6 }] }],
      },
    });
    expect(createRes.json().status).toBe("active");
  });

  it("only goes to the open pool when zero evening-coverage volunteers exist after hours — the true last resort", async () => {
    // Turn off evening coverage for every Available person in the fixture,
    // so after hours nobody at all is eligible.
    await pool.query(`UPDATE person SET evening_coverage = false`);

    const cookie = await loginAs(app, fx.plAlpha);
    const matchRes = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
      payload: { angles: [{ key: "0", staffCount: 1 }] },
    });
    const { perAngle, projectStatus } = matchRes.json();
    const picked = perAngle.find((p: { key: string }) => p.key === "0").picked;
    expect(projectStatus).toBe("open");
    expect(picked).toHaveLength(0);

    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: WEEKDAY_EVENING },
      payload: {
        client: "Client_NoOneOnline",
        projectLink: "https://example.test/proj/nooneonline",
        projectType: "Pitch",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 6, assignments: [] }],
      },
    });
    expect(createRes.json().status).toBe("open");
  });
});
