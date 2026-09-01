import { pool, type Queryable } from "../db";
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
  /** New set-up field — groups the PL board into rows, 1-5, no meaning beyond a label the PL assigns. */
  clientEntity: number;
  /** "Archive for deliverers only" (2026-07-24) — non-null = off every deliverer's board, but still active on the PL board. */
  deliveryClosedAt: string | null;
}

const SELECT = `
  SELECT id, pl_id AS "plId", client, account, topic, project_link AS "projectLink",
         project_type AS "projectType", expert_pool AS "expertPool",
         (SELECT COALESCE(SUM(ang.calls_n), 0)::int FROM angle ang WHERE ang.project_id = project.id) AS "callsN",
         (SELECT COALESCE(SUM(ang.goal_total), 0)::int FROM angle ang WHERE ang.project_id = project.id) AS "goalTotal",
         (SELECT COALESCE(SUM(ang.calls_sold), 0)::int FROM angle ang WHERE ang.project_id = project.id) AS "callsSold",
         status, client_entity AS "clientEntity", delivery_closed_at AS "deliveryClosedAt",
         (SELECT a.stage FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = project.id
          ORDER BY CASE a.stage
            WHEN 'First Deliverable' THEN 0 WHEN 'Second Deliverable' THEN 1
            WHEN 'Hail Mary' THEN 2 WHEN 'Selling' THEN 3 END ASC
          LIMIT 1) AS "earliestStage"
  FROM project`;

/** Batch S — soft-deleted rows never surface via this, the single lookup-by-id function every route guards on with `if (!project) throw notFound(...)`, so excluding here locks down nearly the whole read surface for free. */
export async function findProjectById(id: string, db: Queryable = pool): Promise<ProjectRow | null> {
  const { rows } = await db.query(`${SELECT} WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}

export interface ProjectFilter {
  plId?: string;
  plIdIn?: string[];
  delivererId?: string;
  delivererIdIn?: string[];
  status?: ProjectStatus;
  /**
   * Project lifecycle change — `archived` is no longer its own column, but
   * every existing caller still asks in these terms (the archived-vs-active
   * split on the PL board predates open even mattering to it), so this stays
   * a boolean at the filter layer and translates to `status`:
   * archived=true -> status = 'archived'; archived=false -> status <> 'archived'
   * (still includes open/active — exactly the "not archived" set the callers
   * actually mean; 'idle' was the third value here until Batch S removed it).
   */
  archived?: boolean;
  /** "Archive for deliverers only" — when true, exclude projects whose delivery is closed (the delivering-role boards pass this). */
  deliveryOpen?: boolean;
}

export async function listProjects(filter: ProjectFilter): Promise<ProjectRow[]> {
  // Batch S — soft delete is unconditional, not opt-in: no caller of this
  // function should ever see a deleted project, so it's the first clause
  // rather than something threaded through ProjectFilter.
  const clauses: string[] = ["deleted_at IS NULL"];
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
    clauses.push(filter.archived ? `status = 'archived'` : `status <> 'archived'`);
  }
  if (filter.deliveryOpen) {
    clauses.push(`delivery_closed_at IS NULL`);
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

  const where = ` WHERE ${clauses.join(" AND ")}`;
  // Batch S — three-tier recency ordering, identical on every board that
  // calls listProjects() (both boards do, so "identical" is structural, not
  // just behavioral):
  //   tier 1 (top): unstaffed (no assignments at all) — needs attention.
  //   tier 2: staffed, ordered by the most recent first_deliverable_last_at
  //     across the project's angles, newest first.
  //   tier 3 (bottom): staffed but no first_deliverable_last_at on record
  //     yet (NULLS LAST handles this — it's the same boolean-false bucket as
  //     tier 2, just sorting after every real timestamp).
  // project.created_at DESC is the final tiebreaker within a tier, same as
  // the pre-Batch-S ordering this replaces.
  const order = `
    ORDER BY
      ((SELECT COUNT(*) FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = project.id) = 0) DESC,
      (SELECT MAX(a.first_deliverable_last_at) FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = project.id) DESC NULLS LAST,
      project.created_at DESC`;
  const { rows } = await pool.query(`${SELECT}${where}${order}`, params);
  return rows;
}

export interface MarketShareFilter {
  /** Restrict to one PL (My View). */
  plId?: string;
  /** Restrict to a set of PLs (Team View — the team's members). */
  plIdIn?: string[];
  /** No plId/plIdIn = BU View (every card). */
}

/**
 * Monthly market share = calls_sold / calls_n across every project card
 * CREATED in the given month window, summed over all their angles.
 *
 * DELIBERATELY counts soft-deleted cards (no `deleted_at IS NULL` clause):
 * the spec requires deleted projects to still count toward the month's share
 * (a card that was created, sold against, then deleted still happened). This
 * is the one read in the app that must NOT inherit the standard soft-delete
 * filter — do not add one here. Archived/unarchived state is likewise
 * ignored: all angles of a qualifying project count.
 */
export async function marketShareForMonth(
  filter: MarketShareFilter,
  monthStartIso: string,
  monthEndIso: string
): Promise<{ callsSold: number; n: number }> {
  const clauses = ["p.created_at >= $1", "p.created_at < $2"];
  const params: unknown[] = [monthStartIso, monthEndIso];
  if (filter.plId) {
    params.push(filter.plId);
    clauses.push(`p.pl_id = $${params.length}`);
  } else if (filter.plIdIn) {
    params.push(filter.plIdIn);
    clauses.push(`p.pl_id = ANY($${params.length})`);
  }
  const { rows } = await pool.query<{ callsSold: string; n: string }>(
    `SELECT COALESCE(SUM(ang.calls_sold), 0)::int AS "callsSold",
            COALESCE(SUM(ang.calls_n), 0)::int AS "n"
     FROM project p
     JOIN angle ang ON ang.project_id = p.id
     WHERE ${clauses.join(" AND ")}`,
    params
  );
  return { callsSold: Number(rows[0].callsSold), n: Number(rows[0].n) };
}

export interface MarketShareBreakdownRow {
  projectId: string;
  client: string;
  angleName: string;
  plName: string;
  teamName: string | null;
  callsSold: number;
  callsN: number;
  createdAt: string;
  deleted: boolean;
}

/**
 * Per-angle detail behind marketShareForMonth, for the CSV export. Same window
 * and same filter/soft-delete semantics as the aggregate (deleted cards still
 * count — a `deleted` flag is surfaced so the export stays honest), so summing
 * the rows reproduces the bar exactly.
 */
export async function marketShareBreakdown(
  filter: MarketShareFilter,
  monthStartIso: string,
  monthEndIso: string
): Promise<MarketShareBreakdownRow[]> {
  const clauses = ["p.created_at >= $1", "p.created_at < $2"];
  const params: unknown[] = [monthStartIso, monthEndIso];
  if (filter.plId) {
    params.push(filter.plId);
    clauses.push(`p.pl_id = $${params.length}`);
  } else if (filter.plIdIn) {
    params.push(filter.plIdIn);
    clauses.push(`p.pl_id = ANY($${params.length})`);
  }
  const { rows } = await pool.query<{
    projectId: string;
    client: string;
    angleName: string;
    plName: string;
    teamName: string | null;
    callsSold: number;
    callsN: number;
    createdAt: string;
    deleted: boolean;
  }>(
    `SELECT p.id AS "projectId", p.client, ang.name AS "angleName",
            pl.name AS "plName", t.name AS "teamName",
            ang.calls_sold::int AS "callsSold", ang.calls_n::int AS "callsN",
            p.created_at AS "createdAt", (p.deleted_at IS NOT NULL) AS "deleted"
     FROM project p
     JOIN angle ang ON ang.project_id = p.id
     JOIN person pl ON pl.id = p.pl_id
     LEFT JOIN team t ON t.id = pl.team_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY t.name NULLS LAST, pl.name, p.client, ang.name`,
    params
  );
  return rows.map((r) => ({
    ...r,
    callsSold: Number(r.callsSold),
    callsN: Number(r.callsN),
    createdAt: new Date(r.createdAt).toISOString(),
  }));
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
  clientEntity: number;
}

/** Creates the project row only -- angles (and their assignments) are created separately via repositories/angles.ts, since a project always needs >=1. */
export async function createProject(input: CreateProjectInput, db: Queryable = pool): Promise<ProjectRow> {
  const { rows } = await db.query(
    `INSERT INTO project (pl_id, client, account, topic, project_link, project_type, expert_pool, status, client_entity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      input.plId,
      input.client,
      input.account ?? null,
      input.topic ?? null,
      input.projectLink,
      input.projectType,
      input.expertPool,
      input.status,
      input.clientEntity,
    ]
  );
  return (await findProjectById(rows[0].id, db))!;
}

const PATCHABLE_COLUMNS: Record<string, string> = {
  client: "client",
  account: "account",
  topic: "topic",
  projectLink: "project_link",
  projectType: "project_type",
  expertPool: "expert_pool",
  clientEntity: "client_entity",
};

/**
 * Transfer ownership to a different PL (2026-07-24). pl_id is deliberately
 * NOT in PATCHABLE_COLUMNS — reassigning who owns a project is its own
 * audited action, never a field edit, so it gets a dedicated writer and route.
 */
export async function transferProjectPl(id: string, newPlId: string): Promise<ProjectRow> {
  await pool.query(`UPDATE project SET pl_id = $2 WHERE id = $1`, [id, newPlId]);
  return (await findProjectById(id))!;
}

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

async function countAssignments(projectId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM assignment a JOIN angle ang ON ang.id = a.angle_id WHERE ang.project_id = $1`,
    [projectId]
  );
  return rows[0].n;
}

/** §4 — first-commit-wins claim of an open project. Returns null if it was already claimed. */
export async function claimOpenProject(id: string): Promise<ProjectRow | null> {
  const { rows } = await pool.query(
    `UPDATE project SET status = 'active' WHERE id = $1 AND status = 'open' RETURNING id`,
    [id]
  );
  if (rows.length === 0) return null;
  return (await findProjectById(id))!;
}

/**
 * Batch S — soft delete. Flags deleted_at rather than removing the row;
 * every read (findProjectById, listProjects) already excludes it
 * unconditionally, so this alone is what makes it "disappear from all
 * views." No route ever un-sets deleted_at — recovery is DB-access-only, by
 * design (never surfaced as an app feature). Idempotent-safe: a second call
 * on an already-deleted row matches zero rows and returns null rather than
 * bumping deleted_at again.
 */
export async function softDeleteProject(id: string): Promise<{ id: string } | null> {
  const { rows } = await pool.query(
    `UPDATE project SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Batch S — a direct, ungated status set, distinct from archive/resurface
 * (which each guard a specific prior state). Used only by the goal-change
 * accept flow: the PL is confirming a status the deliverer explicitly
 * requested, for whichever status they're currently at, so there's no
 * "only valid from X" transition to enforce here.
 */
export async function setProjectStatus(id: string, status: ProjectStatus): Promise<ProjectRow> {
  await pool.query(`UPDATE project SET status = $2 WHERE id = $1`, [id, status]);
  return (await findProjectById(id))!;
}

export async function archiveProject(id: string): Promise<ProjectRow> {
  await pool.query(`UPDATE project SET status = 'archived' WHERE id = $1`, [id]);
  return (await findProjectById(id))!;
}

/** "Archive for deliverers only" — off every deliverer's board; status stays as-is (active for the PL). */
export async function closeDeliveryForProject(id: string): Promise<ProjectRow> {
  await pool.query(`UPDATE project SET delivery_closed_at = now() WHERE id = $1`, [id]);
  return (await findProjectById(id))!;
}

/** Reopen delivery — the project reappears on its deliverers' boards. */
export async function reopenDeliveryForProject(id: string): Promise<ProjectRow> {
  await pool.query(`UPDATE project SET delivery_closed_at = NULL WHERE id = $1`, [id]);
  return (await findProjectById(id))!;
}

/**
 * Un-archives back to whichever of active/open it would be now, derived the
 * same way project creation decides it -- staffed means active, unstaffed
 * means back in the open pool -- since archiving doesn't remember which one
 * it was (nor should it: a project's assignments could have changed since).
 */
export async function resurfaceProject(id: string): Promise<ProjectRow> {
  const n = await countAssignments(id);
  await pool.query(`UPDATE project SET status = $2 WHERE id = $1`, [id, n > 0 ? "active" : "open"]);
  return (await findProjectById(id))!;
}
