import { listClosedProjectMonths } from "../repositories/marketShareSnapshot";
import { hasMonthlyReviewSnapshot, saveMonthlyReviewSnapshot } from "../repositories/monthlyReviewSnapshot";
import { computeHistoricalReview } from "../routes/analytics";
import { dubaiMonthRange, dubaiMonthRangeForKey } from "../rules/time";

/**
 * Freeze the full month-historical review for every closed month that has
 * project cards and isn't already frozen (handles backfill and month-end
 * together, exactly like the market-share snapshot). The current month is
 * never frozen. Idempotent via hasMonthlyReviewSnapshot + the ON CONFLICT in
 * saveMonthlyReviewSnapshot. Returns the number of months newly frozen.
 */
export async function snapshotClosedReviewMonths(now: Date): Promise<number> {
  const { monthKey: currentKey } = dubaiMonthRange(now);
  const months = await listClosedProjectMonths(currentKey);
  let frozen = 0;
  for (const monthKey of months) {
    if (await hasMonthlyReviewSnapshot(monthKey)) continue;
    const { startIso, endIso } = dubaiMonthRangeForKey(monthKey);
    const payload = await computeHistoricalReview(startIso, endIso, monthKey, currentKey);
    if (await saveMonthlyReviewSnapshot(monthKey, payload)) frozen++;
  }
  return frozen;
}

/** `.unref()`'d so it never keeps the process (or a test) alive on its own. */
export function startMonthlyReviewSnapshotScheduler(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    snapshotClosedReviewMonths(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("monthly-review snapshot scheduler tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
