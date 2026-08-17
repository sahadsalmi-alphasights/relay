import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "./config";
import { pool } from "./db";

/**
 * Proves the Phase 1b BU boundary at the database layer.
 *
 * IMPORTANT: Postgres superusers (and BYPASSRLS roles) ignore RLS entirely, so
 * these assertions run through a dedicated NON-superuser role — the same shape
 * the production app role must have for isolation to be real. The app's own
 * pool in CI/dev connects as a superuser, which is why the full app suite is
 * unaffected by RLS (it's bypassed there) yet current behaviour is preserved.
 */
const RLS_ROLE = "relay_rls_probe";
let rlsPool: Pool;

function nonSuperUrl(): string {
  const u = new URL(config.databaseUrl);
  u.username = RLS_ROLE;
  u.password = RLS_ROLE;
  return u.toString();
}

async function count(p: Pool, bu: string | null, name: string): Promise<number> {
  const c = await p.connect();
  try {
    if (bu) await c.query("SELECT set_config('app.active_bu', $1, false)", [bu]);
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM team WHERE name = $1`, [name]);
    return rows[0].n;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  await pool.query(`DROP OWNED BY ${RLS_ROLE}`).catch(() => {});
  await pool.query(`DROP ROLE IF EXISTS ${RLS_ROLE}`);
  await pool.query(`CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_ROLE}' NOSUPERUSER NOBYPASSRLS`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON team TO ${RLS_ROLE}`);
  rlsPool = new Pool({ connectionString: nonSuperUrl() });
});

afterAll(async () => {
  await rlsPool.end();
  await pool.query(`REVOKE ALL ON team FROM ${RLS_ROLE}`).catch(() => {});
  await pool.query(`REVOKE USAGE ON SCHEMA public FROM ${RLS_ROLE}`).catch(() => {});
  await pool.query(`DROP ROLE IF EXISTS ${RLS_ROLE}`);
});

beforeEach(async () => {
  await pool.query(`DELETE FROM team WHERE name LIKE 'rls_%'`);
});

describe("RLS BU isolation (non-superuser role)", () => {
  it("an unset BU resolves to non_consulting — the live app path is preserved", async () => {
    await pool.query(`INSERT INTO team (name, business_unit) VALUES ('rls_nc', 'non_consulting')`);
    // No set_config at all: coalesce(..., 'non_consulting') means the NC row is
    // still visible even to a non-superuser session that never set the GUC.
    expect(await count(rlsPool, null, "rls_nc")).toBe(1);
  });

  it("a consulting session cannot see non_consulting rows", async () => {
    await pool.query(`INSERT INTO team (name, business_unit) VALUES ('rls_nc', 'non_consulting')`);
    expect(await count(rlsPool, "consulting", "rls_nc")).toBe(0);
    expect(await count(rlsPool, "non_consulting", "rls_nc")).toBe(1);
  });

  it("a write in a consulting session is forced to consulting and stays invisible to NC", async () => {
    const c = await rlsPool.connect();
    try {
      await c.query("SELECT set_config('app.active_bu', 'consulting', false)");
      await c.query(`INSERT INTO team (name) VALUES ('rls_c')`);
      const mine = await c.query(`SELECT business_unit FROM team WHERE name = 'rls_c'`);
      expect(mine.rows[0].business_unit).toBe("consulting");
    } finally {
      c.release();
    }
    // NC session (and the default path) can't see the consulting row.
    expect(await count(rlsPool, "non_consulting", "rls_c")).toBe(0);
    expect(await count(rlsPool, null, "rls_c")).toBe(0);
  });

  it("a consulting session cannot UPDATE or DELETE a non_consulting row", async () => {
    await pool.query(`INSERT INTO team (name, business_unit) VALUES ('rls_nc2', 'non_consulting')`);
    const c = await rlsPool.connect();
    try {
      await c.query("SELECT set_config('app.active_bu', 'consulting', false)");
      const upd = await c.query(`UPDATE team SET name = 'hacked' WHERE name = 'rls_nc2'`);
      expect(upd.rowCount).toBe(0);
      const del = await c.query(`DELETE FROM team WHERE name = 'rls_nc2'`);
      expect(del.rowCount).toBe(0);
    } finally {
      c.release();
    }
    expect(await count(rlsPool, "non_consulting", "rls_nc2")).toBe(1);
  });

  it("a consulting session cannot mislabel a write as non_consulting (WITH CHECK)", async () => {
    const c = await rlsPool.connect();
    try {
      await c.query("SELECT set_config('app.active_bu', 'consulting', false)");
      await expect(
        c.query(`INSERT INTO team (name, business_unit) VALUES ('rls_x', 'non_consulting')`)
      ).rejects.toThrow(/row-level security/i);
    } finally {
      c.release();
    }
  });
});
