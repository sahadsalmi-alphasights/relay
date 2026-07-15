/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// §9 (built) — notifications: persisted in-app notifications, push
// subscriptions per person, and the bookkeeping the 30-min stale-first-
// deliverable scheduler needs to notify once per threshold instead of
// spamming on every tick.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE notification (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      person_id uuid NOT NULL REFERENCES person(id),
      type text NOT NULL
        CHECK (type IN ('assigned', 'goal_change_requested', 'goal_change_resolved', 'stale_first_deliverable', 'open_pool')),
      title text NOT NULL,
      body text NOT NULL,
      entity_type text,
      entity_id uuid,
      read boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_notification_person ON notification(person_id, created_at DESC);

    CREATE TABLE push_subscription (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      person_id uuid NOT NULL REFERENCES person(id),
      endpoint text NOT NULL UNIQUE,
      p256dh text NOT NULL,
      auth text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_push_subscription_person ON push_subscription(person_id);

    ALTER TABLE assignment
      ADD COLUMN progress_updated_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN stale_notified_threshold_minutes integer NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE assignment
      DROP COLUMN progress_updated_at,
      DROP COLUMN stale_notified_threshold_minutes;
    DROP TABLE IF EXISTS push_subscription;
    DROP TABLE IF EXISTS notification;
  `);
};
