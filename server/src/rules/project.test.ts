import { describe, expect, it } from "vitest";
import { isProjectLifecycleQuiet, needsCallsSoldUpdateToday, needsChaseClient, shouldWarnOnStatusChange } from "./project";

describe("needsChaseClient — §8.1 (corrected)", () => {
  it("flags when profiles have been delivered but not all calls have sold", () => {
    expect(needsChaseClient(6, 1, 2)).toBe(true);
  });

  it("does not flag when nothing has been delivered yet, even if no calls sold", () => {
    expect(needsChaseClient(0, 0, 2)).toBe(false);
  });

  it("does not flag once every call has sold", () => {
    expect(needsChaseClient(6, 2, 2)).toBe(false);
  });

  it("is not a numeric comparison between delivered profiles and calls_n — high delivered, fully sold is still fine", () => {
    expect(needsChaseClient(20, 2, 2)).toBe(false);
  });
});

describe("needsCallsSoldUpdateToday — §8.1 (manual for now, phase-two: auto-populated)", () => {
  it("flags a project whose calls_sold was last touched yesterday", () => {
    const now = new Date("2026-07-13T10:00:00Z"); // 14:00 Dubai
    const yesterday = new Date("2026-07-12T10:00:00Z");
    expect(needsCallsSoldUpdateToday(yesterday, now)).toBe(true);
  });

  it("does not flag a project already touched earlier today", () => {
    const now = new Date("2026-07-13T10:00:00Z"); // 14:00 Dubai
    const earlierToday = new Date("2026-07-13T02:00:00Z"); // 06:00 Dubai, same Dubai calendar day
    expect(needsCallsSoldUpdateToday(earlierToday, now)).toBe(false);
  });

  it("compares Asia/Dubai calendar days, not UTC days — a late-UTC-night update still counts as today Dubai-side", () => {
    // 23:30 UTC on the 12th is 03:30 Dubai on the 13th — same Dubai day as `now`.
    const now = new Date("2026-07-13T10:00:00Z");
    const lateUtcPrevDay = new Date("2026-07-12T23:30:00Z");
    expect(needsCallsSoldUpdateToday(lateUtcPrevDay, now)).toBe(false);
  });
});

describe("isProjectLifecycleQuiet — project lifecycle change", () => {
  it("is quiet for idle and archived", () => {
    expect(isProjectLifecycleQuiet("idle")).toBe(true);
    expect(isProjectLifecycleQuiet("archived")).toBe(true);
  });

  it("is not quiet for active or open", () => {
    expect(isProjectLifecycleQuiet("active")).toBe(false);
    expect(isProjectLifecycleQuiet("open")).toBe(false);
  });
});

describe("shouldWarnOnStatusChange — §7b", () => {
  it("warns when moving someone with outstanding profiles to a non-Available status", () => {
    expect(shouldWarnOnStatusChange("Sick", 4)).toBe(true);
    expect(shouldWarnOnStatusChange("On vacation", 1)).toBe(true);
    expect(shouldWarnOnStatusChange("Offline", 1)).toBe(true);
  });

  it("does not warn when the person has no outstanding profiles", () => {
    expect(shouldWarnOnStatusChange("Sick", 0)).toBe(false);
  });

  it("does not warn when the new status is Available", () => {
    expect(shouldWarnOnStatusChange("Available", 5)).toBe(false);
  });
});
