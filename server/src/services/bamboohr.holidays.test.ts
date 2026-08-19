import { describe, it, expect } from "vitest";
import { filterHolidaysByLocation } from "./bamboohr";

const feed = [
  { name: "[DUB] Prophet Mohammed's birthday" },
  { name: "London Holiday Closure" },
  { name: "LON Christmas Closure (3 days)" },
  { name: "LON NJ Christmas Closure [3 days]" },
];

describe("filterHolidaysByLocation", () => {
  it("keeps only Dubai closures for the Dubai office", () => {
    const out = filterHolidaysByLocation(feed, "Dubai");
    expect(out.map((h) => h.name)).toEqual(["[DUB] Prophet Mohammed's birthday"]);
  });

  it("keeps London closures (full name and LON abbreviation) for the London office", () => {
    const out = filterHolidaysByLocation(feed, "London");
    expect(out.map((h) => h.name)).toEqual([
      "London Holiday Closure",
      "LON Christmas Closure (3 days)",
      "LON NJ Christmas Closure [3 days]",
    ]);
  });

  it("returns everything when no location is given", () => {
    expect(filterHolidaysByLocation(feed, null)).toHaveLength(4);
    expect(filterHolidaysByLocation(feed, "")).toHaveLength(4);
  });
});
