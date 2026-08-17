import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { findPersonById } from "../repositories/people";
import { listInstanceKeysForPerson } from "../repositories/instances";
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

const cookieOf = (c: string) => c.split("=")[1];
const makeOwner = (id: string) => pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [id]);
const patch = (cookie: string, id: string, instanceKeys: unknown) =>
  app.inject({
    method: "PATCH",
    url: `/users/${id}/instances`,
    cookies: { relay_session: cookieOf(cookie) },
    payload: { instanceKeys },
  });

describe("PATCH /users/:id/instances (multi-instance membership)", () => {
  it("is owner-only", async () => {
    const manager = await loginAs(app, fx.plAlpha);
    expect((await patch(manager, fx.delivererAlpha, ["consulting"])).statusCode).toBe(403);
  });

  it("an owner sets a user's memberships to several instances", async () => {
    await makeOwner(fx.plAlpha);
    const owner = await loginAs(app, fx.plAlpha);
    const before = await findPersonById(fx.delivererAlpha);

    const res = await patch(owner, fx.delivererAlpha, ["consulting", "non_consulting"]);
    expect(res.statusCode).toBe(200);
    expect(res.json().instanceKeys.sort()).toEqual(["consulting", "non_consulting"]);

    expect((await listInstanceKeysForPerson(fx.delivererAlpha)).sort()).toEqual(["consulting", "non_consulting"]);
    // Membership change bumps the session so it re-scopes cleanly.
    const after = await findPersonById(fx.delivererAlpha);
    expect(after!.sessionVersion).toBe(before!.sessionVersion + 1);
  });

  it("rejects an unknown instance key and a non-array body", async () => {
    await makeOwner(fx.plAlpha);
    const owner = await loginAs(app, fx.plAlpha);
    expect((await patch(owner, fx.delivererAlpha, ["marketing"])).statusCode).toBe(400);
    expect((await patch(owner, fx.delivererAlpha, "consulting")).statusCode).toBe(400);
  });
});
