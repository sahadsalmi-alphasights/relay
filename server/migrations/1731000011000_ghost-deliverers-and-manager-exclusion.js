/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// "Invisible competition" — a ghost deliverer (intern / new joiner) staffed
// onto the SAME angle as a real associate, working the same stream in
// parallel as competition. Complementary, never a replacement: the ghost's
// own goal/delivered are tracked identically to a real deliverer's, but
// deliberately excluded from the angle/project roll-ups (see the app-layer
// exclusions this migration enables) so the ghost never inflates capacity.
//
// Three independent additions:
//
// 1. person.is_ghost — manager-set, team-scoped (same rule as every other
//    roster action), reversible. Defaults false; no existing row is ever
//    defaulted to ghost.
// 2. assignment.is_ghost — distinguishes a ghost's assignment from a real
//    one at the row level, which is also what makes the later "did this
//    angle have invisible competition" analysis answerable (see
//    PATCH /goal-change-requests -- no, see the ghost allocation code:
//    `EXISTS (SELECT 1 FROM assignment WHERE angle_id = X AND is_ghost)`)
//    without any separate attribution column.
// 3. angle.invisible_competition_enabled — per-angle opt-out, defaults true
//    (Due Diligence/Strategy angles get a ghost suggested by default; the PL
//    can switch it off). Pitch angles carry the column too (uniform schema,
//    simpler than a conditional column) but the suggestion logic never
//    reads it for Pitch -- ghosts never apply there regardless of this flag.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE person ADD COLUMN is_ghost boolean NOT NULL DEFAULT false;
    ALTER TABLE assignment ADD COLUMN is_ghost boolean NOT NULL DEFAULT false;
    ALTER TABLE angle ADD COLUMN invisible_competition_enabled boolean NOT NULL DEFAULT true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE angle DROP COLUMN invisible_competition_enabled;
    ALTER TABLE assignment DROP COLUMN is_ghost;
    ALTER TABLE person DROP COLUMN is_ghost;
  `);
};
