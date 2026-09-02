/**
 * Daily capacity snapshots.
 *
 * Load is computed live and never stored, so the review can only ever show
 * capacity "right now" — there's no way to see whether the team ran hot or
 * cool over the month. This records one row per instance per Dubai day: the
 * deliverer pool's size and its weighted-load shape (median, average, how many
 * over the median, how many idle), so utilisation becomes a trend.
 *
 * One row per (day, instance); the daily scheduler upserts, so the latest run
 * of the day wins. Purely additive history for analytics.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE capacity_snapshot (
      taken_on date NOT NULL,
      instance_key text NOT NULL,
      people integer NOT NULL,
      median_load numeric NOT NULL,
      avg_load numeric NOT NULL,
      over_median integer NOT NULL,
      idle integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (taken_on, instance_key)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE capacity_snapshot;`);
};
