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

function cookieHeader(cookie: string) {
  return { relay_session: cookie.split("=")[1] };
}

// Batch S removed 'idle' and its /idle, /reactivate routes entirely — the
// old "idle/reactivate transitions" and "idle contributes zero load" describe
// blocks that used to live here are gone with it. Archived-project coverage
// (the other formerly-quiet status) stays.
describe("project lifecycle — archived contributes zero load", () => {
  it("an archived project also contributes zero load", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({ method: "POST", url: `/projects/${fx.project}/archive`, cookies: cookieHeader(cookie) });

    const after = await app.inject({ method: "GET", url: "/capacity-ranking", cookies: cookieHeader(cookie) });
    const afterRow = after.json().find((r: { personId: string }) => r.personId === fx.delivererAlpha);
    expect(afterRow.load).toBe(0);
  });
});

describe("project lifecycle — morning calls-sold dialog exclusions (GET /projects/calls-sold-due)", () => {
  async function makeStaleToday() {
    await pool.query(`UPDATE angle SET calls_sold_updated_at = now() - interval '2 days' WHERE id = $1`, [fx.angle]);
  }

  it("an active project with stale calls_sold shows up as due", async () => {
    await makeStaleToday();
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({ method: "GET", url: "/projects/calls-sold-due", cookies: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);
    const { due } = res.json();
    expect(due.map((d: { id: string }) => d.id)).toContain(fx.project);
  });

  it("an archived project is never due (Batch S removed the old separate parked list along with 'idle')", async () => {
    await makeStaleToday();
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({ method: "POST", url: `/projects/${fx.project}/archive`, cookies: cookieHeader(cookie) });

    const res = await app.inject({ method: "GET", url: "/projects/calls-sold-due", cookies: cookieHeader(cookie) });
    const { due } = res.json();
    expect(due.map((d: { id: string }) => d.id)).not.toContain(fx.project);
  });

  it("a project whose calls_sold was already touched today is not due", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({ method: "GET", url: "/projects/calls-sold-due", cookies: cookieHeader(cookie) });
    const { due } = res.json();
    expect(due.map((d: { id: string }) => d.id)).not.toContain(fx.project);
  });

  it("never lists another PL's projects", async () => {
    await makeStaleToday();
    const cookie = await loginAs(app, fx.managerBeta);
    const res = await app.inject({ method: "GET", url: "/projects/calls-sold-due", cookies: cookieHeader(cookie) });
    const { due } = res.json();
    expect(due.map((d: { id: string }) => d.id)).not.toContain(fx.project);
  });
});

describe("project lifecycle — client entity", () => {
  it("defaults to 1 when not given at creation", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      payload: {
        client: "Client_NoEntity",
        projectLink: "https://example.test/proj/no-entity",
        projectType: "Strategy",
        expertPool: "Global",
        angles: [{ name: "Main", callsN: 2, goalTotal: 4, assignments: [] }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clientEntity).toBe(1);
  });

  it("accepts a valid clientEntity at creation", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      payload: {
        client: "Client_Entity3",
        projectLink: "https://example.test/proj/entity-3",
        projectType: "Strategy",
        expertPool: "Global",
        clientEntity: 3,
        angles: [{ name: "Main", callsN: 2, goalTotal: 4, assignments: [] }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clientEntity).toBe(3);
  });

  it("rejects an out-of-range clientEntity at creation", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: cookieHeader(cookie),
      payload: {
        client: "Client_BadEntity",
        projectLink: "https://example.test/proj/bad-entity",
        projectType: "Strategy",
        expertPool: "Global",
        clientEntity: 6,
        angles: [{ name: "Main", callsN: 2, goalTotal: 4, assignments: [] }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PL can edit clientEntity via PATCH", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: cookieHeader(cookie),
      payload: { clientEntity: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clientEntity).toBe(4);
  });

  it("rejects an out-of-range clientEntity on PATCH", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: cookieHeader(cookie),
      payload: { clientEntity: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});
