/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Slack notification settings (2026-07-31) — a singleton of owner-editable,
// NON-secret toggles that decide which CapTracker alerts also post to Slack.
// The Slack webhook URL itself is a credential and lives in env
// (SLACK_WEBHOOK_URL), never here. `slack_enabled` is the master switch and
// starts OFF, so shipping this changes nothing until an owner turns it on AND
// the webhook is configured. Per-event flags default ON (once the master is
// on, everything flows unless an owner mutes a noisy one).
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE notification_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      slack_enabled boolean NOT NULL DEFAULT false,
      slack_broadcast_up_for_grabs boolean NOT NULL DEFAULT true,
      slack_assigned               boolean NOT NULL DEFAULT true,
      slack_goal_change_requested  boolean NOT NULL DEFAULT true,
      slack_goal_change_resolved   boolean NOT NULL DEFAULT true,
      slack_delivery_logged        boolean NOT NULL DEFAULT false,
      slack_stale_first_deliverable boolean NOT NULL DEFAULT true,
      slack_project_transferred    boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO notification_settings (id) VALUES (1);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE notification_settings;`);
};
