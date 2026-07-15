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

const basePayload = {
  client: "Client_Link",
  projectType: "Strategy",
  expertPool: "Global",
  callsN: 2,
  goalTotal: 6,
  assignments: [],
};

describe("project_link — required at intake, validated server-side (bug fix)", () => {
  it("rejects project creation with no projectLink at all", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { ...basePayload },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects project creation with an empty-string projectLink", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { ...basePayload, projectLink: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects project creation with a non-URL projectLink", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { ...basePayload, projectLink: "not a url" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a javascript: URI (not http/https) as a projectLink", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { ...basePayload, projectLink: "javascript:alert(1)" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid https URL and persists it", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { ...basePayload, projectLink: "https://sharepoint.example.test/proj/link-test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projectLink).toBe("https://sharepoint.example.test/proj/link-test");
  });

  it("PATCH cannot clear projectLink to an empty string", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { projectLink: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH rejects an invalid projectLink", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { projectLink: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH accepts a valid replacement projectLink", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { projectLink: "https://sharepoint.example.test/proj/updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projectLink).toBe("https://sharepoint.example.test/proj/updated");
  });
});
