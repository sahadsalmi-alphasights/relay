import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { listForPerson } from "../repositories/notifications";
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

describe("§9 (built) — notification fan-out reaches only intended recipients", () => {
  it("staffing a project (auto-match/manual) notifies only the newly assigned deliverer", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_Notify",
        projectLink: "https://example.test/proj/notify",
        projectType: "Pitch",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 6, assignments: [{ delivererId: fx.otherDelivererAlpha, goal: 6 }] }],
      },
    });
    expect(res.statusCode).toBe(200);

    const assigneeNotifs = await listForPerson(fx.otherDelivererAlpha);
    expect(assigneeNotifs).toHaveLength(1);
    expect(assigneeNotifs[0].type).toBe("assigned");

    // Nobody else -- not the PL who did the staffing, not an uninvolved teammate.
    expect(await listForPerson(fx.plAlpha)).toHaveLength(0);
    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(0);
  });

  it("swapping a deliverer notifies the newly swapped-in person", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/swap`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { newDelivererId: fx.otherDelivererAlpha },
    });
    expect(res.statusCode).toBe(200);

    const swappedInNotifs = await listForPerson(fx.otherDelivererAlpha);
    expect(swappedInNotifs).toHaveLength(1);
    expect(swappedInNotifs[0].type).toBe("assigned");
  });

  it("raising a goal-change request notifies only the PL, not the requesting deliverer or anyone else", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { body: "please lower the goal", requestedGoal: 5, requestedStatus: "active" },
    });
    expect(res.statusCode).toBe(200);

    const plNotifs = await listForPerson(fx.plAlpha);
    expect(plNotifs).toHaveLength(1);
    expect(plNotifs[0].type).toBe("goal_change_requested");

    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(0);
    expect(await listForPerson(fx.otherDelivererAlpha)).toHaveLength(0);
  });

  it("resolving a goal-change request notifies only the deliverer who raised it", async () => {
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    const createRes = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/goal-change-requests`,
      cookies: { relay_session: delivererCookie.split("=")[1] },
      payload: { body: "please lower the goal", requestedGoal: 5, requestedStatus: "active" },
    });
    const gcr = createRes.json();

    const plCookie = await loginAs(app, fx.plAlpha);
    const resolveRes = await app.inject({
      method: "PATCH",
      url: `/goal-change-requests/${gcr.id}/resolve`,
      cookies: { relay_session: plCookie.split("=")[1] },
      payload: { outcome: "accepted" },
    });
    expect(resolveRes.statusCode).toBe(200);

    const delivererNotifs = await listForPerson(fx.delivererAlpha);
    expect(delivererNotifs.filter((n) => n.type === "goal_change_resolved")).toHaveLength(1);
    expect(await listForPerson(fx.otherDelivererAlpha)).toHaveLength(0);
  });

  it("a project falling to the open pool notifies only people currently eligible to claim it", async () => {
    // Make otherDelivererAlpha ineligible (Rule 1 -- status); plAlpha and
    // delivererAlpha remain Available, so they're both still eligible.
    await pool.query(`UPDATE person SET status = 'Sick' WHERE id = $1`, [fx.otherDelivererAlpha]);

    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_OpenPool",
        projectLink: "https://example.test/proj/openpool",
        projectType: "Pitch",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 6, assignments: [] }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("open");

    const sickPersonNotifs = await listForPerson(fx.otherDelivererAlpha);
    expect(sickPersonNotifs.filter((n) => n.type === "open_pool")).toHaveLength(0);

    const eligibleNotifs = await listForPerson(fx.delivererAlpha);
    expect(eligibleNotifs.filter((n) => n.type === "open_pool")).toHaveLength(1);
  });
});
