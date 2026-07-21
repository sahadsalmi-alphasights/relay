/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Expert pool per ANGLE (2026-07-21): different angles of the same project
// can target different pools/timezones. NULL means "inherit the project's
// pool, live" — every consumer reads COALESCE(angle.expert_pool,
// project.expert_pool) — so existing angles (all NULL) behave exactly as
// before, and editing a project's pool still flows through to any angle
// that hasn't explicitly diverged. No backfill on purpose: backfilling
// would freeze today's project pools onto angles forever.

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE angle ADD COLUMN expert_pool text;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE angle DROP COLUMN expert_pool;`);
};
