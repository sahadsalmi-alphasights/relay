import { describe, expect, it } from "vitest";
import { dubaiDateKey, dubaiHour, isAfterHours, isSunday } from "./time";

// All instants given as UTC ("Z") so results never depend on the host
// machine's local timezone. Asia/Dubai is a fixed UTC+4, no DST.

describe("dubaiHour", () => {
  it("shifts UTC to Dubai wall-clock hour", () => {
    expect(dubaiHour(new Date("2023-01-01T00:00:00Z"))).toBe(4);
    expect(dubaiHour(new Date("2023-01-01T20:00:00Z"))).toBe(0); // rolls into next Dubai day
  });
});

describe("isAfterHours", () => {
  it("is false at exactly 08:00 Dubai (the working day start)", () => {
    expect(isAfterHours(new Date("2023-01-01T04:00:00Z"))).toBe(false);
  });

  it("is true one second before 08:00 Dubai", () => {
    expect(isAfterHours(new Date("2023-01-01T03:59:59Z"))).toBe(true);
  });

  it("is true at exactly 19:00 Dubai (after hours starts)", () => {
    expect(isAfterHours(new Date("2023-01-01T15:00:00Z"))).toBe(true);
  });

  it("is false one second before 19:00 Dubai", () => {
    expect(isAfterHours(new Date("2023-01-01T14:59:59Z"))).toBe(false);
  });
});

describe("isSunday", () => {
  // 2023-01-01 is a known Sunday.
  it("is true at exactly Dubai midnight Sunday", () => {
    expect(isSunday(new Date("2022-12-31T20:00:00Z"))).toBe(true);
  });

  it("is false one second before Dubai midnight Sunday (still Saturday)", () => {
    expect(isSunday(new Date("2022-12-31T19:59:59Z"))).toBe(false);
  });

  it("is true one second before Dubai midnight Monday (still Sunday)", () => {
    expect(isSunday(new Date("2023-01-01T19:59:59Z"))).toBe(true);
  });

  it("is false at exactly Dubai midnight Monday", () => {
    expect(isSunday(new Date("2023-01-01T20:00:00Z"))).toBe(false);
  });
});

describe("dubaiDateKey", () => {
  it("returns the Dubai calendar date, which can differ from the UTC date", () => {
    expect(dubaiDateKey(new Date("2022-12-31T20:00:00Z"))).toBe("2023-01-01");
    expect(dubaiDateKey(new Date("2022-12-31T19:59:59Z"))).toBe("2022-12-31");
  });
});
