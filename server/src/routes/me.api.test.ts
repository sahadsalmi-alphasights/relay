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
});

const sessionCookie = (c: string) => c.split("=")[1];
const makeOwner = (id: string) => pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [id]);

describe("instance switcher (/me)", () => {
  it("a non-owner cannot switch and only sees their own instance", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({ method: "GET", url: "/me/instances", cookies: { relay_session: sessionCookie(cookie) } });
    expect(res.statusCode).toBe(200);
    expect(res.json().canSwitch).toBe(false);
    expect(res.json().options.map((o: { key: string }) => o.key)).toEqual(["non_consulting"]);

    const post = await app.inject({
      method: "POST",
      url: "/me/active-instance",
      cookies: { relay_session: sessionCookie(cookie) },
      payload: { key: "consulting" },
    });
    expect(post.statusCode).toBe(403); // requireOwner
  });

  it("an owner can switch, and the choice sticks", async () => {
    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const session = sessionCookie(cookie);

    const before = await app.inject({ method: "GET", url: "/me/instances", cookies: { relay_session: session } });
    expect(before.json().canSwitch).toBe(true);
    expect(before.json().active).toBe("non_consulting"); // home default

    const post = await app.inject({
      method: "POST",
      url: "/me/active-instance",
      cookies: { relay_session: session },
      payload: { key: "consulting" },
    });
    expect(post.statusCode).toBe(200);
    const activeCookie = post.cookies.find((c) => c.name === "relay_active_instance")!;

    // Carrying the active-instance cookie, the view is now Consulting.
    const after = await app.inject({
      method: "GET",
      url: "/me/instances",
      cookies: { relay_session: session, relay_active_instance: activeCookie.value },
    });
    expect(after.json().active).toBe("consulting");
  });

  it("rejects switching to an unknown instance", async () => {
    await makeOwner(fx.plAlpha);
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/me/active-instance",
      cookies: { relay_session: sessionCookie(cookie) },
      payload: { key: "atlantis" },
    });
    expect(res.statusCode).toBe(400);
  });
});
