/**
 * Vacation Planner — CapTracker-owned config that complements BambooHR.
 *
 * Personal vacations + who's-out come from BambooHR (system of record, read via
 * the existing integration). What BambooHR does NOT model, and this does:
 *   - company_closure      — everyone-off closures (Winter Break, Eid, …)
 *   - public_holiday       — office holiday that still needs some coverage,
 *                            with a per-seniority requirement
 *   - public_holiday_coverage — who's assigned to cover a public holiday
 *   - busy_period          — high-stakes windows to flag on the heatmap
 *   - person.seniority     — Senior/Mid/Junior, used by coverage requirements
 *
 * All config tables are BU-scoped (business_unit column + the same RLS policy
 * and active-BU default as the other tenant tables) so Consulting and
 * Non-Consulting keep separate closures/holidays/coverage. Quarter windows and
 * submission deadlines are computed in code, not stored.
 */
exports.shorthands = undefined;

const ACTIVE_BU = "coalesce(current_setting('app.active_bu', true), 'non_consulting')";
const PREDICATE = `business_unit = ${ACTIVE_BU}`;
const NEW_TENANT_TABLES = ["company_closure", "public_holiday", "busy_period"];

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE person ADD COLUMN seniority text
      CHECK (seniority IS NULL OR seniority IN ('Senior', 'Mid', 'Junior'));

    CREATE TABLE company_closure (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_unit text NOT NULL DEFAULT ${ACTIVE_BU},
      name text NOT NULL,
      start_date date NOT NULL,
      end_date date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public_holiday (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_unit text NOT NULL DEFAULT ${ACTIVE_BU},
      name text NOT NULL,
      holiday_date date NOT NULL,
      team_id uuid REFERENCES team(id) ON DELETE SET NULL,
      req_total smallint NOT NULL DEFAULT 0,
      req_senior smallint NOT NULL DEFAULT 0,
      req_mid smallint NOT NULL DEFAULT 0,
      req_junior smallint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public_holiday_coverage (
      holiday_id uuid NOT NULL REFERENCES public_holiday(id) ON DELETE CASCADE,
      person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
      PRIMARY KEY (holiday_id, person_id)
    );

    CREATE TABLE busy_period (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_unit text NOT NULL DEFAULT ${ACTIVE_BU},
      label text NOT NULL,
      start_date date NOT NULL,
      end_date date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  for (const table of NEW_TENANT_TABLES) {
    pgm.sql(`
      CREATE INDEX ${table}_business_unit_idx ON ${table} (business_unit);
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY bu_isolation ON ${table} USING (${PREDICATE}) WITH CHECK (${PREDICATE});
    `);
  }
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS public_holiday_coverage;
    DROP TABLE IF EXISTS public_holiday;
    DROP TABLE IF EXISTS company_closure;
    DROP TABLE IF EXISTS busy_period;
    ALTER TABLE person DROP COLUMN IF EXISTS seniority;
  `);
};
