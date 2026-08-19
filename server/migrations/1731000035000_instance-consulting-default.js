/**
 * Multi-BU fix — the live population is the CONSULTING business, not
 * Non-Consulting.
 *
 * Background: 1731000027000 backfilled every existing tenant row with the
 * default business_unit 'non_consulting', and 1731000034000 labelled the
 * 'non_consulting' instance "Dubai · DUB - Non-Consulting". Result: all current
 * users show up under Non-Consulting, which is wrong — they're the Consulting
 * team.
 *
 * The identity of an instance is its (city, department, board) TUPLE + display
 * name, NOT its opaque key slug. So we simply swap the tuple + name between the
 * two seeded Dubai rows: the key that already owns all the data ('non_consulting'
 * — also the app's default BU for new/untagged users and the RLS default)
 * becomes "Dubai · DUB - Consulting", and the empty 'consulting' key becomes
 * "Dubai · DUB - Non-Consulting".
 *
 * Why this is safe and non-breaking:
 *  - No tenant data moves: every row stays tagged 'non_consulting' and its
 *    membership is unchanged. Only two rows in the `instance` registry change.
 *  - RLS default ('non_consulting') is untouched, so reads/writes are unaffected.
 *  - Okta tuple-routing stays coherent: a real Consulting login (department
 *    'DUB - Consulting') now derives to the 'non_consulting' key and joins the
 *    live population; a Non-Consulting login derives to the 'consulting' key.
 *  - The key slugs are opaque and never shown to users; the inversion (key
 *    'non_consulting' → Consulting label) is intentional and documented here.
 *
 * Fully reversible — down() restores the previous labelling.
 */
exports.shorthands = undefined;

// The partial unique index on (city, department, coalesce(board,'')) means we
// can't have both rows carry the same department even transiently, so we park
// one on a temporary department before completing the swap.
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE instance SET department = 'DUB - _swap_'          WHERE key = 'consulting';
    UPDATE instance SET department = 'DUB - Consulting',     name = 'Dubai · DUB - Consulting'     WHERE key = 'non_consulting';
    UPDATE instance SET department = 'DUB - Non-Consulting', name = 'Dubai · DUB - Non-Consulting' WHERE key = 'consulting';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE instance SET department = 'DUB - _swap_'          WHERE key = 'consulting';
    UPDATE instance SET department = 'DUB - Non-Consulting', name = 'Dubai · DUB - Non-Consulting' WHERE key = 'non_consulting';
    UPDATE instance SET department = 'DUB - Consulting',     name = 'Dubai · DUB - Consulting'     WHERE key = 'consulting';
  `);
};
