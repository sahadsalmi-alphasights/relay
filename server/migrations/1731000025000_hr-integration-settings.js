/**
 * BambooHR leave sync — a singleton settings row (mirrors coverage_settings /
 * notification_settings) plus a per-person marker column.
 *
 * hr_integration_settings: the non-secret, owner-editable knobs (the API key /
 * subdomain live in env, never here). leave_type_keywords is a comma-separated
 * list matched (case-insensitive, substring) against BambooHR time-off type
 * names; anyone currently out on a matching type is set Offline.
 *
 * person.hr_offline_at: stamped when the sync set someone Offline, so the sync
 * can later restore ONLY the people it changed (never clobbering a manual
 * status). Cleared on restore.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE hr_integration_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled boolean NOT NULL DEFAULT false,
      leave_type_keywords text NOT NULL DEFAULT 'vacation,sick',
      last_sync_at timestamptz,
      last_sync_summary text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO hr_integration_settings (id) VALUES (1);

    ALTER TABLE person ADD COLUMN hr_offline_at timestamptz;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE person DROP COLUMN hr_offline_at;
    DROP TABLE hr_integration_settings;
  `);
};
