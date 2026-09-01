import type { FastifyPluginAsync } from "fastify";
import { badRequest } from "../errors";
import { auditByAction, frictionSignals, topUsers, usageByEvent, usageByTeam } from "../repositories/analytics";
import { marketShareForMonth } from "../repositories/projects";
import { hasSnapshot, snapshotMarketShare } from "../repositories/marketShareSnapshot";
import {
  auditEventsForMonth,
  goalAttainmentForMonth,
  goalChangeSnapshot,
  marketShareByTeam,
  marketShareByType,
  pipelineForMonth,
} from "../repositories/monthlyReview";
import { activeInstanceKey } from "../auth/activeInstance";
import { listAvailableCandidatesWithAssignments } from "../services/candidates";
import { personLoad } from "../rules/load";
import { median } from "../rules/median";
import { dubaiHour, dubaiMonthRange, dubaiMonthRangeForKey } from "../rules/time";
import { resolveNow } from "../lib/requestTime";

/** Step a "YYYY-MM" key back by n months. */
function monthKeyMinus(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Market share for one month, reading the frozen snapshot for closed months. */
async function shareForMonth(monthKey: string, currentMonthKey: string): Promise<{ callsSold: number; n: number }> {
  const { startIso, endIso } = dubaiMonthRangeForKey(monthKey);
  if (monthKey !== currentMonthKey && (await hasSnapshot(monthKey))) {
    return snapshotMarketShare({}, monthKey);
  }
  return marketShareForMonth({}, startIso, endIso);
}

/** Allowed rolling windows → days back. "all" reaches to the epoch. */
const WINDOWS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

function windowStartIso(window: string, now: number): string {
  const days = WINDOWS[window];
  if (days === null) return new Date(0).toISOString();
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Owner-only usage analytics. Aggregates telemetry (usage_event) and the audit
 * trail into "what's used" + "what shows friction", by team and by user.
 * requireOwner — this spans every team and every person, so it's the same
 * privileged surface as the rest of Settings, gated server-side (hiding the
 * tab in the UI is not authorization).
 */
const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { window?: string } }>("/", { preHandler: [app.requireOwner] }, async (request) => {
    const window = request.query.window ?? "30d";
    if (!(window in WINDOWS)) throw badRequest("window must be one of 7d, 30d, 90d, all");
    const from = windowStartIso(window, Date.now());

    const [usage, actions, byTeam, users, friction] = await Promise.all([
      usageByEvent(from),
      auditByAction(from),
      usageByTeam(from),
      topUsers(from),
      frictionSignals(from),
    ]);

    return {
      window,
      from,
      generatedAt: new Date().toISOString(),
      usageByEvent: usage,
      auditByAction: actions,
      byTeam,
      topUsers: users,
      friction,
    };
  });

  /**
   * Owner-only monthly leadership review for one month. Month-windowed
   * commercial / delivery / pipeline aggregates (market share reads the frozen
   * snapshot for closed months), plus a live "right now" capacity block and a
   * current goal-change snapshot (that table has no timestamps to window by).
   */
  app.get<{ Querystring: { month?: string } }>("/monthly-review", { preHandler: [app.requireOwner] }, async (request) => {
    const now = resolveNow(request);
    const current = dubaiMonthRange(now);
    let range: { startIso: string; endIso: string; monthKey: string };
    try {
      range = request.query.month ? dubaiMonthRangeForKey(request.query.month) : current;
    } catch {
      throw badRequest("month must be YYYY-MM");
    }
    const { startIso, endIso, monthKey } = range;
    const isFrozen = monthKey !== current.monthKey && (await hasSnapshot(monthKey));

    const [marketShare, byType, byTeam, goals, pipeline, auditEvents, goalChange] = await Promise.all([
      shareForMonth(monthKey, current.monthKey),
      marketShareByType(startIso, endIso),
      marketShareByTeam(startIso, endIso),
      goalAttainmentForMonth(startIso, endIso),
      pipelineForMonth(startIso, endIso),
      auditEventsForMonth(startIso, endIso),
      goalChangeSnapshot(),
    ]);

    // Six-month market-share trend ending at the selected month (snapshot-aware).
    const trendKeys = [5, 4, 3, 2, 1, 0].map((n) => monthKeyMinus(monthKey, n));
    const trend = await Promise.all(
      trendKeys.map(async (k) => {
        const { callsSold, n } = await shareForMonth(k, current.monthKey);
        return { month: k, callsSold, n, share: n > 0 ? callsSold / n : null };
      })
    );

    // Live capacity of the deliverer pool in the owner's active instance.
    const hour = dubaiHour(now);
    const people = await listAvailableCandidatesWithAssignments(activeInstanceKey(request), { ghost: false });
    const loads = people.map((p) => ({ teamId: p.teamId as string | null, load: personLoad(p.assignments, hour) }));
    const medLoad = median(loads.map((l) => l.load));
    const teamAgg = new Map<string, { sum: number; count: number }>();
    for (const l of loads) {
      const key = l.teamId ?? "none";
      const cur = teamAgg.get(key) ?? { sum: 0, count: 0 };
      cur.sum += l.load;
      cur.count += 1;
      teamAgg.set(key, cur);
    }
    const capacityNow = {
      people: loads.length,
      medianLoad: Number(medLoad.toFixed(1)),
      overMedian: loads.filter((l) => l.load > medLoad).length,
      idle: loads.filter((l) => l.load === 0).length,
      byTeam: [...teamAgg.entries()]
        .map(([teamId, { sum, count }]) => ({ teamId: teamId === "none" ? null : teamId, avgLoad: Number((sum / count).toFixed(1)), count }))
        .sort((a, b) => b.avgLoad - a.avgLoad),
    };

    const share = marketShare.n > 0 ? marketShare.callsSold / marketShare.n : null;
    return {
      month: monthKey,
      isFrozen,
      generatedAt: new Date().toISOString(),
      marketShare: { ...marketShare, share },
      trend,
      byType: byType.map((t) => ({ ...t, share: t.n > 0 ? t.callsSold / t.n : null })),
      byTeam: byTeam.map((t) => ({ ...t, share: t.n > 0 ? t.callsSold / t.n : null })),
      goals,
      pipeline,
      auditEvents,
      goalChange,
      capacityNow,
    };
  });
};

export default analyticsRoutes;
