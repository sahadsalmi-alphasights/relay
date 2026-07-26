import { resetAllEveningCoverage, resetAllOutToLunch } from "../repositories/people";
import { dubaiDateKey, dubaiHour } from "../rules/time";
import { publish } from "../ws/hub";

/**
 * Two automatic daily resets (2026-07-24), driven by the clock, not by any
 * user action — so they need a scheduler, same shape as staleScheduler:
 *
 *  - Out to Lunch clears at 16:00 Dubai. Lunch is a short midday thing; by
 *    4pm everyone's back, so the toggle returns to "Free" for the afternoon.
 *  - Evening coverage returns to its default (off) each morning — nobody
 *    carries last night's opt-in into a new day; they're re-asked at 18:00.
 *
 * Each reset fires at most once per Dubai calendar day. The last-run date is
 * held in memory (a missed day after a restart just resets whenever the next
 * tick lands inside the window — no catch-up needed for a preference flag).
 * The morning window is 04:00–08:00 (before the 08:00 working day) so an
 * afternoon restart never clobbers an evening-coverage opt-in made for that
 * same night.
 */
let lastLunchResetDay: string | null = null;
let lastEveningResetDay: string | null = null;

export async function runDailyResets(now: Date): Promise<void> {
  const day = dubaiDateKey(now);
  const hour = dubaiHour(now);

  if (hour >= 16 && lastLunchResetDay !== day) {
    lastLunchResetDay = day;
    const n = await resetAllOutToLunch();
    if (n > 0) {
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
    }
  }

  if (hour >= 4 && hour < 8 && lastEveningResetDay !== day) {
    lastEveningResetDay = day;
    const n = await resetAllEveningCoverage();
    if (n > 0) {
      publish({ type: "people" });
      publish({ type: "capacity-ranking" });
    }
  }
}

/** `.unref()`'d so it never keeps the process (or a test) alive on its own. */
export function startDailyResetScheduler(intervalMs = 5 * 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    runDailyResets(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("daily reset scheduler tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
