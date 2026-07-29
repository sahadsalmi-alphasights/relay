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

const cv = (c: string) => c.substring(c.indexOf("=") + 1);

describe("personal reminders — Admin section (2026-07-29)", () => {
  it("create, list, edit, and delete one's own reminders", async () => {
    const cookies = { relay_session: cv(await loginAs(app, fx.plAlpha)) };

    const created = await app.inject({ method: "POST", url: "/people/me/notes", cookies, payload: { body: "Call the client" } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;

    const list = await app.inject({ method: "GET", url: "/people/me/notes", cookies });
    expect(list.json().map((n: { body: string }) => n.body)).toContain("Call the client");

    const edited = await app.inject({ method: "PATCH", url: `/people/me/notes/${id}`, cookies, payload: { body: "Call the client back" } });
    expect(edited.json().body).toBe("Call the client back");

    const del = await app.inject({ method: "DELETE", url: `/people/me/notes/${id}`, cookies });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/people/me/notes", cookies });
    expect(after.json()).toHaveLength(0);
  });

  it("empty body is rejected", async () => {
    const cookies = { relay_session: cv(await loginAs(app, fx.plAlpha)) };
    const res = await app.inject({ method: "POST", url: "/people/me/notes", cookies, payload: { body: "   " } });
    expect(res.statusCode).toBe(400);
  });

  it("one person cannot read, edit, or delete another's reminders", async () => {
    const alpha = { relay_session: cv(await loginAs(app, fx.plAlpha)) };
    const beta = { relay_session: cv(await loginAs(app, fx.managerBeta)) };

    const mine = await app.inject({ method: "POST", url: "/people/me/notes", cookies: alpha, payload: { body: "private to alpha" } });
    const id = mine.json().id;

    // Beta doesn't see it in their own list…
    const betaList = await app.inject({ method: "GET", url: "/people/me/notes", cookies: beta });
    expect(betaList.json()).toHaveLength(0);

    // …and can neither edit nor delete it (404, not 403 — don't leak existence).
    const betaEdit = await app.inject({ method: "PATCH", url: `/people/me/notes/${id}`, cookies: beta, payload: { body: "hijack" } });
    expect(betaEdit.statusCode).toBe(404);
    const betaDel = await app.inject({ method: "DELETE", url: `/people/me/notes/${id}`, cookies: beta });
    expect(betaDel.statusCode).toBe(404);

    // Alpha's reminder is untouched.
    const alphaList = await app.inject({ method: "GET", url: "/people/me/notes", cookies: alpha });
    expect(alphaList.json()[0].body).toBe("private to alpha");
  });
});
