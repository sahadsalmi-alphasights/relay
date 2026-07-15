import { isEligible, type IneligibleReason } from "./eligibility";
import { dubaiHour } from "./time";
import { median } from "./median";
import { personLoad, personRawRemaining, type WeightedAssignment } from "./load";
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

export interface RankedCandidate {
  personId: string;
  eligible: boolean;
  /** Only set for Rule 2/3 failures — Rule 1 (status) people never appear at all. */
  ineligibleReason?: Exclude<IneligibleReason, "not_available">;
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
  projectStatus: "matched" | "open";
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
    projectStatus: eligible.length === 0 ? "open" : "matched",
  };
}
