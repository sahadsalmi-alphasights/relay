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
async function logProgress(cookie: string, delivered: number) {
  return app.inject({
    method: "PATCH",
    url: `/assignments/${fx.assignment}/progress`,
    cookies: cookieHeader(cookie),
    payload: { delivered },
  });
}
async function deliveryLoggedCount(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM notification WHERE person_id = $1 AND type = 'delivery_logged'`,
    [fx.plAlpha]
  );
  return rows[0].n;
}
// Deterministic baseline: the fixture assignment starts at delivered=2, so reset
// to 0 and clear any delivery_logged notifications before each scenario.
async function resetBaseline() {
  await pool.query(`UPDATE assignment SET delivered = 0, custom_delivered = 0 WHERE id = $1`, [fx.assignment]);
  await pool.query(`DELETE FROM notification WHERE type = 'delivery_logged'`);
}
function backdateAll() {
  return pool.query(`UPDATE notification SET created_at = now() - interval '20 minutes' WHERE type = 'delivery_logged'`);
}

describe("delivery-logged notification — anti-spam", () => {
  it("a burst of stepper clicks yields ONE notification, not one per click", async () => {
    await resetBaseline();
    const cookie = await loginAs(app, fx.delivererAlpha);
    for (const v of [1, 2, 3, 4, 5]) await logProgress(cookie, v);
    expect(await deliveryLoggedCount()).toBe(1); // debounced within the 15-min window
  });

  it("a decrement (correction) does not notify", async () => {
    await resetBaseline();
    const cookie = await loginAs(app, fx.delivererAlpha);
    await logProgress(cookie, 5); // increase → 1 notification
    await backdateAll(); // move it outside the debounce window
    await logProgress(cookie, 4); // decrement — not "progress logged"
    expect(await deliveryLoggedCount()).toBe(1);
  });

  it("a real increase after the debounce window DOES notify again", async () => {
    await resetBaseline();
    const cookie = await loginAs(app, fx.delivererAlpha);
    await logProgress(cookie, 1); // increase → 1 notification
    await backdateAll();
    await logProgress(cookie, 2); // genuine later progress, outside the window
    expect(await deliveryLoggedCount()).toBe(2);
  });
});
