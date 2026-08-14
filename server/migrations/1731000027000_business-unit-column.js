/**
 * Multi-BU foundation (Phase 1a) — tag every tenant row with a business_unit.
 *
 * This is the data-model half of BU isolation: a `business_unit` column on
 * every table that holds per-BU data, so later phases can scope reads/writes
 * (and enforce Postgres row-level security) to one BU. Deliberately does NOT
 * enable RLS yet and changes NO behaviour — the column defaults to
 * 'non_consulting', which backfills every existing row (the whole live app is
 * the Non-Consulting BU today), so production is byte-for-byte unchanged until
 * the enforcement + Okta-routing phases land.
 *
 * Value set is a CHECK (not a pg enum) so it's easy to extend later. Settings
 * singletons (coverage/notification/hr_integration) are intentionally left out
 * here — they become per-BU in the settings phase, which needs its own PK
 * change, not a plain column add.
 */
exports.shorthands = undefined;

const TENANT_TABLES = [
  "person",
  "team",
  "project",
  "angle",
  "assignment",
  "delivery_round",
  "goal_change_request",
  "note",
  "personal_note",
  "notification",
  "push_subscription",
  "sunday_rota",
  "sunday_swap_request",
  "usage_event",
  "audit_log",
];

exports.up = (pgm) => {
  for (const table of TENANT_TABLES) {
    pgm.sql(`
      ALTER TABLE ${table}
        ADD COLUMN business_unit text NOT NULL DEFAULT 'non_consulting'
        CHECK (business_unit IN ('consulting', 'non_consulting'));
      CREATE INDEX ${table}_business_unit_idx ON ${table} (business_unit);
    `);
  }
};

exports.down = (pgm) => {
  for (const table of TENANT_TABLES) {
    pgm.sql(`
      DROP INDEX IF EXISTS ${table}_business_unit_idx;
      ALTER TABLE ${table} DROP COLUMN IF EXISTS business_unit;
    `);
  }
};
