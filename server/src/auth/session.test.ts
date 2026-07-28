import { describe, expect, it } from "vitest";
import { ABSOLUTE_TTL_MS, decodeSession, encodeSession, IDLE_TTL_MS } from "./plugin";

const PERSON_ID = "3056eeda-6a64-43f8-a953-9c06ac10ef75";

describe("session encode/decode", () => {
  it("round-trips a fresh session (id + version)", () => {
    const now = 1_784_800_000_000;
    const decoded = decodeSession(encodeSession(PERSON_ID, 3, now), now);
    expect(decoded?.personId).toBe(PERSON_ID);
    expect(decoded?.version).toBe(3);
  });

  it("enforces the absolute cap as a hard ceiling", () => {
    const login = 1_784_800_000_000;
    const abs = login + ABSOLUTE_TTL_MS;
    // A cookie re-issued 1s before the cap (idle window clamped to abs):
    const value = encodeSession(PERSON_ID, 0, abs - 1000, abs);
    expect(decodeSession(value, abs - 1)?.personId).toBe(PERSON_ID);
    // …dead at/after the absolute cap, no matter what the browser was told.
    expect(decodeSession(value, abs)).toBeNull();
    expect(decodeSession(value, abs + 1)).toBeNull();
  });

  it("enforces the idle timeout independently of the absolute cap", () => {
    const now = 1_784_800_000_000;
    const value = encodeSession(PERSON_ID, 0, now);
    // Still inside the (shorter) idle window…
    expect(decodeSession(value, now + IDLE_TTL_MS - 1)?.personId).toBe(PERSON_ID);
    // …idle window elapsed, even though the absolute cap is far off.
    expect(decodeSession(value, now + IDLE_TTL_MS)).toBeNull();
    expect(decodeSession(value, now + IDLE_TTL_MS + 1)).toBeNull();
  });

  it("preserves a fixed absolute expiry across a sliding re-issue", () => {
    const login = 1_784_800_000_000;
    const abs = login + ABSOLUTE_TTL_MS;
    // Re-issued deep into the session, carrying the original absolute expiry.
    const reissued = encodeSession(PERSON_ID, 0, login + IDLE_TTL_MS - 1, abs);
    expect(decodeSession(reissued, login + IDLE_TTL_MS - 1)?.absExpiresAt).toBe(abs);
    // The re-issue can't push the session past its original absolute cap.
    expect(decodeSession(reissued, abs)).toBeNull();
  });

  it("rejects old-format cookies (bare id / single-expiry)", () => {
    expect(decodeSession(PERSON_ID)).toBeNull();
    expect(decodeSession(`${PERSON_ID}.${Date.now() + 1000}`)).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(decodeSession(`${PERSON_ID}.0.abc.${Date.now() + 1000}`)).toBeNull();
    expect(decodeSession(`${PERSON_ID}.0.`)).toBeNull();
    expect(decodeSession("")).toBeNull();
  });
});
