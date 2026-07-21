/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Expert pool moves to the ANGLE level (2026-07-21): different angles of the
// same project can target different pools/timezones. Backfilled from the
// project's pool, so nothing changes for existing data. project.expert_pool
// stays as the default for new angles and as a display fallback — load and
// broadcast calculations now read the angle's own pool.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE angle ADD COLUMN expert_pool text;
    UPDATE angle a SET expert_pool = p.expert_pool FROM project p WHERE p.id = a.project_id;
    ALTER TABLE angle ALTER COLUMN expert_pool SET NOT NULL;
    ALTER TABLE angle ALTER COLUMN expert_pool SET DEFAULT 'Global';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE angle DROP COLUMN expert_pool;`);
};
