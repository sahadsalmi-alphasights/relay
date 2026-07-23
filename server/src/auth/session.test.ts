import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession, SESSION_TTL_MS } from "./plugin";

const PERSON_ID = "3056eeda-6a64-43f8-a953-9c06ac10ef75";

describe("session encode/decode", () => {
  it("round-trips a fresh session", () => {
    const now = 1_784_800_000_000;
    expect(decodeSession(encodeSession(PERSON_ID, now), now)).toBe(PERSON_ID);
  });

  it("embeds the TTL so expiry survives cookie-attribute tampering", () => {
    const now = 1_784_800_000_000;
    const value = encodeSession(PERSON_ID, now);
    // Valid right up to the TTL boundary...
    expect(decodeSession(value, now + SESSION_TTL_MS - 1)).toBe(PERSON_ID);
    // ...and dead at/after it, no matter what maxAge the browser was told.
    expect(decodeSession(value, now + SESSION_TTL_MS)).toBeNull();
    expect(decodeSession(value, now + SESSION_TTL_MS + 1)).toBeNull();
  });

  it("rejects the pre-expiry cookie format (bare person id)", () => {
    expect(decodeSession(PERSON_ID)).toBeNull();
  });

  it("rejects malformed expiry payloads", () => {
    expect(decodeSession(`${PERSON_ID}.`)).toBeNull();
    expect(decodeSession(`${PERSON_ID}.not-a-number`)).toBeNull();
    expect(decodeSession(`.${Date.now() + 1000}`)).toBeNull();
    expect(decodeSession("")).toBeNull();
  });
});
