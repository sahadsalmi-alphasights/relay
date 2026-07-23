import type { FastifyPluginAsync } from "fastify";
import { config } from "../config";
import { resolveNow } from "../lib/requestTime";
import { listAvailableCandidatesWithAssignments } from "../services/candidates";
import { isEligible } from "../rules/eligibility";
import { personLoad, personRawRemaining } from "../rules/load";
import { median } from "../rules/median";
import { dubaiHour } from "../rules/time";

/**
 * This is the single most expensive read in the app — it pulls every open
 * assignment in the BU and recomputes load for everyone. The frontend calls
 * it from three places (PL team panel, Delivery, the Capacity tab) for every
 * user, so on a busy BU a dozen identical computations can land within one
 * second and pin the (single) CPU — the cause of the 50s response times and
 * Cloudflare timeouts on 2026-07-22.
 *
 * The result is org-wide and identical for every caller within a short
 * window (in production the demo-clock override is off, so `now` is real
 * time). So we compute at most once per TTL per pool and hand every caller
 * in that window the same array. A concurrent burst awaits ONE in-flight
 * computation rather than each starting its own. Staleness is bounded by the
 * TTL — trivial for a capacity overview, and live WS events still drive the
 * client to refetch when something actually changes.
 */
const TTL_MS = 15_000;
type Ranked = Awaited<ReturnType<typeof compute>>;
const cache = new Map<string, { at: number; inflight: Promise<Ranked> }>();

async function compute(request: import("fastify").FastifyRequest, ghost: boolean): Promise<
  { personId: string; practiceArea: string | null; load: number; rawRemaining: number; free: boolean; eligible: boolean }[]
> {
  const now = resolveNow(request);
  const hour = dubaiHour(now);
  const people = await listAvailableCandidatesWithAssignments({ ghost });
  // Free/Busy is judged on weighted LOAD now (2026-07-23): the median is taken
  // over ONLINE (eligible) people's load; anyone at/below it is Free, above is
  // Busy. Offline people (evening coverage off after 7pm) still show as "Off"
  // and don't move the median.
  const rows = people.map((p) => ({
    p,
    elig: isEligible({ id: p.id, status: p.status, eveningCoverage: p.eveningCoverage }, { now }),
    load: personLoad(p.assignments, hour),
  }));
  const medLoad = median(rows.filter((r) => r.elig.eligible).map((r) => r.load));
  const ranked = rows.map(({ p, elig, load }) => ({
    personId: p.id,
    practiceArea: p.practiceArea,
    load,
    rawRemaining: personRawRemaining(p.assignments),
    free: load <= medLoad,
    eligible: elig.eligible,
  }));
  ranked.sort((a, b) => a.load - b.load);
  return ranked;
}

/**
 * §8.3 — visible to everyone, org-wide (not team-private, confirmed with the
 * product owner). It replaces a shared spreadsheet everyone could already see.
 *
 * "Invisible competition" — `?ghost=true` is the SAME route/query, filtered
 * to the ghost pool instead of the standard one.
 */
const capacityRankingRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { ghost?: string } }>("/", { preHandler: [app.requireAuth] }, async (request) => {
    const ghost = request.query.ghost === "true";
    // Cache ONLY in production. The storm that pins the CPU is a prod-scale
    // problem; dev and the test suite must see fresh numbers immediately
    // after a mutation (the tests query capacity-ranking right after changing
    // data, and a 15s stale window would fail them — and mildly confuse a
    // user, but 15s is an acceptable trade at prod scale). Demo-clock
    // requests always bypass so previewing an hour stays live.
    const demo = request.headers["x-demo-as-of"];
    if (config.nodeEnv !== "production" || demo) return compute(request, ghost);

    const key = ghost ? "ghost" : "std";
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.inflight;
    const inflight = compute(request, ghost);
    cache.set(key, { at: Date.now(), inflight });
    return inflight;
  });
};

export default capacityRankingRoutes;
