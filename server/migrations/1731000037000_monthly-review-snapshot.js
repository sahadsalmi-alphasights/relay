/**
 * Month-end snapshots of the whole leadership review.
 *
 * Market share already freezes per month (market_share_snapshot); everything
 * else in the monthly review — goal attainment, pipeline, per-team/type/pool
 * splits, top clients, audit counts — is still recomputed live off the mutable
 * tables, so a closed month drifts as data changes underneath it. This freezes
 * the full set of month-historical blocks once, as a JSON payload per month,
 * so past months stay stable and trend honestly.
 *
 * Only the month-historical blocks are stored. The review's live "now" blocks
 * (capacity, stage mix, chase/stuck lists, roster, hygiene) are always computed
 * fresh and never frozen — they describe the present, not the month.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE monthly_review_snapshot (
      month_key text PRIMARY KEY,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE monthly_review_snapshot;`);
};
