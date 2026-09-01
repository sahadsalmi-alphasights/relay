import { hasSnapshot, listClosedProjectMonths, snapshotMonth } from "../repositories/marketShareSnapshot";
import { dubaiMonthRange, dubaiMonthRangeForKey } from "../rules/time";

/**
 * Freeze every closed Dubai-calendar month that has project cards and isn't
 * already snapshotted. Handles BOTH one-time backfill (all past months on
 * first run) and month-end (the just-ended month, the first run after the 1st):
 * "closed" is simply "before the current month", so nothing special happens on
 * the boundary — the newly-closed month appears in the list and gets frozen.
 *
 * The current month is deliberately never snapshotted: it's still live and must
 * keep computing off the mutable angle rows. Idempotent via hasSnapshot + the
 * ON CONFLICT in snapshotMonth. Returns the number of months newly frozen.
 */
export async function snapshotClosedMonths(now: Date): Promise<number> {
  const { monthKey: currentMonthKey } = dubaiMonthRange(now);
  const months = await listClosedProjectMonths(currentMonthKey);
  let frozen = 0;
  for (const monthKey of months) {
    if (await hasSnapshot(monthKey)) continue;
    const { startIso, endIso } = dubaiMonthRangeForKey(monthKey);
    await snapshotMonth(monthKey, startIso, endIso);
    frozen++;
  }
  return frozen;
}

/** `.unref()`'d so it never keeps the process (or a test) alive on its own. */
export function startMarketShareSnapshotScheduler(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    snapshotClosedMonths(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("market-share snapshot scheduler tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
