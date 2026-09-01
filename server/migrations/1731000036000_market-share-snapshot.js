/**
 * Month-end market-share snapshots.
 *
 * Market share (calls_sold / calls_n per project card, bucketed by the card's
 * Dubai-calendar creation month) is otherwise computed live off the mutable
 * angle rows, so a closed month drifts whenever anyone later edits calls or a
 * project is deleted — the number a past month actually ended on is lost.
 *
 * This table freezes one row per angle per month at month close (and a
 * one-time backfill of already-closed months). Labels (pl_name, team_name,
 * client, angle_name) are denormalised so history stays truthful even if a
 * person/team is renamed later. No FK to project/person: a snapshot is
 * immutable history that must outlive any future deletion of the live rows.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE market_share_snapshot (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      month_key text NOT NULL,
      project_id uuid NOT NULL,
      angle_id uuid NOT NULL,
      pl_id uuid,
      pl_name text NOT NULL,
      team_id uuid,
      team_name text,
      client text NOT NULL,
      angle_name text NOT NULL,
      calls_sold integer NOT NULL,
      calls_n integer NOT NULL,
      deleted boolean NOT NULL,
      project_created_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (month_key, angle_id)
    );
    CREATE INDEX idx_mss_month ON market_share_snapshot(month_key);
    CREATE INDEX idx_mss_pl ON market_share_snapshot(pl_id);
    CREATE INDEX idx_mss_team ON market_share_snapshot(team_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE market_share_snapshot;`);
};
