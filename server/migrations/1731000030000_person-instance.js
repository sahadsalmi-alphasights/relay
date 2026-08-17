/**
 * Multi-BU — a person can belong to MULTIPLE instances.
 *
 * `person.business_unit` stays as the person's home/primary BU (Okta-derived,
 * used for their default view). Membership — which instances a person can be
 * staffed in and ranked within — becomes a many-to-many via `person_instance`.
 * The capacity pool selects people by membership, so someone in both C and NC
 * appears in each BU's ranking, carrying only that BU's assignments/load (the
 * BUs still never blend).
 *
 * Backfill: every existing person becomes a member of their current
 * business_unit, so behaviour is unchanged (everyone is Non-Consulting today).
 * Global mapping table (owner-managed) — no business_unit column / RLS of its
 * own, same as the `instance` registry it references.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE person_instance (
      person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
      instance_key text NOT NULL REFERENCES instance(key) ON DELETE CASCADE,
      PRIMARY KEY (person_id, instance_key)
    );
    CREATE INDEX person_instance_instance_idx ON person_instance (instance_key);

    INSERT INTO person_instance (person_id, instance_key)
      SELECT id, business_unit FROM person
      ON CONFLICT DO NOTHING;

    -- Every person is always a member of their home BU. A trigger guarantees
    -- this on any INSERT and whenever business_unit changes (e.g. the Okta
    -- department stamp at login), so membership stays consistent no matter
    -- which code path creates the person — no per-call-site wiring needed.
    CREATE FUNCTION ensure_home_instance() RETURNS trigger AS $$
    BEGIN
      INSERT INTO person_instance (person_id, instance_key)
        VALUES (NEW.id, NEW.business_unit)
        ON CONFLICT DO NOTHING;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER person_home_instance
      AFTER INSERT OR UPDATE OF business_unit ON person
      FOR EACH ROW EXECUTE FUNCTION ensure_home_instance();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS person_home_instance ON person;
    DROP FUNCTION IF EXISTS ensure_home_instance();
    DROP TABLE person_instance;
  `);
};
