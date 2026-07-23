import { describe, expect, it } from "vitest";
import {
  allocateAcrossAngles,
  applyFirstDeliverableBlock,
  autoMatch,
  blocksNewFirstDeliverable,
  rankCandidates,
  type CandidatePerson,
  type MatchContext,
  type RankedCandidate,
} from "./matching";

const WEEKDAY_DAYTIME = new Date("2023-01-02T06:00:00Z"); // Monday 10:00 Dubai
const WEEKDAY_EVENING = new Date("2023-01-02T16:00:00Z"); // Monday 20:00 Dubai

function baseContext(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    now: WEEKDAY_DAYTIME,
    plPracticeArea: "Tech",
    ...overrides,
  };
}

function cand(id: string, opts: Partial<CandidatePerson> = {}): CandidatePerson {
  return {
    id,
    status: "Available",
    eveningCoverage: true,
    practiceArea: "PIPE",
    teamId: null,
    assignments: [],
    ...opts,
  };
}

// First Deliverable (weight 2) on the always-online Global pool (weight 1):
// load = goal * 2. Keeps the free/busy median math easy to reason about.
const fd = (goal: number) => ({
  goal,
  delivered: 0,
  customDelivered: 0,
  stage: "First Deliverable" as const,
  projectExpertPool: "Global" as const,
});

describe("rankCandidates — offline (status) people never appear at all", () => {
  it("drops Sick/On vacation/Offline entirely rather than greying them out", () => {
    const candidates = [
      cand("sick", { status: "Sick" }),
      cand("vacation", { status: "On vacation" }),
      cand("avail"),
    ];
    const ranked = rankCandidates(candidates, baseContext());
    expect(ranked.map((r) => r.personId)).toEqual(["avail"]);
  });
});

describe("rankCandidates — evening coverage is the only availability block (Sunday rota removed)", () => {
  it("keeps a no-evening-coverage person in the list after hours, marked ineligible", () => {
    const candidates = [
      cand("covering", { eveningCoverage: true }),
      cand("offline", { eveningCoverage: false }),
    ];
    const ranked = rankCandidates(candidates, baseContext({ now: WEEKDAY_EVENING }));
    const off = ranked.find((r) => r.personId === "offline")!;
    expect(off.eligible).toBe(false);
    expect(off.ineligibleReason).toBe("no_evening_coverage");
    expect(ranked[0].personId).toBe("covering");
  });

  it("does NOT block anyone for a Sunday rota — that rule no longer exists", () => {
    // A plain weekday-style pool evaluated on a Sunday: everyone Available with
    // evening coverage on is eligible, regardless of any rota.
    const SUNDAY = new Date("2023-01-01T06:00:00Z"); // Sunday 10:00 Dubai
    const ranked = rankCandidates([cand("a"), cand("b")], baseContext({ now: SUNDAY }));
    expect(ranked.every((r) => r.eligible)).toBe(true);
  });
});

describe("rankCandidates — Free/Busy is judged on weighted LOAD (2026-07-23)", () => {
  it("marks free at/below the median load of online people, busy above, and sorts lowest-load-first", () => {
    const candidates = [
      cand("high", { assignments: [fd(10)] }), // load 20
      cand("low", { assignments: [] }), // load 0
      cand("mid", { assignments: [fd(5)] }), // load 10  (== median)
    ];
    const ranked = rankCandidates(candidates, baseContext());
    const by = Object.fromEntries(ranked.map((r) => [r.personId, r]));
    // median of [0, 10, 20] = 10
    expect(by.low.free).toBe(true);
    expect(by.mid.free).toBe(true); // equal to the median counts as free
    expect(by.high.free).toBe(false);
    expect(ranked.map((r) => r.personId)).toEqual(["low", "mid", "high"]);
  });

  it("does NOT float an in-practice high-load person above a lower-load one — ranking is pure load now", () => {
    const candidates = [
      cand("inPracticeHigh", { practiceArea: "Tech", assignments: [fd(10)] }), // load 20
      cand("outLow", { practiceArea: "PIPE", assignments: [fd(2)] }), // load 4
    ];
    const ranked = rankCandidates(candidates, baseContext({ plPracticeArea: "Tech" }));
    // The high-load in-practice person is above the median → not free → not
    // boosted; pure load ordering puts the lighter out-of-practice person first.
    expect(ranked.map((r) => r.personId)).toEqual(["outLow", "inPracticeHigh"]);
  });

  it("takes the median over ONLINE people only — an offline person doesn't move it", () => {
    const candidates = [
      cand("a", { assignments: [] }), // load 0
      cand("b", { assignments: [fd(5)] }), // load 10
      cand("offlineHeavy", { eveningCoverage: false, assignments: [fd(50)] }), // load 200, offline after hours
    ];
    const ranked = rankCandidates(candidates, baseContext({ now: WEEKDAY_EVENING }));
    const by = Object.fromEntries(ranked.map((r) => [r.personId, r]));
    // Online loads are [0, 10] → median 5. b (10) is above it → busy, despite
    // the huge offline person who is excluded from the median entirely.
    expect(by.a.free).toBe(true);
    expect(by.b.free).toBe(false);
    expect(by.offlineHeavy.eligible).toBe(false);
  });
});

describe("autoMatch — picks lowest load, opens when nobody eligible", () => {
  it("sets the project to open when zero eligible candidates exist", () => {
    const result = autoMatch([cand("sick", { status: "Sick" })], baseContext(), 1);
    expect(result).toEqual({ assigned: [], projectStatus: "open" });
  });

  it("picks the top staffCount eligible candidates by lowest load", () => {
    const candidates = [
      cand("low", { assignments: [] }),
      cand("high", { assignments: [fd(5)] }),
    ];
    const result = autoMatch(candidates, baseContext({ plPracticeArea: "Tech" }), 1);
    expect(result.projectStatus).toBe("active");
    expect(result.assigned.map((r) => r.personId)).toEqual(["low"]);
  });
});

describe("autoMatch — §4/§6 evening projects are ASSIGNED, not floated", () => {
  it("assigns directly after hours when an evening-coverage volunteer is eligible", () => {
    const candidates = [
      cand("covering", { eveningCoverage: true, practiceArea: "Tech" }),
      cand("not-covering", { eveningCoverage: false, practiceArea: "Tech" }),
    ];
    const result = autoMatch(candidates, baseContext({ now: WEEKDAY_EVENING }), 1);
    expect(result.projectStatus).toBe("active");
    expect(result.assigned.map((r) => r.personId)).toEqual(["covering"]);
  });

  it("restricts the after-hours pool to evening-coverage-on people, picking lowest load among them", () => {
    const candidates = [
      cand("covering-busy", { eveningCoverage: true, practiceArea: "Tech", assignments: [fd(5)] }),
      cand("covering-free", { eveningCoverage: true, practiceArea: "Tech" }),
      cand("not-covering-free", { eveningCoverage: false, practiceArea: "Tech" }),
    ];
    const result = autoMatch(candidates, baseContext({ now: WEEKDAY_EVENING }), 1);
    expect(result.projectStatus).toBe("active");
    expect(result.assigned.map((r) => r.personId)).toEqual(["covering-free"]);
  });

  it("only goes to the open pool as a last resort — zero evening-coverage volunteers after hours", () => {
    const candidates = [
      cand("off-1", { eveningCoverage: false, practiceArea: "Tech" }),
      cand("off-2", { eveningCoverage: false, practiceArea: "Tech" }),
    ];
    const result = autoMatch(candidates, baseContext({ now: WEEKDAY_EVENING }), 1);
    expect(result).toEqual({ assigned: [], projectStatus: "open" });
  });
});

function ranked(personId: string, opts: Partial<RankedCandidate> = {}): RankedCandidate {
  return {
    personId,
    eligible: true,
    load: 0,
    rawRemaining: 0,
    practiceAreaMatch: false,
    free: false,
    teamId: null,
    ...opts,
  };
}

describe("allocateAcrossAngles — fill without replacement, reuse only on exhaustion", () => {
  it("fills each angle from a disjoint slice of the eligible pool when large enough — no repeats", () => {
    const pool = [ranked("A"), ranked("B"), ranked("C"), ranked("D")];
    const { perAngle, totalEligible } = allocateAcrossAngles(pool, [
      { key: "a", staffCount: 2 },
      { key: "b", staffCount: 2 },
    ]);
    const a = perAngle.find((p) => p.key === "a")!.picked.map((r) => r.personId);
    const b = perAngle.find((p) => p.key === "b")!.picked.map((r) => r.personId);
    expect(a).toEqual(["A", "B"]);
    expect(b).toEqual(["C", "D"]);
    expect(new Set([...a, ...b]).size).toBe(4);
    expect(totalEligible).toBe(4);
  });

  it("reuses already-placed people, least-loaded first, only once the fresh pool is exhausted", () => {
    const pool = [ranked("P1", { load: 5 }), ranked("P2", { load: 0 })];
    const { perAngle } = allocateAcrossAngles(pool, [
      { key: "a", staffCount: 2 },
      { key: "b", staffCount: 2 },
    ]);
    const a = perAngle.find((p) => p.key === "a")!.picked.map((r) => r.personId);
    const b = perAngle.find((p) => p.key === "b")!.picked.map((r) => r.personId);
    expect(a).toEqual(["P1", "P2"]);
    expect(b).toEqual(["P2", "P1"]);
  });

  it("totalEligible is 0 and projectStatus is open when nobody is eligible", () => {
    const pool = [ranked("A", { eligible: false, ineligibleReason: "no_evening_coverage" })];
    const { perAngle, totalEligible, projectStatus } = allocateAcrossAngles(pool, [
      { key: "a", staffCount: 1 },
    ]);
    expect(totalEligible).toBe(0);
    expect(projectStatus).toBe("open");
    expect(perAngle.find((p) => p.key === "a")!.picked).toEqual([]);
  });
});

describe("allocateAcrossAngles — own-team-free first, then the rest (2026-07-23)", () => {
  it("floats FREE people on the PL's own team ahead of everyone, then the rest in load order", () => {
    // Incoming pool is already in lowest-load-first order.
    const pool = [
      ranked("otherLow", { load: 1, free: true, teamId: "T2" }),
      ranked("ownBusy", { load: 2, free: false, teamId: "T1" }),
      ranked("ownFree", { load: 3, free: true, teamId: "T1" }),
      ranked("otherHigh", { load: 4, free: false, teamId: "T2" }),
    ];
    const { perAngle } = allocateAcrossAngles(pool, [{ key: "a", staffCount: 4 }], "T1");
    // ownFree leads (own team + free). ownBusy does NOT float (busy). The rest
    // keep their incoming lowest-load order.
    expect(perAngle[0].picked.map((r) => r.personId)).toEqual([
      "ownFree",
      "otherLow",
      "ownBusy",
      "otherHigh",
    ]);
  });

  it("falls back to pure incoming (load) order when the PL has no team", () => {
    const pool = [ranked("a", { load: 1, teamId: "T2" }), ranked("b", { load: 2, teamId: "T3" })];
    const { perAngle } = allocateAcrossAngles(pool, [{ key: "a", staffCount: 2 }], null);
    expect(perAngle[0].picked.map((r) => r.personId)).toEqual(["a", "b"]);
  });
});

describe("blocksNewFirstDeliverable", () => {
  const onlinePool = "Global" as const;

  it("blocks a First Deliverable Strategy assignment while that pool is online", () => {
    expect(
      blocksNewFirstDeliverable(
        [{ goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: onlinePool, projectType: "Strategy" }],
        10
      )
    ).toBe(true);
  });

  it("blocks a First Deliverable Due Diligence assignment while that pool is online", () => {
    expect(
      blocksNewFirstDeliverable(
        [{ goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: onlinePool, projectType: "Due Diligence" }],
        10
      )
    ).toBe(true);
  });

  it("does NOT block a First Deliverable Pitch assignment — Pitch is exempt", () => {
    expect(
      blocksNewFirstDeliverable(
        [{ goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: onlinePool, projectType: "Pitch" }],
        10
      )
    ).toBe(false);
  });

  it("does NOT block a Strategy assignment that isn't at First Deliverable", () => {
    expect(
      blocksNewFirstDeliverable(
        [{ goal: 5, delivered: 0, customDelivered: 0, stage: "Second Deliverable", projectExpertPool: onlinePool, projectType: "Strategy" }],
        10
      )
    ).toBe(false);
  });

  it("does NOT block once the blocking assignment's pool goes offline (timezone gate)", () => {
    expect(
      blocksNewFirstDeliverable(
        [{ goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "AUS / NZ / Sing / JP", projectType: "Strategy" }],
        16 // past the 15:00 switch — asleep
      )
    ).toBe(false);
  });

  it("blocks with that same APAC pool before the 15:00 switch, when it's awake", () => {
    expect(
      blocksNewFirstDeliverable(
        [{ goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "AUS / NZ / Sing / JP", projectType: "Strategy" }],
        10
      )
    ).toBe(true);
  });
});

describe("applyFirstDeliverableBlock — layered on top of rankCandidates()", () => {
  it("downgrades a formerly-eligible candidate who blocks, tagging the new reason", () => {
    const candidates = [
      cand("blocked", {
        practiceArea: "Tech",
        assignments: [
          { goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global" },
        ],
      }),
    ];
    // give the assignment a projectType so the block applies
    candidates[0].assignments[0] = {
      goal: 5,
      delivered: 0,
      customDelivered: 0,
      stage: "First Deliverable",
      projectExpertPool: "Global",
      projectType: "Strategy",
    };
    const base = rankCandidates(candidates, baseContext());
    expect(base[0].eligible).toBe(true);
    const adjusted = applyFirstDeliverableBlock(base, candidates, 10);
    expect(adjusted[0].eligible).toBe(false);
    expect(adjusted[0].ineligibleReason).toBe("first_deliverable_conflict");
  });

  it("leaves an existing evening-coverage ineligibility untouched rather than overwriting the reason", () => {
    const candidates = [cand("offline", { eveningCoverage: false })];
    const base = rankCandidates(candidates, baseContext({ now: WEEKDAY_EVENING }));
    const adjusted = applyFirstDeliverableBlock(base, candidates, 20);
    expect(adjusted[0].ineligibleReason).toBe("no_evening_coverage");
  });

  it("re-sorts so a newly-blocked candidate drops after every still-eligible one", () => {
    const candidates = [
      cand("blocked", {
        practiceArea: "Tech",
        assignments: [
          { goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global", projectType: "Strategy" },
        ],
      }),
      cand("free1", { practiceArea: "Tech" }),
      cand("free2", { practiceArea: "Tech" }),
    ];
    const base = rankCandidates(candidates, baseContext());
    const adjusted = applyFirstDeliverableBlock(base, candidates, 10);
    expect(adjusted[adjusted.length - 1].personId).toBe("blocked");
    expect(adjusted.filter((r) => r.eligible).map((r) => r.personId)).toEqual(["free1", "free2"]);
  });
});
