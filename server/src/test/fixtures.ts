import type { FastifyInstance } from "fastify";
import { pool } from "../db";

export interface Fixture {
  teamAlpha: string;
  teamBeta: string;
  plAlpha: string;
  delivererAlpha: string;
  otherDelivererAlpha: string;
  managerBeta: string;
  project: string;
  assignment: string;
}

/**
 * Truncates every domain table and inserts a small, deterministic fixture.
 * Running the API tests wipes whatever seed data was in the dev database —
 * `npm run seed` (or `docker compose up` again) restores the demo data.
 */
export async function resetAndSeedFixture(): Promise<Fixture> {
  await pool.query(`
    TRUNCATE TABLE audit_log, goal_change_request, note, assignment, project,
      sunday_swap_request, sunday_rota, person, team RESTART IDENTITY CASCADE
  `);

  const { rows: teams } = await pool.query<{ id: string; name: string }>(
    `INSERT INTO team (name) VALUES ('Team_Alpha'), ('Team_Beta') RETURNING id, name`
  );
  const teamAlpha = teams.find((t) => t.name === "Team_Alpha")!.id;
  const teamBeta = teams.find((t) => t.name === "Team_Beta")!.id;

  async function insertPerson(
    email: string,
    name: string,
    teamId: string,
    isManager: boolean,
    practiceArea: string,
    status = "Available",
    eveningCoverage = true
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO person (email, name, team_id, is_manager, practice_area, status, evening_coverage)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [email, name, teamId, isManager, practiceArea, status, eveningCoverage]
    );
    return rows[0].id;
  }

  const plAlpha = await insertPerson("pl.alpha@test.example", "PL_Alpha", teamAlpha, true, "Tech");
  const delivererAlpha = await insertPerson("deliverer.alpha@test.example", "Deliverer_Alpha", teamAlpha, false, "Tech");
  const otherDelivererAlpha = await insertPerson("other.alpha@test.example", "Other_Alpha", teamAlpha, false, "Tech");
  const managerBeta = await insertPerson("manager.beta@test.example", "Manager_Beta", teamBeta, true, "Energy");

  const { rows: projectRows } = await pool.query<{ id: string }>(
    `INSERT INTO project (pl_id, client, project_link, project_type, expert_pool, calls_n, goal_total, status)
     VALUES ($1, 'Client_Test', 'https://example.test/proj/fixture', 'Pitch', 'Global', 4, 8, 'matched') RETURNING id`,
    [plAlpha]
  );
  const project = projectRows[0].id;

  const { rows: assignmentRows } = await pool.query<{ id: string }>(
    `INSERT INTO assignment (project_id, deliverer_id, goal, delivered, custom_goal, custom_delivered)
     VALUES ($1, $2, 8, 2, 0, 0) RETURNING id`,
    [project, delivererAlpha]
  );
  const assignment = assignmentRows[0].id;

  return { teamAlpha, teamBeta, plAlpha, delivererAlpha, otherDelivererAlpha, managerBeta, project, assignment };
}

/** Logs in via the DEV_AUTH endpoint through the real HTTP route and returns a `Cookie` header value. */
export async function loginAs(app: FastifyInstance, personId: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/dev-login", payload: { personId } });
  if (res.statusCode !== 200) {
    throw new Error(`dev-login failed for ${personId}: ${res.statusCode} ${res.body}`);
  }
  const setCookie = res.cookies.find((c) => c.name === "relay_session");
  if (!setCookie) throw new Error("dev-login did not set a session cookie");
  return `${setCookie.name}=${setCookie.value}`;
}
