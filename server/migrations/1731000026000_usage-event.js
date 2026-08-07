/**
 * Usage telemetry — a lightweight, high-volume event stream powering the
 * owner-only Analytics dashboard (which workflows are used, which show
 * friction). Deliberately NOT the audit log: audit_log is the tamper-evident
 * record of *mutations* (who changed what); usage_event is *behavioural*
 * telemetry (what people did in the UI, incl. non-mutating actions like
 * viewing a screen or dismissing a prompt).
 *
 * Privacy / data-minimisation: `context` holds only generic, non-identifying
 * keys (e.g. {"screen":"Delivery"}, {"prompt":"lunch"}, {"step":2}) — never
 * client names, personal content, or free text. The server allowlists the
 * `event` name and never trusts a client-supplied identity or timestamp;
 * person_id/team_id/created_at are all stamped server-side.
 *
 * team_id is a denormalised snapshot of the actor's team AT THE TIME of the
 * event, so historical breakdowns stay correct even after someone changes
 * teams. Both FKs ON DELETE SET NULL so deleting a user/team keeps the
 * aggregate counts intact (the row survives, just anonymised).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE usage_event (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      person_id uuid REFERENCES person(id) ON DELETE SET NULL,
      team_id uuid REFERENCES team(id) ON DELETE SET NULL,
      event text NOT NULL,
      context jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX usage_event_created_idx ON usage_event (created_at);
    CREATE INDEX usage_event_event_created_idx ON usage_event (event, created_at);
    CREATE INDEX usage_event_person_idx ON usage_event (person_id);
    CREATE INDEX usage_event_team_idx ON usage_event (team_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE usage_event;`);
};
