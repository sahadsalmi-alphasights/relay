import { runHrLeaveSync } from "./hrLeaveSync";

/**
 * Polls BambooHR on an interval to keep CapTracker statuses in step with who's
 * on leave. Half-hourly is plenty — leave is a whole-day concept. The run
 * itself no-ops unless the integration is configured (env) and enabled
 * (settings), so this timer is cheap when the integration is off. `.unref()`'d
 * so it never keeps the process (or a test) alive.
 */
export function startHrSyncScheduler(intervalMs = 30 * 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    runHrLeaveSync(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("hr leave sync tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
