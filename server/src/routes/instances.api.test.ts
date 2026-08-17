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
  await pool.query(`DELETE FROM instance WHERE key NOT IN ('consulting', 'non_consulting')`);
});

const cookieOf = (c: string) => c.split("=")[1];
const makeOwner = (id: string) => pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [id]);
const post = (cookie: string, name: unknown) =>
  app.inject({ method: "POST", url: "/instances", cookies: { relay_session: cookieOf(cookie) }, payload: { name } });
const list = (cookie: string) =>
  app.inject({ method: "GET", url: "/instances", cookies: { relay_session: cookieOf(cookie) } });

describe("instances registry", () => {
  it("lists the two seeded instances for any signed-in user", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await list(cookie);
    expect(res.statusCode).toBe(200);
    const keys = res.json().map((i: { key: string }) => i.key).sort();
    expect(keys).toEqual(["consulting", "non_consulting"]);
  });

  it("owner creates a new instance (name → slug key)", async () => {
    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await post(cookie, "APAC Research");
    expect(res.statusCode).toBe(200);
    expect(res.json().key).toBe("apac_research");
    expect(res.json().name).toBe("APAC Research");
  });

  it("is owner-only for creation, and rejects duplicates / blanks", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await post(member, "Nope")).statusCode).toBe(403);

    await makeOwner(fx.plAlpha);
    const owner = await loginAs(app, fx.plAlpha);
    expect((await post(owner, "   ")).statusCode).toBe(400);
    // "Consulting" slugs to the seeded 'consulting' → conflict.
    expect((await post(owner, "Consulting")).statusCode).toBe(409);
  });
});
