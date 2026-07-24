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

async function plOf(projectId: string): Promise<string> {
  const { rows } = await pool.query(`SELECT pl_id FROM project WHERE id = $1`, [projectId]);
  return rows[0].pl_id;
}

describe("transfer to a different PL (POST /projects/:id/transfer)", () => {
  it("the current PL can transfer the project to anyone in the BU", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/transfer`,
      cookies: cookieHeader(cookie),
      // otherDelivererAlpha is a plain associate (not a manager/owner) — proves any role can receive a transfer, since PL-ship is per-project.
      payload: { newPlId: fx.otherDelivererAlpha },
    });
    expect(res.statusCode).toBe(200);
    expect(await plOf(fx.project)).toBe(fx.otherDelivererAlpha);
  });

  it("the card follows pl_id — it leaves the old PL's board and joins the new PL's", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/transfer`,
      cookies: cookieHeader(cookie),
      payload: { newPlId: fx.otherDelivererAlpha },
    });

    // Old PL no longer leads it.
    const oldBoard = await app.inject({
      method: "GET",
      url: "/projects?role=leading&scope=mine",
      cookies: cookieHeader(await loginAs(app, fx.plAlpha)),
    });
    expect(oldBoard.json().map((p: { id: string }) => p.id)).not.toContain(fx.project);

    // New PL now does.
    const newBoard = await app.inject({
      method: "GET",
      url: "/projects?role=leading&scope=mine",
      cookies: cookieHeader(await loginAs(app, fx.otherDelivererAlpha)),
    });
    expect(newBoard.json().map((p: { id: string }) => p.id)).toContain(fx.project);
  });

  it("a manager (not the PL) can transfer someone else's project", async () => {
    const cookie = await loginAs(app, fx.managerBeta);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/transfer`,
      cookies: cookieHeader(cookie),
      payload: { newPlId: fx.managerBeta },
    });
    expect(res.statusCode).toBe(200);
    expect(await plOf(fx.project)).toBe(fx.managerBeta);
  });

  it("a plain associate who is neither the PL nor a manager is refused (403)", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/transfer`,
      cookies: cookieHeader(cookie),
      payload: { newPlId: fx.delivererAlpha },
    });
    expect(res.statusCode).toBe(403);
    expect(await plOf(fx.project)).toBe(fx.plAlpha);
  });

  it("rejects transferring to the current PL (400)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/transfer`,
      cookies: cookieHeader(cookie),
      payload: { newPlId: fx.plAlpha },
    });
    expect(res.statusCode).toBe(400);
  });

  it("writes an audit_log entry with the old and new PL", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/transfer`,
      cookies: cookieHeader(cookie),
      payload: { newPlId: fx.otherDelivererAlpha },
    });
    const { rows } = await pool.query(
      `SELECT old_value, new_value FROM audit_log WHERE entity_id = $1 AND action = 'transfer_pl'`,
      [fx.project]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].old_value).toEqual({ plId: fx.plAlpha });
    expect(rows[0].new_value).toEqual({ plId: fx.otherDelivererAlpha });
  });

  it("notifies the new PL", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "POST",
      url: `/projects/${fx.project}/transfer`,
      cookies: cookieHeader(cookie),
      payload: { newPlId: fx.otherDelivererAlpha },
    });
    const { rows } = await pool.query(
      `SELECT type FROM notification WHERE person_id = $1 AND type = 'project_transferred'`,
      [fx.otherDelivererAlpha]
    );
    expect(rows).toHaveLength(1);
  });
});
