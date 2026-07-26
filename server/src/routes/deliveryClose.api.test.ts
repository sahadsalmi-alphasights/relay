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
async function statusOf(id: string) {
  const { rows } = await pool.query(`SELECT status, delivery_closed_at FROM project WHERE id = $1`, [id]);
  return rows[0];
}

describe("archive modes (POST /projects/:id/archive)", () => {
  it("mode 'all' archives the whole project (today's behavior)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/archive`,
      cookies: cookieHeader(cookie),
      payload: { mode: "all" },
    });
    expect(res.statusCode).toBe(200);
    const p = await statusOf(fx.project);
    expect(p.status).toBe("archived");
    expect(p.delivery_closed_at).toBeNull();
  });

  it("mode 'deliverers' keeps the project active but marks delivery closed", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/archive`,
      cookies: cookieHeader(cookie),
      payload: { mode: "deliverers" },
    });
    expect(res.statusCode).toBe(200);
    const p = await statusOf(fx.project);
    expect(p.status).not.toBe("archived");
    expect(p.delivery_closed_at).not.toBeNull();
  });

  it("a delivery-closed project drops off its deliverer's board", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/archive`,
      cookies: cookieHeader(cookie),
      payload: { mode: "deliverers" },
    });
    // delivererAlpha holds an assignment on this project — it must no longer appear.
    const board = await app.inject({
      method: "GET",
      url: "/projects/board?role=delivering&scope=mine&status=active",
      cookies: cookieHeader(await loginAs(app, fx.delivererAlpha)),
    });
    const ids = board.json().map((d: { project: { id: string } }) => d.project.id);
    expect(ids).not.toContain(fx.project);
  });

  it("reopen-delivery brings it back to the deliverer's board", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({ method: "POST", url: `/projects/${fx.project}/archive`, cookies: cookieHeader(cookie), payload: { mode: "deliverers" } });
    await app.inject({ method: "POST", url: `/projects/${fx.project}/reopen-delivery`, cookies: cookieHeader(cookie) });
    const board = await app.inject({
      method: "GET",
      url: "/projects/board?role=delivering&scope=mine&status=active",
      cookies: cookieHeader(await loginAs(app, fx.delivererAlpha)),
    });
    const ids = board.json().map((d: { project: { id: string } }) => d.project.id);
    expect(ids).toContain(fx.project);
    expect((await statusOf(fx.project)).delivery_closed_at).toBeNull();
  });
});
