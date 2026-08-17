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
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

/** True when at least one person is assigned to this instance key. */
export async function instanceHasMembers(key: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM person WHERE business_unit = $1 LIMIT 1`, [key]);
  return rows.length > 0;
}
