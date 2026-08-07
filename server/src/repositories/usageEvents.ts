import { pool } from "../db";

/**
 * The allowlist of telemetry event names. The record endpoint drops anything
 * not in this set, so a compromised or buggy client can't flood the table with
 * arbitrary rows (or smuggle PII in as an event name). Extend this list when
 * you instrument a new workflow — nothing else needs to change.
 */
export const USAGE_EVENTS = [
  "screen_view", // context: { screen }
  "prompt_shown", // context: { prompt }  (lunch | evening)
  "prompt_accepted",
  "prompt_dismissed",
  "prompt_snoozed",
  "intake_started",
  "intake_suggestion_error",
  "intake_created",
  "intake_abandoned",
  "goal_change_submitted",
] as const;

export type UsageEventName = (typeof USAGE_EVENTS)[number];

const ALLOWED = new Set<string>(USAGE_EVENTS);
export function isAllowedEvent(event: string): boolean {
  return ALLOWED.has(event);
}

/** Max events accepted in one POST — a client should batch, not spam. */
export const MAX_BATCH = 50;

export interface IncomingUsageEvent {
  event: string;
  context?: Record<string, unknown> | null;
}

/**
 * Insert a batch of telemetry rows. Identity (person/team) and time are
 * stamped by the CALLER from the authenticated session — never trusted from
 * the client. Unknown event names are silently skipped. `context` is coerced
 * to a small flat object of primitives (no nested objects, no long strings)
 * so nothing sensitive or unbounded lands in the column. Returns how many
 * rows were actually written.
 */
export async function insertUsageEvents(
  personId: string | null,
  teamId: string | null,
  events: IncomingUsageEvent[]
): Promise<number> {
  const rows = events
    .filter((e) => isAllowedEvent(e.event))
    .slice(0, MAX_BATCH)
    .map((e) => ({ event: e.event, context: sanitizeContext(e.context) }));
  if (rows.length === 0) return 0;

  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const base = i * 4;
    values.push(personId, teamId, r.event, r.context);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });
  await pool.query(
    `INSERT INTO usage_event (person_id, team_id, event, context) VALUES ${tuples.join(", ")}`,
    values
  );
  return rows.length;
}

/**
 * Keep only primitive scalar values, at most a handful of short keys — the
 * telemetry contract is "generic dimensions, never content". Anything else is
 * dropped rather than stored.
 */
// Keys that would pollute a prototype if assigned — never accept them from a
// client-supplied object (prototype-pollution / property-injection guard).
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeContext(context: Record<string, unknown> | null | undefined): string | null {
  if (!context || typeof context !== "object") return null;
  // Null-prototype accumulator so an unexpected key can't reach Object.prototype.
  const clean: Record<string, string | number | boolean> = Object.create(null);
  let kept = 0;
  for (const [k, v] of Object.entries(context)) {
    if (kept >= 8) break;
    if (typeof k !== "string" || k.length > 40 || UNSAFE_KEYS.has(k)) continue;
    if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 60)) {
      clean[k] = v;
      kept += 1;
    }
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}
