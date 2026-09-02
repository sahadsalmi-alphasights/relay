/**
 * Stage-transition history.
 *
 * The app only keeps each assignment's CURRENT stage and when it entered it, so
 * there's no way to answer "how long did first deliverables take" or "how often
 * did work bounce backward". This records one row per stage change: the stage
 * being left, the stage entered, and how long the assignment sat in the stage
 * it left (computed from stage_entered_at at the moment of the change, so each
 * row is self-contained — no need to pair rows to get a duration).
 *
 * Purely additive history for analytics; nothing reads it for app behaviour.
 * Only accrues from deploy forward — there's no back-history to backfill.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE stage_transition (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      assignment_id uuid NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
      from_stage text NOT NULL,
      to_stage text NOT NULL,
      from_dwell_seconds integer NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_stage_transition_at ON stage_transition(at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE stage_transition;`);
};
