import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
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

describe("domain change 9 — a goal change starts a new delivery round (end-to-end)", () => {
  it("archives the closed round's (goal, delivered, custom_delivered) and resets the assignment to 0 under the new goal", async () => {
    const cookie = await loginAs(app, fx.plAlpha);

    // Fixture assignment starts at goal 8, delivered 2, customDelivered 0.
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { goal: 10 },
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json();
    expect(updated.goal).toBe(10);
    expect(updated.delivered).toBe(0);
    expect(updated.customDelivered).toBe(0);
    expect(updated.customGoal).toBe(4); // computeCustomGoal(10) = ceil(10*0.33) = 4

    const roundsRes = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}/rounds`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(roundsRes.statusCode).toBe(200);
    const { history } = roundsRes.json();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ goal: 8, delivered: 2, customDelivered: 0 });
  });

  it("the deliverer's board always shows the current round, not the archived one", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: plCookie.split("=")[1] },
      payload: { goal: 5 },
    });

    const getRes = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}`,
      cookies: { relay_session: plCookie.split("=")[1] },
    });
    const assignment = getRes.json();
    expect(assignment.goal).toBe(5);
    expect(assignment.delivered).toBe(0);
    expect(assignment.customDelivered).toBe(0);
  });

  it("preserves cumulative delivered across multiple rounds for future analytics", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);

    // Round 1 (goal 8, delivered 2) closes here; round 2 opens at goal 10.
    await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: plCookie.split("=")[1] },
      payload: { goal: 10 },
    });

    // Log some progress in round 2 before it closes too.
    const delivererCookie = await loginAs(app, fx.delivererAlpha);
    await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/progress`,
      cookies: { relay_session: delivererCookie.split("=")[1] },
      payload: { delivered: 3 },
    });

    // Round 2 (goal 10, delivered 3) closes here; round 3 opens at goal 6.
    await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: plCookie.split("=")[1] },
      payload: { goal: 6 },
    });

    const roundsRes = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}/rounds`,
      cookies: { relay_session: plCookie.split("=")[1] },
    });
    const { history, cumulativeDelivered } = roundsRes.json();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ goal: 8, delivered: 2 });
    expect(history[1]).toMatchObject({ goal: 10, delivered: 3 });
    // 2 (round 1) + 3 (round 2) + 0 (current, freshly reset round 3)
    expect(cumulativeDelivered).toBe(5);
  });

  it("load is computed from the current round's remaining, not the pre-reset value", async () => {
    const plCookie = await loginAs(app, fx.plAlpha);

    // Before: goal 8, delivered 2 -> remaining 6 * stageWeight(First Deliverable, 2) * poolWeight(Global, 1) = 12.
    const before = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: plCookie.split("=")[1] },
    });
    const rowBefore = before.json().find((r: { personId: string }) => r.personId === fx.delivererAlpha);
    expect(rowBefore.load).toBe(12);

    // Raise the goal to 10 -> round closes, delivered resets to 0.
    await app.inject({
      method: "PATCH",
      url: `/assignments/${fx.assignment}/goal`,
      cookies: { relay_session: plCookie.split("=")[1] },
      payload: { goal: 10 },
    });

    // After: remaining is now the full new goal (10 - 0 = 10), not 10 - 2 = 8.
    const after = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: { relay_session: plCookie.split("=")[1] },
    });
    const rowAfter = after.json().find((r: { personId: string }) => r.personId === fx.delivererAlpha);
    expect(rowAfter.load).toBe(20);
  });
});
