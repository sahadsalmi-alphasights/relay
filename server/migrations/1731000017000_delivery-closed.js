/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// "Archive for all deliverers only" (2026-07-24) — a project can be taken off
// every deliverer's board while staying active on the PL's board (the PL is
// still closing/selling). Distinct from a full archive (status='archived').
// delivery_closed_at NULL = normal; non-null = delivery closed for the team.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE project ADD COLUMN delivery_closed_at timestamptz;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE project DROP COLUMN delivery_closed_at;`);
};
