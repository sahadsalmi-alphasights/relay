/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Tracks when calls_sold was last written, so the PL board can prompt for an
// end-of-day update when it hasn't been touched today (Asia/Dubai). Backfilled
// to created_at so existing/seeded projects don't spuriously need an update
// on the day this migration runs.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE project ADD COLUMN calls_sold_updated_at timestamptz NOT NULL DEFAULT now();
    UPDATE project SET calls_sold_updated_at = created_at;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE project DROP COLUMN calls_sold_updated_at;`);
};
