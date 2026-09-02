import type { FastifyPluginAsync } from "fastify";
import { badRequest } from "../errors";
import { auditByAction, frictionSignals, topUsers, usageByEvent, usageByTeam } from "../repositories/analytics";
import { marketShareForMonth } from "../repositories/projects";
import { hasSnapshot, snapshotMarketShare } from "../repositories/marketShareSnapshot";
import { getMonthlyReviewSnapshot } from "../repositories/monthlyReviewSnapshot";
import { capacityMonthly, capacityTrend } from "../repositories/capacitySnapshot";
import {
  auditByActionForMonth,
  auditEventsForMonth,
  autoArchivedForMonth,
  avgDealSizeByType,
  callsSoldVelocity,
  chaseClientsNow,
  clientMixForMonth,
  customVsSystem,
  deliveredByTeam,
  firstDeliverableTimingForMonth,
  ghostWinRate,
  goalAttainmentForMonth,
  goalChangeOutcomes,
  goalChangeSnapshot,
  goalDistributionForMonth,
  hygieneNow,
  intakeByPool,
  marketShareByBU,
  marketShareByPool,
  marketShareByTeam,
  marketShareByTeamAndType,
  marketShareByType,
  overdueFirstDeliverablesNow,
  pipelineByPL,
  pipelineForMonth,
  reworkForMonth,
  rosterNow,
  topDeliverers,
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
import { dubaiDateKey, dubaiHour, dubaiMonthRange, dubaiMonthRangeForKey } from "../rules/time";
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
  const [marketShare, byType, byTeam, byPool, topClients, clientMix, avgDeal, unmetPL, goals, goalDistribution, deliveredTeam, customSystem, pipeline, intakePool, byPL, autoArchived, auditEvents, auditByAction, fdTiming, rework] =
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
      firstDeliverableTimingForMonth(startIso, endIso),
      reworkForMonth(startIso, endIso),
    ]);
  const [heatmap, deliverers, ghost, byBU, velocity] = await Promise.all([
    marketShareByTeamAndType(startIso, endIso),
    topDeliverers(startIso, endIso),
    ghostWinRate(startIso, endIso),
    marketShareByBU(startIso, endIso),
    callsSoldVelocity(startIso, endIso),
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
    firstDeliverableTiming: fdTiming,
    rework,
    heatmap: withShare(heatmap),
    topDeliverers: deliverers,
    ghost,
    byBU: withShare(byBU),
    velocity,
  };
}

/**
 * Six months of the headline scalars ending at `endMonthKey`, for MoM deltas
 * and sparklines. Reads the frozen review snapshot for a closed month (so past
 * points are stable); falls back to a live recompute where a month isn't
 * snapshotted yet. Capacity median comes from the daily capacity snapshots for
 * the given instance, so it's null until that history builds up.
 */
async function computeHistory(currentMonthKey: string, endMonthKey: string, instanceKey: string) {
  const keys = [5, 4, 3, 2, 1, 0].map((n) => monthKeyMinus(endMonthKey, n));
  return Promise.all(
    keys.map(async (k) => {
      const { startIso, endIso } = dubaiMonthRangeForKey(k);
      const [snap, cap] = await Promise.all([getMonthlyReviewSnapshot(k), capacityMonthly(instanceKey, startIso, endIso)]);

      // Prefer the frozen snapshot payload (stable + cheap) for a closed month;
      // otherwise recompute just the scalars this history needs.
      let callsSold: number, demand: number, goals: { deliveredTotal: number; goalTotal: number; projectsTotal: number; projectsHit: number };
      let created: number, archived: number, deliveryClosed: number, active: number, autoArchived: number;
      let fdAvgHours: number | null, rework: number;
      if (snap) {
        const ms = snap.marketShare as { callsSold: number; n: number };
        const p = snap.pipeline as { created: number; byStatus: { archived: number; deliveryClosed: number; active: number } };
        callsSold = ms.callsSold; demand = ms.n;
        goals = snap.goals as typeof goals;
        created = p.created; archived = p.byStatus.archived; deliveryClosed = p.byStatus.deliveryClosed; active = p.byStatus.active;
        autoArchived = (snap.autoArchived as number) ?? 0;
        fdAvgHours = (snap.firstDeliverableTiming as { avgHours: number | null } | undefined)?.avgHours ?? null;
        rework = (snap.rework as number) ?? 0;
      } else {
        const [ms, g, p, auto, fd, rw] = await Promise.all([
          shareForMonth(k, currentMonthKey),
          goalAttainmentForMonth(startIso, endIso),
          pipelineForMonth(startIso, endIso),
          autoArchivedForMonth(startIso, endIso),
          firstDeliverableTimingForMonth(startIso, endIso),
          reworkForMonth(startIso, endIso),
        ]);
        callsSold = ms.callsSold; demand = ms.n; goals = g;
        created = p.created; archived = p.byStatus.archived; deliveryClosed = p.byStatus.deliveryClosed; active = p.byStatus.active;
        autoArchived = auto; fdAvgHours = fd.avgHours; rework = rw;
      }
      return {
        month: k,
        share: demand > 0 ? callsSold / demand : null,
        callsSold,
        demand,
        hitGoalPct: goals.projectsTotal > 0 ? goals.projectsHit / goals.projectsTotal : null,
        delivered: goals.deliveredTotal,
        goalPct: goals.goalTotal > 0 ? goals.deliveredTotal / goals.goalTotal : null,
        fdAvgHours,
        rework,
        created,
        archived,
        deliveryClosed,
        active,
        autoArchived,
        medianLoad: cap.medianLoad,
        people: cap.people,
        overMedian: cap.overMedian,
        idle: cap.idle,
      };
    })
  );
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
    // Utilisation over the last 14 days, from the daily capacity snapshots.
    const instanceKey = activeInstanceKey(request);
    const utilisationTrend = await capacityTrend(instanceKey, dubaiDateKey(new Date(now.getTime() - 14 * dayMs)));
    const history = await computeHistory(current.monthKey, monthKey, instanceKey);
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
      trend: utilisationTrend,
    };

    return {
      month: monthKey,
      isFrozen,
      generatedAt: new Date().toISOString(),
      history,
      ...historical,
      // Defaults so responses stay complete even for months frozen before the
      // stage-history capture existed (their payload has no timing/rework).
      firstDeliverableTiming: (historical as Record<string, unknown>).firstDeliverableTiming ?? { completed: 0, avgHours: null, overdue: 0 },
      rework: (historical as Record<string, unknown>).rework ?? 0,
      heatmap: (historical as Record<string, unknown>).heatmap ?? [],
      topDeliverers: (historical as Record<string, unknown>).topDeliverers ?? [],
      ghost: (historical as Record<string, unknown>).ghost ?? { contested: 0, won: 0 },
      byBU: (historical as Record<string, unknown>).byBU ?? [],
      velocity: (historical as Record<string, unknown>).velocity ?? { total: 0, byWeek: [] },
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
