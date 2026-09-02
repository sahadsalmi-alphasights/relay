import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { capacityTrend } from "../repositories/capacitySnapshot";
import { recordCapacitySnapshots } from "./capacitySnapshot";
import { resetAndSeedFixture } from "../test/fixtures";

beforeEach(async () => {
  await resetAndSeedFixture();
});

describe("capacity snapshot sweep", () => {
  it("records a daily row per active instance and reads back as a trend", async () => {
    const written = await recordCapacitySnapshots(new Date());
    expect(written).toBeGreaterThan(0);

    const { rows } = await pool.query<{ instance_key: string }>(`SELECT instance_key FROM capacity_snapshot LIMIT 1`);
    const trend = await capacityTrend(rows[0].instance_key, "2000-01-01");
    expect(trend.length).toBeGreaterThan(0);
    expect(trend[0]).toHaveProperty("medianLoad");
    expect(trend[0]).toHaveProperty("people");
  });

  it("is idempotent within a day (upsert, one row per instance)", async () => {
    const now = new Date();
    await recordCapacitySnapshots(now);
    await recordCapacitySnapshots(now);
    // Two runs the same day leave exactly one row per instance (no duplicates).
    const { rows } = await pool.query<{ total: number; distinct: number }>(
      `SELECT count(*)::int AS total, count(DISTINCT instance_key)::int AS distinct FROM capacity_snapshot`
    );
    expect(Number(rows[0].total)).toBe(Number(rows[0].distinct));
  });
});
