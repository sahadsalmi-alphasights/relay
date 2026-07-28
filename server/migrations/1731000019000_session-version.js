/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Server-side session revocation (2026-07-28) — SECURITY_CONFIGURATION §21.
//
// Each issued session cookie embeds the person's session_version at login.
// Every request re-checks it against this column; bumping the column (logout
// everywhere, deactivation, suspected compromise) invalidates ALL of that
// person's outstanding cookies instantly — closing the "logout only clears
// the local cookie; a stolen value lived the full 7 days" gap.
//
// Additive column, default 0 — no backfill, no lock of consequence, existing
// sessions (version 0) keep working until their idle/absolute expiry.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE person ADD COLUMN session_version integer NOT NULL DEFAULT 0;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE person DROP COLUMN session_version;`);
};
