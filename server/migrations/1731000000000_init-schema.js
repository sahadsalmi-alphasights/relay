/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

// Full schema per RELAY_BUILD_SPEC.md §3. Enums are enforced via CHECK
// constraints on text columns rather than native Postgres ENUM types, so
// adding a value later is a plain migration instead of an ALTER TYPE dance.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE team (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE person (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      team_id uuid REFERENCES team(id),
      is_manager boolean NOT NULL DEFAULT false,
      practice_area text,
      status text NOT NULL DEFAULT 'Available'
        CHECK (status IN ('Available', 'On vacation', 'Sick', 'Offline')),
      evening_coverage boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- A SCHEDULE, not a preference (§4 Rule 2): eligibility on a Sunday is a
    -- lookup against this table for that exact date, never a per-person flag.
    CREATE TABLE sunday_rota (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rota_date date NOT NULL,
      person_id uuid NOT NULL REFERENCES person(id),
      team_id uuid NOT NULL REFERENCES team(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (rota_date, person_id)
    );

    CREATE TABLE sunday_swap_request (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rota_date date NOT NULL,
      requested_by uuid NOT NULL REFERENCES person(id),
      note text,
      resolved boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE project (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pl_id uuid NOT NULL REFERENCES person(id),
      client text NOT NULL,
      account text,
      topic text,
      project_link text,
      project_type text NOT NULL
        CHECK (project_type IN ('Pitch', 'Due Diligence', 'Strategy')),
      expert_pool text NOT NULL
        CHECK (expert_pool IN ('Global', 'EU & MEA & India', 'AUS / NZ / Sing / JP', 'US only')),
      calls_n integer NOT NULL,
      goal_total integer NOT NULL,
      stage text NOT NULL DEFAULT 'First Deliverable'
        CHECK (stage IN ('First Deliverable', 'Second Deliverable', 'Hail Mary', 'Selling')),
      stage_entered_at timestamptz NOT NULL DEFAULT now(),
      calls_sold integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'matched'
        CHECK (status IN ('matched', 'open')),
      archived boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE assignment (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES project(id),
      deliverer_id uuid NOT NULL REFERENCES person(id),
      goal integer NOT NULL DEFAULT 0,
      delivered integer NOT NULL DEFAULT 0,
      custom_goal integer NOT NULL DEFAULT 0,
      custom_delivered integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, deliverer_id)
    );

    CREATE TABLE note (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES project(id),
      author_id uuid NOT NULL REFERENCES person(id),
      author_role text NOT NULL CHECK (author_role IN ('PL', 'Delivery')),
      body text NOT NULL,
      is_public boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Assignment-level only: a deliverer requests a change to their own
    -- assignment's goal/custom_goal, never a project-level goal_total change.
    CREATE TABLE goal_change_request (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      assignment_id uuid NOT NULL REFERENCES assignment(id),
      requested_by uuid NOT NULL REFERENCES person(id),
      body text NOT NULL,
      resolved boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      actor_id uuid REFERENCES person(id),
      action text NOT NULL,
      old_value jsonb,
      new_value jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_person_team ON person(team_id);
    CREATE INDEX idx_project_pl ON project(pl_id);
    CREATE INDEX idx_assignment_project ON assignment(project_id);
    CREATE INDEX idx_assignment_deliverer ON assignment(deliverer_id);
    CREATE INDEX idx_sunday_rota_date ON sunday_rota(rota_date);
    CREATE INDEX idx_note_project ON note(project_id);
    CREATE INDEX idx_goal_change_request_assignment ON goal_change_request(assignment_id);
    CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS goal_change_request;
    DROP TABLE IF EXISTS note;
    DROP TABLE IF EXISTS assignment;
    DROP TABLE IF EXISTS project;
    DROP TABLE IF EXISTS sunday_swap_request;
    DROP TABLE IF EXISTS sunday_rota;
    DROP TABLE IF EXISTS person;
    DROP TABLE IF EXISTS team;
  `);
};
