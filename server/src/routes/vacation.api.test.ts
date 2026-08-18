import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  fx = await resetAndSeedFixture();
  await pool.query(`DELETE FROM company_closure`);
  await pool.query(`DELETE FROM public_holiday`);
  await pool.query(`DELETE FROM busy_period`);
});

const ck = (c: string) => c.split("=")[1];
const owner = async () => { await pool.query(`UPDATE person SET is_owner = true WHERE id = $1`, [fx.plAlpha]); return loginAs(app, fx.plAlpha); };
const get = (cookie: string, url: string) => app.inject({ method: "GET", url, cookies: { relay_session: ck(cookie) } });
const post = (cookie: string, url: string, payload: unknown) => app.inject({ method: "POST", url, cookies: { relay_session: ck(cookie) }, payload });

describe("vacation planner API (owner-only)", () => {
  it("blocks non-owners from /vacation/data", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await get(member, "/vacation/data")).statusCode).toBe(403);
  });

  it("returns members, computed quarters and empty config for an owner", async () => {
    const cookie = await owner();
    const res = await get(cookie, "/vacation/data");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.members.some((m: { name: string }) => m.name === "Deliverer_Alpha")).toBe(true);
    expect(body.quarters.length).toBeGreaterThan(0);
    expect(body.quarters[0]).toHaveProperty("deadline");
    // BambooHR not configured in test → vacation blocks are empty, not an error.
    expect(body.members.every((m: { vacations: unknown[] }) => Array.isArray(m.vacations))).toBe(true);
  });

  it("owner creates a closure and it appears in /data", async () => {
    const cookie = await owner();
    const c = await post(cookie, "/vacation/closures", { name: "Winter Break", startDate: "2026-12-24", endDate: "2026-12-26" });
    expect(c.statusCode).toBe(200);
    const body = (await get(cookie, "/vacation/data")).json();
    expect(body.closures.map((x: { name: string }) => x.name)).toContain("Winter Break");
  });

  it("diagnostics: owner-only, per-check, surfaces the BambooHR-not-configured reason", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await get(member, "/vacation/diagnostics?check=connection")).statusCode).toBe(403);

    const cookie = await owner();
    // Not configured in tests → connection/timeoff report the reason (not a crash).
    const conn = (await get(cookie, "/vacation/diagnostics?check=connection")).json();
    expect(conn.ok).toBe(false);
    expect(String(conn.error)).toMatch(/not configured/i);
    const tof = (await get(cookie, "/vacation/diagnostics?check=timeoff")).json();
    expect(tof.ok).toBe(false);
    // Matching still runs (empty BambooHR → 0 matched), and counts BU people.
    const match = (await get(cookie, "/vacation/diagnostics?check=matching")).json();
    expect(match.ok).toBe(true);
    expect(match.matched).toBe(0);
    expect(match.peopleInBu).toBeGreaterThan(0);
    // Unknown check → 400.
    expect((await get(cookie, "/vacation/diagnostics?check=nope")).statusCode).toBe(400);
  });

  it("owner creates a public holiday, assigns coverage, and validates dates", async () => {
    const cookie = await owner();
    const created = await post(cookie, "/vacation/public-holidays", { name: "Founders' Day", holidayDate: "2026-09-25", reqTotal: 1 });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    const cov = await app.inject({ method: "PATCH", url: `/vacation/public-holidays/${id}/coverage`, cookies: { relay_session: ck(cookie) }, payload: { personId: fx.delivererAlpha, assigned: true } });
    expect(cov.statusCode).toBe(200);
    const body = (await get(cookie, "/vacation/data")).json();
    const h = body.publicHolidays.find((x: { id: string }) => x.id === id);
    expect(h.coverage).toContain(fx.delivererAlpha);
    // bad date rejected
    expect((await post(cookie, "/vacation/closures", { name: "x", startDate: "nope", endDate: "2026-01-01" })).statusCode).toBe(400);
  });
});
