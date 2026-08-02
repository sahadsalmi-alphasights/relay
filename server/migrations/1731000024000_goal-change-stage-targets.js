/**
 * Notifications batch — a goal-change request's `requested_status` is now a
 * *delivery-stage* target (First/Second Deliverable, Hail Mary, Selling) or the
 * "Archive" shortcut, replacing the old project-lifecycle values. Relax the
 * CHECK constraint accordingly. The legacy values (open/active/archived) stay
 * allowed so historical rows still validate; the app only ever writes the new
 * set going forward (see server/src/rules/goalChange.ts).
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE goal_change_request DROP CONSTRAINT IF EXISTS goal_change_request_requested_status_check;
    ALTER TABLE goal_change_request ADD CONSTRAINT goal_change_request_requested_status_check
      CHECK (requested_status IN (
        'First Deliverable', 'Second Deliverable', 'Hail Mary', 'Selling', 'Archive',
        'open', 'active', 'archived'
      ));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE goal_change_request DROP CONSTRAINT IF EXISTS goal_change_request_requested_status_check;
    ALTER TABLE goal_change_request ADD CONSTRAINT goal_change_request_requested_status_check
      CHECK (requested_status IN ('open', 'active', 'archived'));
  `);
};
