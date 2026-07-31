import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { slackEventEnabled } from "../services/slack";
import type { NotificationSettings } from "../repositories/notificationSettings";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  fx = await resetAndSeedFixture();
  // Singleton row isn't truncated by the fixture — reset to defaults.
  await pool.query(`UPDATE notification_settings SET slack_enabled = false, slack_assigned = true WHERE id = 1`);
});
const cv = (c: string) => c.substring(c.indexOf("=") + 1);
const makeOwner = (id: string) => pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [id]);

const base: NotificationSettings = {
  slackEnabled: false, slackBroadcastUpForGrabs: true, slackAssigned: true,
  slackGoalChangeRequested: true, slackGoalChangeResolved: true, slackDeliveryLogged: false,
  slackStaleFirstDeliverable: true, slackProjectTransferred: true,
};

describe("slackEventEnabled gating", () => {
  it("posts nothing when the master switch is off", () => {
    expect(slackEventEnabled({ ...base, slackEnabled: false }, "open_pool")).toBe(false);
  });
  it("respects the per-event toggle when the master is on", () => {
    const s = { ...base, slackEnabled: true, slackAssigned: true, slackDeliveryLogged: false };
    expect(slackEventEnabled(s, "assigned")).toBe(true);
    expect(slackEventEnabled(s, "delivery_logged")).toBe(false);
  });
  it("ignores unknown notification types", () => {
    expect(slackEventEnabled({ ...base, slackEnabled: true }, "some_future_type")).toBe(false);
  });
});

describe("notification settings API", () => {
  it("GET reports slackConfigured=false in dev (no webhook) and the default toggles", async () => {
    const res = await app.inject({ method: "GET", url: "/settings/notifications", cookies: { relay_session: cv(await loginAs(app, fx.delivererAlpha)) } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ slackEnabled: false, slackConfigured: false });
    // The webhook URL must never be exposed to the client.
    expect(JSON.stringify(res.json())).not.toContain("http");
  });

  it("a non-owner cannot change them", async () => {
    const res = await app.inject({ method: "PATCH", url: "/settings/notifications", cookies: { relay_session: cv(await loginAs(app, fx.plAlpha)) }, payload: { slackEnabled: true } });
    expect(res.statusCode).toBe(403);
  });

  it("an owner can toggle events and they persist", async () => {
    await makeOwner(fx.plAlpha);
    const cookies = { relay_session: cv(await loginAs(app, fx.plAlpha)) };
    const patched = await app.inject({ method: "PATCH", url: "/settings/notifications", cookies, payload: { slackEnabled: true, slackDeliveryLogged: true } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ slackEnabled: true, slackDeliveryLogged: true });
    const readBack = await app.inject({ method: "GET", url: "/settings/notifications", cookies });
    expect(readBack.json().slackEnabled).toBe(true);
  });

  it("the test endpoint 400s cleanly when Slack isn't configured", async () => {
    await makeOwner(fx.plAlpha);
    const res = await app.inject({ method: "POST", url: "/settings/notifications/test", cookies: { relay_session: cv(await loginAs(app, fx.plAlpha)) } });
    expect(res.statusCode).toBe(400);
  });
});
