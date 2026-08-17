/**
 * Multi-BU foundation (Phase 1b) — enforce BU isolation with Postgres RLS.
 *
 * Every tenant table gets row-level security keyed to a per-connection GUC,
 * `app.active_bu`. A query only sees / writes rows whose business_unit equals
 * the active BU:
 *
 *     business_unit = coalesce(current_setting('app.active_bu', true), 'non_consulting')
 *
 * The coalesce is the safety net that makes this a NON-breaking change for the
 * live (Non-Consulting) app:
 *   - current_setting(..., true) returns NULL instead of erroring when the GUC
 *     was never set, so there is no "unset → every query throws" outage mode;
 *   - an unset GUC therefore resolves to 'non_consulting', so every existing
 *     query path (none of which sets the GUC yet) behaves exactly as today.
 * Isolation only starts to matter once a session explicitly sets the GUC to
 * 'consulting' (via runWithBu) — which nothing does until the C BU is enabled.
 *
 * FORCE is required because the app connects as the table owner, and a table
 * owner bypasses its own RLS unless forced.
 *
 * A single FOR ALL policy (USING + WITH CHECK) covers SELECT/INSERT/UPDATE/
 * DELETE. Same 15 tenant tables as the column migration; settings singletons
 * and role_permission stay global.
 *
 * The column default is also switched from the static 'non_consulting' to the
 * SAME active-BU expression. This is what lets every existing INSERT keep
 * working untouched: a statement that doesn't name business_unit now inherits
 * the session's active BU, which by construction satisfies the WITH CHECK
 * (otherwise an insert in a consulting session would default to NC and be
 * rejected). For the live NC app the GUC is unset, so the default is still
 * 'non_consulting' — unchanged.
 */
exports.shorthands = undefined;

const TENANT_TABLES = [
  "person",
  "team",
  "project",
  "angle",
  "assignment",
  "delivery_round",
  "goal_change_request",
  "note",
  "personal_note",
  "notification",
  "push_subscription",
  "sunday_rota",
  "sunday_swap_request",
  "usage_event",
  "audit_log",
];

const ACTIVE_BU = "coalesce(current_setting('app.active_bu', true), 'non_consulting')";
const PREDICATE = `business_unit = ${ACTIVE_BU}`;

exports.up = (pgm) => {
  for (const table of TENANT_TABLES) {
    pgm.sql(`
      ALTER TABLE ${table} ALTER COLUMN business_unit SET DEFAULT ${ACTIVE_BU};
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY bu_isolation ON ${table}
        USING (${PREDICATE})
        WITH CHECK (${PREDICATE});
    `);
  }
};

exports.down = (pgm) => {
  for (const table of TENANT_TABLES) {
    pgm.sql(`
      DROP POLICY IF EXISTS bu_isolation ON ${table};
      ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} ALTER COLUMN business_unit SET DEFAULT 'non_consulting';
    `);
  }
};
