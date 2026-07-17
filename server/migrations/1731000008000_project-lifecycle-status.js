/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Project lifecycle change — status becomes a single four-value lifecycle:
// open / active / idle / archived. Folds the old separate `archived` boolean
// into `status` (an archived project no longer needs two columns to describe
// one fact) and renames 'matched' -> 'active' (a project with assignees,
// being actively worked). 'idle' is new: parked, contributes no load, asked
// about in neither the morning calls-sold dialog nor the stale-assignment
// scheduler. See RELAY_BUILD_SPEC.md for the full state diagram.
//
// Also adds client_entity (1-5) for the new project set-up field used to
// group the PL board into rows.

exports.up = (pgm) => {
  pgm.sql(`
    -- Drop the old two-value constraint FIRST -- the data migration below
    -- writes 'active'/'archived', which the old constraint doesn't allow yet.
    ALTER TABLE project DROP CONSTRAINT project_status_check;

    UPDATE project SET status = 'active' WHERE status = 'matched';
    UPDATE project SET status = 'archived' WHERE archived = true;

    ALTER TABLE project ALTER COLUMN status SET DEFAULT 'active';
    ALTER TABLE project ADD CONSTRAINT project_status_check
      CHECK (status IN ('open', 'active', 'idle', 'archived'));
    ALTER TABLE project DROP COLUMN archived;

    ALTER TABLE project ADD COLUMN client_entity smallint NOT NULL DEFAULT 1
      CHECK (client_entity BETWEEN 1 AND 5);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE project ADD COLUMN archived boolean NOT NULL DEFAULT false;
    UPDATE project SET archived = true WHERE status = 'archived';

    -- Drop the four-value constraint FIRST -- the rewrite below writes
    -- 'matched', which it doesn't allow.
    ALTER TABLE project DROP CONSTRAINT project_status_check;

    -- Best-effort: idle/archived have no equivalent in the old two-value
    -- enum, so they collapse back to 'matched' (they were staffed to get
    -- there in the first place -- see the state diagram, idle/archived are
    -- only reachable from 'active').
    UPDATE project SET status = 'matched' WHERE status IN ('active', 'idle', 'archived');

    ALTER TABLE project ALTER COLUMN status SET DEFAULT 'matched';
    ALTER TABLE project ADD CONSTRAINT project_status_check
      CHECK (status IN ('matched', 'open'));

    ALTER TABLE project DROP COLUMN client_entity;
  `);
};
