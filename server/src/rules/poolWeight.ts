import { POOL_WEIGHT_SWITCH_HOUR } from "./config";
import type { ExpertPool } from "./types";

/**
 * §4 — pool_weight(pool, dubai_hour). NOT an eligibility rule: it only
 * scales how heavily a goal counts toward a person's load at this hour.
 * Never use this to filter who can be staffed.
 */
export function poolWeight(pool: ExpertPool, dubaiHourValue: number): number {
  const isLate = dubaiHourValue >= POOL_WEIGHT_SWITCH_HOUR;
  switch (pool) {
    case "Global":
    case "EU & MEA & India":
      return 1;
    case "AUS / NZ / Sing / JP":
      return isLate ? 0 : 2;
    case "US only":
      return isLate ? 2 : 0;
  }
}
