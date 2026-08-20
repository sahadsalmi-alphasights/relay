import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db";
import { applyImport, previewImport, type DirectoryPerson } from "./instanceImport";

const dir = (rows: Partial<DirectoryPerson>[]): DirectoryPerson[] =>
  rows.map((r, i) => ({ employeeId: String(i + 1), email: "", name: "", location: null, department: null, board: null, ...r }));

const SAMPLE = dir([
  { email: "kai@x.test", name: "Kai", location: "Dubai", department: "DUB - Consulting" }, // allowed, existing instance
  { email: "new1@x.test", name: "New One", location: "London", department: "LON PE", board: "Board 3" }, // allowed, board-specific instance
  { email: "new2@x.test", name: "New Two", location: "London", department: "LON PE", board: "Board 3" }, // allowed, same board instance
  { email: "", name: "No Email", location: "London", department: "LON PE" }, // skipped — no email
  { email: "notuple@x.test", name: "No Office", location: null, department: null }, // skipped — no tuple
  { email: "offlist@x.test", name: "Off List", location: "London", department: "Technology and Strategy" }, // skipped — not on the allowlist
]);

// Directory sources passed to the (source-agnostic) importer.
const source = async () => SAMPLE;
const outage = async () => null;

let actorId: string;
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE person, audit_log RESTART IDENTITY CASCADE`);
  // Remove any London instance a prior run created so instance state is clean.
  await pool.query(`DELETE FROM instance WHERE key = 'london_lon_pe'`);
  // An existing Dubai Consulting user (home = 'non_consulting' after the swap)
  // that also serves as the audit actor.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO person (email, name, business_unit) VALUES ('kai@x.test', 'Kai', 'non_consulting') RETURNING id`
  );
  actorId = rows[0].id;
});

describe("directory instance/user import (Okta tuple derivation)", () => {
  it("previews without writing anything", async () => {
    const before = await pool.query(`SELECT count(*)::int n FROM person`);
    const p = await previewImport(source);
    expect(p.ok).toBe(true);
    expect(p.totalEmployees).toBe(6);
    expect(p.withTuple).toBe(3); // off-list + no-email + no-tuple all excluded
    expect(p.skippedNoEmail).toBe(1);
    expect(p.skippedNoTuple).toBe(1);
    expect(p.skippedNotAllowed).toBe(1); // London · Technology and Strategy is off-list
    expect(p.newInstances).toBe(1);
    expect(p.existingInstances).toBe(1);
    expect(p.matchedUsers).toBe(1);
    expect(p.newUsers).toBe(2);
    expect(p.withBoard).toBe(2); // the two London people carry a board
    // Read-only: no rows added.
    const after = await pool.query(`SELECT count(*)::int n FROM person`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("instances-only (default): creates the instance but feeds NO users", async () => {
    const before = await pool.query(`SELECT count(*)::int n FROM person`);
    const r = await applyImport(actorId, source); // default instancesOnly = true
    expect(r.ok).toBe(true);
    expect(r.instancesCreated).toBe(1);
    expect(r.instancesTotal).toBe(2);
    expect(r.usersCreated).toBe(0);
    expect(r.usersReassigned).toBe(0);

    const inst = await pool.query(`SELECT city, department, board FROM instance WHERE key = 'london_lon_pe'`);
    expect(inst.rows[0]).toMatchObject({ city: "London", department: "LON PE", board: null }); // board ignored for now
    // No new people created.
    const after = await pool.query(`SELECT count(*)::int n FROM person`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("with instancesOnly=false: also creates users and assigns memberships", async () => {
    const r = await applyImport(actorId, source, { instancesOnly: false });
    expect(r.usersCreated).toBe(2);
    expect(r.usersReassigned).toBe(0); // kai's derived key equals his current home

    const members = await pool.query(
      `SELECT p.email FROM person p JOIN person_instance pi ON pi.person_id = p.id
       WHERE pi.instance_key = 'london_lon_pe' ORDER BY p.email`
    );
    expect(members.rows.map((x) => x.email)).toEqual(["new1@x.test", "new2@x.test"]);
  });

  it("is idempotent — a second run creates nothing new", async () => {
    await applyImport(actorId, source);
    const r2 = await applyImport(actorId, source);
    expect(r2.instancesCreated).toBe(0);
    expect(r2.usersCreated).toBe(0);
    expect(r2.usersReassigned).toBe(0);
  });

  it("surfaces a directory outage as an error, writing nothing", async () => {
    const p = await previewImport(outage);
    expect(p.ok).toBe(false);
    const r = await applyImport(actorId, outage);
    expect(r.ok).toBe(false);
  });
});
