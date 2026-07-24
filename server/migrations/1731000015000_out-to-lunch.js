/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// "Out to Lunch" (2026-07-24) — a self-serve live toggle, sibling to
// evening_coverage: while on, the person is ineligible for any new
// allocation (auto-match, claims, broadcasts) and shows as a red "Lunch"
// chip on the Capacity Ranking instead of disappearing from it. Deliberately
// NOT a person.status value: status stays whatever the manager set, so
// toggling lunch off restores the person exactly as they were — nothing to
// remember, nothing a manager has to reset.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE person ADD COLUMN out_to_lunch boolean NOT NULL DEFAULT false;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE person DROP COLUMN out_to_lunch;`);
};
