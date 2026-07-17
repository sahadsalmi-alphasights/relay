import { isEligible, type IneligibleReason } from "./eligibility";
import { dubaiHour } from "./time";
import { median } from "./median";
import { personLoad, personRawRemaining, type WeightedAssignment } from "./load";
import { poolWeight } from "./poolWeight";
import type { PersonStatus } from "./types";

export interface CandidatePerson {
  id: string;
  status: PersonStatus;
  eveningCoverage: boolean;
  practiceArea: string | null;
  assignments: WeightedAssignment[];
}

export interface MatchContext {
  now: Date;
  sundayRotaPersonIds: ReadonlySet<string>;
  plPracticeArea: string;
}

/**
 * "first_deliverable_conflict" is NOT one of the §4 availability rules (Rule
 * 1/2/3) — it's a separate, later-added auto-assign-time rule (see
 * applyFirstDeliverableBlock below), deliberately layered on top rather than
 * fused into isEligible(), same spirit as §4's "keep the rules independent."
 */
export type MatchBlockReason = Exclude<IneligibleReason, "not_available"> | "first_deliverable_conflict";

export interface RankedCandidate {
  personId: string;
  eligible: boolean;
  /** Only set for Rule 2/3 (or the first-deliverable block) failures — Rule 1 (status) people never appear at all. */
  ineligibleReason?: MatchBlockReason;
  load: number;
  rawRemaining: number;
  practiceAreaMatch: boolean;
  /** raw remaining <= org-wide median among Available people (§5d). */
  free: boolean;
}

/**
 * §5d — rank every eligible-or-nearly-eligible candidate for a project.
 *
 * Rule 1 (status) people are dropped entirely, per spec: they must not even
 * appear greyed out. Rule 2/3 failures remain in the list (so the PL can see
 * who *would* be available) but sort after every eligible candidate.
 *
 * The median for the "free" comparison is computed org-wide across all
 * Available people passed in, regardless of their Rule 2/3 eligibility —
 * it's a global capacity signal, not scoped to this project's candidate set.
 */
export function rankCandidates(
  candidates: CandidatePerson[],
  context: MatchContext
): RankedCandidate[] {
  const hour = dubaiHour(context.now);
  const availableOnly = candidates.filter((c) => c.status === "Available");

  const rawRemainders = availableOnly.map((c) => personRawRemaining(c.assignments));
  const med = median(rawRemainders);

  const ranked: RankedCandidate[] = availableOnly.map((c) => {
    const elig = isEligible(
      { id: c.id, status: c.status, eveningCoverage: c.eveningCoverage },
      { now: context.now, sundayRotaPersonIds: context.sundayRotaPersonIds }
    );
    const rawRemaining = personRawRemaining(c.assignments);
    return {
      personId: c.id,
      eligible: elig.eligible,
      ineligibleReason: elig.eligible
        ? undefined
        : (elig.reason as Exclude<IneligibleReason, "not_available">),
      load: personLoad(c.assignments, hour),
      rawRemaining,
      practiceAreaMatch: c.practiceArea === context.plPracticeArea,
      free: rawRemaining <= med,
    };
  });

  ranked.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible) {
      const aBoost = a.practiceAreaMatch && a.free;
      const bBoost = b.practiceAreaMatch && b.free;
      if (aBoost !== bBoost) return aBoost ? -1 : 1;
    }
    return a.load - b.load;
  });

  return ranked;
}

export interface AutoMatchResult {
  assigned: RankedCandidate[];
  projectStatus: "active" | "open";
}

/** §5d/§4 — pick the top staffCount eligible candidates; zero eligible -> open. */
export function autoMatch(
  candidates: CandidatePerson[],
  context: MatchContext,
  staffCount: number
): AutoMatchResult {
  const ranked = rankCandidates(candidates, context);
  const eligible = ranked.filter((r) => r.eligible);
  return {
    assigned: eligible.slice(0, staffCount),
    projectStatus: eligible.length === 0 ? "open" : "active",
  };
}

/**
 * CHANGE 2 — a person already holding a First Deliverable assignment on a
 * Strategy or Due Diligence project is blocked from being auto-assigned a
 * NEW first deliverable (every brand-new assignment starts at First
 * Deliverable) while that OTHER assignment's project pool is currently
 * online. Pitch is exempt: holding a First-Deliverable Pitch assignment
 * never blocks.
 *
 * "Online" reuses the app's one existing definition, unchanged:
 * `poolWeight(pool, hour) !== 0` (rules/poolWeight.ts) — the same signal
 * that already drives load weighting and the 💤/⚡ pool chips. Derived fresh
 * every call from the candidate's live assignments; nothing is stored.
 *
 * Deliberately separate from isEligible() (§4 Rules 1-3) — this is a later,
 * independent auto-assign-time rule, not a fourth availability rule.
 */
export function blocksNewFirstDeliverable(assignments: WeightedAssignment[], hour: number): boolean {
  return assignments.some(
    (a) =>
      a.stage === "First Deliverable" &&
      (a.projectType === "Strategy" || a.projectType === "Due Diligence") &&
      poolWeight(a.projectExpertPool, hour) !== 0
  );
}

/**
 * Layers the CHANGE 2 block on top of rankCandidates()'s output — rankCandidates()
 * itself is unchanged (still pure §4 Rules 1-3). Anyone already ineligible
 * stays exactly as-is (Rule 1/2/3 reasons take precedence — this rule adds a
 * new way to become ineligible, it doesn't touch existing ones). A formerly-
 * eligible candidate who now blocks is downgraded to ineligible with reason
 * "first_deliverable_conflict", then the list is re-sorted so ineligible
 * still sorts after eligible (relative order within each group is preserved
 * — Array#sort is stable, so the practice-area/free/load ordering
 * rankCandidates() already computed survives untouched within each group).
 */
export function applyFirstDeliverableBlock(
  ranked: RankedCandidate[],
  candidates: CandidatePerson[],
  hour: number
): RankedCandidate[] {
  const assignmentsById = new Map(candidates.map((c) => [c.id, c.assignments]));
  const adjusted = ranked.map((r) => {
    if (!r.eligible) return r;
    const assignments = assignmentsById.get(r.personId) ?? [];
    if (blocksNewFirstDeliverable(assignments, hour)) {
      return { ...r, eligible: false, ineligibleReason: "first_deliverable_conflict" as const };
    }
    return r;
  });
  adjusted.sort((a, b) => (a.eligible === b.eligible ? 0 : a.eligible ? -1 : 1));
  return adjusted;
}

export interface AngleStaffRequest {
  key: string;
  staffCount: number;
}

export interface AngleAllocation {
  key: string;
  picked: RankedCandidate[];
}

export interface AllocationResult {
  perAngle: AngleAllocation[];
  /** How many candidates were eligible at all, across the WHOLE request — the zero/nonzero split that decides broadcast (Change 3, totalEligible===0) vs. partial-fill (Change 4, totalEligible>0 but some angle still short) vs. a clean full fill. */
  totalEligible: number;
  projectStatus: "active" | "open";
}

/**
 * CHANGE 1 — one ranking, one candidate snapshot, allocated across every
 * angle WITHOUT replacement: angle 1 fills from the eligible pool, angle 2
 * fills from those NOT already placed on THIS project, and so on. A person
 * is suggested for only one angle per project.
 *
 * Reuse only on exhaustion: once every eligible candidate is already placed
 * somewhere on this project and an angle still needs seats, the
 * already-placed pool is reused, least-loaded first — never before
 * exhaustion, and never as a way to reach a broadcast (see below).
 *
 * `ranked` should already have CHANGE 2's block applied (or not, if the
 * caller doesn't want it) — this function only ever reads `.eligible`, it
 * doesn't know or care why someone is ineligible.
 */
export function allocateAcrossAngles(ranked: RankedCandidate[], angles: AngleStaffRequest[]): AllocationResult {
  const eligibleOrdered = ranked.filter((r) => r.eligible);
  const placedThisProject = new Set<string>();
  const perAngle: AngleAllocation[] = [];

  for (const { key, staffCount } of angles) {
    const fresh = eligibleOrdered.filter((r) => !placedThisProject.has(r.personId));
    const picks = fresh.slice(0, staffCount);
    if (picks.length < staffCount) {
      const reuse = eligibleOrdered
        .filter((r) => placedThisProject.has(r.personId))
        .sort((a, b) => a.load - b.load);
      picks.push(...reuse.slice(0, staffCount - picks.length));
    }
    picks.forEach((p) => placedThisProject.add(p.personId));
    perAngle.push({ key, picked: picks });
  }

  return {
    perAngle,
    totalEligible: eligibleOrdered.length,
    // Broadcast (Change 3) is ONLY ever triggered by totalEligible === 0 at
    // the route layer — never derived from a per-angle shortfall here, so
    // reuse-on-exhaustion can never "fall through" to it.
    projectStatus: eligibleOrdered.length === 0 ? "open" : "active",
  };
}
