import type { FastifyPluginAsync } from "fastify";
import { badRequest } from "../errors";
import { auditByAction, frictionSignals, topUsers, usageByEvent, usageByTeam } from "../repositories/analytics";
import { marketShareForMonth } from "../repositories/projects";
import { hasSnapshot, snapshotMarketShare } from "../repositories/marketShareSnapshot";
import { getMonthlyReviewSnapshot } from "../repositories/monthlyReviewSnapshot";
import {
  auditByActionForMonth,
  auditEventsForMonth,
  autoArchivedForMonth,
  avgDealSizeByType,
  chaseClientsNow,
  clientMixForMonth,
  customVsSystem,
  deliveredByTeam,
  goalAttainmentForMonth,
  goalChangeOutcomes,
  goalChangeSnapshot,
  goalDistributionForMonth,
  hygieneNow,
  intakeByPool,
  marketShareByPool,
  marketShareByTeam,
  marketShareByType,
  overdueFirstDeliverablesNow,
  pipelineByPL,
  pipelineForMonth,
  rosterNow,
  stageMixNow,
  staleCallsSoldNow,
  statusBreakdownNow,
  stuckInAdminNow,
  topClientsForMonth,
  unmetDemandByPL,
} from "../repositories/monthlyReview";
import { ADMIN_AUTO_ARCHIVE_DAYS } from "../rules/config";
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

const withShare = <T extends { callsSold: number; n: number }>(rows: T[]) =>
  rows.map((t) => ({ ...t, share: t.n > 0 ? t.callsSold / t.n : null }));

/**
 * The month-HISTORICAL blocks of the review (everything that describes the
 * month itself, not the present). Pure over the given window, so both the live
 * route and the month-end snapshot scheduler compute it the same way. The
 * review's "now" blocks (capacity, stage mix, chase/stuck, roster, hygiene)
 * are computed separately and never frozen.
 */
export async function computeHistoricalReview(startIso: string, endIso: string, monthKey: string, currentMonthKey: string) {
  const [marketShare, byType, byTeam, byPool, topClients, clientMix, avgDeal, unmetPL, goals, goalDistribution, deliveredTeam, customSystem, pipeline, intakePool, byPL, autoArchived, auditEvents, auditByAction] =
    await Promise.all([
      shareForMonth(monthKey, currentMonthKey),
      marketShareByType(startIso, endIso),
      marketShareByTeam(startIso, endIso),
      marketShareByPool(startIso, endIso),
      topClientsForMonth(startIso, endIso),
      clientMixForMonth(startIso, endIso),
      avgDealSizeByType(startIso, endIso),
      unmetDemandByPL(startIso, endIso),
      goalAttainmentForMonth(startIso, endIso),
      goalDistributionForMonth(startIso, endIso),
      deliveredByTeam(startIso, endIso),
      customVsSystem(startIso, endIso),
      pipelineForMonth(startIso, endIso),
      intakeByPool(startIso, endIso),
      pipelineByPL(startIso, endIso),
      autoArchivedForMonth(startIso, endIso),
      auditEventsForMonth(startIso, endIso),
      auditByActionForMonth(startIso, endIso),
    ]);
  const trendKeys = [5, 4, 3, 2, 1, 0].map((n) => monthKeyMinus(monthKey, n));
  const trend = await Promise.all(
    trendKeys.map(async (k) => {
      const { callsSold, n } = await shareForMonth(k, currentMonthKey);
      return { month: k, callsSold, n, share: n > 0 ? callsSold / n : null };
    })
  );
  return {
    marketShare: { ...marketShare, share: marketShare.n > 0 ? marketShare.callsSold / marketShare.n : null },
    trend,
    byType: withShare(byType),
    byTeam: withShare(byTeam),
    byPool: withShare(byPool),
    topClients: withShare(topClients),
    clientMix,
    avgDealByType: avgDeal,
    unmetDemandByPL: unmetPL,
    goals,
    goalDistribution,
    deliveredByTeam: deliveredTeam,
    customVsSystem: customSystem,
    pipeline,
    intakeByPool: intakePool,
    pipelineByPL: byPL,
    autoArchived,
    auditEvents,
    auditByAction,
  };
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
    const isClosed = monthKey !== current.monthKey;

    // Historical blocks: read the frozen review snapshot for a closed month
    // that's been snapshotted, otherwise compute live off the current tables.
    const frozen = isClosed ? await getMonthlyReviewSnapshot(monthKey) : null;
    const isFrozen = frozen !== null;
    const historical = frozen ?? (await computeHistoricalReview(startIso, endIso, monthKey, current.monthKey));

    const dayMs = 24 * 60 * 60 * 1000;
    const stuckBeforeIso = new Date(now.getTime() - ADMIN_AUTO_ARCHIVE_DAYS * dayMs).toISOString();
    const staleBeforeIso = new Date(now.getTime() - 2 * dayMs).toISOString();
    const overdueBeforeIso = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const loginSinceIso = new Date(now.getTime() - 30 * dayMs).toISOString();

    // "Now" blocks — always live; they describe the present, not the month.
    const [goalChange, stageMix, chase, stuck, goalChangeOut, staleCallsSold, overdueFd, statusMix, roster, hygiene] =
      await Promise.all([
        goalChangeSnapshot(),
        stageMixNow(),
        chaseClientsNow(),
        stuckInAdminNow(stuckBeforeIso),
        goalChangeOutcomes(),
        staleCallsSoldNow(staleBeforeIso),
        overdueFirstDeliverablesNow(overdueBeforeIso),
        statusBreakdownNow(),
        rosterNow(loginSinceIso),
        hygieneNow(),
      ]);

    // Live capacity of the deliverer pool in the owner's active instance.
    const hour = dubaiHour(now);
    const people = await listAvailableCandidatesWithAssignments(activeInstanceKey(request), { ghost: false });
    const loads = people.map((p) => ({
      teamId: (p.teamId as string | null) ?? null,
      practice: (p.practiceArea as string | null) ?? null,
      load: personLoad(p.assignments, hour),
    }));
    const medLoad = median(loads.map((l) => l.load));
    const aggBy = (pick: (l: (typeof loads)[number]) => string | null) => {
      const m = new Map<string, { sum: number; count: number }>();
      for (const l of loads) {
        const k = pick(l) ?? "none";
        const cur = m.get(k) ?? { sum: 0, count: 0 };
        cur.sum += l.load;
        cur.count += 1;
        m.set(k, cur);
      }
      return m;
    };
    const teamAgg = aggBy((l) => l.teamId);
    const practiceAgg = aggBy((l) => l.practice);
    const capacityNow = {
      people: loads.length,
      medianLoad: Number(medLoad.toFixed(1)),
      overMedian: loads.filter((l) => l.load > medLoad).length,
      idle: loads.filter((l) => l.load === 0).length,
      byTeam: [...teamAgg.entries()]
        .map(([teamId, { sum, count }]) => ({ teamId: teamId === "none" ? null : teamId, avgLoad: Number((sum / count).toFixed(1)), count }))
        .sort((a, b) => b.avgLoad - a.avgLoad),
      byPractice: [...practiceAgg.entries()]
        .map(([practice, { sum, count }]) => ({ practice: practice === "none" ? "Unassigned" : practice, avgLoad: Number((sum / count).toFixed(1)), count }))
        .sort((a, b) => b.avgLoad - a.avgLoad),
    };

    return {
      month: monthKey,
      isFrozen,
      generatedAt: new Date().toISOString(),
      ...historical,
      overdueFirstDeliverables: overdueFd,
      stageMix,
      chase,
      stuck: stuck.map((s) => ({ ...s, daysIdle: Math.floor((now.getTime() - new Date(s.latestStageEnteredAt).getTime()) / dayMs) })),
      statusBreakdown: statusMix,
      roster,
      goalChange,
      goalChangeOutcomes: goalChangeOut,
      staleCallsSold,
      hygiene,
      capacityNow,
    };
  });
};

export default analyticsRoutes;
