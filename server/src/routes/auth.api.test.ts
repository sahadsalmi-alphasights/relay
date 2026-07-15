import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { findOrCreatePersonByEmail, findPersonByEmail } from "../repositories/people";
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

describe("§7/§11 step 6 — auth mode + OIDC/DEV_AUTH mutual exclusion", () => {
  it("GET /auth/mode is public and reports the server's real auth mode", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/mode" });
    expect(res.statusCode).toBe(200);
    // The whole test suite runs with DEV_AUTH=true (see docker-compose.yml / .env).
    expect(res.json()).toEqual({ devAuth: true });
  });

  it("OIDC routes are disabled while DEV_AUTH is active", async () => {
    const login = await app.inject({ method: "GET", url: "/auth/oidc/login" });
    expect(login.statusCode).toBe(403);

    const callback = await app.inject({ method: "GET", url: "/auth/oidc/callback?code=x&state=y" });
    expect(callback.statusCode).toBe(403);
  });

  it("dev-only routes still work normally when DEV_AUTH is active (unchanged behavior)", async () => {
    const users = await app.inject({ method: "GET", url: "/auth/dev-users" });
    expect(users.statusCode).toBe(200);
    expect(users.json().some((u: { id: string }) => u.id === fx.plAlpha)).toBe(true);

    const cookie = await loginAs(app, fx.plAlpha);
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(me.json().id).toBe(fx.plAlpha);
  });
});

describe("§7 — JIT person provisioning from OIDC claims", () => {
  it("creates a new, team-less person on first sight of an email", async () => {
    const before = await findPersonByEmail("new.hire@example.test");
    expect(before).toBeNull();

    const person = await findOrCreatePersonByEmail("new.hire@example.test", "New Hire");
    expect(person.email).toBe("new.hire@example.test");
    expect(person.name).toBe("New Hire");
    expect(person.teamId).toBeNull(); // §7a onboarding picks this up client-side

    const again = await findPersonByEmail("new.hire@example.test");
    expect(again?.id).toBe(person.id);
  });

  it("is idempotent -- a second login with the same email returns the same person, not a duplicate", async () => {
    const first = await findOrCreatePersonByEmail("repeat.login@example.test", "Repeat Login");
    const second = await findOrCreatePersonByEmail("repeat.login@example.test", "Repeat Login");
    expect(second.id).toBe(first.id);
  });

  it("matches an existing person's email case-insensitively", async () => {
    const created = await findOrCreatePersonByEmail("Case.Test@Example.test", "Case Test");
    const found = await findPersonByEmail("case.test@example.test");
    expect(found?.id).toBe(created.id);
  });
});
