import { describe, expect, it } from "vitest";
import { computeCustomGoal, suggestGoal, suggestStaffing } from "./suggestedGoal";

describe("suggestGoal — §5a (Strategy, and a Pitch once N > 0 -- same math)", () => {
  it("uses the small multiplier (x3) at and below the small-calls threshold", () => {
    expect(suggestGoal(1, "Strategy")).toBe(3);
    expect(suggestGoal(2, "Strategy")).toBe(6); // spec's worked example: 2 calls -> 6 profiles
  });

  it("uses the large multiplier (x2) above the threshold", () => {
    expect(suggestGoal(3, "Strategy")).toBe(6);
    expect(suggestGoal(4, "Strategy")).toBe(8);
  });

  it("a Pitch that has converted (N > 0) uses identical math to Strategy", () => {
    expect(suggestGoal(2, "Pitch")).toBe(suggestGoal(2, "Strategy"));
    expect(suggestGoal(5, "Pitch")).toBe(suggestGoal(5, "Strategy"));
  });
});

describe("suggestGoal — §5a (domain change 4): Pitch at N=0", () => {
  it("suggests a flat default of 8, not sized off calls at all", () => {
    expect(suggestGoal(0, "Pitch")).toBe(8);
  });
});

describe("suggestGoal — §5a (domain change 4): Due Diligence", () => {
  it("is always N * 3, regardless of N's size -- no small/large split like Strategy", () => {
    expect(suggestGoal(1, "Due Diligence")).toBe(3);
    expect(suggestGoal(2, "Due Diligence")).toBe(6);
    expect(suggestGoal(10, "Due Diligence")).toBe(30);
  });

  it("is intentionally heavier than Strategy at the same N above the small-calls threshold", () => {
    expect(suggestGoal(10, "Due Diligence")).toBeGreaterThan(suggestGoal(10, "Strategy"));
    expect(suggestGoal(10, "Due Diligence")).toBe(30);
    expect(suggestGoal(10, "Strategy")).toBe(20);
  });
});

describe("suggestStaffing — §5b (Strategy, and a Pitch once N > 0) (bug fix)", () => {
  it("N=1 gets exactly one deliverer", () => {
    expect(suggestStaffing(1, "Strategy")).toEqual({ delivererCount: 1 });
  });

  it("N=2 gets two deliverers, NOT one -- this was the bug (ceil(2/2)=1 is wrong here)", () => {
    expect(suggestStaffing(2, "Strategy")).toEqual({ delivererCount: 2 });
  });

  it("N>=3 gets one deliverer per 2 calls, rounded up", () => {
    expect(suggestStaffing(3, "Strategy")).toEqual({ delivererCount: 2 });
    expect(suggestStaffing(4, "Strategy")).toEqual({ delivererCount: 2 });
    expect(suggestStaffing(5, "Strategy")).toEqual({ delivererCount: 3 });
  });
});

describe("suggestStaffing — §5b (domain change 4): Pitch at N=0 and Due Diligence", () => {
  it("a no-calls Pitch staffs exactly 1 deliverer", () => {
    expect(suggestStaffing(0, "Pitch")).toEqual({ delivererCount: 1 });
  });

  it("Due Diligence uses the same N=1/N=2/N>=3 staffing rule as Strategy", () => {
    expect(suggestStaffing(1, "Due Diligence")).toEqual({ delivererCount: 1 });
    expect(suggestStaffing(2, "Due Diligence")).toEqual({ delivererCount: 2 });
    expect(suggestStaffing(3, "Due Diligence")).toEqual({ delivererCount: 2 });
    // Worked example from the spec: N=10 -> 5 deliverers (30 profiles / 5 = 6 each).
    expect(suggestStaffing(10, "Due Diligence")).toEqual({ delivererCount: 5 });
    expect(suggestStaffing(10, "Due Diligence")).toEqual(suggestStaffing(10, "Strategy"));
  });
});

describe("computeCustomGoal — §5 (domain change 7): always derived, never set by hand", () => {
  it("is 0 when goal is 0 or 1 — too small to carve out a custom share", () => {
    expect(computeCustomGoal(0)).toBe(0);
    expect(computeCustomGoal(1)).toBe(0);
  });

  it("matches the spec's own worked example: a goal of 10 implies ~4 custom", () => {
    expect(computeCustomGoal(10)).toBe(4);
  });

  it("rounds up (never down) the 33% share", () => {
    expect(computeCustomGoal(3)).toBe(1); // 0.99 -> 1
    expect(computeCustomGoal(4)).toBe(2); // 1.32 -> 2
    expect(computeCustomGoal(6)).toBe(2); // 1.98 -> 2
  });

  it("is never less than 1 once goal is above the threshold, even for small goals", () => {
    expect(computeCustomGoal(2)).toBe(1); // 0.66 -> ceil 1, and MAX(...,1) keeps it at 1
  });

  it("is part of the goal, not additional to it — same delivered target either way", () => {
    // This is a documentation-style check: custom_goal never changes what the
    // rules engine treats as the assignment's total (goal alone), only how
    // much of that total is expected to come from custom sourcing.
    const goal = 10;
    expect(computeCustomGoal(goal)).toBeLessThan(goal);
  });
});
