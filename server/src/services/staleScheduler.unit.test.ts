import { describe, expect, it } from "vitest";
import { thresholdLabel } from "./staleScheduler";

describe("thresholdLabel", () => {
  it("reports whole hours only — never a fractional hour (the 15.5833+ hours bug)", () => {
    // The "next morning 9am" ladder step lands on an arbitrary minute.
    expect(thresholdLabel(935)).toBe("15+ hours");
    expect(thresholdLabel(61)).toBe("1+ hour");
    expect(thresholdLabel(119)).toBe("1+ hour");
    expect(thresholdLabel(120)).toBe("2+ hours");
    // No decimal point ever slips through for any in-range value.
    for (let m = 60; m < 24 * 60; m += 7) {
      expect(thresholdLabel(m)).not.toContain(".");
    }
  });

  it("keeps the sub-hour and since-yesterday branches", () => {
    expect(thresholdLabel(30)).toBe("30+ minutes");
    expect(thresholdLabel(24 * 60)).toBe("since yesterday");
  });
});
