/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Domain change 8 — stage is per-deliverer, not per-project: a project can
// have one assignee on Second Deliverable while another is still on First.
// Moves stage + stage_entered_at from project to assignment. The project's
// own stage/stage_entered_at columns are dropped; "the project's stage" is
// now always computed (earliest stage among its assignments), never stored.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE assignment
      ADD COLUMN stage text NOT NULL DEFAULT 'First Deliverable'
        CHECK (stage IN ('First Deliverable', 'Second Deliverable', 'Hail Mary', 'Selling')),
      ADD COLUMN stage_entered_at timestamptz NOT NULL DEFAULT now();

    -- Backfill existing assignments from their project's current stage, so
    -- in-flight dummy data doesn't silently reset to First Deliverable.
    UPDATE assignment a
    SET stage = p.stage, stage_entered_at = p.stage_entered_at
    FROM project p
    WHERE p.id = a.project_id;

    ALTER TABLE project
      DROP COLUMN stage,
      DROP COLUMN stage_entered_at;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE project
      ADD COLUMN stage text NOT NULL DEFAULT 'First Deliverable'
        CHECK (stage IN ('First Deliverable', 'Second Deliverable', 'Hail Mary', 'Selling')),
      ADD COLUMN stage_entered_at timestamptz NOT NULL DEFAULT now();

    -- Best-effort backfill: give each project its earliest assignment stage.
    UPDATE project p
    SET stage = sub.stage, stage_entered_at = sub.stage_entered_at
    FROM (
      SELECT DISTINCT ON (a.project_id) a.project_id, a.stage, a.stage_entered_at
      FROM assignment a
      ORDER BY a.project_id,
        CASE a.stage
          WHEN 'First Deliverable' THEN 0
          WHEN 'Second Deliverable' THEN 1
          WHEN 'Hail Mary' THEN 2
          WHEN 'Selling' THEN 3
        END ASC
    ) sub
    WHERE sub.project_id = p.id;

    ALTER TABLE assignment
      DROP COLUMN stage,
      DROP COLUMN stage_entered_at;
  `);
};
