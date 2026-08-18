import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { getBambooCreds } from "../services/bamboohr";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  fx = await resetAndSeedFixture();
  await pool.query(`UPDATE hr_integration_settings SET api_key_ciphertext = NULL, api_key_hint = NULL, subdomain = NULL WHERE id = 1`);
});

const ck = (c: string) => c.split("=")[1];
const owner = async () => { await pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [fx.plAlpha]); return loginAs(app, fx.plAlpha); };
const patch = (cookie: string, body: unknown) => app.inject({ method: "PATCH", url: "/settings/hr-integration", cookies: { relay_session: ck(cookie) }, payload: body });
const get = (cookie: string) => app.inject({ method: "GET", url: "/settings/hr-integration", cookies: { relay_session: ck(cookie) } });

describe("BambooHR credentials — encrypted, write-only", () => {
  it("owner pastes key + subdomain; it's stored encrypted and never returned", async () => {
    const cookie = await owner();
    const res = await patch(cookie, { apiKey: "super-secret-key-9f7a", subdomain: "alphasights" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasKey).toBe(true);
    expect(body.hint).toBe("9f7a"); // last 4 only
    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("super-secret-key"); // key never echoed

    // At rest it's ciphertext, not the plaintext key.
    const { rows } = await pool.query(`SELECT api_key_ciphertext FROM hr_integration_settings WHERE id = 1`);
    expect(rows[0].api_key_ciphertext).toBeTruthy();
    expect(rows[0].api_key_ciphertext).not.toContain("super-secret-key");

    // The service can still resolve the real key (decrypts).
    const creds = await getBambooCreds();
    expect(creds).toEqual({ apiKey: "super-secret-key-9f7a", subdomain: "alphasights" });

    // GET (read side) also never returns the key.
    const g = (await get(cookie)).json();
    expect(g.hasKey).toBe(true);
    expect(JSON.stringify(g)).not.toContain("super-secret-key");
  });

  it("clearing the key removes it", async () => {
    const cookie = await owner();
    await patch(cookie, { apiKey: "k-1234", subdomain: "x" });
    const cleared = (await patch(cookie, { clearApiKey: true })).json();
    expect(cleared.hasKey).toBe(false);
    expect(await getBambooCreds()).toBeNull();
  });

  it("is owner-only", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await patch(member, { apiKey: "nope", subdomain: "x" })).statusCode).toBe(403);
  });
});
