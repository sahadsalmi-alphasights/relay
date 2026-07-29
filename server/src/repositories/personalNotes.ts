import { pool } from "../db";

export interface PersonalNoteRow {
  id: string;
  personId: string;
  body: string;
  createdAt: string;
}

const SELECT = `
  SELECT id, person_id AS "personId", body, created_at AS "createdAt"
  FROM personal_note`;

/** A person's own reminders, oldest first (same order the box lists them). */
export async function listPersonalNotes(personId: string): Promise<PersonalNoteRow[]> {
  const { rows } = await pool.query(`${SELECT} WHERE person_id = $1 ORDER BY created_at`, [personId]);
  return rows;
}

export async function findPersonalNoteById(id: string): Promise<PersonalNoteRow | null> {
  const { rows } = await pool.query(`${SELECT} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createPersonalNote(personId: string, body: string): Promise<PersonalNoteRow> {
  const { rows } = await pool.query(
    `INSERT INTO personal_note (person_id, body) VALUES ($1, $2) RETURNING id`,
    [personId, body]
  );
  return (await findPersonalNoteById(rows[0].id))!;
}

export async function updatePersonalNoteBody(id: string, body: string): Promise<PersonalNoteRow> {
  await pool.query(`UPDATE personal_note SET body = $2 WHERE id = $1`, [id, body]);
  return (await findPersonalNoteById(id))!;
}

export async function deletePersonalNote(id: string): Promise<void> {
  await pool.query(`DELETE FROM personal_note WHERE id = $1`, [id]);
}
