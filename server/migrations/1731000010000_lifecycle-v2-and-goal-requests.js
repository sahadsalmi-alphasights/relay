/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Batch S — three independent changes bundled in one migration because they
// land together:
//
// 1. Removes the 'idle' project status (added by
//    1731000008000_project-lifecycle-status.js). Idle rows are defensively
//    moved to 'active' first (the only status idle was ever reachable
//    from) before the CHECK constraint narrows — a no-op today (0 idle rows
//    at the time this was written) but must not leave any row violating the
//    new constraint if one exists in another environment.
// 2. Adds project.deleted_at for soft delete. Never hard-deleted, never
//    exposed to the client — every project query gets `deleted_at IS NULL`.
// 3. Adds assignment.first_deliverable_last_at (invisible sort key, stamped
//    on every transition into 'First Deliverable', including creation) and
//    two structured fields to goal_change_request (requested_goal,
//    requested_status) plus an outcome column so accept/decline are
//    distinguishable from the existing resolved boolean. Nullable — existing
//    rows predate the structured flow and aren't backfilled.

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE project SET status = 'active' WHERE status = 'idle';

    ALTER TABLE project DROP CONSTRAINT project_status_check;
    ALTER TABLE project ADD CONSTRAINT project_status_check
      CHECK (status IN ('open', 'active', 'archived'));

    ALTER TABLE project ADD COLUMN deleted_at timestamptz;

    ALTER TABLE assignment ADD COLUMN first_deliverable_last_at timestamptz;

    ALTER TABLE goal_change_request ADD COLUMN requested_goal integer;
    ALTER TABLE goal_change_request ADD COLUMN requested_status text
      CHECK (requested_status IN ('open', 'active', 'archived'));
    ALTER TABLE goal_change_request ADD COLUMN outcome text
      CHECK (outcome IN ('accepted', 'declined'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE goal_change_request DROP COLUMN outcome;
    ALTER TABLE goal_change_request DROP COLUMN requested_status;
    ALTER TABLE goal_change_request DROP COLUMN requested_goal;

    ALTER TABLE assignment DROP COLUMN first_deliverable_last_at;

    ALTER TABLE project DROP COLUMN deleted_at;

    -- Best-effort, same spirit as 1731000008000's down(): idle has no
    -- equivalent to restore into, so this only widens the constraint back.
    ALTER TABLE project DROP CONSTRAINT project_status_check;
    ALTER TABLE project ADD CONSTRAINT project_status_check
      CHECK (status IN ('open', 'active', 'idle', 'archived'));
  `);
};
