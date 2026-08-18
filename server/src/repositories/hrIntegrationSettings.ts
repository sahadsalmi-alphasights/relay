import { pool } from "../db";

/**
 * BambooHR leave-sync settings (singleton row, mirrors coverage/notification
 * settings). The API key + subdomain are NOT here — they live in env. Only the
 * owner-editable knobs and the last-run status persist.
 */
export interface HrIntegrationSettings {
  enabled: boolean;
  /** Comma-separated BambooHR time-off type keywords matched case-insensitively (substring). */
  leaveTypeKeywords: string;
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
}

const SELECT = `
  SELECT enabled,
         leave_type_keywords AS "leaveTypeKeywords",
         last_sync_at        AS "lastSyncAt",
         last_sync_summary   AS "lastSyncSummary"
  FROM hr_integration_settings WHERE id = 1`;

export async function getHrIntegrationSettings(): Promise<HrIntegrationSettings> {
  const { rows } = await pool.query<HrIntegrationSettings>(SELECT);
  return rows[0];
}

/** Only these two fields are owner-editable (mass-assignment guard). */
const COLUMN: Record<"enabled" | "leaveTypeKeywords", string> = {
  enabled: "enabled",
  leaveTypeKeywords: "leave_type_keywords",
};

export type HrIntegrationSettingsPatch = Partial<Pick<HrIntegrationSettings, "enabled" | "leaveTypeKeywords">>;

export async function updateHrIntegrationSettings(fields: HrIntegrationSettingsPatch): Promise<HrIntegrationSettings> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of Object.keys(COLUMN) as (keyof typeof COLUMN)[]) {
    const v = fields[key];
    if (v !== undefined) {
      vals.push(v);
      sets.push(`${COLUMN[key]} = $${vals.length}`);
    }
  }
  if (sets.length > 0) {
    await pool.query(`UPDATE hr_integration_settings SET ${sets.join(", ")}, updated_at = now() WHERE id = 1`, vals);
  }
  return getHrIntegrationSettings();
}

/** Record the outcome of a sync run (shown in the settings panel). */
export async function recordHrSync(summary: string): Promise<void> {
  await pool.query(`UPDATE hr_integration_settings SET last_sync_at = now(), last_sync_summary = $1 WHERE id = 1`, [
    summary,
  ]);
}

// ---- Encrypted BambooHR credentials (pasted in the UI) ---------------------

/** Raw stored credential material — internal to the BambooHR service. */
export async function getHrStoredCredentials(): Promise<{ apiKeyCiphertext: string | null; subdomain: string | null }> {
  const { rows } = await pool.query<{ apiKeyCiphertext: string | null; subdomain: string | null }>(
    `SELECT api_key_ciphertext AS "apiKeyCiphertext", subdomain FROM hr_integration_settings WHERE id = 1`
  );
  return rows[0] ?? { apiKeyCiphertext: null, subdomain: null };
}

/** A safe-to-show hint (last 4) — the key itself is never returned to a client. */
export async function getHrCredentialHint(): Promise<{ hasKey: boolean; hint: string | null; subdomain: string | null }> {
  const { rows } = await pool.query<{ apiKeyCiphertext: string | null; hint: string | null; subdomain: string | null }>(
    `SELECT api_key_ciphertext AS "apiKeyCiphertext", api_key_hint AS hint, subdomain FROM hr_integration_settings WHERE id = 1`
  );
  const r = rows[0];
  return { hasKey: !!r?.apiKeyCiphertext, hint: r?.hint ?? null, subdomain: r?.subdomain ?? null };
}

/** Store the encrypted API key + its hint. Ciphertext is produced by the caller (secretCrypto). */
export async function setHrApiKey(ciphertext: string, hint: string): Promise<void> {
  await pool.query(
    `UPDATE hr_integration_settings SET api_key_ciphertext = $1, api_key_hint = $2, updated_at = now() WHERE id = 1`,
    [ciphertext, hint]
  );
}

/** Clear the stored key (revert to env fallback / disable). */
export async function clearHrApiKey(): Promise<void> {
  await pool.query(
    `UPDATE hr_integration_settings SET api_key_ciphertext = NULL, api_key_hint = NULL, updated_at = now() WHERE id = 1`
  );
}

export async function setHrSubdomain(subdomain: string): Promise<void> {
  await pool.query(`UPDATE hr_integration_settings SET subdomain = $1, updated_at = now() WHERE id = 1`, [subdomain]);
}
