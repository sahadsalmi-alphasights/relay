import { pool } from "../db";
import type { ExpertPool, ProjectStatus, Stage } from "../rules/types";

export interface ProjectRow {
  id: string;
  plId: string;
  client: string;
  account: string | null;
  topic: string | null;
  /** Required (bug fix) — every project card links its name to this, so a missing link would be a broken link on every card, not just an empty field. */
  projectLink: string;
  projectType: "Pitch" | "Due Diligence" | "Strategy";
  expertPool: ExpertPool;
  /**
   * Big structural change — a project always has >=1 angle now (N, goal,
   * calls_sold all live on angle, not project). These three are the SUM
   * across the project's angles, computed at query time, not stored columns
   * — every existing "project totals" display keeps working unchanged for
   * the common one-angle case, and correctly sums for multi-angle projects.
   * See RELAY_BUILD_SPEC.md §3a and repositories/angles.ts.
   */
  callsN: number;
  goalTotal: number;
  /**
   * §3/§8 (domain change 8) — computed, never stored: the earliest stage
   * among this project's assignments, or null if it has none yet (open
   * pool). Stage itself lives on each assignment now, not the project.
   */
  earliestStage: Stage | null;
  callsSold: number;
  status: ProjectStatus;
  archived: boolean;
}

const SELECT = `
  SELECT id, pl_id AS "plId", client, account, topic, project_link AS "projectLink",
         project_type AS "projectType", expert_pool AS "expertPool",
         (SELECT COALESCE(SUM(ang.calls_n), 0)::int FROM angle ang WHERE ang.project_id = project.id) AS "callsN",
         (SELECT COALESCE(SUM(ang.goal_total), 0)::int FROM angle ang WHERE ang.project_id = project.id) AS "goalTotal",
         (SELECT COALESCE(SUM(ang.calls_sold), 0)::int FROM angle ang WHERE ang.project_id = project.id) AS "callsSold",
         status, archived,
         (SELECT a.stage FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = project.id
          ORDER BY CASE a.stage
            WHEN 'First Deliverable' THEN 0 WHEN 'Second Deliverable' THEN 1
            WHEN 'Hail Mary' THEN 2 WHEN 'Selling' THEN 3 END ASC
          LIMIT 1) AS "earliestStage"
  FROM project`;

export async function findProjectById(id: string): Promise<ProjectRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export interface ProjectFilter {
  plId?: string;
  plIdIn?: string[];
  delivererId?: string;
  delivererIdIn?: string[];
  status?: ProjectStatus;
  archived?: boolean;
}

export async function listProjects(filter: ProjectFilter): Promise<ProjectRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.plId) {
    params.push(filter.plId);
    clauses.push(`pl_id = $${params.length}`);
  }
  if (filter.plIdIn) {
    params.push(filter.plIdIn);
    clauses.push(`pl_id = ANY($${params.length})`);
  }
  if (filter.status) {
    params.push(filter.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filter.archived !== undefined) {
    params.push(filter.archived);
    clauses.push(`archived = $${params.length}`);
  }
  if (filter.delivererId) {
    params.push(filter.delivererId);
    clauses.push(
      `id IN (SELECT ang.project_id FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE a.deliverer_id = $${params.length})`
    );
  }
  if (filter.delivererIdIn) {
    params.push(filter.delivererIdIn);
    clauses.push(
      `id IN (SELECT ang.project_id FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE a.deliverer_id = ANY($${params.length}))`
    );
  }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(`${SELECT}${where} ORDER BY project.created_at DESC`, params);
  return rows;
}

export interface CreateProjectInput {
  plId: string;
  client: string;
  account?: string;
  topic?: string;
  projectLink: string;
  projectType: string;
  expertPool: string;
  status: ProjectStatus;
}

/** Creates the project row only -- angles (and their assignments) are created separately via repositories/angles.ts, since a project always needs >=1. */
export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  const { rows } = await pool.query(
    `INSERT INTO project (pl_id, client, account, topic, project_link, project_type, expert_pool, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.plId,
      input.client,
      input.account ?? null,
      input.topic ?? null,
      input.projectLink,
      input.projectType,
      input.expertPool,
      input.status,
    ]
  );
  return (await findProjectById(rows[0].id))!;
}

const PATCHABLE_COLUMNS: Record<string, string> = {
  client: "client",
  account: "account",
  topic: "topic",
  projectLink: "project_link",
  projectType: "project_type",
  expertPool: "expert_pool",
};

/** callsN/goalTotal/callsSold are no longer project fields -- edit them via repositories/angles.ts (updateAngleFields) instead. */
export async function updateProjectFields(id: string, patch: Record<string, unknown>): Promise<ProjectRow> {
  const sets: string[] = [];
  const params: unknown[] = [id];

  for (const [key, column] of Object.entries(PATCHABLE_COLUMNS)) {
    if (key in patch) {
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length > 0) {
    await pool.query(`UPDATE project SET ${sets.join(", ")} WHERE id = $1`, params);
  }
  return (await findProjectById(id))!;
}

export async function setArchived(id: string, archived: boolean): Promise<ProjectRow> {
  await pool.query(`UPDATE project SET archived = $2 WHERE id = $1`, [id, archived]);
  return (await findProjectById(id))!;
}

/** §4 — first-commit-wins claim of an open project. Returns null if it was already claimed. */
export async function claimOpenProject(id: string): Promise<ProjectRow | null> {
  const { rows } = await pool.query(
    `UPDATE project SET status = 'matched' WHERE id = $1 AND status = 'open' RETURNING id`,
    [id]
  );
  if (rows.length === 0) return null;
  return (await findProjectById(id))!;
}
