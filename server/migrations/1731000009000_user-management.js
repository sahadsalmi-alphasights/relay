/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// User management / roles. Adds an OWNER tier above the existing team
// `is_manager` flag, a login timestamp for the admin portal, and a
// deactivation marker so access can be revoked without deleting history.
//
//   role(person) = is_owner ? 'owner' : is_manager ? 'manager' : 'member'
//
// is_manager is left untouched so every existing team-scoped rule keeps
// working; owner is a pure superset enforced in rules/permissions.ts.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE person
      ADD COLUMN is_owner boolean NOT NULL DEFAULT false,
      ADD COLUMN last_login_at timestamptz,
      ADD COLUMN deactivated_at timestamptz;

    CREATE INDEX idx_person_is_owner ON person(is_owner) WHERE is_owner;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_person_is_owner;
    ALTER TABLE person
      DROP COLUMN is_owner,
      DROP COLUMN last_login_at,
      DROP COLUMN deactivated_at;
  `);
};
