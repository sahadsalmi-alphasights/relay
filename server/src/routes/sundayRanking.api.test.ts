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

function cookieHeader(cookie: string) {
  return { relay_session: cookie.split("=")[1] };
}

// 2099-01-04 is a Sunday; the demo-clock header lets us evaluate the ranking "as of" it.
const SUNDAY_DEMO = "2099-01-04T09:00:00.000Z";

describe("capacity ranking — Sunday offline (not on the rota)", () => {
  it("on a Sunday, a person NOT on that Sunday's rota shows offline", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: cookieHeader(cookie),
      headers: { "x-demo-as-of": SUNDAY_DEMO },
    });
    expect(res.statusCode).toBe(200);
    const row = res.json().find((r: { personId: string }) => r.personId === fx.delivererAlpha);
    expect(row).toBeTruthy();
    expect(row.sundayOff).toBe(true); // offline — not rostered for this Sunday
  });

  it("a person rostered for that Sunday is online", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    // Roster delivererAlpha for that Sunday (BU-wide rota route).
    await app.inject({
      method: "POST",
      url: "/sunday-rota",
      cookies: cookieHeader(cookie),
      payload: { rotaDate: "2099-01-04", personId: fx.delivererAlpha },
    });
    const res = await app.inject({
      method: "GET",
      url: "/capacity-ranking",
      cookies: cookieHeader(cookie),
      headers: { "x-demo-as-of": SUNDAY_DEMO },
    });
    const row = res.json().find((r: { personId: string }) => r.personId === fx.delivererAlpha);
    expect(row.sundayOff).toBe(false);
  });
});
