import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { loginAs, resetAndSeedFixture, type Fixture } from "../test/fixtures";

let app: FastifyInstance;
let fx: Fixture;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  fx = await resetAndSeedFixture();
});

/** A second assignment on the fixture's project, for a different deliverer. */
async function addSecondAssignment(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assignment (project_id, deliverer_id, goal, delivered, custom_goal, custom_delivered)
     VALUES ($1, $2, 4, 0, 0, 0) RETURNING id`,
    [fx.project, fx.otherDelivererAlpha]
  );
  return rows[0].id;
}

describe("domain change 8 — stage is per-deliverer, not per-project (end-to-end)", () => {
  it("advancing one assignment's stage never touches a sibling assignment on the same project", async () => {
    const secondAssignmentId = await addSecondAssignment();
    const cookie = await loginAs(app, fx.plAlpha);

    const advanceRes = await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/stage/advance`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(advanceRes.statusCode).toBe(200);
    expect(advanceRes.json().stage).toBe("Second Deliverable");

    const { rows } = await pool.query("SELECT stage FROM assignment WHERE id = $1", [secondAssignmentId]);
    expect(rows[0].stage).toBe("First Deliverable"); // untouched
  });

  it("the project's earliestStage is the lowest among its assignments, and updates as they change", async () => {
    const secondAssignmentId = await addSecondAssignment();
    const cookie = await loginAs(app, fx.plAlpha);

    // Both start on First Deliverable.
    let detail = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(detail.json().project.earliestStage).toBe("First Deliverable");

    // Advance only one — earliest is still First Deliverable (the other one).
    await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/stage/advance`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    detail = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(detail.json().project.earliestStage).toBe("First Deliverable");

    // Advance the second one too — now earliest becomes Second Deliverable.
    await app.inject({
      method: "POST",
      url: `/assignments/${secondAssignmentId}/stage/advance`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    detail = await app.inject({
      method: "GET",
      url: `/projects/${fx.project}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(detail.json().project.earliestStage).toBe("Second Deliverable");
  });

  it("a project with no assignments has a null earliestStage (the open pool)", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const createRes = await app.inject({
      method: "POST",
      url: "/projects",
      cookies: { relay_session: cookie.split("=")[1] },
      payload: {
        client: "Client_Unstaffed",
        projectLink: "https://example.test/proj/unstaffed",
        projectType: "Pitch",
        expertPool: "Global",
        callsN: 2,
        goalTotal: 6,
        assignments: [],
      },
    });
    expect(createRes.json().earliestStage).toBeNull();
  });

  it("a freshly staffed deliverer starts on First Deliverable regardless of their project's other stages", async () => {
    // Advance the fixture assignment first, so the project is "ahead."
    const cookie = await loginAs(app, fx.plAlpha);
    await app.inject({
      method: "POST",
      url: `/assignments/${fx.assignment}/stage/advance`,
      cookies: { relay_session: cookie.split("=")[1] },
    });

    const swapRes = await app.inject({
      method: "GET",
      url: `/assignments/${fx.assignment}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(swapRes.json().stage).toBe("Second Deliverable");

    // A brand new assignment on the same project defaults to First Deliverable.
    const newAssignmentId = await addSecondAssignment();
    const { rows } = await pool.query("SELECT stage FROM assignment WHERE id = $1", [newAssignmentId]);
    expect(rows[0].stage).toBe("First Deliverable");
  });
});
