import { describe, expect, it } from "vitest";
import { mapDepartmentToBu } from "./businessUnit";

describe("mapDepartmentToBu", () => {
  it("maps the two known Okta departments", () => {
    expect(mapDepartmentToBu("DUB - Consulting")).toBe("consulting");
    expect(mapDepartmentToBu("DUB - Non-Consulting")).toBe("non_consulting");
  });

  it("is case- and whitespace-tolerant", () => {
    expect(mapDepartmentToBu("dub - consulting")).toBe("consulting");
    expect(mapDepartmentToBu("  DUB   -   Non-Consulting  ")).toBe("non_consulting");
  });

  it("returns null for missing or unknown departments (caller keeps current BU)", () => {
    expect(mapDepartmentToBu(undefined)).toBeNull();
    expect(mapDepartmentToBu(null)).toBeNull();
    expect(mapDepartmentToBu("")).toBeNull();
    expect(mapDepartmentToBu("DUB - Marketing")).toBeNull();
    expect(mapDepartmentToBu("Consulting")).toBeNull();
  });
});
