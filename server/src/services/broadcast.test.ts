import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { listForPerson } from "../repositories/notifications";
import { resetAndSeedFixture, type Fixture } from "../test/fixtures";
import { checkBroadcastRepings } from "./broadcast";

let fx: Fixture;

beforeEach(async () => {
  fx = await resetAndSeedFixture();
});

/** Creates an open (zero-assignment) project with one Pitch/N=0 angle, targeting exactly 1 seat. */
async function createOpenProject(client: string): Promise<{ projectId: string }> {
  const { rows: projectRows } = await pool.query<{ id: string }>(
    `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, status)
     VALUES ($1, $2, 'https://example.test/proj/open', 'Pitch', 'Global', 'open') RETURNING id`,
    [fx.plAlpha, client]
  );
  await pool.query(`INSERT INTO angle (project_id, name, calls_n, goal_total) VALUES ($1, 'Main', 0, 8)`, [
    projectRows[0].id,
  ]);
  return { projectId: projectRows[0].id };
}

describe("CHANGE 3 — checkBroadcastRepings: 15-minute re-ping, derived from existing notification rows (no broadcast table)", () => {
  it("does not re-ping before 15 minutes have passed since the last broadcast", async () => {
    await createOpenProject("Client_ReadyToPing");
    await checkBroadcastRepings(new Date()); // first ping, right now
    const before = await listForPerson(fx.delivererAlpha);
    expect(before.length).toBeGreaterThan(0);

    // A second tick moments later must not spam.
    await checkBroadcastRepings(new Date());
    const after = await listForPerson(fx.delivererAlpha);
    expect(after).toHaveLength(before.length);
  });

  it("re-pings once 15+ minutes have passed since the last broadcast", async () => {
    await createOpenProject("Client_StaleOpen");
    const firstPingAt = new Date();
    await checkBroadcastRepings(firstPingAt);
    const afterFirst = await listForPerson(fx.delivererAlpha);
    expect(afterFirst.length).toBeGreaterThan(0);

    const sixteenMinutesLater = new Date(firstPingAt.getTime() + 16 * 60_000);
    await checkBroadcastRepings(sixteenMinutesLater);
    const afterSecond = await listForPerson(fx.delivererAlpha);
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
  });

  it("stops re-pinging once the project is no longer open (fully staffed)", async () => {
    const { projectId } = await createOpenProject("Client_GetsStaffed");
    await checkBroadcastRepings(new Date());
    const firstCount = (await listForPerson(fx.delivererAlpha)).length;

    // Fully staff it directly (bypassing the claim route -- this test only
    // cares about the re-ping scheduler's own qualifying-set logic).
    await pool.query(`UPDATE project SET status = 'active' WHERE id = $1`, [projectId]);

    const muchLater = new Date(Date.now() + 60 * 60_000);
    await checkBroadcastRepings(muchLater);
    const laterCount = (await listForPerson(fx.delivererAlpha)).length;
    expect(laterCount).toBe(firstCount); // no new pings once it's no longer open
  });
});
