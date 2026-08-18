/**
 * Store the BambooHR credentials in the app (owner pastes them in the
 * Integrations UI) instead of only in env — but NEVER as plaintext.
 *
 * - api_key_ciphertext: the API key encrypted by secretCrypto (GCP KMS in
 *   prod; local AES fallback in dev/test). Only ciphertext is ever stored.
 * - api_key_hint: last 4 chars, so the UI can show "•••• 1a2b" without ever
 *   returning the key.
 * - subdomain: not a secret — stored in the clear.
 *
 * Env vars (BAMBOOHR_API_KEY / BAMBOOHR_SUBDOMAIN) remain a fallback, so
 * nothing breaks until the key is set via the UI.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE hr_integration_settings
      ADD COLUMN api_key_ciphertext text,
      ADD COLUMN api_key_hint text,
      ADD COLUMN subdomain text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE hr_integration_settings
      DROP COLUMN IF EXISTS api_key_ciphertext,
      DROP COLUMN IF EXISTS api_key_hint,
      DROP COLUMN IF EXISTS subdomain;
  `);
};
