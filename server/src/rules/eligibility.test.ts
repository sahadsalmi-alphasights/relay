import { describe, expect, it } from "vitest";
import { isEligible } from "./eligibility";

// Reference instants (all UTC "Z", so results are independent of host tz):
//  - WEEKDAY_DAYTIME: Monday 10:00 Dubai — no rota or evening rule in play.
//  - SUNDAY_DAYTIME:  Sunday 10:00 Dubai — Rule 2 in play, Rule 3 is not.
//  - WEEKDAY_EVENING: Monday 20:00 Dubai — Rule 3 in play, Rule 2 is not.
//  - SUNDAY_EVENING:  Sunday 20:00 Dubai — both Rule 2 and Rule 3 in play.
const WEEKDAY_DAYTIME = new Date("2023-01-02T06:00:00Z");
const SUNDAY_DAYTIME = new Date("2023-01-01T06:00:00Z");
const WEEKDAY_EVENING = new Date("2023-01-02T16:00:00Z");
const SUNDAY_EVENING = new Date("2023-01-01T16:00:00Z");

const NOBODY_ON_ROTA = new Set<string>();

describe("isEligible — Rule 1 (status)", () => {
  it("excludes Sick, On vacation, and Offline regardless of day or hour", () => {
    for (const status of ["Sick", "On vacation", "Offline"] as const) {
      const result = isEligible(
        { id: "p1", status, eveningCoverage: true },
        { now: WEEKDAY_DAYTIME, sundayRotaPersonIds: NOBODY_ON_ROTA }
      );
      expect(result).toEqual({ eligible: false, reason: "not_available" });
    }
  });

  it("allows Available people through this rule", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: true },
      { now: WEEKDAY_DAYTIME, sundayRotaPersonIds: NOBODY_ON_ROTA }
    );
    expect(result).toEqual({ eligible: true });
  });
});

describe("isEligible — Rule 2 (Sunday rota, a schedule not a preference)", () => {
  it("is irrelevant on a non-Sunday, even if the person is on nobody's rota", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: true },
      { now: WEEKDAY_DAYTIME, sundayRotaPersonIds: NOBODY_ON_ROTA }
    );
    expect(result).toEqual({ eligible: true });
  });

  it("excludes an Available person on Sunday if they are not on that date's rota", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: true },
      { now: SUNDAY_DAYTIME, sundayRotaPersonIds: NOBODY_ON_ROTA }
    );
    expect(result).toEqual({ eligible: false, reason: "not_on_sunday_rota" });
  });

  it("allows an Available person on Sunday if they are rostered for that date", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: true },
      { now: SUNDAY_DAYTIME, sundayRotaPersonIds: new Set(["p1"]) }
    );
    expect(result).toEqual({ eligible: true });
  });
});

describe("isEligible — Rule 3 (evening coverage, a live self-serve toggle)", () => {
  it("is irrelevant during the working day, even with the toggle off", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: false },
      { now: WEEKDAY_DAYTIME, sundayRotaPersonIds: NOBODY_ON_ROTA }
    );
    expect(result).toEqual({ eligible: true });
  });

  it("excludes an Available person after hours if their toggle is off", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: false },
      { now: WEEKDAY_EVENING, sundayRotaPersonIds: NOBODY_ON_ROTA }
    );
    expect(result).toEqual({ eligible: false, reason: "no_evening_coverage" });
  });

  it("allows an Available person after hours if their toggle is on", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: true },
      { now: WEEKDAY_EVENING, sundayRotaPersonIds: NOBODY_ON_ROTA }
    );
    expect(result).toEqual({ eligible: true });
  });
});

describe("isEligible — Rules 2 and 3 stack independently (do not conflate them)", () => {
  it("fails on evening coverage even though the Sunday rota requirement is satisfied", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: false },
      { now: SUNDAY_EVENING, sundayRotaPersonIds: new Set(["p1"]) }
    );
    expect(result).toEqual({ eligible: false, reason: "no_evening_coverage" });
  });

  it("fails on Sunday rota even though evening coverage is satisfied", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: true },
      { now: SUNDAY_EVENING, sundayRotaPersonIds: NOBODY_ON_ROTA }
    );
    expect(result).toEqual({ eligible: false, reason: "not_on_sunday_rota" });
  });

  it("passes only when both are satisfied at once", () => {
    const result = isEligible(
      { id: "p1", status: "Available", eveningCoverage: true },
      { now: SUNDAY_EVENING, sundayRotaPersonIds: new Set(["p1"]) }
    );
    expect(result).toEqual({ eligible: true });
  });
});
