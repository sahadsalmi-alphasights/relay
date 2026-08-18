import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { getSlackBotToken, getSlackWebhookUrl } from "../services/slack";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  fx = await resetAndSeedFixture();
  await pool.query(`DELETE FROM integration_secret`);
});

const ck = (c: string) => c.split("=")[1];
const owner = async () => { await pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [fx.plAlpha]); return loginAs(app, fx.plAlpha); };
const patch = (cookie: string, body: unknown) => app.inject({ method: "PATCH", url: "/settings/notifications/slack-credentials", cookies: { relay_session: ck(cookie) }, payload: body });
const getNotif = (cookie: string) => app.inject({ method: "GET", url: "/settings/notifications", cookies: { relay_session: ck(cookie) } });

describe("Slack credentials — encrypted, write-only", () => {
  it("owner pastes webhook + bot token; stored encrypted, never returned, resolvable", async () => {
    const cookie = await owner();
    const res = await patch(cookie, { webhookUrl: "https://hooks.slack.com/services/T/B/abcd1234", botToken: "xoxb-real-token-9999" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slackConfigured).toBe(true);
    expect(body.slackDmConfigured).toBe(true);
    expect(body.slackHints.webhookUrl.hasValue).toBe(true);
    expect(body.slackHints.webhookUrl.hint).toBe("1234");
    expect(body.slackHints.botToken.hint).toBe("9999");
    expect(JSON.stringify(body)).not.toContain("xoxb-real-token"); // never echoed
    expect(JSON.stringify(body)).not.toContain("hooks.slack.com");

    // At rest = ciphertext.
    const { rows } = await pool.query(`SELECT ciphertext FROM integration_secret ORDER BY name`);
    expect(rows.every((r) => !r.ciphertext.includes("xoxb-real-token"))).toBe(true);

    // The service resolves the real values (decrypts).
    expect(await getSlackWebhookUrl()).toBe("https://hooks.slack.com/services/T/B/abcd1234");
    expect(await getSlackBotToken()).toBe("xoxb-real-token-9999");

    // GET (read side) never leaks the secret either.
    expect(JSON.stringify((await getNotif(cookie)).json())).not.toContain("xoxb-real-token");
  });

  it("clearing a Slack credential removes it", async () => {
    const cookie = await owner();
    await patch(cookie, { botToken: "xoxb-1234" });
    expect(await getSlackBotToken()).toBe("xoxb-1234");
    const cleared = (await patch(cookie, { clear: "botToken" })).json();
    expect(cleared.slackDmConfigured).toBe(false);
    expect(await getSlackBotToken()).toBe("");
  });

  it("is owner-only", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await patch(member, { webhookUrl: "https://hooks.slack.com/x" })).statusCode).toBe(403);
  });

  it("diagnostics: owner-only, per-check, surfaces not-configured reasons", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await app.inject({ method: "GET", url: "/settings/notifications/slack-diagnostics?check=bot", cookies: { relay_session: ck(await loginAs(app, fx.delivererAlpha)) } })).statusCode).toBe(403);
    void member;

    const cookie = await owner();
    const diag = (check: string) => app.inject({ method: "GET", url: `/settings/notifications/slack-diagnostics?check=${check}`, cookies: { relay_session: ck(cookie) } });

    // Nothing configured → each check reports why (bot check does NOT hit the
    // network when there's no token, so this stays deterministic offline).
    const bot = (await diag("bot")).json();
    expect(bot.ok).toBe(false);
    expect(String(bot.error)).toMatch(/no bot token/i);
    expect((await diag("webhook")).json().ok).toBe(false);
    expect((await diag("signing")).json().ok).toBe(false);

    // Configure webhook + signing → those two flip green.
    await patch(cookie, { webhookUrl: "https://hooks.slack.com/services/T/B/xyz", signingSecret: "sign-1234" });
    expect((await diag("webhook")).json().ok).toBe(true);
    expect((await diag("signing")).json().ok).toBe(true);

    expect((await diag("nope")).statusCode).toBe(400);
  });
});
