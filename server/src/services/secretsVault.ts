import { pool } from "../db";
import { secretCrypto } from "../crypto/secretCrypto";

/**
 * A small vault over the integration_secret table: stores each secret as
 * ciphertext (encrypted by secretCrypto — GCP KMS in prod) and exposes a
 * safe-to-show hint (last 4). The plaintext only ever exists in memory at the
 * moment it's set or used. Reusable for any integration; Slack uses it, and
 * future ones can too.
 */

export interface SecretHint {
  hasValue: boolean;
  hint: string | null;
}

/** Store (or replace) a secret. Empty/blank plaintext clears it. */
export async function setSecret(name: string, plaintext: string): Promise<void> {
  const value = plaintext.trim();
  if (!value) {
    await clearSecret(name);
    return;
  }
  const ciphertext = await secretCrypto().encrypt(value);
  await pool.query(
    `INSERT INTO integration_secret (name, ciphertext, hint, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, hint = EXCLUDED.hint, updated_at = now()`,
    [name, ciphertext, value.slice(-4)]
  );
}

export async function clearSecret(name: string): Promise<void> {
  await pool.query(`DELETE FROM integration_secret WHERE name = $1`, [name]);
}

/** Decrypt and return a secret, or null if unset. Throws only on a KMS/crypto failure. */
export async function getSecret(name: string): Promise<string | null> {
  const { rows } = await pool.query<{ ciphertext: string }>(
    `SELECT ciphertext FROM integration_secret WHERE name = $1`,
    [name]
  );
  if (!rows[0]) return null;
  return secretCrypto().decrypt(rows[0].ciphertext);
}

/** hints for many secret names at once (for the settings UI). */
export async function getHints(names: string[]): Promise<Record<string, SecretHint>> {
  const { rows } = await pool.query<{ name: string; hint: string | null }>(
    `SELECT name, hint FROM integration_secret WHERE name = ANY($1)`,
    [names]
  );
  const byName = new Map(rows.map((r) => [r.name, r.hint]));
  const out: Record<string, SecretHint> = {};
  for (const n of names) out[n] = { hasValue: byName.has(n), hint: byName.get(n) ?? null };
  return out;
}
