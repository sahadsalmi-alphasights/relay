import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../db";
import type { DirectoryPerson } from "./bamboohr";

// Mock the BambooHR client so the import runs against a scripted directory.
vi.mock("./bamboohr", () => ({ fetchDirectory: vi.fn() }));
import { fetchDirectory } from "./bamboohr";
import { applyImport, previewImport } from "./instanceImport";

const dir = (rows: Partial<DirectoryPerson>[]): DirectoryPerson[] =>
  rows.map((r, i) => ({ employeeId: String(i + 1), email: "", name: "", location: null, department: null, ...r }));

const SAMPLE = dir([
  { email: "kai@x.test", name: "Kai", location: "Dubai", department: "DUB - Consulting" }, // existing person, existing instance
  { email: "new1@x.test", name: "New One", location: "London", department: "LON - PE" }, // new user, new instance
  { email: "new2@x.test", name: "New Two", location: "London", department: "LON - PE" }, // new user, same new instance
  { email: "", name: "No Email", location: "London", department: "LON - PE" }, // skipped — no email
  { email: "notuple@x.test", name: "No Office", location: null, department: null }, // skipped — no tuple
]);

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
  (fetchDirectory as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE);
});
afterEach(() => vi.clearAllMocks());

describe("BambooHR instance/user import (same tuple derivation as Okta)", () => {
  it("previews without writing anything", async () => {
    const before = await pool.query(`SELECT count(*)::int n FROM person`);
    const p = await previewImport();
    expect(p.ok).toBe(true);
    expect(p.totalEmployees).toBe(5);
    expect(p.withTuple).toBe(3);
    expect(p.skippedNoEmail).toBe(1);
    expect(p.skippedNoTuple).toBe(1);
    expect(p.newInstances).toBe(1);
    expect(p.existingInstances).toBe(1);
    expect(p.matchedUsers).toBe(1);
    expect(p.newUsers).toBe(2);
    // Read-only: no rows added.
    const after = await pool.query(`SELECT count(*)::int n FROM person`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("applies: creates the new instance + users and assigns memberships", async () => {
    const r = await applyImport(actorId);
    expect(r.ok).toBe(true);
    expect(r.instancesCreated).toBe(1);
    expect(r.instancesTotal).toBe(2);
    expect(r.usersCreated).toBe(2);
    expect(r.usersReassigned).toBe(0); // kai's derived key equals his current home

    const inst = await pool.query(`SELECT key, city, department FROM instance WHERE key = 'london_lon_pe'`);
    expect(inst.rows[0]).toMatchObject({ city: "London", department: "LON - PE" });

    // New users are members of the London instance via the home trigger.
    const members = await pool.query(
      `SELECT p.email FROM person p JOIN person_instance pi ON pi.person_id = p.id
       WHERE pi.instance_key = 'london_lon_pe' ORDER BY p.email`
    );
    expect(members.rows.map((x) => x.email)).toEqual(["new1@x.test", "new2@x.test"]);
  });

  it("is idempotent — a second run creates nothing new", async () => {
    await applyImport(actorId);
    const r2 = await applyImport(actorId);
    expect(r2.instancesCreated).toBe(0);
    expect(r2.usersCreated).toBe(0);
    expect(r2.usersReassigned).toBe(0);
  });

  it("surfaces a BambooHR outage as an error, writing nothing", async () => {
    (fetchDirectory as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const p = await previewImport();
    expect(p.ok).toBe(false);
    const r = await applyImport(actorId);
    expect(r.ok).toBe(false);
  });
});
