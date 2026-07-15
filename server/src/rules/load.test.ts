import { describe, expect, it } from "vitest";
import { assignmentLoad, personLoad, personRawRemaining, progress, remaining } from "./load";

describe("remaining — §5c", () => {
  it("subtracts both delivered and customDelivered from goal", () => {
    expect(remaining({ goal: 10, delivered: 3, customDelivered: 2 })).toBe(5);
  });

  it("counts a custom (outside-system) profile exactly like a regular one toward the goal", () => {
    // 6 delivered via custom sourcing only, same goal, same result as 6 regular deliveries.
    expect(remaining({ goal: 6, delivered: 0, customDelivered: 6 })).toBe(
      remaining({ goal: 6, delivered: 6, customDelivered: 0 })
    );
  });

  it("floors at zero — over-delivering never produces a negative remainder", () => {
    expect(remaining({ goal: 4, delivered: 3, customDelivered: 3 })).toBe(0);
  });
});

describe("progress — §5c", () => {
  it("is the delivered+custom fraction of goal", () => {
    expect(progress({ goal: 8, delivered: 2, customDelivered: 2 })).toBe(0.5);
  });

  it("is 0 for a goal of 0 rather than dividing by zero", () => {
    expect(progress({ goal: 0, delivered: 0, customDelivered: 0 })).toBe(0);
  });
});

describe("personRawRemaining — §5d", () => {
  it("sums unweighted remaining() across all assignments, ignoring stage and pool entirely", () => {
    const raw = personRawRemaining([
      { goal: 6, delivered: 2, customDelivered: 0 }, // remaining 4
      { goal: 4, delivered: 4, customDelivered: 0 }, // remaining 0
    ]);
    expect(raw).toBe(4);
  });

  it("bug fix — excludes a no-calls Pitch's remaining profiles, consistent with the load model", () => {
    const raw = personRawRemaining([
      { goal: 8, delivered: 0, customDelivered: 0, projectType: "Pitch", projectCallsN: 0 }, // remaining 8, excluded
    ]);
    expect(raw).toBe(0);
  });

  it("bug fix — a person whose only work is a no-calls Pitch has zero raw remaining, mixed in with real work", () => {
    const raw = personRawRemaining([
      { goal: 8, delivered: 0, customDelivered: 0, projectType: "Pitch", projectCallsN: 0 }, // excluded
      { goal: 6, delivered: 2, customDelivered: 0, projectType: "Strategy", projectCallsN: 3 }, // remaining 4, counted
    ]);
    expect(raw).toBe(4);
  });

  it("a converted Pitch (callsN > 0) counts normally again", () => {
    const raw = personRawRemaining([
      { goal: 8, delivered: 0, customDelivered: 0, projectType: "Pitch", projectCallsN: 3 },
    ]);
    expect(raw).toBe(8);
  });
});

describe("assignmentLoad / personLoad — §5c", () => {
  it("Selling stage always contributes 0 load regardless of remaining work", () => {
    const load = assignmentLoad(
      { goal: 10, delivered: 0, customDelivered: 0, stage: "Selling", projectExpertPool: "Global" },
      10
    );
    expect(load).toBe(0);
  });

  it("First Deliverable weighs double Second Deliverable for the same remaining work and pool", () => {
    const base = { goal: 10, delivered: 0, customDelivered: 0, projectExpertPool: "Global" as const };
    const first = assignmentLoad({ ...base, stage: "First Deliverable" }, 10);
    const second = assignmentLoad({ ...base, stage: "Second Deliverable" }, 10);
    expect(first).toBe(20);
    expect(second).toBe(10);
    expect(first).toBe(second * 2);
  });

  it("a US-only goal contributes 0 load before 15:00 Dubai and double after", () => {
    const a = {
      goal: 5,
      delivered: 0,
      customDelivered: 0,
      stage: "First Deliverable" as const,
      projectExpertPool: "US only" as const,
    };
    expect(assignmentLoad(a, 10)).toBe(0); // US asleep — can't convert, load reads as free
    expect(assignmentLoad(a, 15)).toBe(20); // US awake — remaining(5) * stage(2) * pool(2)
  });

  it("§5c (domain change 4) — a no-calls Pitch (callsN=0) pins load at a flat 1, regardless of remaining profiles", () => {
    const huge = assignmentLoad(
      {
        goal: 100,
        delivered: 0,
        customDelivered: 0,
        stage: "First Deliverable",
        projectExpertPool: "US only",
        projectType: "Pitch",
        projectCallsN: 0,
      },
      15 // US pool live, would otherwise double-weight this
    );
    const nearlyDone = assignmentLoad(
      {
        goal: 100,
        delivered: 99,
        customDelivered: 0,
        stage: "First Deliverable",
        projectExpertPool: "US only",
        projectType: "Pitch",
        projectCallsN: 0,
      },
      15
    );
    expect(huge).toBe(1);
    expect(nearlyDone).toBe(1); // "regardless of profiles remaining" -- not scaled down as it nears completion either
  });

  it("§5c (domain change 4) — a Pitch converts to normal load the moment callsN > 0", () => {
    const stillPitchNoCalls = assignmentLoad(
      { goal: 8, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global", projectType: "Pitch", projectCallsN: 0 },
      10
    );
    const convertedPitch = assignmentLoad(
      { goal: 8, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global", projectType: "Pitch", projectCallsN: 3 },
      10
    );
    expect(stillPitchNoCalls).toBe(1);
    // Once N > 0 it's normal remaining * stage * pool math, same as Strategy would give.
    expect(convertedPitch).toBe(8 * 2 * 1);
  });

  it("personLoad sums weighted load across every assignment a person holds", () => {
    const total = personLoad(
      [
        { goal: 4, delivered: 0, customDelivered: 0, stage: "First Deliverable", projectExpertPool: "Global" }, // 4*2*1=8
        { goal: 4, delivered: 4, customDelivered: 0, stage: "Hail Mary", projectExpertPool: "Global" }, // remaining 0
        { goal: 2, delivered: 0, customDelivered: 0, stage: "Second Deliverable", projectExpertPool: "US only" }, // asleep at hour 10 -> 0
      ],
      10
    );
    expect(total).toBe(8);
  });
});
