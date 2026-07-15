import { Pool, type PoolClient } from "pg";
import { computeCustomGoal } from "../src/rules/suggestedGoal";

// DUMMY DATA ONLY (spec §1.6) — no real client, employee, or project names.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function nextNSundays(n: number): string[] {
  const dates: string[] = [];
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (7 - day) % 7; // 0 if today is already Sunday
  d.setUTCDate(d.getUTCDate() + diff);
  for (let i = 0; i < n; i++) {
    const next = new Date(d.getTime() + i * 7 * 86400000);
    dates.push(next.toISOString().slice(0, 10));
  }
  return dates;
}

type PersonSeed = {
  email: string;
  name: string;
  team: "Team_Alpha" | "Team_Beta" | null;
  isManager: boolean;
  practiceArea: string;
  status: "Available" | "On vacation" | "Sick" | "Offline";
  eveningCoverage: boolean;
};

const PEOPLE: PersonSeed[] = [
  { email: "lead.alpha@example.test", name: "Lead_User_Alpha", team: "Team_Alpha", isManager: true, practiceArea: "Tech", status: "Available", eveningCoverage: true },
  { email: "resource.zeta@example.test", name: "Resource_Zeta", team: "Team_Alpha", isManager: false, practiceArea: "Tech", status: "Available", eveningCoverage: true },
  { email: "resource.epsilon@example.test", name: "Resource_Epsilon", team: "Team_Alpha", isManager: false, practiceArea: "Tech", status: "Available", eveningCoverage: false },
  { email: "resource.theta@example.test", name: "Resource_Theta", team: "Team_Alpha", isManager: false, practiceArea: "PIPE", status: "On vacation", eveningCoverage: false },
  { email: "resource.iota@example.test", name: "Resource_Iota", team: "Team_Alpha", isManager: false, practiceArea: "Energy", status: "Available", eveningCoverage: false },
  { email: "lead.beta@example.test", name: "Lead_User_Beta", team: "Team_Beta", isManager: true, practiceArea: "Energy", status: "Available", eveningCoverage: true },
  { email: "resource.kappa@example.test", name: "Resource_Kappa", team: "Team_Beta", isManager: false, practiceArea: "Energy", status: "Available", eveningCoverage: true },
  { email: "resource.gamma@example.test", name: "Resource_Gamma", team: "Team_Beta", isManager: false, practiceArea: "PIPE", status: "Available", eveningCoverage: true },
  { email: "resource.lambda@example.test", name: "Resource_Lambda", team: "Team_Beta", isManager: false, practiceArea: "COG", status: "Sick", eveningCoverage: false },
  { email: "resource.mu@example.test", name: "Resource_Mu", team: "Team_Beta", isManager: false, practiceArea: "Tech", status: "Offline", eveningCoverage: false },
  // No team yet — demonstrates §7a onboarding and the §7b "add existing person to my team" flow.
  { email: "resource.unassigned@example.test", name: "Resource_Unassigned", team: null, isManager: false, practiceArea: "Tech", status: "Available", eveningCoverage: false },
];

async function seed(client: PoolClient) {
  await client.query("BEGIN");

  await client.query(`
    TRUNCATE TABLE audit_log, goal_change_request, note, assignment, project,
      sunday_swap_request, sunday_rota, person, team RESTART IDENTITY CASCADE;
  `);

  const { rows: teamRows } = await client.query<{ id: string; name: string }>(
    `INSERT INTO team (name) VALUES ('Team_Alpha'), ('Team_Beta') RETURNING id, name`
  );
  const teamIdByName = new Map(teamRows.map((t) => [t.name, t.id]));

  const personIdByName = new Map<string, string>();
  for (const p of PEOPLE) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO person (email, name, team_id, is_manager, practice_area, status, evening_coverage)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [p.email, p.name, p.team ? teamIdByName.get(p.team) : null, p.isManager, p.practiceArea, p.status, p.eveningCoverage]
    );
    personIdByName.set(p.name, rows[0].id);
  }

  const upcomingSundays = nextNSundays(3);
  for (const rotaDate of upcomingSundays) {
    await client.query(
      `INSERT INTO sunday_rota (rota_date, person_id, team_id) VALUES ($1, $2, $3)`,
      [rotaDate, personIdByName.get("Resource_Zeta"), teamIdByName.get("Team_Alpha")]
    );
    await client.query(
      `INSERT INTO sunday_rota (rota_date, person_id, team_id) VALUES ($1, $2, $3)`,
      [rotaDate, personIdByName.get("Resource_Kappa"), teamIdByName.get("Team_Beta")]
    );
  }

  await client.query(
    `INSERT INTO sunday_swap_request (rota_date, requested_by, note, resolved)
     VALUES ($1, $2, $3, false)`,
    [upcomingSundays[0], personIdByName.get("Resource_Zeta"), "Can anyone take this? I'm away that weekend."]
  );

  type ProjectSeed = {
    pl: string;
    client: string;
    account: string;
    topic: string;
    projectLink: string;
    projectType: "Pitch" | "Due Diligence" | "Strategy";
    expertPool: "Global" | "EU & MEA & India" | "AUS / NZ / Sing / JP" | "US only";
    callsN: number;
    goalTotal: number;
    callsSold: number;
    status: "matched" | "open";
    assignments: {
      deliverer: string;
      goal: number;
      delivered: number;
      customDelivered: number;
      // §3/§8 (domain change 8) — stage lives on the assignment now.
      stage: "First Deliverable" | "Second Deliverable" | "Hail Mary" | "Selling";
    }[];
  };

  const PROJECTS: ProjectSeed[] = [
    {
      pl: "Lead_User_Alpha",
      client: "Client_A",
      account: "Account_1",
      topic: "Market sizing — widget sector",
      projectLink: "https://example.test/proj/1001",
      projectType: "Pitch",
      expertPool: "US only",
      callsN: 4,
      goalTotal: 8,
      callsSold: 0,
      status: "matched",
      assignments: [
        // Demonstrates §8: two deliverers on the same project, different stages.
        { deliverer: "Resource_Zeta", goal: 4, delivered: 2, customDelivered: 0, stage: "First Deliverable" },
        { deliverer: "Resource_Epsilon", goal: 4, delivered: 1, customDelivered: 1, stage: "Second Deliverable" },
      ],
    },
    {
      pl: "Lead_User_Alpha",
      client: "Client_B",
      account: "Account_2",
      topic: "Competitive landscape",
      projectLink: "https://example.test/proj/1002",
      projectType: "Due Diligence",
      expertPool: "EU & MEA & India",
      callsN: 2,
      goalTotal: 6,
      callsSold: 1,
      status: "matched",
      assignments: [{ deliverer: "Resource_Iota", goal: 6, delivered: 6, customDelivered: 0, stage: "Selling" }],
    },
    {
      pl: "Lead_User_Beta",
      client: "Client_C",
      account: "Account_3",
      topic: "Regulatory expert sourcing",
      projectLink: "https://example.test/proj/1003",
      projectType: "Strategy",
      expertPool: "AUS / NZ / Sing / JP",
      callsN: 3,
      goalTotal: 6,
      callsSold: 0,
      status: "matched",
      assignments: [
        { deliverer: "Resource_Gamma", goal: 3, delivered: 3, customDelivered: 0, stage: "Second Deliverable" },
        { deliverer: "Resource_Kappa", goal: 3, delivered: 0, customDelivered: 0, stage: "First Deliverable" },
      ],
    },
    {
      pl: "Lead_User_Beta",
      client: "Client_D",
      account: "Account_4",
      topic: "Unmatched — needs staffing",
      projectLink: "https://example.test/proj/1004",
      projectType: "Pitch",
      expertPool: "Global",
      callsN: 2,
      goalTotal: 6,
      callsSold: 0,
      status: "open",
      assignments: [],
    },
  ];

  for (const p of PROJECTS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO project (pl_id, client, account, topic, project_link, project_type,
         expert_pool, calls_n, goal_total, calls_sold, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        personIdByName.get(p.pl),
        p.client,
        p.account,
        p.topic,
        p.projectLink,
        p.projectType,
        p.expertPool,
        p.callsN,
        p.goalTotal,
        p.callsSold,
        p.status,
      ]
    );
    const projectId = rows[0].id;

    for (const a of p.assignments) {
      await client.query(
        `INSERT INTO assignment (project_id, deliverer_id, goal, delivered, custom_goal, custom_delivered, stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          projectId,
          personIdByName.get(a.deliverer),
          a.goal,
          a.delivered,
          computeCustomGoal(a.goal),
          a.customDelivered,
          a.stage,
        ]
      );
    }

    await client.query(
      `INSERT INTO note (project_id, author_id, author_role, body, is_public)
       VALUES ($1, $2, 'PL', $3, true)`,
      [projectId, personIdByName.get(p.pl), `Kickoff note for ${p.client}.`]
    );
  }

  await client.query("COMMIT");
}

async function main() {
  const client = await pool.connect();
  try {
    await seed(client);
    console.log("Seed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
