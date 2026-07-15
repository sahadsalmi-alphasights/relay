/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// project_link was optional at intake and, it turns out, never surfaced
// anywhere in the UI once collected -- now that the client/project name is a
// hyperlink to it everywhere a project appears, a missing link is a broken
// link on every card, not just an empty field. Backfill any pre-existing
// NULLs (dummy data only, per spec §1.6) before enforcing NOT NULL so this
// migration is safe to run against an already-seeded dev database.
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE project SET project_link = 'https://example.test/unknown' WHERE project_link IS NULL;
    ALTER TABLE project ALTER COLUMN project_link SET NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE project ALTER COLUMN project_link DROP NOT NULL;`);
};
