/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Domain change 9 — a goal change starts a new delivery round: the
// completed round (goal, delivered, custom_delivered) is archived here,
// then the assignment's own counters reset to 0 under the new goal. The
// deliverer's board always shows the current (live) round; this table is
// the append-only history feeding future cumulative-delivery analytics.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE delivery_round (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      assignment_id uuid NOT NULL REFERENCES assignment(id),
      goal integer NOT NULL,
      delivered integer NOT NULL,
      custom_delivered integer NOT NULL,
      closed_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_delivery_round_assignment ON delivery_round(assignment_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS delivery_round;`);
};
