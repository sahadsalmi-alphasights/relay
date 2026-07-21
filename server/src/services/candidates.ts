import { pool } from "../db";
import type { WeightedAssignment } from "../rules/load";
import type { PersonStatus } from "../rules/types";

/** §4 Rule 2 — person ids rostered on sunday_rota for one exact Dubai calendar date. */
export async function sundayRotaPersonIdsForDate(dateKey: string): Promise<Set<string>> {
  const { rows } = await pool.query(`SELECT person_id AS "personId" FROM sunday_rota WHERE rota_date = $1`, [
    dateKey,
  ]);
  return new Set(rows.map((r) => r.personId));
}

export interface CandidateWithAssignments {
  id: string;
  status: PersonStatus;
  eveningCoverage: boolean;
  practiceArea: string | null;
  assignments: WeightedAssignment[];
}

/**
 * Every Available person plus their non-archived assignments, shaped for
 * rankCandidates()/personLoad(). Only Available people are fetched at all —
 * Rule 1 (status) excludes the rest before ranking ever sees them.
 *
 * Managers are excluded unconditionally (`is_manager = false`) — the single
 * shared source for both ranking dashboards (Capacity Ranking, and the ghost
 * one below) and the real staffing/matching candidate pool
 * (routes/projects.ts's intake/match + creation-time ghost suggestion), so
 * one filter here means a manager is never suggested, never ranked, and
 * never counts toward the org-wide median — while still being addable to a
 * project manually (the manual "Edit team"/override routes accept any
 * delivererId directly, never consulting this function).
 *
 * "Invisible competition" — `ghost` selects one of two mutually exclusive
 * pools by `is_ghost`. Omitted (or false) is the standard pool (today's
 * default behavior, unchanged); `true` is the ghost-only pool used for both
 * ghost allocation and the separate Ghost Ranking dashboard.
 */
export async function listAvailableCandidatesWithAssignments(opts?: {
  ghost?: boolean;
}): Promise<CandidateWithAssignments[]> {
  const { rows: people } = await pool.query(
    `SELECT id, status, evening_coverage AS "eveningCoverage", practice_area AS "practiceArea"
     FROM person
     WHERE status = 'Available' AND is_manager = false AND is_owner = false AND is_ghost = $1
       AND deactivated_at IS NULL`,
    [opts?.ghost ?? false]
  );

  // Big structural change — a Pitch's flat-load pin (and the free/busy
  // exclusion) key off calls_n, which lives on the angle now, not the
  // project. Join through angle to reach it; project_type/expert_pool stay
  // project-level (one type/pool per project, shared by all its angles).
  //
  // Project lifecycle — archived contributes zero load: nobody's actively
  // working an archived project (see rules/project.ts isProjectLifecycleQuiet,
  // which this mirrors). Soft-deleted projects are excluded unconditionally,
  // same as every other project query (Batch S).
  const { rows: assignments } = await pool.query(
    `SELECT a.deliverer_id AS "delivererId", a.goal, a.delivered, a.custom_goal AS "customGoal",
            a.custom_delivered AS "customDelivered", a.stage,
            p.expert_pool AS "projectExpertPool",
            p.project_type AS "projectType", ang.calls_n AS "projectCallsN"
     FROM assignment a JOIN angle ang ON ang.id = a.angle_id JOIN project p ON p.id = ang.project_id
     WHERE p.status <> 'archived' AND p.deleted_at IS NULL`
  );

  const byPerson = new Map<string, WeightedAssignment[]>();
  for (const a of assignments) {
    const list = byPerson.get(a.delivererId) ?? [];
    list.push({
      goal: a.goal,
      delivered: a.delivered,
      customDelivered: a.customDelivered,
      stage: a.stage,
      projectExpertPool: a.projectExpertPool,
      // §5c (domain change 4) — feeds the Pitch-at-N=0 flat-load pin in assignmentLoad().
      projectType: a.projectType,
      projectCallsN: a.projectCallsN,
    });
    byPerson.set(a.delivererId, list);
  }

  return people.map((p) => ({ ...p, assignments: byPerson.get(p.id) ?? [] }));
}
