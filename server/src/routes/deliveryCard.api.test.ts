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

describe("GET /people/:id/delivery-card", () => {
  it("summarizes a deliverer's assignments and their load contributions", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "GET",
      url: `/people/${fx.delivererAlpha}/delivery-card`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Fixture: one assignment, goal 8, delivered 2 -> 6 remaining, on "Main".
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].angleName).toBe("Main");
    expect(body.assignments[0].remaining).toBe(6);
    expect(body.rawRemaining).toBe(6);
    // The parts sum to the whole Load the ranking shows.
    const summed = body.assignments.reduce((s: number, a: { loadContribution: number }) => s + a.loadContribution, 0);
    expect(body.load).toBeCloseTo(summed, 5);
    expect(body.load).toBeGreaterThan(0);
    // Lunch window is surfaced for the countdown; not at lunch by default.
    expect(typeof body.lunchAutoOffMin).toBe("number");
    expect(body.outToLunch).toBe(false);
    expect(body.outToLunchSince).toBeNull();
  });

  it("surfaces the live lunch start time once a deliverer goes to lunch", async () => {
    await pool.query(
      `UPDATE person SET out_to_lunch = true, out_to_lunch_since = now() WHERE id = $1`,
      [fx.delivererAlpha]
    );
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "GET",
      url: `/people/${fx.delivererAlpha}/delivery-card`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outToLunch).toBe(true);
    expect(body.outToLunchSince).not.toBeNull();
  });

  it("404s for an unknown person", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "GET",
      url: `/people/00000000-0000-0000-0000-000000000000/delivery-card`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /projects/intake/match — lunch timing for the picker", () => {
  it("returns lunchAutoOffMin and the lunch start on a blocked-for-lunch candidate", async () => {
    await pool.query(
      `UPDATE person SET out_to_lunch = true, out_to_lunch_since = now() WHERE id = $1`,
      [fx.delivererAlpha]
    );
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects/intake/match",
      headers: { cookie },
      payload: { angles: [{ key: "0", staffCount: 1 }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.lunchAutoOffMin).toBe("number");
    const row = body.ranked.find((r: { personId: string }) => r.personId === fx.delivererAlpha);
    expect(row.eligible).toBe(false);
    expect(row.ineligibleReason).toBe("out_to_lunch");
    expect(row.outToLunchSince).not.toBeNull();
  });
});
