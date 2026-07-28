/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Enterprise hardening (2026-07-28) — audit-log tamper-evidence under a
// least-privilege runtime DB role (docs/SECURITY_CONFIGURATION.md §21).
//
// The runtime app role is granted INSERT + SELECT on audit_log ONLY — no
// UPDATE / DELETE / TRUNCATE — so a SQL-exec bug or a compromised app can
// never rewrite or erase history. The one legitimate mutation the app makes
// is nulling actor_id when a person is hard-deleted (GDPR-style
// de-identification, repositories/people.ts). That goes through this
// SECURITY DEFINER function, owned by the schema owner, so it keeps working
// even when the app role itself lacks UPDATE on the table.
//
// SECURITY DEFINER hygiene: search_path is pinned so the function can't be
// hijacked by a caller-controlled path, and EXECUTE is revoked from PUBLIC
// (the deploy runbook grants it to the app role explicitly).
exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION audit_log_anonymize_actor(p_actor uuid)
      RETURNS void
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
    AS $$
      UPDATE audit_log SET actor_id = NULL WHERE actor_id = p_actor;
    $$;
    REVOKE ALL ON FUNCTION audit_log_anonymize_actor(uuid) FROM PUBLIC;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS audit_log_anonymize_actor(uuid);`);
};
