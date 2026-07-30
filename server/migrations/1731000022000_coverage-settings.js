/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Configurable coverage timings (2026-07-29) — the lunch and evening-coverage
// prompt windows / durations were hardcoded in the client and the daily-reset
// scheduler. This singleton row makes them owner-editable (Settings → Coverage)
// and read by both the client prompts and the server scheduler, so a change
// applies BU-wide with no redeploy.
//
// Times are "minutes since Dubai midnight" (0–1439); durations are minutes.
// Seeded to the exact values that were hardcoded, so behaviour is unchanged
// until someone edits them.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE coverage_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      lunch_prompt_start_min   int NOT NULL DEFAULT 750,   -- 12:30
      lunch_prompt_end_min     int NOT NULL DEFAULT 870,   -- 14:30
      lunch_auto_off_min       int NOT NULL DEFAULT 60,
      lunch_snooze_min         int NOT NULL DEFAULT 30,
      evening_prompt_start_min int NOT NULL DEFAULT 1080,  -- 18:00
      evening_prompt_end_min   int NOT NULL DEFAULT 1320,  -- 22:00
      evening_reset_start_min  int NOT NULL DEFAULT 240,   -- 04:00
      evening_reset_end_min    int NOT NULL DEFAULT 480,   -- 08:00
      evening_snooze_min       int NOT NULL DEFAULT 60,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO coverage_settings (id) VALUES (1);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE coverage_settings;`);
};
