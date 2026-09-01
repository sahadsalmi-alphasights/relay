import { pool } from "../db";
import type { MarketShareBreakdownRow } from "./projects";

/** Snapshot scope filter — mine (a PL) or team (frozen team membership). */
export interface SnapshotFilter {
  plId?: string;
  teamId?: string;
}

function scopeClause(filter: SnapshotFilter, params: unknown[]): string {
  if (filter.plId) {
    params.push(filter.plId);
    return ` AND pl_id = $${params.length}`;
  }
  if (filter.teamId) {
    params.push(filter.teamId);
    return ` AND team_id = $${params.length}`;
  }
  return "";
}

/** True once a month has been frozen — used to route reads to the snapshot. */
export async function hasSnapshot(monthKey: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM market_share_snapshot WHERE month_key = $1) AS exists`,
    [monthKey]
  );
  return rows[0].exists;
}

/**
 * The distinct Dubai-calendar months (YYYY-MM) that have project cards and are
 * strictly before `currentMonthKey` — i.e. every closed month the backfill
 * should freeze. The +4h shift matches dubaiMonthRange's bucketing.
 */
export async function listClosedProjectMonths(currentMonthKey: string): Promise<string[]> {
  const { rows } = await pool.query<{ monthKey: string }>(
    `SELECT DISTINCT to_char((created_at AT TIME ZONE 'UTC') + interval '4 hours', 'YYYY-MM') AS "monthKey"
     FROM project
     WHERE to_char((created_at AT TIME ZONE 'UTC') + interval '4 hours', 'YYYY-MM') < $1
     ORDER BY "monthKey"`,
    [currentMonthKey]
  );
  return rows.map((r) => r.monthKey);
}

/**
 * Freeze one month's per-angle market-share rows. Idempotent: ON CONFLICT DO
 * NOTHING means a re-run (or a month already snapshotted) inserts nothing, so
 * the frozen numbers are never overwritten by later live drift. Same window
 * and soft-delete semantics as marketShareForMonth (deleted cards still count,
 * flagged). Returns rows inserted.
 */
export async function snapshotMonth(monthKey: string, startIso: string, endIso: string): Promise<number> {
  const res = await pool.query(
    `INSERT INTO market_share_snapshot
       (month_key, project_id, angle_id, pl_id, pl_name, team_id, team_name,
        client, angle_name, calls_sold, calls_n, deleted, project_created_at)
     SELECT $1, p.id, ang.id, pl.id, pl.name, t.id, t.name,
            p.client, ang.name, ang.calls_sold, ang.calls_n,
            (p.deleted_at IS NOT NULL), p.created_at
     FROM project p
     JOIN angle ang ON ang.project_id = p.id
     JOIN person pl ON pl.id = p.pl_id
     LEFT JOIN team t ON t.id = pl.team_id
     WHERE p.created_at >= $2 AND p.created_at < $3
     ON CONFLICT (month_key, angle_id) DO NOTHING`,
    [monthKey, startIso, endIso]
  );
  return res.rowCount ?? 0;
}

/** Aggregate market share for a frozen month, honoring the scope filter. */
export async function snapshotMarketShare(filter: SnapshotFilter, monthKey: string): Promise<{ callsSold: number; n: number }> {
  const params: unknown[] = [monthKey];
  const { rows } = await pool.query<{ callsSold: string; n: string }>(
    `SELECT COALESCE(SUM(calls_sold), 0)::int AS "callsSold",
            COALESCE(SUM(calls_n), 0)::int AS "n"
     FROM market_share_snapshot
     WHERE month_key = $1${scopeClause(filter, params)}`,
    params
  );
  return { callsSold: Number(rows[0].callsSold), n: Number(rows[0].n) };
}

/** Per-angle detail for a frozen month, shaped exactly like the live breakdown. */
export async function snapshotBreakdown(filter: SnapshotFilter, monthKey: string): Promise<MarketShareBreakdownRow[]> {
  const params: unknown[] = [monthKey];
  const { rows } = await pool.query<{
    projectId: string;
    client: string;
    angleName: string;
    plName: string;
    teamName: string | null;
    callsSold: number;
    callsN: number;
    createdAt: string;
    deleted: boolean;
  }>(
    `SELECT project_id AS "projectId", client, angle_name AS "angleName",
            pl_name AS "plName", team_name AS "teamName",
            calls_sold AS "callsSold", calls_n AS "callsN",
            project_created_at AS "createdAt", deleted
     FROM market_share_snapshot
     WHERE month_key = $1${scopeClause(filter, params)}
     ORDER BY team_name NULLS LAST, pl_name, client, angle_name`,
    params
  );
  return rows.map((r) => ({
    ...r,
    callsSold: Number(r.callsSold),
    callsN: Number(r.callsN),
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}
