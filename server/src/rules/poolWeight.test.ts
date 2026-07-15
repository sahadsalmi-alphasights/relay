import { describe, expect, it } from "vitest";
import { poolWeight } from "./poolWeight";

describe("poolWeight", () => {
  it("Global is always weight 1, before and after 15:00", () => {
    expect(poolWeight("Global", 9)).toBe(1);
    expect(poolWeight("Global", 15)).toBe(1);
  });

  it("EU & MEA & India is always weight 1, before and after 15:00", () => {
    expect(poolWeight("EU & MEA & India", 9)).toBe(1);
    expect(poolWeight("EU & MEA & India", 15)).toBe(1);
  });

  it("AUS/NZ/Sing/JP is double-weighted before 15:00 (their daytime) and zero after", () => {
    expect(poolWeight("AUS / NZ / Sing / JP", 10)).toBe(2);
    expect(poolWeight("AUS / NZ / Sing / JP", 14)).toBe(2);
    expect(poolWeight("AUS / NZ / Sing / JP", 15)).toBe(0);
    expect(poolWeight("AUS / NZ / Sing / JP", 20)).toBe(0);
  });

  it("US only is the mirror image: zero before 15:00 (asleep), double from 15:00 (awake, urgent)", () => {
    expect(poolWeight("US only", 10)).toBe(0);
    expect(poolWeight("US only", 14)).toBe(0);
    expect(poolWeight("US only", 15)).toBe(2);
    expect(poolWeight("US only", 20)).toBe(2);
  });
});
