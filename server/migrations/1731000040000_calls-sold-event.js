/**
 * Calls-sold ledger.
 *
 * calls_sold on an angle is a running cumulative total, so there's no way to
 * see how fast calls were sold — only where it landed. This records one row per
 * change: the signed delta and the resulting value, with a timestamp. That
 * turns calls-sold into a true velocity (calls sold per week within a month).
 *
 * Additive history for analytics; accrues from deploy forward.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE calls_sold_event (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      angle_id uuid NOT NULL REFERENCES angle(id) ON DELETE CASCADE,
      delta integer NOT NULL,
      new_value integer NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_calls_sold_event_at ON calls_sold_event(at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE calls_sold_event;`);
};
