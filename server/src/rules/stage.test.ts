import { describe, expect, it } from "vitest";
import { advanceStage, backStage, canAdvanceStage, canBackStage, earliestStage, stageBand } from "./stage";

describe("stage ordering — §6", () => {
  it("advances through the full sequence", () => {
    expect(advanceStage("First Deliverable")).toBe("Second Deliverable");
    expect(advanceStage("Second Deliverable")).toBe("Hail Mary");
    expect(advanceStage("Hail Mary")).toBe("Selling");
  });

  it("cannot advance past Selling", () => {
    expect(canAdvanceStage("Selling")).toBe(false);
    expect(() => advanceStage("Selling")).toThrow();
  });

  it("goes back through the full sequence (mis-click recovery)", () => {
    expect(backStage("Selling")).toBe("Hail Mary");
    expect(backStage("Hail Mary")).toBe("Second Deliverable");
    expect(backStage("Second Deliverable")).toBe("First Deliverable");
  });

  it("cannot go back before First Deliverable — there is no 'Not Started' stage", () => {
    expect(canBackStage("First Deliverable")).toBe(false);
    expect(() => backStage("First Deliverable")).toThrow();
  });
});

describe("earliestStage — §3/§8 (domain change 8): stage is per-deliverer, project shows the earliest", () => {
  it("returns the earliest stage among a mix, regardless of input order", () => {
    expect(earliestStage(["Second Deliverable", "First Deliverable", "Hail Mary"])).toBe("First Deliverable");
    expect(earliestStage(["Selling", "Hail Mary"])).toBe("Hail Mary");
  });

  it("returns that single stage when only one assignment exists", () => {
    expect(earliestStage(["Selling"])).toBe("Selling");
  });

  it("returns null for a project with no assignments yet (the open pool)", () => {
    expect(earliestStage([])).toBeNull();
  });

  it("is unaffected by duplicates — several deliverers on the same stage", () => {
    expect(earliestStage(["Second Deliverable", "Second Deliverable", "First Deliverable"])).toBe("First Deliverable");
  });
});

describe("stageBand — §6 elapsed-timer color banding", () => {
  it("is green under 30 minutes", () => {
    expect(stageBand(0)).toBe("green");
    expect(stageBand(29)).toBe("green");
  });

  it("is amber from 30 up to (not including) 60 minutes", () => {
    expect(stageBand(30)).toBe("amber");
    expect(stageBand(59)).toBe("amber");
  });

  it("is red at 60 minutes and beyond", () => {
    expect(stageBand(60)).toBe("red");
    expect(stageBand(500)).toBe("red");
  });
});
