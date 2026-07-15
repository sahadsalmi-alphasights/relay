/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// §9/§5 (eight changes) — change 5: "when a deliverer logs a delivery,
// notify the PL to review." A new notification type alongside the existing
// four built in the previous phase.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE notification DROP CONSTRAINT notification_type_check;
    ALTER TABLE notification ADD CONSTRAINT notification_type_check
      CHECK (type IN ('assigned', 'goal_change_requested', 'goal_change_resolved', 'stale_first_deliverable', 'open_pool', 'delivery_logged'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE notification DROP CONSTRAINT notification_type_check;
    ALTER TABLE notification ADD CONSTRAINT notification_type_check
      CHECK (type IN ('assigned', 'goal_change_requested', 'goal_change_resolved', 'stale_first_deliverable', 'open_pool'));
  `);
};
