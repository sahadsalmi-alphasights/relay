import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { listForPerson } from "../repositories/notifications";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

function cookieHeader(cookie: string) {
  return { relay_session: cookie.split("=")[1] };
}

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

async function insertPerson(email: string, name: string, teamId: string, isManager: boolean): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO person (email, name, team_id, is_manager, practice_area, status, evening_coverage)
     VALUES ($1, $2, $3, $4, 'Energy', 'Available', false) RETURNING id`,
    [email, name, teamId, isManager]
  );
  return rows[0].id;
}

async function raiseRequest(cookie: string, goal = 3, status = "Second Deliverable"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/assignments/${fx.assignment}/goal-change-requests`,
    cookies: cookieHeader(cookie),
    payload: { body: "pool is thin", requestedGoal: goal, requestedStatus: status },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

describe("Goal-change Poke", () => {
  it("pokes the PL and the PL's-team manager(s), not the deliverer", async () => {
    // A second manager on the PL's team so the fan-out is observable.
    const secondManager = await insertPerson("second.mgr.alpha@test.example", "Second_Mgr_Alpha", fx.teamAlpha, true);
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    await raiseRequest(delivererCookie);
    // Clear the PL's "requested" notification noise by only checking the poke title below.

    const poke = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests/poke`,
      cookies: cookieHeader(delivererCookie),
    });
    expect(poke.statusCode).toBe(200);

    const plPokes = (await listForPerson(fx.plAlpha)).filter((n) => n.title === "Goal change still needs action");
    const mgrPokes = (await listForPerson(secondManager)).filter((n) => n.title === "Goal change still needs action");
    expect(plPokes).toHaveLength(1);
    expect(mgrPokes).toHaveLength(1);
    expect(plPokes[0].body).toContain("has not been actioned on");
    // The deliverer never pokes themselves.
    expect((await listForPerson(fx.delivererAlpha)).filter((n) => n.title === "Goal change still needs action")).toHaveLength(0);
  });

  it("rejects a poke when there's no open request (400)", async () => {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests/poke`,
      cookies: cookieHeader(delivererCookie),
    });
    expect(res.statusCode).toBe(400);
  });

  it("only the assignment's own deliverer may poke (403)", async () => {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    await raiseRequest(delivererCookie);
    const plCookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests/poke`,
      cookies: cookieHeader(plCookie),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /assignments/me/goal-change-requests returns the actor's open requests", async () => {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    await raiseRequest(delivererCookie);
    const res = await app.inject({
      method: "GET",
      url: "/assignments/me/goal-change-requests",
      cookies: cookieHeader(delivererCookie),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { assignmentId: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].assignmentId).toBe(fx.assignment);
  });
});

describe("Cross-team staffing notification", () => {
  it("names the PL to the deliverer and pings the deliverer's team manager when the PL is on another team", async () => {
    // A plain member of Team_Beta (managerBeta already manages Team_Beta).
    const betaMember = await insertPerson("beta.member@test.example", "Beta_Member", fx.teamBeta, false);
    const plCookie = await loginAs(app, fx.plAlpha); // PL is on Team_Alpha

    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/assignments`,
      cookies: cookieHeader(plCookie),
      payload: { delivererId: betaMember, goal: 4, angleId: fx.angle },
    });
    expect(res.statusCode).toBe(200);

    const delivererNotifs = await listForPerson(betaMember);
    expect(delivererNotifs.filter((n) => n.type === "assigned")).toHaveLength(1);
    expect(delivererNotifs[0].body).toContain("has staffed you on a new project with a goal of 4");

    // Team_Beta's manager is told one of their people was staffed cross-team.
    const mgrNotifs = await listForPerson(fx.managerBeta);
    const staffedNotif = mgrNotifs.find((n) => n.body.includes("has been staffed by"));
    expect(staffedNotif).toBeTruthy();
    expect(staffedNotif!.body).toContain("with a goal of 4");
  });

  it("does not ping a manager for a same-team staffing", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/assignments`,
      cookies: cookieHeader(plCookie),
      payload: { delivererId: fx.otherDelivererAlpha, goal: 2, angleId: fx.angle },
    });
    expect(res.statusCode).toBe(200);
    // No cross-team manager notification anywhere on Team_Beta.
    expect((await listForPerson(fx.managerBeta)).filter((n) => n.body.includes("has been staffed by"))).toHaveLength(0);
  });
});

describe("Slack interactivity endpoint", () => {
  it("rejects an unsigned request (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/slack/interactive",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "payload=%7B%22type%22%3A%22block_actions%22%7D",
    });
    expect(res.statusCode).toBe(401);
  });
});
