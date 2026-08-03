import { describe, expect, it } from "vitest";
import { emailsOnLeave, matchesLeaveType } from "./hrLeaveSync";
import type { TimeOffRequest } from "./bamboohr";

describe("matchesLeaveType", () => {
  it("matches case-insensitively by substring against the keyword list", () => {
    expect(matchesLeaveType("Vacation", "vacation,sick")).toBe(true);
    expect(matchesLeaveType("Paid Sick Leave", "vacation,sick")).toBe(true);
    expect(matchesLeaveType("SICK", "vacation, sick")).toBe(true);
    expect(matchesLeaveType("Annual Leave", "vacation,sick")).toBe(false);
    expect(matchesLeaveType("Work From Home", "vacation,sick")).toBe(false);
  });

  it("honours custom keywords and ignores blanks/whitespace", () => {
    expect(matchesLeaveType("Annual Leave", "annual")).toBe(true);
    expect(matchesLeaveType("Vacation", " , ,vacation, ")).toBe(true);
    expect(matchesLeaveType("Vacation", "")).toBe(false);
  });
});

describe("emailsOnLeave", () => {
  const directory = new Map<string, string>([
    ["1", "ana@example.test"],
    ["2", "ben@example.test"],
    ["3", "cara@example.test"],
  ]);
  const reqs: TimeOffRequest[] = [
    { employeeId: "1", typeName: "Vacation", start: "2026-08-02", end: "2026-08-05" },
    { employeeId: "2", typeName: "Bereavement", start: "2026-08-02", end: "2026-08-02" }, // non-matching type
    { employeeId: "3", typeName: "Sick", start: "2026-08-02", end: "2026-08-02" },
    { employeeId: "9", typeName: "Sick", start: "2026-08-02", end: "2026-08-02" }, // not in directory
  ];

  it("returns only emails of people on a matching leave type, resolvable in the directory", () => {
    const out = emailsOnLeave(reqs, directory, "vacation,sick");
    expect(out).toEqual(new Set(["ana@example.test", "cara@example.test"]));
  });

  it("returns an empty set when nothing matches", () => {
    expect(emailsOnLeave(reqs, directory, "jury duty").size).toBe(0);
  });
});
