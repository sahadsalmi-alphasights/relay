import { pool } from "../db";

export interface InstanceRow {
  id: string;
  key: string;
  name: string;
}

/**
 * The BU registry — the canonical list of isolated instances. Global (not
 * BU-scoped): owners manage it, and it's the source of truth the user-BU
 * assignment validates against.
 */
export async function listInstances(): Promise<InstanceRow[]> {
  const { rows } = await pool.query(`SELECT id, key, name FROM instance ORDER BY name`);
  return rows;
}

export async function findInstanceByKey(key: string): Promise<InstanceRow | null> {
  const { rows } = await pool.query(`SELECT id, key, name FROM instance WHERE key = $1`, [key]);
  return rows[0] ?? null;
}

/**
 * Derive a stable key from a display name: lowercase, non-alphanumeric runs
 * collapse to a single underscore, trimmed. "Non-Consulting" → "non_consulting".
 */
export function slugifyInstanceKey(name: string): string {
  // Split on runs of non-alphanumerics and rejoin — avoids anchored `_+$`
  // trimming (a polynomial-ReDoS shape) while dropping leading/trailing/blank
  // segments naturally. "Non-Consulting" → "non_consulting".
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("_");
}

/** Create an instance from a display name. Throws on a duplicate key (unique). */
export async function createInstance(name: string): Promise<InstanceRow> {
  const key = slugifyInstanceKey(name);
  const { rows } = await pool.query(
    `INSERT INTO instance (key, name) VALUES ($1, $2) RETURNING id, key, name`,
    [key, name.trim()]
  );
  return rows[0];
}

/** True when at least one person is a member of this instance key. */
export async function instanceHasMembers(key: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM person_instance WHERE instance_key = $1 LIMIT 1`, [key]);
  return rows.length > 0;
}

/** The instance keys a person is a member of. */
export async function listInstanceKeysForPerson(personId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT instance_key FROM person_instance WHERE person_id = $1 ORDER BY instance_key`,
    [personId]
  );
  return rows.map((r) => r.instance_key as string);
}

/**
 * Replace a person's instance memberships with exactly `keys` (deduped). All
 * keys must exist in the registry — validated by the caller. Runs in one
 * transaction so the set is never left partial.
 */
export async function setPersonInstances(personId: string, keys: string[]): Promise<void> {
  const unique = [...new Set(keys)];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM person_instance WHERE person_id = $1`, [personId]);
    for (const key of unique) {
      await client.query(
        `INSERT INTO person_instance (person_id, instance_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [personId, key]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** instance keys for many people at once → { personId: keys[] } (admin roster). */
export async function instanceKeysByPerson(): Promise<Map<string, string[]>> {
  const { rows } = await pool.query(
    `SELECT person_id, array_agg(instance_key ORDER BY instance_key) AS keys FROM person_instance GROUP BY person_id`
  );
  return new Map(rows.map((r) => [r.person_id as string, r.keys as string[]]));
}
