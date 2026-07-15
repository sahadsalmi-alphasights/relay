import { describe, expect, it } from "vitest";
import { median } from "./median";

describe("median", () => {
  it("averages the two middle values for an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns the middle value for an odd-length list", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("returns 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });
});
