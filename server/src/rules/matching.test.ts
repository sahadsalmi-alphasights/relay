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
const SUNDAY_DAYTIME = new Date("2023-01-01T06:00:00Z"); // Sunday 10:00 Dubai
const WEEKDAY_EVENING = new Date("2023-01-02T16:00:00Z"); // Monday 20:00 Dubai

function baseContext(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    now: WEEKDAY_DAYTIME,
    sundayRotaPersonIds: new Set(),
    plPracticeArea: "Tech",
    ...overrides,
  };
}

describe("rankCandidates — Rule 1 people never appear at all", () => {
  it("drops Sick/On vacation/Offline entirely rather than greying them out", () => {
    const candidates: CandidatePerson[] = [
      { id: "sick", status: "Sick", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
      { id: "vacation", status: "On vacation", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
      { id: "avail", status: "Available", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
    ];
    const ranked = rankCandidates(candidates, baseContext());
    expect(ranked.map((r) => r.personId)).toEqual(["avail"]);
  });
});

describe("rankCandidates — Rule 2/3 people appear, greyed, with a reason", () => {
  it("keeps a not-on-rota person in the list on Sunday, marked ineligible", () => {
    const candidates: CandidatePerson[] = [
      { id: "onRota", status: "Available", eveningCoverage: true, practiceArea: "PIPE", assignments: [] },
      { id: "offRota", status: "Available", eveningCoverage: true, practiceArea: "PIPE", assignments: [] },
    ];
    const ranked = rankCandidates(
      candidates,
      baseContext({ now: SUNDAY_DAYTIME, sundayRotaPersonIds: new Set(["onRota"]) })
    );
    expect(ranked).toHaveLength(2);
    const off = ranked.find((r) => r.personId === "offRota")!;
    expect(off.eligible).toBe(false);
    expect(off.ineligibleReason).toBe("not_on_sunday_rota");
    // eligible candidate always sorts ahead of an ineligible one.
    expect(ranked[0].personId).toBe("onRota");
  });

  it("keeps a no-evening-coverage person in the list after hours, marked ineligible", () => {
    const candidates: CandidatePerson[] = [
      { id: "covering", status: "Available", eveningCoverage: true, practiceArea: "PIPE", assignments: [] },
      { id: "offline", status: "Available", eveningCoverage: false, practiceArea: "PIPE", assignments: [] },
    ];
    const ranked = rankCandidates(candidates, baseContext({ now: WEEKDAY_EVENING }));
    const off = ranked.find((r) => r.personId === "offline")!;
    expect(off.eligible).toBe(false);
    expect(off.ineligibleReason).toBe("no_evening_coverage");
    expect(ranked[0].personId).toBe("covering");
  });
});

describe("rankCandidates — §5d practice-area + free soft rule", () => {
  it("ranks an in-practice, free candidate above a lower-load candidate outside the practice area", () => {
    const inPractice: CandidatePerson = {
      id: "A",
      status: "Available",
      eveningCoverage: true, // after-hours instant used below, must stay eligible
      practiceArea: "Tech",
      assignments: [
        { goal: 2, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global" },
        { goal: 3, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "US only" },
      ],
    };
    const outsidePractice: CandidatePerson = {
      id: "B",
      status: "Available",
      eveningCoverage: true,
      practiceArea: "PIPE",
      assignments: [
        { goal: 10, delivered: 5, customDelivered: 0, stage: "Second Deliverable", projectExpertPool: "Global" },
      ],
    };

    // At 20:00 Dubai, US-only is double-weighted, so A's load (16) is
    // actually higher than B's (5) — by load alone B would win.
    const ranked = rankCandidates(
      [inPractice, outsidePractice],
      baseContext({ now: WEEKDAY_EVENING, plPracticeArea: "Tech" })
    );

    const a = ranked.find((r) => r.personId === "A")!;
    const b = ranked.find((r) => r.personId === "B")!;
    expect(a.load).toBeGreaterThan(b.load);
    expect(a.practiceAreaMatch).toBe(true);
    expect(a.free).toBe(true);
    expect(b.practiceAreaMatch).toBe(false);

    // The soft rule overrides pure load ordering.
    expect(ranked[0].personId).toBe("A");
    expect(ranked[1].personId).toBe("B");
  });

  it("falls back to lowest load when the practice-area+free boost doesn't differentiate", () => {
    const lowerLoad: CandidatePerson = {
      id: "C",
      status: "Available",
      eveningCoverage: true,
      practiceArea: "PIPE",
      assignments: [
        { goal: 3, delivered: 0, customDelivered: 0, stage: "Second Deliverable", projectExpertPool: "Global" },
      ],
    };
    const higherLoad: CandidatePerson = {
      id: "D",
      status: "Available",
      eveningCoverage: true,
      practiceArea: "PIPE",
      assignments: [
        { goal: 8, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global" },
      ],
    };
    const ranked = rankCandidates([higherLoad, lowerLoad], baseContext({ plPracticeArea: "Tech" }));
    expect(ranked.map((r) => r.personId)).toEqual(["C", "D"]);
  });
});

describe("autoMatch — §4/§5d", () => {
  it("sets the project to open when zero eligible candidates exist", () => {
    const candidates: CandidatePerson[] = [
      { id: "sick", status: "Sick", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
    ];
    const result = autoMatch(candidates, baseContext(), 1);
    expect(result).toEqual({ assigned: [], projectStatus: "open" });
  });

  it("picks the top staffCount eligible candidates in rank order", () => {
    const candidates: CandidatePerson[] = [
      { id: "low", status: "Available", eveningCoverage: true, practiceArea: "PIPE", assignments: [] },
      {
        id: "high",
        status: "Available",
        eveningCoverage: true,
        practiceArea: "PIPE",
        assignments: [
          { goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global" },
        ],
      },
    ];
    const result = autoMatch(candidates, baseContext({ plPracticeArea: "Tech" }), 1);
    expect(result.projectStatus).toBe("active");
    expect(result.assigned.map((r) => r.personId)).toEqual(["low"]);
  });
});

describe("autoMatch — §4/§6 evening projects are ASSIGNED, not floated", () => {
  it("assigns directly after hours when an evening-coverage volunteer is eligible — never opens while someone is eligible", () => {
    const candidates: CandidatePerson[] = [
      { id: "covering", status: "Available", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
      { id: "not-covering", status: "Available", eveningCoverage: false, practiceArea: "Tech", assignments: [] },
    ];
    const result = autoMatch(candidates, baseContext({ now: WEEKDAY_EVENING }), 1);
    expect(result.projectStatus).toBe("active");
    expect(result.assigned.map((r) => r.personId)).toEqual(["covering"]);
  });

  it("restricts the after-hours candidate pool to evening-coverage-on people, picking the lowest load among them — exactly like daytime matching", () => {
    const candidates: CandidatePerson[] = [
      {
        id: "covering-busy",
        status: "Available",
        eveningCoverage: true,
        practiceArea: "Tech",
        assignments: [
          { goal: 10, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global" },
        ],
      },
      { id: "covering-free", status: "Available", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
      { id: "not-covering-free", status: "Available", eveningCoverage: false, practiceArea: "Tech", assignments: [] },
    ];
    const result = autoMatch(candidates, baseContext({ now: WEEKDAY_EVENING }), 1);
    expect(result.projectStatus).toBe("active");
    // Lowest load among the evening-coverage pool, not just lowest load overall
    // (not-covering-free would win on load alone but must never be picked).
    expect(result.assigned.map((r) => r.personId)).toEqual(["covering-free"]);
  });

  it("only goes to the open pool as a last resort — zero evening-coverage volunteers, even after hours", () => {
    const candidates: CandidatePerson[] = [
      { id: "off-1", status: "Available", eveningCoverage: false, practiceArea: "Tech", assignments: [] },
      { id: "off-2", status: "Available", eveningCoverage: false, practiceArea: "Tech", assignments: [] },
    ];
    const result = autoMatch(candidates, baseContext({ now: WEEKDAY_EVENING }), 1);
    expect(result).toEqual({ assigned: [], projectStatus: "open" });
  });

  it("goes open when every evening-coverage volunteer is already fully loaded elsewhere — 'last resort' means no eligible headcount, not no capacity math", () => {
    // isEligible has no load threshold — a "fully loaded" volunteer is still
    // eligible and still gets picked (they just rank low); autoMatch only
    // opens the project when the eligible set itself is empty.
    const candidates: CandidatePerson[] = [{ id: "off", status: "Available", eveningCoverage: false, practiceArea: "Tech", assignments: [] }];
    const result = autoMatch(candidates, baseContext({ now: WEEKDAY_EVENING }), 3);
    expect(result.projectStatus).toBe("open");
    expect(result.assigned).toEqual([]);
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
    ...opts,
  };
}

describe("CHANGE 1 — allocateAcrossAngles: fill without replacement, reuse only on exhaustion", () => {
  it("fills each angle from a disjoint slice of the eligible pool when the pool is large enough — no repeats across angles", () => {
    const pool = [ranked("A"), ranked("B"), ranked("C"), ranked("D")];
    const { perAngle, totalEligible } = allocateAcrossAngles(pool, [
      { key: "a", staffCount: 2 },
      { key: "b", staffCount: 2 },
    ]);
    const a = perAngle.find((p) => p.key === "a")!.picked.map((r) => r.personId);
    const b = perAngle.find((p) => p.key === "b")!.picked.map((r) => r.personId);
    expect(a).toEqual(["A", "B"]);
    expect(b).toEqual(["C", "D"]);
    expect(new Set([...a, ...b]).size).toBe(4); // no overlap
    expect(totalEligible).toBe(4);
  });

  it("reuses already-placed people, least-loaded first, only once the fresh eligible pool is exhausted", () => {
    const pool = [ranked("P1", { load: 5 }), ranked("P2", { load: 0 })];
    const { perAngle } = allocateAcrossAngles(pool, [
      { key: "a", staffCount: 2 },
      { key: "b", staffCount: 2 },
    ]);
    const a = perAngle.find((p) => p.key === "a")!.picked.map((r) => r.personId);
    const b = perAngle.find((p) => p.key === "b")!.picked.map((r) => r.personId);
    expect(a).toEqual(["P1", "P2"]); // fresh pool, ranked order preserved
    // Angle b's fresh pool is exhausted (both already placed on angle a) —
    // reuse kicks in, least-loaded first: P2 (load 0) before P1 (load 5).
    expect(b).toEqual(["P2", "P1"]);
  });

  it("never reuses before the fresh pool is exhausted, even when an unplaced candidate has a much higher load than an already-placed one", () => {
    const pool = [ranked("P1", { load: 0 }), ranked("P2", { load: 100 })];
    const { perAngle } = allocateAcrossAngles(pool, [
      { key: "a", staffCount: 1 },
      { key: "b", staffCount: 1 },
    ]);
    const a = perAngle.find((p) => p.key === "a")!.picked.map((r) => r.personId);
    const b = perAngle.find((p) => p.key === "b")!.picked.map((r) => r.personId);
    expect(a).toEqual(["P1"]);
    // P2 is still unplaced (fresh) for angle b, so it's picked over reusing
    // P1 — "fresh before reuse" beats "lowest load" here.
    expect(b).toEqual(["P2"]);
  });

  it("totalEligible is 0 and projectStatus is open when nobody is eligible, regardless of how many angles are requested", () => {
    const pool = [ranked("A", { eligible: false, ineligibleReason: "no_evening_coverage" })];
    const { perAngle, totalEligible, projectStatus } = allocateAcrossAngles(pool, [
      { key: "a", staffCount: 1 },
      { key: "b", staffCount: 2 },
    ]);
    expect(totalEligible).toBe(0);
    expect(projectStatus).toBe("open");
    expect(perAngle.find((p) => p.key === "a")!.picked).toEqual([]);
    expect(perAngle.find((p) => p.key === "b")!.picked).toEqual([]);
  });

  it("projectStatus is active whenever at least one person is eligible, even if an angle ends up understaffed (Change 4's concern, not this function's)", () => {
    const pool = [ranked("A")];
    const { perAngle, projectStatus } = allocateAcrossAngles(pool, [{ key: "a", staffCount: 3 }]);
    expect(projectStatus).toBe("active");
    expect(perAngle.find((p) => p.key === "a")!.picked.map((r) => r.personId)).toEqual(["A"]);
  });
});

describe("CHANGE 2 — blocksNewFirstDeliverable", () => {
  const onlinePool = "Global" as const; // always weight 1, never asleep

  it("blocks someone holding a First Deliverable Strategy assignment while that pool is online", () => {
    expect(
      blocksNewFirstDeliverable(
        [{ goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: onlinePool, projectType: "Strategy" }],
        10
      )
    ).toBe(true);
  });

  it("blocks someone holding a First Deliverable Due Diligence assignment while that pool is online", () => {
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

  it("does NOT block once the blocking assignment's pool goes offline — reuses the app's existing poolWeight() definition, recomputed live", () => {
    // AUS / NZ / Sing / JP is weight 0 (asleep) at/after 15:00 Dubai.
    expect(
      blocksNewFirstDeliverable(
        [
          {
            goal: 5,
            delivered: 0,
            customDelivered: 0,
            stage: "First Deliverable",
            projectExpertPool: "AUS / NZ / Sing / JP",
            projectType: "Strategy",
          },
        ],
        16 // 16:00 Dubai -- past the 15:00 switch, this pool is asleep
      )
    ).toBe(false);
  });

  it("blocks with that same APAC pool before the 15:00 switch, when it's awake (weight 2)", () => {
    expect(
      blocksNewFirstDeliverable(
        [
          {
            goal: 5,
            delivered: 0,
            customDelivered: 0,
            stage: "First Deliverable",
            projectExpertPool: "AUS / NZ / Sing / JP",
            projectType: "Strategy",
          },
        ],
        10 // before 15:00 -- awake
      )
    ).toBe(true);
  });
});

describe("CHANGE 2 — applyFirstDeliverableBlock: layered on top of rankCandidates(), which stays untouched", () => {
  it("downgrades a formerly-eligible candidate who blocks, tagging the new reason", () => {
    const candidates: CandidatePerson[] = [
      {
        id: "blocked",
        status: "Available",
        eveningCoverage: true,
        practiceArea: "Tech",
        assignments: [
          { goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global", projectType: "Strategy" },
        ],
      },
    ];
    const base = rankCandidates(candidates, baseContext());
    expect(base[0].eligible).toBe(true); // rankCandidates itself is unchanged -- doesn't know about this rule
    const adjusted = applyFirstDeliverableBlock(base, candidates, 10);
    expect(adjusted[0].eligible).toBe(false);
    expect(adjusted[0].ineligibleReason).toBe("first_deliverable_conflict");
  });

  it("leaves an existing Rule 2/3 ineligibility untouched rather than overwriting the reason", () => {
    const candidates: CandidatePerson[] = [
      { id: "offRota", status: "Available", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
    ];
    const base = rankCandidates(candidates, baseContext({ now: SUNDAY_DAYTIME, sundayRotaPersonIds: new Set() }));
    const adjusted = applyFirstDeliverableBlock(base, candidates, 10);
    expect(adjusted[0].ineligibleReason).toBe("not_on_sunday_rota");
  });

  it("re-sorts so a newly-blocked candidate drops after every still-eligible one, preserving relative order within each group", () => {
    const candidates: CandidatePerson[] = [
      {
        id: "blocked",
        status: "Available",
        eveningCoverage: true,
        practiceArea: "Tech",
        assignments: [
          { goal: 5, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global", projectType: "Strategy" },
        ],
      },
      { id: "free1", status: "Available", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
      { id: "free2", status: "Available", eveningCoverage: true, practiceArea: "Tech", assignments: [] },
    ];
    const base = rankCandidates(candidates, baseContext());
    const adjusted = applyFirstDeliverableBlock(base, candidates, 10);
    expect(adjusted[adjusted.length - 1].personId).toBe("blocked");
    expect(adjusted.filter((r) => r.eligible).map((r) => r.personId)).toEqual(["free1", "free2"]);
  });
});
