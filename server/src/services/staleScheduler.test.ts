import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { listForPerson } from "../repositories/notifications";
import { resetAndSeedFixture, type Fixture } from "../test/fixtures";
import { checkStaleAssignments } from "./staleScheduler";

let fx: Fixture;

beforeEach(async () => {
  fx = await resetAndSeedFixture();
});

/** Backdates both the stage entry and last-progress timestamps, simulating an assignment idle for `minutesAgo`. */
async function backdate(assignmentId: string, minutesAgo: number): Promise<void> {
  await pool.query(
    `UPDATE assignment
     SET stage_entered_at = now() - ($2 || ' minutes')::interval,
         progress_updated_at = now() - ($2 || ' minutes')::interval
     WHERE id = $1`,
    [assignmentId, minutesAgo]
  );
}

describe("§9 (built) — stale-first-deliverable scheduler: notify once, then again only at a further threshold", () => {
  it("does not fire before 30 minutes idle", async () => {
    await backdate(fx.assignment, 29);
    await checkStaleAssignments(new Date());
    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(0);
    expect(await listForPerson(fx.plAlpha)).toHaveLength(0);
  });

  it("fires exactly once at 30+ minutes, notifying both the deliverer and the PL", async () => {
    await backdate(fx.assignment, 31);
    await checkStaleAssignments(new Date());

    const delivererNotifs = await listForPerson(fx.delivererAlpha);
    const plNotifs = await listForPerson(fx.plAlpha);
    expect(delivererNotifs).toHaveLength(1);
    expect(delivererNotifs[0].type).toBe("stale_first_deliverable");
    expect(plNotifs).toHaveLength(1);
    expect(plNotifs[0].type).toBe("stale_first_deliverable");
  });

  it("does not repeat the same 30-min notification on a later tick with no new elapsed time", async () => {
    await backdate(fx.assignment, 31);
    await checkStaleAssignments(new Date());
    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(1);

    // A second tick moments later, nothing changed -- must not spam.
    await checkStaleAssignments(new Date());
    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(1);
  });

  it("does not fire again while still under the next threshold (60 min)", async () => {
    await backdate(fx.assignment, 31);
    await checkStaleAssignments(new Date());
    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(1);

    await backdate(fx.assignment, 45);
    await checkStaleAssignments(new Date());
    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(1); // still just the one
  });

  it("fires again once it crosses the next threshold (60 min) -- exactly one more notification", async () => {
    await backdate(fx.assignment, 31);
    await checkStaleAssignments(new Date());
    await backdate(fx.assignment, 61);
    await checkStaleAssignments(new Date());

    const delivererNotifs = await listForPerson(fx.delivererAlpha);
    expect(delivererNotifs).toHaveLength(2);
  });

  it("logging progress resets the clock -- no longer stale even past 30 minutes", async () => {
    await backdate(fx.assignment, 45);
    await pool.query(
      `UPDATE assignment SET delivered = delivered + 1, progress_updated_at = now() WHERE id = $1`,
      [fx.assignment]
    );
    await checkStaleAssignments(new Date());
    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(0);
  });

  it("does not consider assignments outside First Deliverable, however long idle", async () => {
    await pool.query(`UPDATE assignment SET stage = 'Second Deliverable' WHERE id = $1`, [fx.assignment]);
    await backdate(fx.assignment, 120);
    await checkStaleAssignments(new Date());
    expect(await listForPerson(fx.delivererAlpha)).toHaveLength(0);
  });
});
