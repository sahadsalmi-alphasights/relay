import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { resetAndSeedFixture, type Fixture } from "../test/fixtures";
import { checkAdminAutoArchive } from "./adminAutoArchive";

let fx: Fixture;

beforeEach(async () => {
  fx = await resetAndSeedFixture();
});

/**
 * Create a project with one angle and one assignment per (delivererId, stage,
 * daysInStage), returning the project id. daysInStage back-dates stage_entered_at.
 */
async function seedProject(
  plId: string,
  client: string,
  assignments: { delivererId: string; stage: string; daysInStage: number }[]
): Promise<string> {
  const { rows: pr } = await pool.query<{ id: string }>(
    `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
     VALUES ($1, $2, 'https://example.test/x', 'Strategy', 'Global', 'active') RETURNING id`,
    [plId, client]
  );
  const projectId = pr[0].id;
  const { rows: ar } = await pool.query<{ id: string }>(
    `INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 3, 9) RETURNING id`,
    [projectId]
  );
  const angleId = ar[0].id;
  for (const a of assignments) {
    await pool.query(
      `INSERT INTO assignment (angle_id, deliverer_id, goal, custom_goal, stage, stage_entered_at)
       VALUES ($1, $2, 3, 0, $3, now() - ($4 || ' days')::interval)`,
      [angleId, a.delivererId, a.stage, a.daysInStage]
    );
  }
  return projectId;
}

async function isDeliveryClosed(projectId: string): Promise<boolean> {
  const { rows } = await pool.query<{ closed: boolean }>(
    `SELECT (delivery_closed_at IS NOT NULL) AS closed FROM project WHERE id = $1`,
    [projectId]
  );
  return rows[0].closed;
}

describe("admin auto-archive (idle-in-Selling → close delivery)", () => {
  it("closes delivery when every assignment has been in Selling past the threshold", async () => {
    const id = await seedProject(fx.plAlpha, "StaleAdmin", [
      { delivererId: fx.delivererAlpha, stage: "Selling", daysInStage: 8 },
      { delivererId: fx.otherDelivererAlpha, stage: "Selling", daysInStage: 6 }, // most recent, still past 5
    ]);

    const n = await checkAdminAutoArchive(new Date());

    expect(n).toBe(1);
    expect(await isDeliveryClosed(id)).toBe(true);
    // Audited as a system action, distinct from a manual close.
    const { rows } = await pool.query(
      `SELECT actor_id, action FROM audit_log WHERE entity_id = $1 AND action = 'close_delivery_auto'`,
      [id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBeNull();
  });

  it("leaves a project alone while the most recent Selling entry is under the threshold", async () => {
    const id = await seedProject(fx.plAlpha, "FreshAdmin", [
      { delivererId: fx.delivererAlpha, stage: "Selling", daysInStage: 6 },
      { delivererId: fx.otherDelivererAlpha, stage: "Selling", daysInStage: 2 }, // recent → keep
    ]);

    expect(await checkAdminAutoArchive(new Date())).toBe(0);
    expect(await isDeliveryClosed(id)).toBe(false);
  });

  it("leaves a project alone when any assignment is still in a delivering stage", async () => {
    const id = await seedProject(fx.plAlpha, "MixedStage", [
      { delivererId: fx.delivererAlpha, stage: "Selling", daysInStage: 9 },
      { delivererId: fx.otherDelivererAlpha, stage: "First Deliverable", daysInStage: 9 },
    ]);

    expect(await checkAdminAutoArchive(new Date())).toBe(0);
    expect(await isDeliveryClosed(id)).toBe(false);
  });

  it("respects a custom threshold", async () => {
    const id = await seedProject(fx.plAlpha, "TenDayThreshold", [
      { delivererId: fx.delivererAlpha, stage: "Selling", daysInStage: 6 },
    ]);

    expect(await checkAdminAutoArchive(new Date(), 10)).toBe(0); // 6d < 10d
    expect(await isDeliveryClosed(id)).toBe(false);
    expect(await checkAdminAutoArchive(new Date(), 5)).toBe(1); // 6d >= 5d
    expect(await isDeliveryClosed(id)).toBe(true);
  });

  it("is idempotent — an already-closed project is not re-processed", async () => {
    const id = await seedProject(fx.plAlpha, "AlreadyClosed", [
      { delivererId: fx.delivererAlpha, stage: "Selling", daysInStage: 8 },
    ]);
    expect(await checkAdminAutoArchive(new Date())).toBe(1);
    expect(await checkAdminAutoArchive(new Date())).toBe(0); // second tick: nothing left
    const { rows } = await pool.query(
      `SELECT count(*)::int AS c FROM audit_log WHERE entity_id = $1 AND action = 'close_delivery_auto'`,
      [id]
    );
    expect(rows[0].c).toBe(1);
  });
});
