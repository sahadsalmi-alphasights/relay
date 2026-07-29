/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Personal reminders (2026-07-29) — the "Admin" section of the notes to-do
// box: free-text reminders a person writes for themselves, not tied to any
// project. Private to the author; server-backed so they follow the person
// across devices (unlike a localStorage scratchpad).
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE personal_note (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX personal_note_person_idx ON personal_note (person_id, created_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE personal_note;`);
};
