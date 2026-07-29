# Feature spec: Audit Log sidebar

## Goal

Give authorised users a page in the app to see **who changed what, and when**.
The data is already being recorded on every mutation; this feature adds the
**read API** and the **sidebar view**. It becomes meaningful once SSO is live,
since `actor_id` then maps to a real person.

## What already exists (do not rebuild)

Table `audit_log` (from `server/migrations/1731000000000_init-schema.js`):

| column        | type        | notes                                   |
|---------------|-------------|-----------------------------------------|
| `id`          | uuid PK     |                                         |
| `entity_type` | text        | e.g. `angle`, `assignment`, `project`   |
| `entity_id`   | uuid        |                                         |
| `actor_id`    | uuid FK → `person(id)` | who made the change          |
| `action`      | text        | e.g. `update_fields`, `delete`, `swap`  |
| `old_value`   | jsonb       | nullable                                |
| `new_value`   | jsonb       | nullable                                |
| `created_at`  | timestamptz | defaults to `now()`                     |

Index: `idx_audit_entity (entity_type, entity_id)`.

Writer: `server/src/repositories/auditLog.ts` → `insertAuditLog(...)`, already
called across `routes/angles.ts`, `routes/assignments.ts`, project edits, and
goal-change routes.

## To build

### 1. Read API

Add `server/src/repositories/auditLog.ts` → a `listAuditLog(...)` query, and a
new route file `server/src/routes/auditLog.ts` registered in `server/src/app.ts`:

```ts
app.register(auditLogRoutes, { prefix: "/audit-log" });
```

Endpoint: `GET /api/audit-log`

- **Auth:** `preHandler: [app.requireAuth]`. **Decide access control** — recommend
  restricting to PLs/admins (audit trails are sensitive). Follow the existing
  PL-only pattern used in `routes/angles.ts`.
- **Query params (all optional):** `entityType`, `entityId`, `actorId`,
  `action`, `from`, `to` (ISO dates), `limit` (default 50, max 200), `offset`.
- **Response:** newest first, joined to `person` for the actor's name/email:

```json
{
  "items": [
    {
      "id": "…",
      "entityType": "angle",
      "entityId": "…",
      "action": "update_fields",
      "actor": { "id": "…", "name": "Jane Doe", "email": "jane@alphasights.com" },
      "oldValue": { "...": "..." },
      "newValue": { "...": "..." },
      "createdAt": "2026-07-17T02:57:13Z"
    }
  ],
  "total": 1234
}
```

- Add an API test (`routes/auditLog.api.test.ts`) mirroring the existing
  `*.api.test.ts` style: seed a couple of audit rows, assert filtering, ordering,
  pagination, and that a non-authorised actor is rejected.

### 2. Web sidebar page

- Add a nav entry in `web/src/Shell.tsx` (follow the existing tab pattern), shown
  only to authorised roles.
- Add `web/src/tabs/AuditLogTab.tsx`:
  - Table columns: **When** (relative + absolute on hover), **Who** (actor name),
    **Action**, **Entity** (`entity_type` + short id or resolved label), **Change**
    (a compact old→new diff; expandable row for full `old_value`/`new_value`).
  - Filters: date range, actor, entity type, action.
  - Pagination or infinite scroll using `limit`/`offset`.
- Add the response types to `web/src/api/types.ts`.

### 3. Keep the trail complete

Any **new** mutating endpoint must call `insertAuditLog(...)` with the acting
`actor.id`, so nothing bypasses the log.

## Acceptance criteria

- Authorised user sees a sidebar "Audit log" entry; unauthorised users do not.
- The page lists changes newest-first with actor, action, entity, timestamp, and
  an expandable old→new diff.
- Filters (date, actor, entity type, action) and pagination work.
- API rejects unauthorised access; covered by tests.
- All 6 CI checks pass.
