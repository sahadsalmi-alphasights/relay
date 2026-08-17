/**
 * Multi-BU — make the BU (isolated "instance") a managed registry instead of a
 * hardcoded two-value enum, so an owner can create instances as needed.
 *
 * - New `instance` table: the canonical list of BUs. Seeded with the two that
 *   already exist. `key` is the value stored in every tenant table's
 *   business_unit column (and the RLS GUC); `name` is the display label.
 * - The static CHECK (business_unit IN ('consulting','non_consulting')) is
 *   dropped from all 15 tenant tables so a newly-created instance's key is a
 *   valid value. Integrity is enforced at the app layer (assignments validate
 *   against the instance registry); the column stays NOT NULL with the
 *   active-BU default, and RLS is unchanged.
 *
 * The `instance` registry itself is global (owner-managed, shared across BUs,
 * like settings / role_permission), so it gets NO business_unit column or RLS.
 */
exports.shorthands = undefined;

const TENANT_TABLES = [
  "person", "team", "project", "angle", "assignment", "delivery_round",
  "goal_change_request", "note", "personal_note", "notification",
  "push_subscription", "sunday_rota", "sunday_swap_request", "usage_event", "audit_log",
];

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE instance (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL UNIQUE,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO instance (key, name) VALUES
      ('non_consulting', 'Non-Consulting'),
      ('consulting', 'Consulting');
  `);
  for (const table of TENANT_TABLES) {
    pgm.sql(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_business_unit_check;`);
  }
};

exports.down = (pgm) => {
  for (const table of TENANT_TABLES) {
    pgm.sql(`
      ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_business_unit_check
        CHECK (business_unit IN ('consulting', 'non_consulting'));
    `);
  }
  pgm.sql(`DROP TABLE instance;`);
};
