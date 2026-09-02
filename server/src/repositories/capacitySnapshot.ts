import { pool } from "../db";

export interface CapacitySnapshotRow {
  instanceKey: string;
  takenOn: string; // yyyy-mm-dd
  people: number;
  medianLoad: number;
  avgLoad: number;
  overMedian: number;
  idle: number;
}

/** All instance keys, for the daily capacity sweep. */
export async function listInstanceKeys(): Promise<string[]> {
  const { rows } = await pool.query<{ key: string }>(`SELECT key FROM instance`);
  return rows.map((r) => r.key);
}

/** Upsert one day's capacity snapshot for an instance (latest run of the day wins). */
export async function upsertCapacitySnapshot(r: CapacitySnapshotRow): Promise<void> {
  await pool.query(
    `INSERT INTO capacity_snapshot (taken_on, instance_key, people, median_load, avg_load, over_median, idle)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (taken_on, instance_key) DO UPDATE
       SET people = EXCLUDED.people, median_load = EXCLUDED.median_load, avg_load = EXCLUDED.avg_load,
           over_median = EXCLUDED.over_median, idle = EXCLUDED.idle, created_at = now()`,
    [r.takenOn, r.instanceKey, r.people, r.medianLoad, r.avgLoad, r.overMedian, r.idle]
  );
}

/** Daily median/average load for one instance since a given date (inclusive), oldest first. */
export async function capacityTrend(instanceKey: string, sinceDateKey: string): Promise<{ date: string; medianLoad: number; avgLoad: number; people: number }[]> {
  const { rows } = await pool.query<{ date: string; medianLoad: string; avgLoad: string; people: number }>(
    `SELECT to_char(taken_on, 'YYYY-MM-DD') AS date, median_load AS "medianLoad", avg_load AS "avgLoad", people
     FROM capacity_snapshot
     WHERE instance_key = $1 AND taken_on >= $2
     ORDER BY taken_on ASC`,
    [instanceKey, sinceDateKey]
  );
  return rows.map((r) => ({ date: r.date, medianLoad: Number(r.medianLoad), avgLoad: Number(r.avgLoad), people: Number(r.people) }));
}

/** Average of the daily median load over a month, for one instance (null if no snapshots that month). */
export interface CapacityMonthly { medianLoad: number | null; people: number | null; overMedian: number | null; idle: number | null }

/** Monthly averages of the daily capacity shape for one instance (nulls if no snapshots that month). */
export async function capacityMonthly(instanceKey: string, startIso: string, endIso: string): Promise<CapacityMonthly> {
  const { rows } = await pool.query<{ med: string | null; ppl: string | null; over: string | null; idle: string | null }>(
    `SELECT AVG(median_load)::float AS med, AVG(people)::float AS ppl, AVG(over_median)::float AS over, AVG(idle)::float AS idle
     FROM capacity_snapshot
     WHERE instance_key = $1 AND taken_on >= $2::date AND taken_on < $3::date`,
    [instanceKey, startIso, endIso]
  );
  const r = rows[0];
  const round1 = (v: string | null) => (v == null ? null : Number(Number(v).toFixed(1)));
  return { medianLoad: round1(r.med), people: round1(r.ppl), overMedian: round1(r.over), idle: round1(r.idle) };
}
