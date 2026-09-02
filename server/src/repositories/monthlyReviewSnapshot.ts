import { pool } from "../db";

/**
 * Persistence for the frozen month-historical review payload (one JSON blob per
 * closed month). The payload shape is whatever computeHistoricalReview returns;
 * it's stored and read back opaquely here.
 */

export async function getMonthlyReviewSnapshot(monthKey: string): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM monthly_review_snapshot WHERE month_key = $1`,
    [monthKey]
  );
  return rows[0]?.payload ?? null;
}

export async function hasMonthlyReviewSnapshot(monthKey: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM monthly_review_snapshot WHERE month_key = $1) AS exists`,
    [monthKey]
  );
  return rows[0].exists;
}

/** Freeze a month's historical payload. Idempotent: never overwrites an existing month. */
export async function saveMonthlyReviewSnapshot(monthKey: string, payload: unknown): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO monthly_review_snapshot (month_key, payload) VALUES ($1, $2)
     ON CONFLICT (month_key) DO NOTHING`,
    [monthKey, JSON.stringify(payload)]
  );
  return (res.rowCount ?? 0) > 0;
}
