import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { findOrCreatePersonByEmail, findPersonById, setPersonBusinessUnit } from "./people";

const EMAIL = "bu.probe@test.example";

beforeEach(async () => {
  await pool.query(`DELETE FROM person WHERE email = $1`, [EMAIL]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM person WHERE email = $1`, [EMAIL]);
});

describe("person business_unit", () => {
  it("a new person defaults to non_consulting and PersonRow exposes it", async () => {
    const p = await findOrCreatePersonByEmail(EMAIL, "BU Probe");
    expect(p.businessUnit).toBe("non_consulting");
  });

  it("setPersonBusinessUnit moves a person to consulting", async () => {
    const p = await findOrCreatePersonByEmail(EMAIL, "BU Probe");
    await setPersonBusinessUnit(p.id, "consulting");
    const after = await findPersonById(p.id);
    expect(after?.businessUnit).toBe("consulting");
  });
});
