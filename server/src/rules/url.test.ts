import { describe, expect, it } from "vitest";
import { isValidHttpUrl } from "./url";

describe("isValidHttpUrl — §3 project_link validation (bug fix)", () => {
  it("accepts http and https URLs", () => {
    expect(isValidHttpUrl("https://example.test/proj/123")).toBe(true);
    expect(isValidHttpUrl("http://internal.example.test/x")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidHttpUrl("")).toBe(false);
  });

  it("rejects garbage that isn't a URL at all", () => {
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("example.test/proj/123")).toBe(false); // no scheme
  });

  it("rejects non-http(s) schemes", () => {
    expect(isValidHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isValidHttpUrl("mailto:someone@example.test")).toBe(false);
    expect(isValidHttpUrl("ftp://example.test/file")).toBe(false);
  });
});
