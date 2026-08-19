import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { fx = await resetAndSeedFixture(); });

const ck = (c: string) => c.split("=")[1];
const owner = async () => { await pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [fx.plAlpha]); return loginAs(app, fx.plAlpha); };
const get = (cookie: string, url: string) => app.inject({ method: "GET", url, cookies: { relay_session: ck(cookie) } });

describe("GET /users/roster (scalable owner roster)", () => {
  it("is owner-only", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await get(member, "/users/roster")).statusCode).toBe(403);
  });

  it("defaults to the caller's active (home) instance — the fixture is all Non-Consulting", async () => {
    const cookie = await owner();
    const res = await get(cookie, "/users/roster");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    // Everyone returned is a Non-Consulting member (home instance).
    expect(body.users.every((u: { instanceKeys: string[] }) => u.instanceKeys.includes("non_consulting"))).toBe(true);
    expect(body).toMatchObject({ page: 1 });
  });

  it("filters by a different instance tuple and finds only its members", async () => {
    // No one is Consulting yet.
    const cookie = await owner();
    let res = await get(cookie, "/users/roster?location=Dubai&department=" + encodeURIComponent("DUB - Consulting"));
    expect(res.json().total).toBe(0);

    // Add delivererAlpha to the Consulting instance.
    await pool.query(`INSERT INTO person_instance (person_id, instance_key) VALUES ($1, 'consulting')`, [fx.delivererAlpha]);
    res = await get(cookie, "/users/roster?location=Dubai&department=" + encodeURIComponent("DUB - Consulting"));
    expect(res.json().total).toBe(1);
    expect(res.json().users[0].id).toBe(fx.delivererAlpha);
  });

  it("searches by name/email and paginates", async () => {
    const cookie = await owner();
    const s = await get(cookie, "/users/roster?q=Deliverer");
    expect(s.json().users.every((u: { name: string }) => /deliverer/i.test(u.name))).toBe(true);

    const p1 = await get(cookie, "/users/roster?limit=1&page=1");
    expect(p1.json().users.length).toBe(1);
    expect(p1.json().limit).toBe(1);
    expect(p1.json().total).toBeGreaterThanOrEqual(1);
  });
});
