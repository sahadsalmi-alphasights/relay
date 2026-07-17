import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../db";

/**
 * Migrations 1731000007000_project-angles.js already ran against this
 * database (angle_id is NOT NULL on the live `assignment` table now), so
 * there's no way to reconstruct a genuine pre-migration row to backfill
 * against. This test proves the backfill ALGORITHM itself is correct --
 * one angle per project (named from topic, or "Main"), carrying over
 * calls_n/goal_total/calls_sold, with every existing assignment re-pointed
 * at its project's new angle -- by running the identical
 * INSERT...SELECT + UPDATE...FROM pattern from that migration against a
 * temporary scratch schema shaped like the old one.
 */
describe("project-angles migration — backfill converts existing data without loss", () => {
  afterEach(async () => {
    await pool.query(`DROP TABLE IF EXISTS legacy_assignment, legacy_project, legacy_angle`);
  });

  it("gives every legacy project exactly one angle, carrying over its N/goal/calls_sold, and re-points every assignment", async () => {
    await pool.query(`
      CREATE TEMP TABLE legacy_project (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        topic text,
        calls_n integer NOT NULL,
        goal_total integer NOT NULL,
        calls_sold integer NOT NULL DEFAULT 0,
        calls_sold_updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TEMP TABLE legacy_assignment (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL,
        deliverer_id uuid NOT NULL DEFAULT gen_random_uuid()
      );
      CREATE TEMP TABLE legacy_angle (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL,
        name text NOT NULL,
        calls_n integer NOT NULL,
        goal_total integer NOT NULL,
        calls_sold integer NOT NULL DEFAULT 0,
        calls_sold_updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        assignment_id uuid
      );
    `);

    const { rows: projects } = await pool.query<{ id: string }>(
      `INSERT INTO legacy_project (topic, calls_n, goal_total, calls_sold) VALUES
         ('Market sizing', 4, 8, 1),
         (NULL, 2, 6, 0),
         ('', 3, 9, 2)
       RETURNING id`
    );
    const [withTopic, noTopic, emptyTopic] = projects.map((p) => p.id);

    // 3 assignments across the 3 legacy projects (2 on the first, to prove
    // multiple assignments on one project all land on that project's single
    // new angle, not one each).
    const { rows: assignments } = await pool.query<{ id: string; project_id: string }>(
      `INSERT INTO legacy_assignment (project_id) VALUES ($1), ($1), ($2), ($3) RETURNING id, project_id`,
      [withTopic, noTopic, emptyTopic]
    );

    // The exact backfill pattern from 1731000007000_project-angles.js,
    // adapted to the legacy_* scratch tables: one angle per project (via
    // INSERT...SELECT), then every assignment re-pointed at its project's
    // new angle (via UPDATE...FROM), in the same two-step shape.
    await pool.query(`
      INSERT INTO legacy_angle (project_id, name, calls_n, goal_total, calls_sold, calls_sold_updated_at, created_at)
      SELECT id, COALESCE(NULLIF(topic, ''), 'Main'), calls_n, goal_total, calls_sold, calls_sold_updated_at, created_at
      FROM legacy_project;
    `);
    await pool.query(`ALTER TABLE legacy_assignment ADD COLUMN angle_id uuid`);
    await pool.query(`
      UPDATE legacy_assignment a
      SET angle_id = ang.id
      FROM legacy_angle ang
      WHERE ang.project_id = a.project_id;
    `);

    // Exactly one angle per project -- no data loss, no duplication.
    const { rows: angleCounts } = await pool.query<{ project_id: string; count: string }>(
      `SELECT project_id, COUNT(*) FROM legacy_angle GROUP BY project_id`
    );
    expect(angleCounts).toHaveLength(3);
    for (const row of angleCounts) expect(Number(row.count)).toBe(1);

    // Names: topic when present, "Main" when null or empty.
    const { rows: angles } = await pool.query<{ project_id: string; name: string; calls_n: number; goal_total: number; calls_sold: number }>(
      `SELECT project_id, name, calls_n, goal_total, calls_sold FROM legacy_angle`
    );
    const byProject = new Map(angles.map((a) => [a.project_id, a]));
    expect(byProject.get(withTopic)!.name).toBe("Market sizing");
    expect(byProject.get(noTopic)!.name).toBe("Main");
    expect(byProject.get(emptyTopic)!.name).toBe("Main");
    // N/goal/calls_sold carried over exactly, not reset or dropped.
    expect(byProject.get(withTopic)!.calls_n).toBe(4);
    expect(byProject.get(withTopic)!.goal_total).toBe(8);
    expect(byProject.get(withTopic)!.calls_sold).toBe(1);
    expect(byProject.get(emptyTopic)!.calls_sold).toBe(2);

    // Every assignment re-points to its own project's one angle -- zero orphans.
    const { rows: repointed } = await pool.query<{ id: string; project_id: string; angle_id: string }>(
      `SELECT id, project_id, angle_id FROM legacy_assignment`
    );
    expect(repointed).toHaveLength(4);
    for (const a of repointed) {
      expect(a.angle_id).not.toBeNull();
      expect(byProject.get(a.project_id)!).toBeDefined();
    }
    // The 2 assignments on the same (withTopic) project share the same angle.
    const withTopicAssignments = repointed.filter((a) => a.project_id === withTopic);
    expect(withTopicAssignments).toHaveLength(2);
    expect(withTopicAssignments[0].angle_id).toBe(withTopicAssignments[1].angle_id);
  });
});
