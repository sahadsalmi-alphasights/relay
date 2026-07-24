/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// "Transfer to a different PL" (2026-07-24) — when a PL goes on vacation/sick,
// their project card can be handed to any PL in the BU. The new owner gets a
// notification, which needs its own type in the CHECK constraint (same
// pattern as 1731000005000 adding 'delivery_logged').
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE notification DROP CONSTRAINT notification_type_check;
    ALTER TABLE notification ADD CONSTRAINT notification_type_check
      CHECK (type IN ('assigned', 'goal_change_requested', 'goal_change_resolved',
                      'stale_first_deliverable', 'open_pool', 'delivery_logged',
                      'project_transferred'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE notification DROP CONSTRAINT notification_type_check;
    ALTER TABLE notification ADD CONSTRAINT notification_type_check
      CHECK (type IN ('assigned', 'goal_change_requested', 'goal_change_resolved',
                      'stale_first_deliverable', 'open_pool', 'delivery_logged'));
  `);
};
