import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
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
  // The singleton settings row isn't TRUNCATEd by the fixture — reset it.
  await pool.query(
    `UPDATE hr_integration_settings
       SET enabled = false, leave_type_keywords = 'vacation,sick', last_sync_at = NULL, last_sync_summary = NULL
     WHERE id = 1`
  );
});

async function makeOwner(id: string) {
  await pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [id]);
}

describe("BambooHR integration settings API", () => {
  it("GET reports not-configured in the test env and never leaks a secret", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({ method: "GET", url: "/settings/hr-integration", cookies: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.enabled).toBe(false);
    expect(body.leaveTypeKeywords).toBe("vacation,sick");
    // No API key / URL ever appears in the payload.
    expect(res.body.toLowerCase()).not.toContain("bamboohr_api_key");
    expect(res.body).not.toContain("api.bamboohr.com");
  });

  it("rejects a PATCH from a non-owner (403)", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/hr-integration",
      cookies: cookieHeader(cookie),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("owner can enable and change leave keywords; it persists", async () => {
    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/hr-integration",
      cookies: cookieHeader(cookie),
      payload: { enabled: true, leaveTypeKeywords: "vacation, sick, annual" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
    expect(res.json().leaveTypeKeywords).toBe("vacation, sick, annual");

    const read = await app.inject({ method: "GET", url: "/settings/hr-integration", cookies: cookieHeader(cookie) });
    expect(read.json().enabled).toBe(true);
    expect(read.json().leaveTypeKeywords).toBe("vacation, sick, annual");
  });

  it("rejects empty leave keywords (400)", async () => {
    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: "/settings/hr-integration",
      cookies: cookieHeader(cookie),
      payload: { leaveTypeKeywords: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("sync + test endpoints 400 when BambooHR isn't configured", async () => {
    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const sync = await app.inject({ method: "POST", url: "/settings/hr-integration/sync", cookies: cookieHeader(cookie) });
    expect(sync.statusCode).toBe(400);
    const test = await app.inject({ method: "POST", url: "/settings/hr-integration/test", cookies: cookieHeader(cookie) });
    expect(test.statusCode).toBe(400);
  });
});
