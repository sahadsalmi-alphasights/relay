import { describe, expect, it } from "vitest";
import { isEligible } from "./eligibility";

// Reference instants (all UTC "Z", so results are independent of host tz):
//  - WEEKDAY_DAYTIME: Monday 10:00 Dubai — no evening rule in play.
//  - WEEKDAY_EVENING: Monday 20:00 Dubai — evening rule in play.
//  - SUNDAY_DAYTIME:  Sunday 10:00 Dubai — the Sunday rota rule was removed,
//    so a Sunday behaves exactly like any weekday now.
const WEEKDAY_DAYTIME = new Date("2023-01-02T06:00:00Z");
const WEEKDAY_EVENING = new Date("2023-01-02T16:00:00Z");
const SUNDAY_DAYTIME = new Date("2023-01-01T06:00:00Z");
const SUNDAY_EVENING = new Date("2023-01-01T16:00:00Z");

describe("isEligible — status", () => {
  it("excludes Sick, On vacation, and Offline regardless of day or hour", () => {
    for (const status of ["Sick", "On vacation", "Offline"] as const) {
      const result = isEligible({ id: "p1", status, eveningCoverage: true }, { now: WEEKDAY_DAYTIME });
      expect(result).toEqual({ eligible: false, reason: "not_available" });
    }
  });

  it("allows Available people through this rule", () => {
    const result = isEligible({ id: "p1", status: "Available", eveningCoverage: true }, { now: WEEKDAY_DAYTIME });
    expect(result).toEqual({ eligible: true });
  });
});

describe("isEligible — Sunday rota rule removed (2026-07-23)", () => {
  it("does NOT exclude an Available person on Sunday — Sunday is just another day now", () => {
    const result = isEligible({ id: "p1", status: "Available", eveningCoverage: true }, { now: SUNDAY_DAYTIME });
    expect(result).toEqual({ eligible: true });
  });

  it("still applies the evening rule on a Sunday after hours", () => {
    const result = isEligible({ id: "p1", status: "Available", eveningCoverage: false }, { now: SUNDAY_EVENING });
    expect(result).toEqual({ eligible: false, reason: "no_evening_coverage" });
  });
});

describe("isEligible — evening coverage (a live self-serve toggle)", () => {
  it("is irrelevant during the working day, even with the toggle off", () => {
    const result = isEligible({ id: "p1", status: "Available", eveningCoverage: false }, { now: WEEKDAY_DAYTIME });
    expect(result).toEqual({ eligible: true });
  });

  it("excludes an Available person after hours if their toggle is off", () => {
    const result = isEligible({ id: "p1", status: "Available", eveningCoverage: false }, { now: WEEKDAY_EVENING });
    expect(result).toEqual({ eligible: false, reason: "no_evening_coverage" });
  });

  it("allows an Available person after hours if their toggle is on", () => {
    const result = isEligible({ id: "p1", status: "Available", eveningCoverage: true }, { now: WEEKDAY_EVENING });
    expect(result).toEqual({ eligible: true });
  });
});
