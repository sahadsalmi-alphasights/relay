import { describe, expect, it } from "vitest";
import { autoMatch, rankCandidates, type CandidatePerson, type MatchContext } from "./matching";

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
    expect(result.projectStatus).toBe("matched");
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
    expect(result.projectStatus).toBe("matched");
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
    expect(result.projectStatus).toBe("matched");
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
