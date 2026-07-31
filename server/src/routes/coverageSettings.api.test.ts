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
  // coverage_settings isn't in the fixture truncate list, so its seeded
  // singleton row persists — reset every field to defaults so tests are
  // order-independent.
  await pool.query(`
    UPDATE coverage_settings SET
      lunch_prompt_start_min = 750, lunch_prompt_end_min = 870, lunch_auto_off_min = 60, lunch_snooze_min = 30,
      evening_prompt_start_min = 1080, evening_prompt_end_min = 1320,
      evening_reset_start_min = 240, evening_reset_end_min = 480, evening_snooze_min = 60
    WHERE id = 1`);
});
const cv = (c: string) => c.substring(c.indexOf("=") + 1);
const makeOwner = (id: string) => pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [id]);

describe("coverage settings (2026-07-29)", () => {
  it("anyone signed in can read; defaults are the old hardcoded values", async () => {
    const res = await app.inject({ method: "GET", url: "/settings/coverage", cookies: { relay_session: cv(await loginAs(app, fx.delivererAlpha)) } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ lunchPromptStartMin: 750, lunchPromptEndMin: 870, lunchAutoOffMin: 60, eveningPromptStartMin: 1080 });
  });

  it("a non-owner cannot change them", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/coverage",
      cookies: { relay_session: cv(await loginAs(app, fx.plAlpha)) },
      payload: { lunchPromptStartMin: 720 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("an owner can change them and the new values persist", async () => {
    await makeOwner(fx.plAlpha);
    const cookies = { relay_session: cv(await loginAs(app, fx.plAlpha)) };
    const patched = await app.inject({ method: "PATCH", url: "/settings/coverage", cookies, payload: { lunchPromptStartMin: 720, lunchAutoOffMin: 45 } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ lunchPromptStartMin: 720, lunchAutoOffMin: 45, lunchPromptEndMin: 870 });

    const readBack = await app.inject({ method: "GET", url: "/settings/coverage", cookies });
    expect(readBack.json().lunchPromptStartMin).toBe(720);
  });

  it("rejects an inverted window and out-of-range values", async () => {
    await makeOwner(fx.plAlpha);
    const cookies = { relay_session: cv(await loginAs(app, fx.plAlpha)) };
    // start after end
    const inverted = await app.inject({ method: "PATCH", url: "/settings/coverage", cookies, payload: { lunchPromptStartMin: 900, lunchPromptEndMin: 800 } });
    expect(inverted.statusCode).toBe(400);
    // minute-of-day out of range
    const oob = await app.inject({ method: "PATCH", url: "/settings/coverage", cookies, payload: { eveningPromptStartMin: 2000 } });
    expect(oob.statusCode).toBe(400);
  });
});
