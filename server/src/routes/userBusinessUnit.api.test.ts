import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { findPersonById } from "../repositories/people";
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
const patchBu = (cookie: string, id: string, businessUnit: unknown) =>
  app.inject({
    method: "PATCH",
    url: `/users/${id}/business-unit`,
    cookies: { relay_session: cookieOf(cookie) },
    payload: { businessUnit },
  });

describe("PATCH /users/:id/business-unit", () => {
  it("is owner-only", async () => {
    const manager = await loginAs(app, fx.plAlpha); // manager, not owner
    expect((await patchBu(manager, fx.delivererAlpha, "consulting")).statusCode).toBe(403);
  });

  it("an owner moves a user to consulting, and it bumps their session", async () => {
    await makeOwner(fx.plAlpha);
    const owner = await loginAs(app, fx.plAlpha);
    const before = await findPersonById(fx.delivererAlpha);
    expect(before?.businessUnit).toBe("non_consulting");

    const res = await patchBu(owner, fx.delivererAlpha, "consulting");
    expect(res.statusCode).toBe(200);
    expect(res.json().businessUnit).toBe("consulting");

    const after = await findPersonById(fx.delivererAlpha);
    expect(after?.businessUnit).toBe("consulting");
    // Session bumped so a mid-session BU change re-scopes cleanly.
    expect(after!.sessionVersion).toBe(before!.sessionVersion + 1);
  });

  it("rejects an invalid BU value", async () => {
    await makeOwner(fx.plAlpha);
    const owner = await loginAs(app, fx.plAlpha);
    expect((await patchBu(owner, fx.delivererAlpha, "marketing")).statusCode).toBe(400);
  });
});
