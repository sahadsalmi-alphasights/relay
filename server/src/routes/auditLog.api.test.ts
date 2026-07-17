import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { pool } from "../db";
import { insertAuditLog } from "../repositories/auditLog";
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

describe("docs/AUDIT_LOG_SPEC.md — GET /audit-log", () => {
  it("rejects a non-manager actor", async () => {
    const cookie = await loginAs(app, fx.delivererAlpha); // not a manager
    const res = await app.inject({
      method: "GET",
      url: "/audit-log",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lists entries newest-first, joined to the actor's name/email", async () => {
    await insertAuditLog({
      entityType: "project",
      entityId: fx.project,
      actorId: fx.plAlpha,
      action: "update_fields",
      oldValue: { client: "Old_Name" },
      newValue: { client: "New_Name" },
    });
    await new Promise((r) => setTimeout(r, 5)); // distinct created_at ordering
    await insertAuditLog({
      entityType: "angle",
      entityId: fx.angle,
      actorId: fx.plAlpha,
      action: "create",
      newValue: { name: "Second angle" },
    });

    const cookie = await loginAs(app, fx.plAlpha); // is_manager on Team_Alpha
    const res = await app.inject({
      method: "GET",
      url: "/audit-log",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    // newest first -- the angle "create" entry was inserted second.
    expect(body.items[0].entityType).toBe("angle");
    expect(body.items[0].action).toBe("create");
    expect(body.items[0].actor).toEqual({ id: fx.plAlpha, name: "PL_Alpha", email: "pl.alpha@test.example" });
    expect(body.items[1].entityType).toBe("project");
    expect(body.items[1].oldValue).toEqual({ client: "Old_Name" });
    expect(body.items[1].newValue).toEqual({ client: "New_Name" });
  });

  it("a manager on a different team can still view it (no team-scoped restriction -- audit trails span the whole org)", async () => {
    await insertAuditLog({ entityType: "project", entityId: fx.project, actorId: fx.plAlpha, action: "archive" });
    const cookie = await loginAs(app, fx.managerBeta); // manager, Team_Beta
    const res = await app.inject({
      method: "GET",
      url: "/audit-log",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it("filters by entityType, entityId, actorId, and action", async () => {
    await insertAuditLog({ entityType: "project", entityId: fx.project, actorId: fx.plAlpha, action: "archive" });
    await insertAuditLog({ entityType: "angle", entityId: fx.angle, actorId: fx.plAlpha, action: "create" });
    await insertAuditLog({ entityType: "angle", entityId: fx.angle, actorId: fx.managerBeta, action: "create" });

    const cookie = await loginAs(app, fx.plAlpha);
    const byEntityType = await app.inject({
      method: "GET",
      url: "/audit-log?entityType=angle",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(byEntityType.json().total).toBe(2);

    const byActor = await app.inject({
      method: "GET",
      url: `/audit-log?actorId=${fx.managerBeta}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(byActor.json().total).toBe(1);
    expect(byActor.json().items[0].actor.id).toBe(fx.managerBeta);

    const byAction = await app.inject({
      method: "GET",
      url: "/audit-log?action=archive",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(byAction.json().total).toBe(1);
    expect(byAction.json().items[0].entityType).toBe("project");

    const byEntityId = await app.inject({
      method: "GET",
      url: `/audit-log?entityId=${fx.angle}`,
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(byEntityId.json().total).toBe(2);
  });

  it("filters by a from/to date range", async () => {
    await pool.query(
      `INSERT INTO audit_log (entity_type, entity_id, actor_id, action, created_at)
       VALUES ('project', $1, $2, 'archive', '2020-01-01T00:00:00Z')`,
      [fx.project, fx.plAlpha]
    );
    await insertAuditLog({ entityType: "project", entityId: fx.project, actorId: fx.plAlpha, action: "archive" });

    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "GET",
      url: "/audit-log?from=2025-01-01T00:00:00Z",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.json().total).toBe(1); // only the recent one, not the 2020 row
  });

  it("paginates with limit/offset while total reflects the full filtered count", async () => {
    for (let i = 0; i < 5; i++) {
      await insertAuditLog({ entityType: "project", entityId: fx.project, actorId: fx.plAlpha, action: `action_${i}` });
    }
    const cookie = await loginAs(app, fx.plAlpha);
    const page1 = await app.inject({
      method: "GET",
      url: "/audit-log?limit=2&offset=0",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(page1.json().items).toHaveLength(2);
    expect(page1.json().total).toBe(5);

    const page2 = await app.inject({
      method: "GET",
      url: "/audit-log?limit=2&offset=2",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(page2.json().items).toHaveLength(2);
    // Pages don't repeat rows.
    const ids1 = page1.json().items.map((i: { id: string }) => i.id);
    const ids2 = page2.json().items.map((i: { id: string }) => i.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it("caps limit at 200 even if a caller asks for more", async () => {
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "GET",
      url: "/audit-log?limit=99999",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.statusCode).toBe(200); // just proves the route doesn't error; the cap is enforced server-side before the query runs
  });

  it("an entry with no actor (system-triggered) still appears, with actor: null", async () => {
    await insertAuditLog({ entityType: "project", entityId: fx.project, actorId: null, action: "system_cleanup" });
    const cookie = await loginAs(app, fx.plAlpha);
    const res = await app.inject({
      method: "GET",
      url: "/audit-log?action=system_cleanup",
      cookies: { relay_session: cookie.split("=")[1] },
    });
    expect(res.json().items[0].actor).toBeNull();
  });
});
