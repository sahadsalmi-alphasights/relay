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
 */
export async function listAvailableCandidatesWithAssignments(): Promise<CandidateWithAssignments[]> {
  const { rows: people } = await pool.query(
    `SELECT id, status, evening_coverage AS "eveningCoverage", practice_area AS "practiceArea"
     FROM person WHERE status = 'Available'`
  );

  const { rows: assignments } = await pool.query(
    `SELECT a.deliverer_id AS "delivererId", a.goal, a.delivered, a.custom_goal AS "customGoal",
            a.custom_delivered AS "customDelivered", a.stage,
            p.expert_pool AS "projectExpertPool",
            p.project_type AS "projectType", p.calls_n AS "projectCallsN"
     FROM assignment a JOIN project p ON p.id = a.project_id
     WHERE p.archived = false`
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
