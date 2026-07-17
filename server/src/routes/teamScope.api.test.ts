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

describe("bug 4 — scope=team returns a teammate's project, not just the actor's own", () => {
  it("GET /projects?role=leading&scope=team includes a project led by a teammate, not the logged-in actor", async () => {
    // fx.project is led by fx.plAlpha; fx.delivererAlpha is a teammate (same
    // team) but neither leads nor is the PL of it. This is precisely the
    // case a naive "team filter ANDed with personal filter" bug would empty.
    const cookie = await loginAs(app, fx.delivererAlpha);

    const teamRes = await app.inject({
      method: "GET",
      url: "/projects?role=leading&scope=team&archived=false",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(teamRes.statusCode).toBe(200);
    expect(teamRes.json().some((p: { id: string; plId: string }) => p.id === fx.project && p.plId === fx.plAlpha)).toBe(true);

    // scope=mine, by contrast, must NOT include it — delivererAlpha isn't its PL.
    const mineRes = await app.inject({
      method: "GET",
      url: "/projects?role=leading&scope=mine&archived=false",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(mineRes.json().some((p: { id: string }) => p.id === fx.project)).toBe(false);
  });

  it("GET /projects?role=delivering&scope=team includes a teammate's assignment, not just the actor's own", async () => {
    // fx.assignment is held by fx.delivererAlpha; fx.otherDelivererAlpha is a
    // teammate with no assignment of their own on it.
    const cookie = await loginAs(app, fx.otherDelivererAlpha);

    const teamRes = await app.inject({
      method: "GET",
      url: "/projects?role=delivering&scope=team&status=active&archived=false",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(teamRes.json().some((p: { id: string }) => p.id === fx.project)).toBe(true);

    const mineRes = await app.inject({
      method: "GET",
      url: "/projects?role=delivering&scope=mine&status=active&archived=false",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(mineRes.json().some((p: { id: string }) => p.id === fx.project)).toBe(false);
  });

  // §5e — this is intentional and must stay 403; it is exactly the boundary
  // the Project Leading tab's Team view must respect (only fetch pending
  // goal-change-requests for projects the actor themselves lead), not a bug
  // to "fix" by loosening the endpoint.
  it("GET /projects/:id/goal-change-requests still 403s for a teammate who isn't that project's PL", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}/goal-change-requests`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(403);
  });
});
