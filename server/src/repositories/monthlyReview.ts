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
