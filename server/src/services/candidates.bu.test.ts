import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { setPersonInstances } from "../repositories/instances";
import { resetAndSeedFixture, type Fixture } from "../test/fixtures";
import { listAvailableCandidatesWithAssignments } from "./candidates";

let fx: Fixture;
let dualId: string;

beforeEach(async () => {
  fx = await resetAndSeedFixture();
  // A person who is a member of BOTH instances.
  const { rows } = await pool.query(
    `INSERT INTO person (email, name, status, is_manager, is_owner)
     VALUES ('dual@test.example', 'Dual_Member', 'Available', false, false) RETURNING id`
  );
  dualId = rows[0].id;
  await setPersonInstances(dualId, ["consulting", "non_consulting"]);
});
afterEach(async () => {
  await pool.query(`DELETE FROM person WHERE email = 'dual@test.example'`);
});

describe("candidate pool is BU-isolated by membership", () => {
  it("a Non-Consulting ranking sees NC members and dual members, not C-only", async () => {
    const nc = await listAvailableCandidatesWithAssignments("non_consulting");
    const ids = nc.map((p) => p.id);
    expect(ids).toContain(fx.delivererAlpha); // NC member
    expect(ids).toContain(dualId); // member of both → appears here too
  });

  it("a Consulting ranking sees only Consulting members (the dual member, not NC-only people)", async () => {
    const c = await listAvailableCandidatesWithAssignments("consulting");
    const ids = c.map((p) => p.id);
    expect(ids).toContain(dualId); // member of both → appears here
    expect(ids).not.toContain(fx.delivererAlpha); // NC-only person absent from C
  });
});
