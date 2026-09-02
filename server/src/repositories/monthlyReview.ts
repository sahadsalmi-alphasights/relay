import { pool } from "../db";

/**
 * Read side of the owner-only monthly leadership review. Everything here is a
 * month-windowed aggregate over live tables (the caller passes the Dubai
 * month's [start, end) from dubaiMonthRangeForKey). Market-share blocks follow
 * the same semantics as marketShareForMonth — they COUNT soft-deleted cards
 * (a card that was created and sold against still happened). Delivery and
 * pipeline blocks exclude soft-deleted projects, since they reflect real work.
 */

export interface TypeShareRow { type: string; callsSold: number; n: number }
export interface TeamShareRow { team: string; callsSold: number; n: number }

/** Market share split by project type for the month (deleted cards included). */
export async function marketShareByType(startIso: string, endIso: string): Promise<TypeShareRow[]> {
  const { rows } = await pool.query<{ type: string; callsSold: number; n: number }>(
    `SELECT p.project_type AS type,
            COALESCE(SUM(ang.calls_sold),0)::int AS "callsSold",
            COALESCE(SUM(ang.calls_n),0)::int AS "n"
     FROM project p JOIN angle ang ON ang.project_id = p.id
     WHERE p.created_at >= $1 AND p.created_at < $2
     GROUP BY p.project_type
     ORDER BY p.project_type`,
    [startIso, endIso]
  );
  return rows.map((r) => ({ ...r, callsSold: Number(r.callsSold), n: Number(r.n) }));
}

/** Market share split by the PL's team for the month (deleted cards included). */
export async function marketShareByTeam(startIso: string, endIso: string): Promise<TeamShareRow[]> {
  const { rows } = await pool.query<{ team: string | null; callsSold: number; n: number }>(
    `SELECT t.name AS team,
            COALESCE(SUM(ang.calls_sold),0)::int AS "callsSold",
            COALESCE(SUM(ang.calls_n),0)::int AS "n"
     FROM project p
     JOIN angle ang ON ang.project_id = p.id
     JOIN person pl ON pl.id = p.pl_id
     LEFT JOIN team t ON t.id = pl.team_id
     WHERE p.created_at >= $1 AND p.created_at < $2
     GROUP BY t.name
     ORDER BY SUM(ang.calls_n) DESC NULLS LAST`,
    [startIso, endIso]
  );
  return rows.map((r) => ({ team: r.team ?? "Unassigned", callsSold: Number(r.callsSold), n: Number(r.n) }));
}

export interface GoalAttainment {
  deliveredTotal: number;
  goalTotal: number;
  projectsTotal: number;
  projectsHit: number;
}

/**
 * Goal attainment for projects CREATED in the month: profiles delivered
 * (delivered + custom, ghosts excluded) vs goal, and how many projects met or
 * beat their goal. Soft-deleted projects excluded.
 */
export async function goalAttainmentForMonth(startIso: string, endIso: string): Promise<GoalAttainment> {
  const { rows } = await pool.query<{ goal: number; delivered: number; hit: boolean }>(
    `SELECT per.goal, per.delivered, (per.goal > 0 AND per.delivered >= per.goal) AS hit
     FROM (
       SELECT p.id,
              COALESCE(SUM(a.goal),0)::int AS goal,
              COALESCE(SUM(a.delivered + a.custom_delivered),0)::int AS delivered
       FROM project p
       JOIN angle ang ON ang.project_id = p.id
       JOIN assignment a ON a.angle_id = ang.id AND a.is_ghost = false
       WHERE p.created_at >= $1 AND p.created_at < $2 AND p.deleted_at IS NULL
       GROUP BY p.id
     ) per`,
    [startIso, endIso]
  );
  let deliveredTotal = 0, goalTotal = 0, projectsHit = 0;
  for (const r of rows) {
    deliveredTotal += Number(r.delivered);
    goalTotal += Number(r.goal);
    if (r.hit) projectsHit++;
  }
  return { deliveredTotal, goalTotal, projectsTotal: rows.length, projectsHit };
}

export interface Pipeline {
  created: number;
  byType: { type: string; count: number }[];
  byStatus: { open: number; active: number; archived: number; deliveryClosed: number };
}

/** Projects created in the month, by type and by status. Soft-deleted excluded. */
export async function pipelineForMonth(startIso: string, endIso: string): Promise<Pipeline> {
  const { rows } = await pool.query<{ type: string; status: string; deliveryClosed: boolean; count: number }>(
    `SELECT project_type AS type, status,
            (delivery_closed_at IS NOT NULL) AS "deliveryClosed",
            count(*)::int AS count
     FROM project
     WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL
     GROUP BY project_type, status, (delivery_closed_at IS NOT NULL)`,
    [startIso, endIso]
  );
  const byTypeMap = new Map<string, number>();
  const byStatus = { open: 0, active: 0, archived: 0, deliveryClosed: 0 };
  let created = 0;
  for (const r of rows) {
    const c = Number(r.count);
    created += c;
    byTypeMap.set(r.type, (byTypeMap.get(r.type) ?? 0) + c);
    if (r.status === "archived") byStatus.archived += c;
    else if (r.status === "open") byStatus.open += c;
    else byStatus.active += c;
    if (r.deliveryClosed) byStatus.deliveryClosed += c;
  }
  return {
    created,
    byType: [...byTypeMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    byStatus,
  };
}

/** Count of audit events in the month. */
export async function auditEventsForMonth(startIso: string, endIso: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_log WHERE created_at >= $1 AND created_at < $2`,
    [startIso, endIso]
  );
  return Number(rows[0].count);
}

export interface GoalChangeSnapshot { open: number; resolved: number }

/**
 * Goal-change requests as a CURRENT snapshot (the table has no timestamps, so
 * it can't be month-windowed): how many are still open vs already resolved.
 */
export async function goalChangeSnapshot(): Promise<GoalChangeSnapshot> {
  const { rows } = await pool.query<{ resolved: boolean; count: number }>(
    `SELECT resolved, count(*)::int AS count FROM goal_change_request GROUP BY resolved`
  );
  const snap = { open: 0, resolved: 0 };
  for (const r of rows) {
    if (r.resolved) snap.resolved = Number(r.count);
    else snap.open = Number(r.count);
  }
  return snap;
}

/* ---- Enrich (all already-stored) ---- */

/** Market share by expert pool for the month (per-angle pool, falling back to project). */
export async function marketShareByPool(startIso: string, endIso: string): Promise<{ pool: string; callsSold: number; n: number }[]> {
  const { rows } = await pool.query<{ pool: string; callsSold: number; n: number }>(
    `SELECT COALESCE(ang.expert_pool, p.expert_pool) AS pool,
            COALESCE(SUM(ang.calls_sold),0)::int AS "callsSold",
            COALESCE(SUM(ang.calls_n),0)::int AS "n"
     FROM project p JOIN angle ang ON ang.project_id = p.id
     WHERE p.created_at >= $1 AND p.created_at < $2
     GROUP BY COALESCE(ang.expert_pool, p.expert_pool)
     ORDER BY SUM(ang.calls_n) DESC NULLS LAST`,
    [startIso, endIso]
  );
  return rows.map((r) => ({ pool: r.pool, callsSold: Number(r.callsSold), n: Number(r.n) }));
}

/** Top clients by demand for the month. */
export async function topClientsForMonth(startIso: string, endIso: string, limit = 6): Promise<{ client: string; callsSold: number; n: number }[]> {
  const { rows } = await pool.query<{ client: string; callsSold: number; n: number }>(
    `SELECT p.client,
            COALESCE(SUM(ang.calls_sold),0)::int AS "callsSold",
            COALESCE(SUM(ang.calls_n),0)::int AS "n"
     FROM project p JOIN angle ang ON ang.project_id = p.id
     WHERE p.created_at >= $1 AND p.created_at < $2
     GROUP BY p.client
     ORDER BY SUM(ang.calls_n) DESC NULLS LAST
     LIMIT $3`,
    [startIso, endIso, limit]
  );
  return rows.map((r) => ({ client: r.client, callsSold: Number(r.callsSold), n: Number(r.n) }));
}

/** Per-project %-to-goal, bucketed, for projects created in the month (ghosts excluded). */
export async function goalDistributionForMonth(startIso: string, endIso: string): Promise<{ bucket: string; count: number }[]> {
  const { rows } = await pool.query<{ goal: number; delivered: number }>(
    `SELECT COALESCE(SUM(a.goal),0)::int AS goal,
            COALESCE(SUM(a.delivered + a.custom_delivered),0)::int AS delivered
     FROM project p
     JOIN angle ang ON ang.project_id = p.id
     JOIN assignment a ON a.angle_id = ang.id AND a.is_ghost = false
     WHERE p.created_at >= $1 AND p.created_at < $2 AND p.deleted_at IS NULL
     GROUP BY p.id`,
    [startIso, endIso]
  );
  const buckets = { "0–49%": 0, "50–79%": 0, "80–99%": 0, "100%+": 0 };
  for (const r of rows) {
    if (r.goal <= 0) continue;
    const pct = r.delivered / r.goal;
    if (pct >= 1) buckets["100%+"]++;
    else if (pct >= 0.8) buckets["80–99%"]++;
    else if (pct >= 0.5) buckets["50–79%"]++;
    else buckets["0–49%"]++;
  }
  return Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));
}

/** Current mix of active (non-ghost) assignments by stage. Live, not month-scoped. */
export async function stageMixNow(): Promise<{ stage: string; count: number }[]> {
  const { rows } = await pool.query<{ stage: string; count: number }>(
    `SELECT a.stage, count(*)::int AS count
     FROM assignment a
     JOIN angle ang ON ang.id = a.angle_id AND ang.archived_at IS NULL
     JOIN project p ON p.id = ang.project_id
     WHERE a.is_ghost = false AND p.status <> 'archived' AND p.deleted_at IS NULL
     GROUP BY a.stage`,
    []
  );
  return rows.map((r) => ({ stage: r.stage, count: Number(r.count) }));
}

/** Projects that owe the client calls (delivered < sold). Live. */
export async function chaseClientsNow(limit = 8): Promise<{ projectId: string; client: string; sold: number; delivered: number }[]> {
  const { rows } = await pool.query<{ projectId: string; client: string; sold: number; delivered: number }>(
    `SELECT * FROM (
       SELECT p.id AS "projectId", p.client,
              (SELECT COALESCE(SUM(calls_sold),0) FROM angle WHERE project_id = p.id AND archived_at IS NULL)::int AS sold,
              (SELECT COALESCE(SUM(a.delivered + a.custom_delivered),0)
                 FROM assignment a JOIN angle ang2 ON ang2.id = a.angle_id
                 WHERE ang2.project_id = p.id AND ang2.archived_at IS NULL AND a.is_ghost = false)::int AS delivered
       FROM project p
       WHERE p.status <> 'archived' AND p.deleted_at IS NULL
     ) t
     WHERE t.sold > t.delivered
     ORDER BY (t.sold - t.delivered) DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ ...r, sold: Number(r.sold), delivered: Number(r.delivered) }));
}

/** Projects idle in Admin/Selling beyond `beforeIso` (every active assignment Selling). Live. */
export async function stuckInAdminNow(beforeIso: string, limit = 8): Promise<{ projectId: string; client: string; latestStageEnteredAt: string }[]> {
  const { rows } = await pool.query<{ projectId: string; client: string; latestStageEnteredAt: string }>(
    `SELECT p.id AS "projectId", p.client, MAX(a.stage_entered_at) AS "latestStageEnteredAt"
     FROM project p
     JOIN angle ang ON ang.project_id = p.id AND ang.archived_at IS NULL
     JOIN assignment a ON a.angle_id = ang.id
     WHERE p.status <> 'archived' AND p.deleted_at IS NULL AND p.delivery_closed_at IS NULL
     GROUP BY p.id, p.client
     HAVING bool_and(a.stage = 'Selling') AND MAX(a.stage_entered_at) < $1
     ORDER BY MAX(a.stage_entered_at) ASC
     LIMIT $2`,
    [beforeIso, limit]
  );
  return rows.map((r) => ({ ...r, latestStageEnteredAt: new Date(r.latestStageEnteredAt).toISOString() }));
}

/** New projects by expert pool for the month (soft-deleted excluded). */
export async function intakeByPool(startIso: string, endIso: string): Promise<{ pool: string; count: number }[]> {
  const { rows } = await pool.query<{ pool: string; count: number }>(
    `SELECT expert_pool AS pool, count(*)::int AS count
     FROM project
     WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL
     GROUP BY expert_pool ORDER BY count(*) DESC`,
    [startIso, endIso]
  );
  return rows.map((r) => ({ pool: r.pool, count: Number(r.count) }));
}

/** Goal-change acceptance (current; the table has no timestamps). */
export async function goalChangeOutcomes(): Promise<{ accepted: number; declined: number }> {
  const { rows } = await pool.query<{ outcome: string | null; count: number }>(
    `SELECT outcome, count(*)::int AS count FROM goal_change_request WHERE resolved = true GROUP BY outcome`
  );
  const out = { accepted: 0, declined: 0 };
  for (const r of rows) {
    if (r.outcome === "accepted") out.accepted = Number(r.count);
    else if (r.outcome === "declined") out.declined = Number(r.count);
  }
  return out;
}

/** Top audit actions in the month. */
export async function auditByActionForMonth(startIso: string, endIso: string, limit = 6): Promise<{ action: string; count: number }[]> {
  const { rows } = await pool.query<{ action: string; count: number }>(
    `SELECT action, count(*)::int AS count FROM audit_log
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY action ORDER BY count(*) DESC LIMIT $3`,
    [startIso, endIso, limit]
  );
  return rows.map((r) => ({ action: r.action, count: Number(r.count) }));
}

/** Count of angles on live projects whose calls-sold hasn't been updated recently. Live. */
export async function staleCallsSoldNow(beforeIso: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM angle ang JOIN project p ON p.id = ang.project_id
     WHERE p.status <> 'archived' AND p.deleted_at IS NULL AND ang.archived_at IS NULL
       AND ang.calls_sold_updated_at < $1`,
    [beforeIso]
  );
  return Number(rows[0].count);
}

/* ---- Available-now batch (no new capture) ---- */

/** Distinct clients this month and how many are new (never had a project before). */
export async function clientMixForMonth(startIso: string, endIso: string): Promise<{ total: number; newClients: number }> {
  const { rows } = await pool.query<{ total: number; newclients: number }>(
    `WITH cur AS (
       SELECT DISTINCT client FROM project
       WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL
     )
     SELECT (SELECT count(*) FROM cur)::int AS total,
            (SELECT count(*) FROM cur WHERE client NOT IN (SELECT client FROM project WHERE created_at < $1))::int AS newclients`,
    [startIso, endIso]
  );
  return { total: Number(rows[0].total), newClients: Number(rows[0].newclients) };
}

/** Average deal size (calls wanted per project) by type. */
export async function avgDealSizeByType(startIso: string, endIso: string): Promise<{ type: string; projects: number; n: number }[]> {
  const { rows } = await pool.query<{ type: string; projects: number; n: number }>(
    `SELECT p.project_type AS type, count(DISTINCT p.id)::int AS projects, COALESCE(SUM(ang.calls_n),0)::int AS n
     FROM project p JOIN angle ang ON ang.project_id = p.id
     WHERE p.created_at >= $1 AND p.created_at < $2 AND p.deleted_at IS NULL
     GROUP BY p.project_type ORDER BY p.project_type`,
    [startIso, endIso]
  );
  return rows.map((r) => ({ type: r.type, projects: Number(r.projects), n: Number(r.n) }));
}

/** PLs with the most unmet demand (calls wanted minus sold) this month. */
export async function unmetDemandByPL(startIso: string, endIso: string, limit = 6): Promise<{ pl: string; gap: number }[]> {
  const { rows } = await pool.query<{ pl: string; gap: number }>(
    `SELECT pl.name AS pl, SUM(ang.calls_n - ang.calls_sold)::int AS gap
     FROM project p JOIN angle ang ON ang.project_id = p.id JOIN person pl ON pl.id = p.pl_id
     WHERE p.created_at >= $1 AND p.created_at < $2
     GROUP BY pl.name HAVING SUM(ang.calls_n - ang.calls_sold) > 0
     ORDER BY SUM(ang.calls_n - ang.calls_sold) DESC LIMIT $3`,
    [startIso, endIso, limit]
  );
  return rows.map((r) => ({ pl: r.pl, gap: Number(r.gap) }));
}

/** Profiles delivered vs goal per team, for projects created in the month (ghosts excluded). */
export async function deliveredByTeam(startIso: string, endIso: string): Promise<{ team: string; delivered: number; goal: number }[]> {
  const { rows } = await pool.query<{ team: string | null; delivered: number; goal: number }>(
    `SELECT t.name AS team,
            COALESCE(SUM(a.delivered + a.custom_delivered),0)::int AS delivered,
            COALESCE(SUM(a.goal),0)::int AS goal
     FROM project p
     JOIN angle ang ON ang.project_id = p.id
     JOIN assignment a ON a.angle_id = ang.id AND a.is_ghost = false
     JOIN person pl ON pl.id = p.pl_id
     LEFT JOIN team t ON t.id = pl.team_id
     WHERE p.created_at >= $1 AND p.created_at < $2 AND p.deleted_at IS NULL
     GROUP BY t.name ORDER BY SUM(a.delivered + a.custom_delivered) DESC NULLS LAST`,
    [startIso, endIso]
  );
  return rows.map((r) => ({ team: r.team ?? "Unassigned", delivered: Number(r.delivered), goal: Number(r.goal) }));
}

/** System-sourced vs custom (outside-system) profiles delivered this month. */
export async function customVsSystem(startIso: string, endIso: string): Promise<{ system: number; custom: number }> {
  const { rows } = await pool.query<{ system: number; custom: number }>(
    `SELECT COALESCE(SUM(a.delivered),0)::int AS system, COALESCE(SUM(a.custom_delivered),0)::int AS custom
     FROM project p JOIN angle ang ON ang.project_id = p.id
     JOIN assignment a ON a.angle_id = ang.id AND a.is_ghost = false
     WHERE p.created_at >= $1 AND p.created_at < $2 AND p.deleted_at IS NULL`,
    [startIso, endIso]
  );
  return { system: Number(rows[0].system), custom: Number(rows[0].custom) };
}

/** First Deliverables sitting past the threshold with no recent progress. Live. */
export async function overdueFirstDeliverablesNow(beforeIso: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM assignment a
     JOIN angle ang ON ang.id = a.angle_id AND ang.archived_at IS NULL
     JOIN project p ON p.id = ang.project_id
     WHERE a.is_ghost = false AND a.stage = 'First Deliverable'
       AND p.status <> 'archived' AND p.deleted_at IS NULL
       AND GREATEST(a.stage_entered_at, a.progress_updated_at) < $1`,
    [beforeIso]
  );
  return Number(rows[0].count);
}

/** Current person status breakdown (non-ghost, active accounts). Live. */
export async function statusBreakdownNow(): Promise<{ status: string; count: number }[]> {
  const { rows } = await pool.query<{ status: string; count: number }>(
    `SELECT status, count(*)::int AS count FROM person
     WHERE is_ghost = false AND deactivated_at IS NULL GROUP BY status ORDER BY count(*) DESC`
  );
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
}

/** Roster snapshot. Live. `activeSinceIso` = the "recently logged in" cutoff. */
export async function rosterNow(activeSinceIso: string): Promise<{ active: number; deactivated: number; ghosts: number; loggedInRecently: number }> {
  const { rows } = await pool.query<{ active: number; deactivated: number; ghosts: number; recent: number }>(
    `SELECT count(*) FILTER (WHERE deactivated_at IS NULL AND is_ghost = false)::int AS active,
            count(*) FILTER (WHERE deactivated_at IS NOT NULL)::int AS deactivated,
            count(*) FILTER (WHERE is_ghost = true)::int AS ghosts,
            count(*) FILTER (WHERE deactivated_at IS NULL AND is_ghost = false AND last_login_at > $1)::int AS recent
     FROM person`,
    [activeSinceIso]
  );
  const r = rows[0];
  return { active: Number(r.active), deactivated: Number(r.deactivated), ghosts: Number(r.ghosts), loggedInRecently: Number(r.recent) };
}

/** Count of projects auto-archived-for-deliverers this month (audit action). */
export async function autoArchivedForMonth(startIso: string, endIso: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_log
     WHERE action = 'close_delivery_auto' AND created_at >= $1 AND created_at < $2`,
    [startIso, endIso]
  );
  return Number(rows[0].count);
}

/** Top PLs by projects created this month. */
export async function pipelineByPL(startIso: string, endIso: string, limit = 6): Promise<{ pl: string; count: number }[]> {
  const { rows } = await pool.query<{ pl: string; count: number }>(
    `SELECT pl.name AS pl, count(*)::int AS count
     FROM project p JOIN person pl ON pl.id = p.pl_id
     WHERE p.created_at >= $1 AND p.created_at < $2 AND p.deleted_at IS NULL
     GROUP BY pl.name ORDER BY count(*) DESC LIMIT $3`,
    [startIso, endIso, limit]
  );
  return rows.map((r) => ({ pl: r.pl, count: Number(r.count) }));
}

/** Data-hygiene counts (live): live angles with no demand set, and live projects with no goal. */
export async function hygieneNow(): Promise<{ anglesNoDemand: number; projectsNoGoal: number }> {
  const { rows } = await pool.query<{ anglesnodemand: number; projectsnogoal: number }>(
    `SELECT
       (SELECT count(*) FROM angle ang JOIN project p ON p.id = ang.project_id
          WHERE p.status <> 'archived' AND p.deleted_at IS NULL AND ang.archived_at IS NULL AND ang.calls_n = 0)::int AS anglesnodemand,
       (SELECT count(*) FROM (
          SELECT p.id FROM project p JOIN angle ang ON ang.project_id = p.id
          WHERE p.status <> 'archived' AND p.deleted_at IS NULL AND ang.archived_at IS NULL
          GROUP BY p.id HAVING COALESCE(SUM(ang.goal_total),0) = 0
        ) z)::int AS projectsnogoal`
  );
  return { anglesNoDemand: Number(rows[0].anglesnodemand), projectsNoGoal: Number(rows[0].projectsnogoal) };
}

/* ---- Stage-transition history (new capture) ---- */

/** First-Deliverable completion timing for stage exits recorded this month. */
export async function firstDeliverableTimingForMonth(startIso: string, endIso: string): Promise<{ completed: number; avgHours: number | null; overdue: number }> {
  const { rows } = await pool.query<{ completed: number; avgsec: number | null; overdue: number }>(
    `SELECT count(*)::int AS completed,
            AVG(from_dwell_seconds)::float AS avgsec,
            count(*) FILTER (WHERE from_dwell_seconds > 4 * 3600)::int AS overdue
     FROM stage_transition
     WHERE from_stage = 'First Deliverable' AND at >= $1 AND at < $2`,
    [startIso, endIso]
  );
  const r = rows[0];
  return {
    completed: Number(r.completed),
    avgHours: r.avgsec == null ? null : Number((Number(r.avgsec) / 3600).toFixed(1)),
    overdue: Number(r.overdue),
  };
}

/**
 * Rework this month: stage changes that moved BACKWARD in the delivery order
 * (First Deliverable → Second → Hail Mary → Selling). Ranks are inlined so the
 * count is a single grouped query.
 */
export async function reworkForMonth(startIso: string, endIso: string): Promise<number> {
  const rank = `CASE stage WHEN 'First Deliverable' THEN 0 WHEN 'Second Deliverable' THEN 1 WHEN 'Hail Mary' THEN 2 WHEN 'Selling' THEN 3 ELSE 9 END`;
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM stage_transition
     WHERE at >= $1 AND at < $2
       AND (${rank.replace(/stage/g, "to_stage")}) < (${rank.replace(/stage/g, "from_stage")})`,
    [startIso, endIso]
  );
  return Number(rows[0].count);
}

/* ---- Visual forms + remaining metrics ---- */

/** Market share for the month as a team × project-type grid (for a heatmap). */
export async function marketShareByTeamAndType(startIso: string, endIso: string): Promise<{ team: string; type: string; callsSold: number; n: number }[]> {
  const { rows } = await pool.query<{ team: string | null; type: string; callsSold: number; n: number }>(
    `SELECT t.name AS team, p.project_type AS type,
            COALESCE(SUM(ang.calls_sold),0)::int AS "callsSold",
            COALESCE(SUM(ang.calls_n),0)::int AS "n"
     FROM project p JOIN angle ang ON ang.project_id = p.id
     JOIN person pl ON pl.id = p.pl_id LEFT JOIN team t ON t.id = pl.team_id
     WHERE p.created_at >= $1 AND p.created_at < $2
     GROUP BY t.name, p.project_type`,
    [startIso, endIso]
  );
  return rows.map((r) => ({ team: r.team ?? "Unassigned", type: r.type, callsSold: Number(r.callsSold), n: Number(r.n) }));
}

/** Top deliverers by profiles delivered this month (ghosts excluded). */
export async function topDeliverers(startIso: string, endIso: string, limit = 8): Promise<{ name: string; delivered: number }[]> {
  const { rows } = await pool.query<{ name: string; delivered: number }>(
    `SELECT d.name, COALESCE(SUM(a.delivered + a.custom_delivered),0)::int AS delivered
     FROM project p JOIN angle ang ON ang.project_id = p.id
     JOIN assignment a ON a.angle_id = ang.id AND a.is_ghost = false
     JOIN person d ON d.id = a.deliverer_id
     WHERE p.created_at >= $1 AND p.created_at < $2 AND p.deleted_at IS NULL
     GROUP BY d.name HAVING SUM(a.delivered + a.custom_delivered) > 0
     ORDER BY SUM(a.delivered + a.custom_delivered) DESC LIMIT $3`,
    [startIso, endIso, limit]
  );
  return rows.map((r) => ({ name: r.name, delivered: Number(r.delivered) }));
}

/**
 * Ghost competition: of angles created this month that had a ghost deliverer,
 * how many did our team out-deliver the ghost on (a "win").
 */
export async function ghostWinRate(startIso: string, endIso: string): Promise<{ contested: number; won: number }> {
  const { rows } = await pool.query<{ contested: number; won: number }>(
    `WITH ang_stats AS (
       SELECT ang.id,
              bool_or(a.is_ghost) AS has_ghost,
              COALESCE(SUM((a.delivered + a.custom_delivered)) FILTER (WHERE NOT a.is_ghost), 0) AS ours,
              COALESCE(SUM((a.delivered + a.custom_delivered)) FILTER (WHERE a.is_ghost), 0) AS ghost
       FROM angle ang JOIN assignment a ON a.angle_id = ang.id JOIN project p ON p.id = ang.project_id
       WHERE p.created_at >= $1 AND p.created_at < $2 AND p.deleted_at IS NULL
       GROUP BY ang.id
     )
     SELECT count(*) FILTER (WHERE has_ghost)::int AS contested,
            count(*) FILTER (WHERE has_ghost AND ours > ghost)::int AS won
     FROM ang_stats`,
    [startIso, endIso]
  );
  return { contested: Number(rows[0].contested), won: Number(rows[0].won) };
}

/** Market share for the month by business unit (resolved to the instance name). */
export async function marketShareByBU(startIso: string, endIso: string): Promise<{ bu: string; callsSold: number; n: number }[]> {
  const { rows } = await pool.query<{ bu: string | null; callsSold: number; n: number }>(
    `SELECT COALESCE(i.name, p.business_unit) AS bu,
            COALESCE(SUM(ang.calls_sold),0)::int AS "callsSold",
            COALESCE(SUM(ang.calls_n),0)::int AS "n"
     FROM project p JOIN angle ang ON ang.project_id = p.id
     LEFT JOIN instance i ON i.key = p.business_unit
     WHERE p.created_at >= $1 AND p.created_at < $2
     GROUP BY COALESCE(i.name, p.business_unit)
     ORDER BY SUM(ang.calls_n) DESC NULLS LAST`,
    [startIso, endIso]
  );
  return rows.map((r) => ({ bu: r.bu ?? "Unassigned", callsSold: Number(r.callsSold), n: Number(r.n) }));
}
