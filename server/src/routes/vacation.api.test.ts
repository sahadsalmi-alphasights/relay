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

describe("vacation planner API (role-scoped)", () => {
  it("lets any signed-in member read /vacation/data", async () => {
    // Read is open — a member needs it for My Vacation + Plan My Trip. The
    // team-facing sub-tabs are gated in the web nav; every write stays owner-only.
    const member = await loginAs(app, fx.delivererAlpha);
    const res = await get(member, "/vacation/data");
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().members)).toBe(true);
    expect(res.json().quarters.length).toBeGreaterThan(0);
  });

  it("still blocks a member from every config write", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await post(member, "/vacation/closures", { name: "x", startDate: "2026-12-24", endDate: "2026-12-26" })).statusCode).toBe(403);
    expect((await post(member, "/vacation/public-holidays", { name: "x", holidayDate: "2026-09-25" })).statusCode).toBe(403);
    expect((await post(member, "/vacation/busy-periods", { label: "x", startDate: "2026-12-24", endDate: "2026-12-26" })).statusCode).toBe(403);
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

  it("GET /vacation/diagnostics?check=holidays is owner-only and reports cleanly when BambooHR is unset", async () => {
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await get(member, "/vacation/diagnostics?check=holidays")).statusCode).toBe(403);

    const cookie = await owner();
    const res = await get(cookie, "/vacation/diagnostics?check=holidays");
    expect(res.statusCode).toBe(200);
    // No BAMBOOHR_* in the test env → clean {ok:false} with a reason, not a crash.
    expect(res.json().ok).toBe(false);
    expect(String(res.json().error)).toMatch(/bamboohr|not configured/i);
  });

  it("POST /vacation/remind is manager+ and reports when Slack isn't configured", async () => {
    // A plain member never sees the nudge and can't reach it.
    const member = await loginAs(app, fx.delivererAlpha);
    expect((await post(member, "/vacation/remind", { email: "a@b.co" })).statusCode).toBe(403);

    // A manager (not an owner) may send it.
    const mgr = await loginAs(app, fx.managerBeta);
    expect((await post(mgr, "/vacation/remind", {})).statusCode).toBe(400); // email required
    // No SLACK_BOT_TOKEN in the test env → clean {ok:false} with a reason, not a crash.
    const mres = await post(mgr, "/vacation/remind", { email: "someone@test.example", name: "Sam", quarter: "Q2 2027" });
    expect(mres.statusCode).toBe(200);
    expect(mres.json().ok).toBe(false);
    expect(mres.json().error).toMatch(/slack/i);

    // And an owner, of course.
    const cookie = await owner();
    const res = await post(cookie, "/vacation/remind", { email: "someone@test.example", name: "Sam", quarter: "Q2 2027" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
  });

  describe("self-service booking (POST /vacation/request)", () => {
    it("requires auth", async () => {
      expect((await app.inject({ method: "POST", url: "/vacation/request", payload: {} })).statusCode).toBe(401);
    });

    it("validates dates and leave type before touching BambooHR", async () => {
      const member = await loginAs(app, fx.delivererAlpha);
      expect((await post(member, "/vacation/request", {})).statusCode).toBe(400); // missing dates
      expect((await post(member, "/vacation/request", { start: "2027-03-10", end: "2027-03-05", timeOffTypeId: "1" })).statusCode).toBe(400); // end before start
      expect((await post(member, "/vacation/request", { start: "2027-03-10", end: "2027-03-12" })).statusCode).toBe(400); // no type
    });

    it("with valid input but BambooHR not configured, fails to resolve the employee (never books for anyone else)", async () => {
      const member = await loginAs(app, fx.delivererAlpha);
      const res = await post(member, "/vacation/request", { start: "2027-03-10", end: "2027-03-12", timeOffTypeId: "1" });
      // No BAMBOOHR_* in the test env → can't match the caller's own record → 400, not a write.
      expect(res.statusCode).toBe(400);
      expect(String(res.json().message ?? res.json().error)).toMatch(/match|bamboohr/i);
    });
  });
});
