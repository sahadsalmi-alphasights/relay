import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { DEMO_AS_OF_HEADER } from "../lib/requestTime";
import { needsChaseClient } from "../rules/project";
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

describe("§8.1 — calls_sold is PL-editable, enforced server-side", () => {
  it("a deliverer cannot write calls_sold on a project they don't lead", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsSold: 2 },
    });
    expect(res.statusCode).toBe(403);

    // Unchanged in the database.
    const check = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(check.json().project.callsSold).toBe(0);
  });

  it("the project's own PL can write calls_sold", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsSold: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().callsSold).toBe(3);
  });

  it("writing calls_sold stamps calls_sold_updated_at, clearing the end-of-day nudge for today", async () => {
    const cookie = await loginAs(app, fx.plAlpha);

    await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsSold: 1 },
    });

    const res = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.json().project.needsCallsSoldUpdate).toBe(false);
  });

  it("needsCallsSoldUpdate is true when previewing a later Dubai calendar day than the last write", async () => {
    const cookie = await loginAs(app, fx.plAlpha);

    // Fixture seeding stamps calls_sold_updated_at to "now" (today); preview
    // a Dubai instant two days later to simulate it having gone stale.
    const twoDaysLater = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      headers: { [DEMO_AS_OF_HEADER]: twoDaysLater },
    });
    expect(res.json().project.needsCallsSoldUpdate).toBe(true);
  });

  // §8.1 (corrected) — now that calls_sold is actually writable, this proves
  // the chase-client flag's real inputs are correctly plumbed end-to-end
  // through the API, not just correct in the rules module.
  it("chase-client flag fires once profiles are delivered but calls_sold lags, and clears once fully sold", async () => {
    const cookie = await loginAs(app, fx.plAlpha);

    // Fixture: fx.assignment has delivered=2, custom_delivered=0 on a
    // project with calls_n=4 and calls_sold defaulting to 0.
    let detail = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    let { project, assignments } = detail.json();
    let totalDelivered = assignments.reduce((s: number, a: { delivered: number; customDelivered: number }) => s + a.delivered + a.customDelivered, 0);
    expect(needsChaseClient(totalDelivered, project.callsSold, project.callsN)).toBe(true);

    // PL sells the remaining calls.
    await app.inject({
      method: "PATCH",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
      payload: { callsSold: project.callsN },
    });

    detail = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    ({ project, assignments } = detail.json());
    totalDelivered = assignments.reduce((s: number, a: { delivered: number; customDelivered: number }) => s + a.delivered + a.customDelivered, 0);
    expect(needsChaseClient(totalDelivered, project.callsSold, project.callsN)).toBe(false);
  });
});
