/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// "Out to Lunch" now auto-clears 1 hour after it's switched on, instead of at
// a fixed 16:00 Dubai reset (2026-07-29). We need to know WHEN each person
// went on lunch to expire them individually — this column records it (set to
// now() on toggle-on, NULL on toggle-off). The scheduler clears anyone whose
// stamp is older than an hour. Additive, nullable — no backfill needed.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE person ADD COLUMN out_to_lunch_since timestamptz;`);
  // Anyone currently on lunch under the old model has no stamp — give them one
  // so they expire an hour from this migration rather than never.
  pgm.sql(`UPDATE person SET out_to_lunch_since = now() WHERE out_to_lunch = true AND out_to_lunch_since IS NULL;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE person DROP COLUMN out_to_lunch_since;`);
};
