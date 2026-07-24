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

function cookieHeader(cookie: string) {
  return { relay_session: cookie.split("=")[1] };
}

const SUNDAY = "2099-01-04"; // a Sunday, far enough out to be stable

describe("Sunday coverage — BU-wide (POST/GET/DELETE /sunday-rota)", () => {
  it("a manager can roster someone on ANOTHER team, no teamId needed in the body", async () => {
    // managerBeta is on Team Beta; otherDelivererAlpha is on Team Alpha.
    const cookie = await loginAs(app, fx.managerBeta);
    const res = await app.inject({
      method: "POST",
      url: "/sunday-rota",
      cookies: cookieHeader(cookie),
      payload: { rotaDate: SUNDAY, personId: fx.otherDelivererAlpha },
    });
    expect(res.statusCode).toBe(200);
    // The entry is attributed to the person's OWN team (Team Alpha), derived server-side.
    expect(res.json().teamId).toBe(fx.teamAlpha);
  });

  it("GET with no teamId returns the whole BU's rota", async () => {
    const cookie = await loginAs(app, fx.managerBeta);
    await app.inject({
      method: "POST",
      url: "/sunday-rota",
      cookies: cookieHeader(cookie),
      payload: { rotaDate: SUNDAY, personId: fx.otherDelivererAlpha },
    });
    await app.inject({
      method: "POST",
      url: "/sunday-rota",
      cookies: cookieHeader(cookie),
      payload: { rotaDate: SUNDAY, personId: fx.managerBeta },
    });

    const res = await app.inject({ method: "GET", url: `/sunday-rota?from=${SUNDAY}&to=${SUNDAY}`, cookies: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);
    const people = res.json().map((r: { personId: string }) => r.personId);
    // spans both teams
    expect(people).toContain(fx.otherDelivererAlpha);
    expect(people).toContain(fx.managerBeta);
  });

  it("a plain associate cannot edit the rota (403)", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/sunday-rota",
      cookies: cookieHeader(cookie),
      payload: { rotaDate: SUNDAY, personId: fx.delivererAlpha },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a manager can remove any team's rota entry", async () => {
    const cookie = await loginAs(app, fx.managerBeta);
    const created = await app.inject({
      method: "POST",
      url: "/sunday-rota",
      cookies: cookieHeader(cookie),
      payload: { rotaDate: SUNDAY, personId: fx.otherDelivererAlpha },
    });
    const id = created.json().id;
    const del = await app.inject({ method: "DELETE", url: `/sunday-rota/${id}`, cookies: cookieHeader(cookie) });
    expect(del.statusCode).toBe(200);
  });
});
