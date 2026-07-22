/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Per-angle archive (2026-07-22). An archived angle is paused, mirroring a
// project archive but scoped to one workstream: hidden from the card's active
// view, and its goal + its deliverers' load stop counting (the load query and
// the card's roll-up both skip archived angles). Recoverable — resurface
// clears archived_at. Nullable, no backfill: every existing angle stays
// active (archived_at IS NULL).
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE angle ADD COLUMN archived_at timestamptz;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE angle DROP COLUMN archived_at;`);
};
