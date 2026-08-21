import { describe, expect, it } from "vitest";
import { interpretWriteProbe } from "./bamboohr";

describe("interpretWriteProbe — BambooHR time-off write capability", () => {
  it("403 → read-only, cannot book", () => {
    const r = interpretWriteProbe(403);
    expect(r.canWrite).toBe(false);
    expect(r.detail).toMatch(/read-only/i);
  });

  it("400 / 409 / 422 → authorized to write (validation rejected the probe)", () => {
    for (const s of [400, 409, 422]) {
      expect(interpretWriteProbe(s).canWrite).toBe(true);
    }
  });

  it("200 / 201 → write authorized", () => {
    expect(interpretWriteProbe(200).canWrite).toBe(true);
    expect(interpretWriteProbe(201).canWrite).toBe(true);
  });

  it("401 (bad key) and 404 (no endpoint/access) → not writable", () => {
    expect(interpretWriteProbe(401).canWrite).toBe(false);
    expect(interpretWriteProbe(404).canWrite).toBe(false);
  });

  it("unexpected status → not confirmed writable", () => {
    expect(interpretWriteProbe(500).canWrite).toBe(false);
  });
});
