import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { resetAndSeedFixture, type Fixture } from "../test/fixtures";
import { listAvailableCandidatesWithAssignments } from "./candidates";

let fx: Fixture;
let consultingId: string;

beforeEach(async () => {
  fx = await resetAndSeedFixture();
  // A Consulting-BU person in the same shape the pool would otherwise pick up.
  const { rows } = await pool.query(
    `INSERT INTO person (email, name, status, is_manager, is_owner, business_unit)
     VALUES ('c.deliverer@test.example', 'C_Deliverer', 'Available', false, false, 'consulting')
     RETURNING id`
  );
  consultingId = rows[0].id;
});
afterEach(async () => {
  await pool.query(`DELETE FROM person WHERE email = 'c.deliverer@test.example'`);
});

describe("candidate pool is BU-isolated (capacity calc never mixes BUs)", () => {
  it("a Non-Consulting ranking excludes Consulting people", async () => {
    const nc = await listAvailableCandidatesWithAssignments("non_consulting");
    const ids = nc.map((p) => p.id);
    expect(ids).toContain(fx.delivererAlpha); // NC person present
    expect(ids).not.toContain(consultingId); // C person absent
  });

  it("a Consulting ranking excludes Non-Consulting people", async () => {
    const c = await listAvailableCandidatesWithAssignments("consulting");
    const ids = c.map((p) => p.id);
    expect(ids).toContain(consultingId);
    expect(ids).not.toContain(fx.delivererAlpha);
  });
});
