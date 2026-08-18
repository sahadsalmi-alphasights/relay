/**
 * Multi-BU — an isolated instance is a (city, department, board?) tuple,
 * derived from Okta (city / department / whiteboard_number).
 *
 * Non-breaking by construction: the two existing Dubai instances keep their
 * current keys ('non_consulting' / 'consulting') and all existing data stays
 * tagged with those keys untouched. We only ADD descriptive columns and point
 * them at the Dubai tuple, so the Okta derivation matches them BY TUPLE and
 * reuses the same key — current users' data never moves. New offices get a
 * fresh tuple-slug key auto-created on first login.
 *
 * The partial unique index enforces one instance per populated tuple (treating
 * a null board as a single value) while leaving any name-only manual instances
 * (null city/department) unconstrained.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE instance
      ADD COLUMN city text,
      ADD COLUMN department text,
      ADD COLUMN board text;

    UPDATE instance SET city = 'Dubai', department = 'DUB - Non-Consulting', name = 'Dubai · DUB - Non-Consulting'
      WHERE key = 'non_consulting';
    UPDATE instance SET city = 'Dubai', department = 'DUB - Consulting', name = 'Dubai · DUB - Consulting'
      WHERE key = 'consulting';

    CREATE UNIQUE INDEX instance_tuple_idx
      ON instance (city, department, COALESCE(board, ''))
      WHERE city IS NOT NULL AND department IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS instance_tuple_idx;
    UPDATE instance SET name = 'Non-Consulting' WHERE key = 'non_consulting';
    UPDATE instance SET name = 'Consulting' WHERE key = 'consulting';
    ALTER TABLE instance DROP COLUMN city, DROP COLUMN department, DROP COLUMN board;
  `);
};
