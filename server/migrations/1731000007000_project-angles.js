/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Big structural change, on the scale of domain change 8 (stage -> assignment):
// a project always has at least one ANGLE now. There is no separate
// "simple project" mode -- a simple project is just a project with one
// angle. N (calls_n), the suggested/actual goal (goal_total), and calls_sold
// all move from project to angle, since they're per-workstream, not
// per-project. Assignments attach to an angle, not directly to a project.
//
// Existing projects migrate cleanly: each gets exactly one angle (named from
// its topic, or "Main" if topic was never set), carrying over the project's
// existing calls_n/goal_total/calls_sold/calls_sold_updated_at, and every
// existing assignment re-points to that one new angle. No data loss.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE angle (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES project(id),
      name text NOT NULL,
      calls_n integer NOT NULL,
      goal_total integer NOT NULL,
      calls_sold integer NOT NULL DEFAULT 0,
      calls_sold_updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_angle_project ON angle(project_id);

    -- One angle per existing project, carrying over its N/goal/calls_sold.
    -- Point every existing assignment at its project's new (only) angle.
    ALTER TABLE assignment ADD COLUMN angle_id uuid REFERENCES angle(id);

    WITH new_angles AS (
      INSERT INTO angle (project_id, name, calls_n, goal_total, calls_sold, calls_sold_updated_at, created_at)
      SELECT id, COALESCE(NULLIF(topic, ''), 'Main'), calls_n, goal_total, calls_sold, calls_sold_updated_at, created_at
      FROM project
      RETURNING id, project_id
    )
    UPDATE assignment a
    SET angle_id = new_angles.id
    FROM new_angles
    WHERE new_angles.project_id = a.project_id;

    ALTER TABLE assignment ALTER COLUMN angle_id SET NOT NULL;

    -- Replace the (project_id, deliverer_id) uniqueness with (angle_id,
    -- deliverer_id) -- a person may now hold assignments on two different
    -- angles of the same project (different workstreams), not just two
    -- different projects.
    ALTER TABLE assignment DROP CONSTRAINT IF EXISTS assignment_project_id_deliverer_id_key;
    ALTER TABLE assignment ADD CONSTRAINT assignment_angle_id_deliverer_id_key UNIQUE (angle_id, deliverer_id);
    CREATE INDEX idx_assignment_angle ON assignment(angle_id);
    ALTER TABLE assignment DROP COLUMN project_id;

    ALTER TABLE project
      DROP COLUMN calls_n,
      DROP COLUMN goal_total,
      DROP COLUMN calls_sold,
      DROP COLUMN calls_sold_updated_at;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE project
      ADD COLUMN calls_n integer,
      ADD COLUMN goal_total integer,
      ADD COLUMN calls_sold integer NOT NULL DEFAULT 0,
      ADD COLUMN calls_sold_updated_at timestamptz NOT NULL DEFAULT now();

    ALTER TABLE assignment ADD COLUMN project_id uuid REFERENCES project(id);
    UPDATE assignment a SET project_id = ang.project_id FROM angle ang WHERE ang.id = a.angle_id;
    ALTER TABLE assignment ALTER COLUMN project_id SET NOT NULL;

    -- Best-effort: collapse each project's angles back down to one set of
    -- totals (sum of calls_n/goal_total/calls_sold across its angles).
    UPDATE project p
    SET calls_n = sub.calls_n, goal_total = sub.goal_total, calls_sold = sub.calls_sold
    FROM (
      SELECT project_id, SUM(calls_n) AS calls_n, SUM(goal_total) AS goal_total, SUM(calls_sold) AS calls_sold
      FROM angle GROUP BY project_id
    ) sub
    WHERE sub.project_id = p.id;
    ALTER TABLE project ALTER COLUMN calls_n SET NOT NULL, ALTER COLUMN goal_total SET NOT NULL;

    ALTER TABLE assignment DROP CONSTRAINT IF EXISTS assignment_angle_id_deliverer_id_key;
    ALTER TABLE assignment ADD CONSTRAINT assignment_project_id_deliverer_id_key UNIQUE (project_id, deliverer_id);
    DROP INDEX IF EXISTS idx_assignment_angle;
    CREATE INDEX idx_assignment_project ON assignment(project_id);
    ALTER TABLE assignment DROP COLUMN angle_id;

    DROP TABLE IF EXISTS angle;
  `);
};
