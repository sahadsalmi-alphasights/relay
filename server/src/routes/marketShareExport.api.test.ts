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

const cookieVal = (c: string) => c.substring(c.indexOf("=") + 1);

async function makeOwner(personId: string): Promise<Record<string, string>> {
  await pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [personId]);
  const cookie = await loginAs(app, personId);
  return { relay_session: cookieVal(cookie) };
}

/** A project with one angle, created at an explicit instant, sold/wanted set. */
async function seedCard(plId: string, client: string, sold: number, n: number, createdAt: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status, created_at)
     VALUES ($1, $2, 'https://example.test/x', 'Strategy', 'Global', 'active', $3) RETURNING id`,
    [plId, client, createdAt]
  );
  await pool.query(`INSERT INTO angle (project_id, name, calls_n, goal_total, calls_sold) VALUES ($1, 'Main', $2, $2, $3)`, [
    rows[0].id,
    n,
    sold,
  ]);
}

describe("market-share CSV export (owner-only, month-selectable)", () => {
  it("returns a CSV attachment whose rows reproduce the month's numbers", async () => {
    const cookies = await makeOwner(fx.plAlpha);
    await seedCard(fx.plAlpha, "Acme", 3, 10, "2026-09-10T08:00:00Z");

    const res = await app.inject({ method: "GET", url: "/projects/market-share/export.csv?scope=bu&month=2026-09", cookies });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain('filename="market-share-2026-09-bu.csv"');
    const body = res.body.replace(/^﻿/, "");
    const lines = body.trim().split("\r\n");
    expect(lines[0]).toBe("Month,Team,PL,Client,Angle,Calls sold,N (calls wanted),Share,Project created,Deleted");
    const acme = lines.find((l) => l.includes("Acme"))!;
    expect(acme).toContain("2026-09,Team_Alpha,PL_Alpha,Acme,Main,3,10,0.3000,");
    expect(acme).toContain(",no");
  });

  it("scopes by month — a past month excludes cards created in another month", async () => {
    const cookies = await makeOwner(fx.plAlpha);
    await seedCard(fx.plAlpha, "AugCard", 5, 5, "2026-08-15T08:00:00Z");
    await seedCard(fx.plAlpha, "SepCard", 1, 4, "2026-09-15T08:00:00Z");

    const aug = await app.inject({ method: "GET", url: "/projects/market-share/export.csv?scope=bu&month=2026-08", cookies });
    expect(aug.body).toContain("AugCard");
    expect(aug.body).not.toContain("SepCard");

    const sep = await app.inject({ method: "GET", url: "/projects/market-share/export.csv?scope=bu&month=2026-09", cookies });
    expect(sep.body).toContain("SepCard");
    expect(sep.body).not.toContain("AugCard");
  });

  it("rejects a non-owner with 403", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha); // member
    const cookies = { relay_session: cookieVal(cookie) };
    const res = await app.inject({ method: "GET", url: "/projects/market-share/export.csv?scope=bu", cookies });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a malformed month with 400", async () => {
    const cookies = await makeOwner(fx.plAlpha);
    const res = await app.inject({ method: "GET", url: "/projects/market-share/export.csv?scope=bu&month=2026-13", cookies });
    expect(res.statusCode).toBe(400);
  });
});
