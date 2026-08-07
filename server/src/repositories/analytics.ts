import { pool } from "../db";

export interface CountRow {
  label: string;
  count: number;
}
export interface UserCountRow {
  name: string;
  team: string;
  count: number;
}
export interface FrictionRow {
  key: string;
  label: string;
  count: number;
  hint: string;
}

/**
 * Owner Analytics — all reads are windowed by a single `fromIso` lower bound
 * (the dashboard passes now − {7,30,90} days, or the epoch for "all time").
 * Everything is a plain GROUP BY count; no row-level data leaves the DB.
 */

/** Feature usage (telemetry) counts by event name, busiest first. */
export async function usageByEvent(fromIso: string): Promise<CountRow[]> {
  const { rows } = await pool.query(
    `SELECT event AS label, COUNT(*)::int AS count
     FROM usage_event WHERE created_at >= $1
     GROUP BY event ORDER BY count DESC`,
    [fromIso]
  );
  return rows;
}

/** Mutations (audit log) counts by action, busiest first. */
export async function auditByAction(fromIso: string): Promise<CountRow[]> {
  const { rows } = await pool.query(
    `SELECT action AS label, COUNT(*)::int AS count
     FROM audit_log WHERE created_at >= $1
     GROUP BY action ORDER BY count DESC`,
    [fromIso]
  );
  return rows;
}

/** Total telemetry activity per team (actor's team at event time). */
export async function usageByTeam(fromIso: string): Promise<CountRow[]> {
  const { rows } = await pool.query(
    `SELECT COALESCE(t.name, '(no team)') AS label, COUNT(*)::int AS count
     FROM usage_event u LEFT JOIN team t ON t.id = u.team_id
     WHERE u.created_at >= $1
     GROUP BY t.name ORDER BY count DESC`,
    [fromIso]
  );
  return rows;
}

/** Most active users by telemetry volume. */
export async function topUsers(fromIso: string, limit = 15): Promise<UserCountRow[]> {
  const { rows } = await pool.query(
    `SELECT COALESCE(p.name, '(removed user)') AS name,
            COALESCE(t.name, '—') AS team,
            COUNT(*)::int AS count
     FROM usage_event u
     LEFT JOIN person p ON p.id = u.person_id
     LEFT JOIN team t ON t.id = u.team_id
     WHERE u.created_at >= $1
     GROUP BY p.name, t.name ORDER BY count DESC LIMIT $2`,
    [fromIso, limit]
  );
  return rows;
}

/**
 * The friction panel — signals that a workflow needed a correction or wasn't
 * smooth. Telemetry signals (dismissed/snoozed prompts, intake errors,
 * abandoned intake) are joined with audit-log proxies (overrides, downward
 * goal revisions, back-stage moves, goal-change requests that were declined or
 * amended). Each carries a plain-English hint for the owner.
 */
export async function frictionSignals(fromIso: string): Promise<FrictionRow[]> {
  const usage = await pool.query(
    `SELECT event, COUNT(*)::int AS count FROM usage_event
     WHERE created_at >= $1
       AND event IN ('prompt_dismissed','prompt_snoozed','intake_suggestion_error','intake_abandoned')
     GROUP BY event`,
    [fromIso]
  );
  const audit = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE action = 'manual_override')::int AS overrides,
       COUNT(*) FILTER (WHERE action = 'downward_goal_revision')::int AS downward,
       COUNT(*) FILTER (WHERE action = 'back_stage')::int AS back_stage,
       COUNT(*) FILTER (WHERE action = 'resolve' AND new_value->>'outcome' = 'declined')::int AS gc_declined,
       COUNT(*) FILTER (WHERE action = 'resolve' AND (new_value->>'changed')::boolean IS TRUE)::int AS gc_amended
     FROM audit_log WHERE created_at >= $1`,
    [fromIso]
  );
  const u = new Map<string, number>(usage.rows.map((r: { event: string; count: number }) => [r.event, r.count]));
  const a = audit.rows[0] ?? {};
  const n = (v: unknown) => Number(v ?? 0);

  return [
    { key: "manual_override", label: "Staffing overrides", count: n(a.overrides), hint: "Auto-suggested deliverer wasn't trusted — matching may need tuning." },
    { key: "intake_suggestion_error", label: "Intake suggestion errors", count: u.get("intake_suggestion_error") ?? 0, hint: "The intake wizard couldn't compute a suggestion." },
    { key: "intake_abandoned", label: "Abandoned intakes", count: u.get("intake_abandoned") ?? 0, hint: "Project setup started but not finished." },
    { key: "downward_goal_revision", label: "Downward goal revisions", count: n(a.downward), hint: "Initial goals set too high and later reduced." },
    { key: "goal_change_declined", label: "Goal changes declined", count: n(a.gc_declined), hint: "Deliverers requesting changes PLs reject — expectation mismatch." },
    { key: "goal_change_amended", label: "Goal changes amended", count: n(a.gc_amended), hint: "Requests accepted only after edits — the ask wasn't quite right." },
    { key: "back_stage", label: "Stage moved backwards", count: n(a.back_stage), hint: "Delivery stage sent back — progress mis-recorded or reworked." },
    { key: "prompt_dismissed", label: "Prompts dismissed", count: u.get("prompt_dismissed") ?? 0, hint: "Coverage prompts closed without acting." },
    { key: "prompt_snoozed", label: "Prompts snoozed", count: u.get("prompt_snoozed") ?? 0, hint: "Coverage prompts deferred." },
  ].sort((x, y) => y.count - x.count);
}
