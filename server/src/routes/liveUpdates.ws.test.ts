import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { buildApp } from "../app";
import { DEMO_AS_OF_HEADER } from "../lib/requestTime";
import { resetAndSeedFixture, type Fixture } from "../test/fixtures";

// A fixed non-Sunday weekday morning (matches the convention in rules/*.test.ts
// and matching.api.test.ts) so eligibility never depends on real wall-clock time.
const WEEKDAY_MORNING = "2023-01-02T06:00:00Z";

/**
 * §11 step 5 — unlike every other route test in this suite, a WS upgrade
 * can't go through app.inject(); this needs a real listening socket and a
 * real ws client on the other end.
 */
let app: FastifyInstance;
let fx: Fixture;
let baseUrl: string;
let wsBaseUrl: string;

beforeAll(async () => {
  app = buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  wsBaseUrl = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  fx = await resetAndSeedFixture();
});

async function loginCookie(personId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId }),
  });
  const setCookie = res.headers.get("set-cookie")!;
  return setCookie.split(";")[0];
}

function connect(cookie?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBaseUrl}/ws`, cookie ? { headers: { Cookie: cookie } } : undefined);
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`unexpected response status ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<{ type: string; [k: string]: unknown }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for a WS message")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

/** Resolves true if no message arrives within `ms` -- used to prove a socket was correctly NOT notified. */
function assertSilentFor(ws: WebSocket, ms = 800): Promise<boolean> {
  return new Promise((resolve) => {
    ws.once("message", () => resolve(false));
    setTimeout(() => resolve(true), ms);
  });
}

describe("§11 step 5 — live updates over WebSocket", () => {
  it("rejects an unauthenticated connection with the same 401 REST would give", async () => {
    await expect(connect()).rejects.toThrow(/401/);
  });

  it("accepts an authenticated connection", async () => {
    const cookie = await loginCookie(fx.plAlpha);
    const ws = await connect(cookie);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("a project change reaches a teammate but not someone on an unrelated team -- authorization is enforced, not broadcast to everyone", async () => {
    const teammateCookie = await loginCookie(fx.otherDelivererAlpha); // same team as the PL, not on this project
    const outsiderCookie = await loginCookie(fx.managerBeta); // different team entirely
    const plCookie = await loginCookie(fx.plAlpha);

    const teammateWs = await connect(teammateCookie);
    const outsiderWs = await connect(outsiderCookie);

    const teammateMessage = waitForMessage(teammateWs);
    const outsiderStaysSilent = assertSilentFor(outsiderWs);

    await fetch(`${baseUrl}/projects/${fx.project}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: plCookie },
      body: JSON.stringify({ callsSold: 1 }),
    });

    await expect(teammateMessage).resolves.toEqual({ type: "project", projectId: fx.project });
    await expect(outsiderStaysSilent).resolves.toBe(true);

    teammateWs.close();
    outsiderWs.close();
  });

  it("logging a delivery notifies the project's people and broadcasts a capacity-ranking refresh org-wide", async () => {
    const delivererCookie = await loginCookie(fx.delivererAlpha);
    const outsiderCookie = await loginCookie(fx.managerBeta); // different team -- should still get the ranking event
    const outsiderWs = await connect(outsiderCookie);

    const outsiderMessage = waitForMessage(outsiderWs);

    await fetch(`${baseUrl}/assignments/${fx.assignment}/progress`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: delivererCookie },
      body: JSON.stringify({ delivered: 3 }),
    });

    // The outsider isn't a recipient of the project-scoped event, so the
    // first (only) thing they see is the org-wide ranking refresh.
    await expect(outsiderMessage).resolves.toEqual({ type: "capacity-ranking" });
    outsiderWs.close();
  });

  it("claiming an open-pool project broadcasts open-pool org-wide so it disappears from everyone's screen", async () => {
    // Seed an open, unstaffed project directly (bypassing intake) with an
    // eligible claimant on an unrelated team.
    const { pool } = await import("../db");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, calls_n, goal_total, status)
       VALUES ($1, 'Client_Open', 'https://example.test/proj/open', 'Pitch', 'Global', 2, 6, 'open') RETURNING id`,
      [fx.plAlpha]
    );
    const openProjectId = rows[0].id;

    const outsiderCookie = await loginCookie(fx.managerBeta);
    const claimantCookie = await loginCookie(fx.otherDelivererAlpha);
    const outsiderWs = await connect(outsiderCookie);

    const outsiderMessage = waitForMessage(outsiderWs);

    const res = await fetch(`${baseUrl}/projects/${openProjectId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: claimantCookie, [DEMO_AS_OF_HEADER]: WEEKDAY_MORNING },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    await expect(outsiderMessage).resolves.toEqual({ type: "open-pool" });
    outsiderWs.close();
  });
});
