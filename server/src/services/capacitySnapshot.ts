import { listInstanceKeys, upsertCapacitySnapshot } from "../repositories/capacitySnapshot";
import { personLoad } from "../rules/load";
import { median } from "../rules/median";
import { dubaiDateKey, dubaiHour } from "../rules/time";
import { listAvailableCandidatesWithAssignments } from "./candidates";

/**
 * Record today's capacity shape for every instance: the deliverer pool's size
 * and its weighted-load distribution (median, average, over-median, idle),
 * computed at the current Dubai hour. Upserts one row per (day, instance), so
 * re-running the same day just refreshes it. Instances with nobody online are
 * skipped (no row rather than a misleading zero). Returns rows written.
 */
export async function recordCapacitySnapshots(now: Date): Promise<number> {
  const hour = dubaiHour(now);
  const takenOn = dubaiDateKey(now);
  const keys = await listInstanceKeys();
  let written = 0;
  for (const key of keys) {
    const people = await listAvailableCandidatesWithAssignments(key, { ghost: false });
    if (people.length === 0) continue;
    const loads = people.map((p) => personLoad(p.assignments, hour));
    const med = median(loads);
    const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
    await upsertCapacitySnapshot({
      instanceKey: key,
      takenOn,
      people: loads.length,
      medianLoad: Number(med.toFixed(2)),
      avgLoad: Number(avg.toFixed(2)),
      overMedian: loads.filter((l) => l > med).length,
      idle: loads.filter((l) => l === 0).length,
    });
    written++;
  }
  return written;
}

/** `.unref()`'d so it never keeps the process (or a test) alive on its own. */
export function startCapacitySnapshotScheduler(intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    recordCapacitySnapshots(new Date()).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("capacity snapshot scheduler tick failed", err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
