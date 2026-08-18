import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { deriveInstanceKey, findInstanceByTuple } from "./instances";

afterEach(async () => {
  await pool.query(`DELETE FROM instance WHERE city IS NOT NULL AND city <> 'Dubai'`);
});

describe("instance tuple derivation (Okta-driven, non-breaking for Dubai)", () => {
  it("reuses the existing Dubai instance key rather than creating a new one", async () => {
    // The migration described the seeded Dubai instances with the tuple, so an
    // Okta identity for Dubai NC resolves to the ORIGINAL 'non_consulting' key —
    // existing data/memberships are untouched.
    const key = await deriveInstanceKey("Dubai", "DUB - Non-Consulting", null);
    expect(key).toBe("non_consulting");
    const key2 = await deriveInstanceKey("Dubai", "DUB - Consulting", null);
    expect(key2).toBe("consulting");
  });

  it("auto-creates a new instance for a new office combo (with board)", async () => {
    const key = await deriveInstanceKey("New York", "NY CAP", "Board 11");
    expect(key).toBe("new_york_ny_cap_board_11");
    const row = await findInstanceByTuple("New York", "NY CAP", "Board 11");
    expect(row?.name).toBe("New York · NY CAP · Board 11");
  });

  it("treats different boards in the same office+dept as separate instances", async () => {
    const a = await deriveInstanceKey("New York", "NY CAP", "Board 11");
    const b = await deriveInstanceKey("New York", "NY CAP", "Board 2");
    const none = await deriveInstanceKey("New York", "NY CAP", null);
    expect(new Set([a, b, none]).size).toBe(3);
  });

  it("is idempotent — the same tuple always resolves to the same key", async () => {
    const first = await deriveInstanceKey("London", "LON PE", null);
    const again = await deriveInstanceKey("London", "LON PE", null);
    expect(first).toBe(again);
  });
});
