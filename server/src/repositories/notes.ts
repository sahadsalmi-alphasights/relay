import { pool } from "../db";

export interface NoteRow {
  id: string;
  projectId: string;
  authorId: string;
  authorRole: "PL" | "Delivery";
  body: string;
  isPublic: boolean;
  createdAt: string;
}

const SELECT = `
  SELECT id, project_id AS "projectId", author_id AS "authorId", author_role AS "authorRole",
         body, is_public AS "isPublic", created_at AS "createdAt"
  FROM note`;

export async function createNote(input: {
  projectId: string;
  authorId: string;
  authorRole: "PL" | "Delivery";
  body: string;
  isPublic: boolean;
}): Promise<NoteRow> {
  const { rows } = await pool.query(
    `INSERT INTO note (project_id, author_id, author_role, body, is_public)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.projectId, input.authorId, input.authorRole, input.body, input.isPublic]
  );
  const { rows: full } = await pool.query(`${SELECT} WHERE id = $1`, [rows[0].id]);
  return full[0];
}

/** Public notes are visible to anyone on the project; private notes only to their author. */
export async function listNotesForProject(projectId: string, actorId: string): Promise<NoteRow[]> {
  const { rows } = await pool.query(
    `${SELECT} WHERE project_id = $1 AND (is_public = true OR author_id = $2) ORDER BY created_at`,
    [projectId, actorId]
  );
  return rows;
}

/** Board endpoint (2026-07-21) — same privacy filter, one query for every project on a board. */
export async function listNotesByProjectIds(projectIds: string[], actorId: string): Promise<NoteRow[]> {
  if (projectIds.length === 0) return [];
  const { rows } = await pool.query(
    `${SELECT} WHERE project_id = ANY($1) AND (is_public = true OR author_id = $2) ORDER BY created_at`,
    [projectIds, actorId]
  );
  return rows;
}
