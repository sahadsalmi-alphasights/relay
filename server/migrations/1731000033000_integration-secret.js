/**
 * Generic encrypted secret store for integrations (Slack, and any future one).
 *
 * A tiny key/value table: `name` -> encrypted `ciphertext` (produced by
 * secretCrypto — GCP KMS in prod, local AES fallback in dev/test) plus a
 * non-sensitive `hint` (last 4 chars) for display. Only ciphertext is ever
 * stored; the plaintext is never persisted, logged, or returned to a client.
 *
 * Global / owner-managed (like the other settings singletons) — no
 * business_unit column or RLS.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE integration_secret (
      name text PRIMARY KEY,
      ciphertext text NOT NULL,
      hint text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE integration_secret;`);
};
