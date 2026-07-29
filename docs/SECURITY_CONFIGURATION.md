# CapTracker (Relay) — Full Security Configuration Reference

**Audience:** team members, contributors, and anyone operating CapTracker.
**Scope:** the complete set of controls securing this app against vulnerabilities and misconfigurations — architecture, code, build pipeline, and operations. Current as of 2026-07-28.
**App:** internal capacity-and-delivery tracker, ~50 internal users, no external or customer-facing surface.
**Roadmap to enterprise-grade:** see §21 for the prioritized hardening plan (verify-what's-claimed → close known limits → governance).

---

## 0. Security principles the app is built on

1. **The server is the authority.** All business logic, validation, and authorization run server-side; the client only renders. Hiding a button is never a control.
2. **Fail loud, not degraded.** A misconfigured deployment refuses to start rather than running with broken auth (see §13).
3. **Deny by default.** Unknown origins, unauthenticated sockets, non-allowlisted CSP hosts, non-owner admin access — everything starts closed and is opened deliberately.
4. **Least data.** Dummy data only until governance sign-off; the app stores no PII beyond name + company email from SSO.
5. **Everything auditable.** Every mutation writes an append-only audit trail.

---

## 1. Network architecture — defense in depth

Every production request passes through all of these layers, in order:

| Layer | Control | Configured in |
|---|---|---|
| Cloudflare Access (Zero Trust) | Company login wall **before the app is reachable at all**; unauthenticated visitors never touch our infrastructure | Cloudflare dashboard |
| Cloudflare TLS | HTTPS at the edge for all traffic | Cloudflare dashboard |
| cloudflared tunnel | The origin dials **out** to Cloudflare — **no inbound port is open on the VM**, so there is no IP anyone can hit to bypass the layers above | VM tunnel daemon |
| nginx | Serves the SPA, proxies `/api/` to the API, attaches all browser security headers (§7) | `web/nginx.conf` |
| Fastify API | SSO auth, sessions, per-request authorization, rate limiting, audit logging | `server/src/` |
| Postgres | Reachable **only on the internal Docker network** — never published on the host in production | `docker-compose.prod.yml` |

Result: no path to the app skips company SSO; no path to the API skips per-request authorization; no path to the database skips the API.

## 2. Authentication

- **OIDC SSO (Authorization Code + PKCE)** via `openid-client` — the only production sign-in. No passwords exist anywhere in the system. PKCE verifier, `state`, and `nonce` round-trip in a short-lived (10 min) signed `httpOnly` cookie; ID-token signature/expiry/audience/nonce validation is done by the library — nothing security-critical is hand-rolled.
- **Provider-agnostic by discovery** (`/.well-known/openid-configuration`) — no IdP is hardcoded. Discovery is lazy and cached, and a *failed* discovery is not cached, so an unreachable IdP can't crash-loop the server or wedge future logins.
- **Two auth modes that can never coexist:**
  - `DEV_AUTH=true` (local dev: pick a seeded dummy user) is **impossible in production** — the server refuses to boot if combined with `NODE_ENV=production`.
  - With DEV_AUTH off, the `/auth/dev-*` routes return 403; with it on, the `/auth/oidc/*` routes return 403. There is no in-between state.
- **Deactivated accounts** are blocked at sign-in **and** re-checked on every single request — deactivation takes effect immediately, not at next login.
- **Owner allowlist** (`OWNER_EMAILS` env): allowlisted emails are re-granted Owner and reactivated on every login — administrators can never be locked out by portal changes or DB state.

## 3. Session management

- Session = signed cookie (`@fastify/cookie` HMAC), **`httpOnly`** (no JS access), **`Secure`** in production, **`SameSite=Lax`**, path-scoped.
- **Server-side expiry:** the expiry timestamp is embedded *inside the signed payload* (`personId.expiresAtMs`) and checked on every request — a stolen cookie value dies after 7 days regardless of cookie attributes, which are browser-enforced only and attacker-ignorable.
- The cookie carries **only a person id + expiry** — no roles, no permissions, nothing tamperable. Identity and permissions are re-resolved from the database on every request, so role changes and deactivations apply instantly.
- **Kill switch:** rotating `SESSION_SECRET` invalidates every session at once.

## 4. Authorization & access control

- **Enforced server-side on every route** — centralized in `server/src/rules/permissions.ts` (unit-tested), never inlined ad hoc, never trusted to the UI.
- **Role model:** Owner > Manager > Member.
  - Owners pass every check and are **hardcoded in the app layer** — no database state can lock owners out.
  - Manager/Member capabilities come from the owner-editable **permission matrix** (User Management → User groups), seeded to safe defaults.
  - The User Management portal itself is Owner-only **in code**, not in the matrix — no configuration change can expose it.
- **Ownership beats roles for project work:** a PL controls their own project regardless of group; a deliverer alone writes their own `delivered`/`custom_delivered`; **nobody** — PL included — writes `custom_goal` directly (it is always derived).
- **Team scoping:** non-owners exercise people-permissions (status, roster, ghost flags, rota) only on their own team.
- **Self-serve boundaries:** `evening_coverage` is each person's own live toggle — managers can read it, never set it.
- Authorization is **per-resource, not per-user-role** (a person is "the PL" only on projects they lead), which eliminates whole classes of privilege confusion.

## 5. Injection & input-validation defenses

- **SQL injection:** all SQL is parameterized (`$1, $2, …`) via `pg` — no string-concatenated values anywhere. Dynamic UPDATE builders map JSON keys through **hardcoded column allowlists** (e.g. `PATCHABLE_COLUMNS`), so field names can never be attacker-supplied — which is simultaneously **mass-assignment protection**: a request body can only ever touch the columns explicitly listed for that endpoint.
- **URL validation:** `project_link` is validated server-side to be `http:`/`https:` only — `javascript:`, `data:`, and other URI schemes are rejected, so stored links can never become script vectors when rendered as hyperlinks.
- **Type/shape validation:** route inputs are typed and validated at the handler level; numeric query params are clamped (e.g. audit-log `limit` capped at 200); required fields return 400 with a named field, never a stack trace.
- **Request size:** Fastify's 1 MB default body limit applies — no unbounded payloads.
- **IDs are UUIDs** generated server-side — no sequential IDs to enumerate.

## 6. XSS defenses

- **React auto-escaping** — the app renders no `dangerouslySetInnerHTML`, no `eval`, no `new Function` (verified by grep and by Semgrep in CI).
- **Content-Security-Policy** (§7) as the backstop: even if markup injection were found, foreign scripts cannot load (`script-src 'self'`) and the app cannot be framed.
- Stored user content (notes, justifications, names) is rendered exclusively through React's escaping path.

## 7. Browser security headers

Attached by nginx to **every** response — the SPA and proxied `/api` responses alike:

| Header | Value / effect |
|---|---|
| `Strict-Transport-Security` | 1 year + includeSubDomains — browsers refuse plain HTTP after first visit |
| `Content-Security-Policy` | `default-src 'self'`. Scripts: self only. The **only** external hosts allowed: Google Fonts (styles/fonts) and `logo.clearbit.com` (client logo chips, images only). Frames, objects, and foreign scripts blocked; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'` |
| `X-Frame-Options: DENY` | No embedding in iframes (clickjacking) |
| `X-Content-Type-Options: nosniff` | No MIME sniffing |
| `Referrer-Policy: strict-origin-when-cross-origin` | No URL leakage cross-origin |
| `Permissions-Policy` | camera, microphone, geolocation disabled |

**Rule:** if you add an external resource to the frontend, the CSP blocks it until the allowlist in `web/nginx.conf` is widened deliberately — one host at a time, never a wildcard.

## 8. CSRF & CORS

- **CORS is pinned to the exact web origin** (`WEB_ORIGIN` env) with `credentials: true` — never a wildcard, which would be rejected by browsers for credentialed requests anyway. Foreign origins can send requests but can never read responses.
- **`SameSite=Lax`** on the session cookie blocks the cookie from riding on cross-site POST/PATCH/DELETE — the classic CSRF vector. All state-changing routes use those methods; no state-changing GETs exist.
- Cookies are signed — a forged or tampered cookie fails HMAC verification and the request proceeds unauthenticated.

## 9. API abuse & availability

- **Rate limiting** (production): 300 requests/minute **per authenticated user** — keyed per person, not per IP, because the office shares one egress IP and a shared bucket would throttle everyone collectively. Pre-login traffic is keyed on the Cloudflare-reported client IP. Exceeding it returns 429 with `x-ratelimit-*` headers.
- **Expensive-endpoint caching:** `/capacity-ranking` (the heaviest query) is cached for 15 s in production — the fix for a real CPU-starvation incident, and a hard cap on what a refresh-spamming client can cost.
- **WebSocket hygiene:** a 30-second heartbeat sweep detects and closes dead connections, so abandoned sockets can't accumulate.
- **Live-update storm control:** the client coalesces bursts of invalidation events into a single refetch (~700 ms debounce), so a busy board doesn't self-DDoS the API.

## 10. Realtime (WebSocket) security

- The socket upgrade authenticates with the **same signed session cookie** as REST (`requireAuth` preHandler) — an unauthenticated upgrade gets a plain 401 and never connects.
- **Invalidate-only protocol:** the server pushes tiny "something changed" signals, never data payloads. Clients refetch through the same authorized REST endpoints they already use — so the socket layer *cannot* leak more than REST allows, and REST's authorization logic is never duplicated (or allowed to drift).
- Event fan-out mirrors REST visibility exactly: project events go only to that project's PL, assignees, and their teammates; the single event type that carries content (a personal notification) goes only to its one recipient.

## 11. Notifications & Web Push

- In-app notifications are scoped to their owner at the query level; read/delete routes only ever operate on the caller's own rows.
- **Web Push is strictly opt-in** per browser — nothing auto-subscribes. Subscriptions are stored per person, keyed by endpoint; delete requires owning both.
- Push uses the standard **VAPID** protocol — the private key lives only in the server env; no third-party push service is involved beyond the browser vendors' own endpoints. Dead subscriptions (404/410) are pruned automatically on the next send.

## 12. Data protection

- **Dummy data only** until data governance signs off — seeds and fixtures contain only fictional clients (`Client_A`) and fixture people. No real client, project, or personnel data may be entered. Standing rule, not temporary.
- **Minimal PII by design:** the only personal data stored is name + company email (from SSO claims) and work-state fields. No phone numbers, no addresses, no external identifiers.
- **Soft delete:** projects are never hard-deleted (`deleted_at` + filtered queries) — history stays reconstructable, and deletion can't be used to cover tracks.
- Progress credit survives reassignment with attribution recorded, so historical stats can't be silently rewritten.

## 13. Misconfiguration defenses (boot-time hard-fails)

The server **refuses to start** — deliberately, loudly — in every one of these states, so a bad deploy fails in seconds instead of running insecurely or locking users out:

| Misconfiguration | Guard |
|---|---|
| `DEV_AUTH=true` in production | Boot refusal — the no-login dev mode can never reach production |
| SSO on but any of the four `OIDC_*` vars missing | Boot refusal — prevents a deploy where nobody can log in (or worse, a silent fallback) |
| Empty `SESSION_SECRET` | Boot refusal — prevents unsigned/weakly-signed sessions |
| Wrong/missing `WEB_ORIGIN` | CORS simply blocks the mismatched origin (fails closed) |
| Stale schema at deploy | Migrations run before the app starts (`migrate:up && node dist`) — the API never serves against a schema it doesn't expect |
| Dev database exposed on shared wifi | Dev compose ports bound to `127.0.0.1` only |
| Secrets committed by accident | `.env*` gitignored + Gitleaks scanning every push in CI |
| Real credentials in examples | `.env.example` / `.env.production.example` contain placeholders only |

## 14. Error handling & information exposure

- A central error handler returns **typed, minimal errors** (400/401/403/404/409 with a short message). Unexpected errors return a generic `internal_error` — **stack traces and internals are logged server-side, never sent to clients**.
- `/health` exposes only `{status, db}` — no versions, no config.
- Auth failures are uniform (401 "unauthorized") — no user-enumeration through differing responses.
- Server logs (pino) record request metadata for diagnosis but never log secrets, cookies, or token contents.

## 15. Audit & accountability

- **`audit_log` is append-only** and written on every mutation: entity, actor, action, old value → new value, timestamp. This is the "what changed and who did it" answer the old spreadsheet never had.
- Sensitive actions carry extra context by design:
  - **Manual staffing overrides** require a written justification, which is logged (and deliberately not broadcast — no one is told they were passed over).
  - **Downward goal revisions** at intake are logged with both the suggested and the chosen value.
  - **Deliverer swaps** record original attribution so historical stats stay honest.
- Viewing the audit log in-app requires the `audit.view` permission (Managers by default, Owners always) — audit data is itself access-controlled.

## 16. Container & image hardening

- **Non-root everywhere:** the API runs as `node`; the web server is `nginx-unprivileged` (uid 101) listening on an unprivileged port.
- **Multi-stage API image:** production dependencies + compiled `dist/` only — no source, no dev toolchain, no test files in the shipped image.
- Base images are patched at build (`apt-get upgrade` / `apk upgrade`), and npm is upgraded past a known-critical vendored-tar CVE before any package extraction happens.
- Both images are **Trivy-scanned in CI on every PR** — criticals block the merge.
- Images are built on GitHub runners (never on the production VM) and pulled prebuilt — the VM never needs build tooling, and deploys are seconds of downtime.

## 17. CI/CD & supply-chain security

Branch protection requires **all six checks green** on a PR before merge; direct pushes to `main` are blocked. Merging to `main` is the deploy.

| Check | Tool | Blocks on |
|---|---|---|
| Secret scanning | Gitleaks (full history) | any finding |
| Dependency vulnerabilities | Trivy filesystem scan | criticals (highs reported) |
| Static analysis | Semgrep (`security-audit` + `typescript` rulesets) | any finding |
| Server build + tests | tsc + vitest (~330 integration tests against real Postgres) | any failure |
| Web build | tsc + vite | any failure |
| Container image scan | Trivy on both built images | criticals (highs reported) |

- **Every GitHub Action is pinned to a commit SHA** (tag kept as a comment) — a compromised or retagged upstream action cannot silently change what runs in our pipeline.
- `npm audit` runs on every build; **Dependabot** tracks and PRs dependency updates continuously. Current status: **0 known vulnerabilities** in server production dependencies.
- Images are pushed to GHCR tagged both `latest` and the commit SHA — the SHA tags are what make instant rollback possible (§19).

## 18. Rules for contributors (the controls that keep the above true)

1. **Every new mutating endpoint** gets a server-side authorization check **and** an `audit_log` write. No exceptions.
2. **Never edit an existing migration** — one new timestamped file per schema change.
3. **Never seed, commit, or test with real client/personnel data.**
4. **Never widen CSP, CORS, or cookie settings as a debugging shortcut** — if something is blocked, that's a design conversation.
5. **Secrets never appear in code, tests, fixtures, chat, or tickets** — env vars + the secrets store only.
6. Extend `rules/permissions.ts` rather than inlining permission checks — that module is unit-tested and is the single place authorization logic lives.
7. New SQL goes through parameterized queries and column allowlists, same as everything else.

## 19. Operational runbooks

**Rollback** (no DB rollback ever needed for a code-only deploy; schema changes ride separate migrations):
- *Normal (~10 min, no server access):* GitHub → merged PR → **Revert** → merge the revert PR when green → CI redeploys the previous behavior.
- *Emergency (~2 min, VM):* check out the previous main commit on the VM (compose config and images roll back **together**), pull the GHCR images tagged with that commit SHA, retag as `latest`, `docker compose up -d` — without `pull`.

**Log everyone out now:** rotate `SESSION_SECRET` and restart the API.

**Lock out a person immediately:** deactivate them in User Management — takes effect on their next request, not their next login.

**Admin locked out:** impossible by design — `OWNER_EMAILS` re-grants Owner at login.

**Diagnose a sick deploy:** `docker compose logs api --tail 50` (a boot refusal names the failed config check) → browser console (a red CSP line = blocked resource = one-line nginx allowlist fix, not a rollback).

## 20. Known limitations (deliberate trade-offs, revisit as the app grows)

- **Logout doesn't revoke server-side** — it clears the cookie; the signed value stays valid until its embedded 7-day expiry. Next step if requirements tighten: a sessions table with per-session revocation.
- **CSP allows inline styles** (`'unsafe-inline'` in `style-src`) — required by React style attributes; standard for SPAs.
- **Rate-limit state is in-memory per process** — correct single-instance; needs a shared store if the API scales horizontally.
- **No formal data-retention policy yet** — owned by the data-governance sign-off that gates real data entering the system.
- **Cloudflare Access JWT is not re-validated at the origin** — the tunnel makes the origin unreachable directly, so this is defense-in-depth we've deferred, not an open door.

---

## 21. Security hardening roadmap (path to enterprise-grade)

The controls above are strong for an internal ~50-user tool. This section is the deliberate plan to reach enterprise/compliance-grade, kept as living backlog. Work it top-down: **one tracked issue per row, one PR per item**, and when an item lands, fold it into the relevant section above and mark it Done here.

**Priority:** P0 = do first (highest leverage / lowest effort, or a trust gap). P1 = near-term. P2 = governance & assurance (mostly process, not code).
**Status:** ☐ not started · ◐ in progress · ☑ done.

### P0 — Prove the documented controls are actually live (a doc can drift from the deploy)

Before adding anything, confirm each claimed control above is real in production. This is the cheapest, highest-trust work: it either passes (confidence) or finds a real gap.

Verification pass 2026-07-28 (☑ pass · ✗ gap found · ☐ not yet checked):

| # | Verify | Finding (2026-07-28) | Status |
|---|---|---|---|
| 0.1 | Every §7 header is emitted in prod | `web/nginx.conf` declares HSTS/CSP/X-Frame/nosniff/Referrer/Permissions at server scope on all responses. Confirm once against the live domain with `curl -sI`. | ☑ (code) |
| 0.2 | All six §17 CI checks exist **and are required** in branch protection | All six jobs present in `pipeline.yml`, pinned to commit SHAs. Still confirm they're marked **required** in repo branch-protection settings. | ☑ (code) |
| 0.3 | Postgres app role is **non-superuser**, DML-only | **✗ GAP.** App connects as `relay`, which is a **superuser** (`rolsuper=t`, createdb, createrole). Same `POSTGRES_USER` pattern in prod → prod app role is superuser too. Fix: scoped role with DML only. | ✗ |
| 0.4 | `audit_log` is append-only **at the DB level** | **✗ GAP.** App role holds `UPDATE`/`DELETE`/`TRUNCATE` on `audit_log` — append-only is app-convention only, not DB-enforced. Fix: `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM <app_role>`. | ✗ |
| 0.5 | Connection to Postgres uses **TLS in transit** | `DATABASE_URL` has no `sslmode`. Internal Docker network, but still cleartext on the host. Add `sslmode=require` (or keep documented as an accepted internal-network risk). | ☐ |
| 0.6 | Backups exist **and a restore has been tested** | Not verifiable from the repo — confirm on the VM / GCP snapshot policy + run one restore drill. | ☐ |
| 0.7 | Encryption at rest for the DB volume/host | GCP Compute Engine persistent disks are encrypted at rest by default; confirm the VM uses one (and consider CMEK). | ☐ |

**Applied 2026-07-28** (branch `feature/security-hardening`): explicit `bodyLimit` (256 KB) + `requestTimeout` (30 s) on the API (P1-adjacent, OWASP API4); web build made reproducible — committed `web/package-lock.json` and switched web Dockerfile + CI to `npm ci`.

### P0 remediation runbook — least-privilege DB role + append-only audit (fixes 0.3 + 0.4)

**Status:** code shipped on `feature/security-hardening`, deploy-time ops steps below **not yet run in prod**. Design verified locally 2026-07-28 (as the scoped role: INSERT/SELECT ok; UPDATE/DELETE/TRUNCATE on `audit_log` denied; the `SECURITY DEFINER` anonymize function still succeeds).

**What the code change already did:**
- Migration `1731000018000_audit-log-anonymize-fn` adds a `SECURITY DEFINER` function so the one legitimate `audit_log` mutation (de-identifying a deleted person's actor_id) works even when the app role can't UPDATE the table. `repositories/people.ts` now calls it instead of a raw UPDATE.
- `server/Dockerfile.prod` runs migrations as `MIGRATE_DATABASE_URL` (owner, needs DDL) and the app process as `DATABASE_URL` (scoped role). Falls back to `DATABASE_URL` for both when `MIGRATE_DATABASE_URL` is unset — so **merging this branch changes nothing until you do the cutover below.**

**Cutover (run once on the VM, after the branch is deployed):**

1. Create the scoped runtime role (pick a strong password; store it in the secrets store, not the shell history):
   ```sql
   CREATE ROLE relay_app LOGIN PASSWORD '<STRONG_RANDOM>';
   GRANT CONNECT ON DATABASE relay TO relay_app;
   GRANT USAGE ON SCHEMA public TO relay_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO relay_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO relay_app;
   -- Append-only: the app role may add audit rows and read them, never rewrite/erase them.
   REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM relay_app;
   GRANT EXECUTE ON FUNCTION audit_log_anonymize_actor(uuid) TO relay_app;
   -- Future migrated tables/sequences (created by the owner) stay usable by the app role:
   ALTER DEFAULT PRIVILEGES FOR ROLE relay IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO relay_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE relay IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO relay_app;
   ```
   > After any future migration that creates `audit_log`-like append-only tables, re-run the matching `REVOKE UPDATE, DELETE, TRUNCATE`.

2. Update `.env.production` on the VM:
   ```
   # App connects as the least-privilege role…
   DATABASE_URL=postgres://relay_app:<STRONG_RANDOM>@db:5432/relay?sslmode=require
   # …migrations still run as the owner (DDL). Add this line:
   MIGRATE_DATABASE_URL=postgres://relay:<OWNER_PASSWORD>@db:5432/relay?sslmode=require
   ```
   (Adding `sslmode=require` here also closes verification item 0.5.)

3. Restart: `docker compose -f docker-compose.prod.yml --env-file .env.production up -d api`. Migrations run as owner, the app runs scoped.

4. Verify (should mirror the local proof):
   ```sql
   -- as relay_app:
   INSERT INTO audit_log (entity_type, entity_id, action) VALUES ('probe','…','verify');  -- OK
   UPDATE audit_log SET action='x';                                                        -- permission denied
   DELETE FROM audit_log;                                                                   -- permission denied
   ```

**Rollback:** revert `.env.production` (`DATABASE_URL` back to the owner role, drop `MIGRATE_DATABASE_URL`) and restart. No schema rollback needed — the function is inert if unused.

### P1 — Close the known limitations (§20) and add core enterprise controls

| # | Item | Why it matters | Effort | Status |
|---|---|---|---|---|
| 1.1 | **Server-side session revocation** — sessions table (or Redis): logout revokes, "log out all devices", idle timeout | Today a stolen/loose cookie is valid the full 7 days; logout is cookie-clear only (§20) | M | ☐ |
| 1.2 | **Shared rate-limit store** (Redis) + a **stricter, auth-endpoint-specific** limit on `/auth/*` | In-memory limit breaks on horizontal scale (§20); global 300/min doesn't resist login brute-force/enumeration | S–M | ☐ |
| 1.3 | **Centralized log shipping → SIEM** with alerting on auth failures, privilege changes, owner-allowlist use; define **log retention** | App-level `audit_log` isn't monitored or tamper-shipped; enterprises need detection + retention | M | ☐ |
| 1.4 | **Secrets manager** (Vault / AWS Secrets Manager / Doppler) + documented **`SESSION_SECRET` rotation** with a dual-secret verify window | Env-file secrets have no rotation story; rotation currently logs everyone out hard | M | ☐ |
| 1.5 | **DR runbook** with RTO/RPO targets, backup automation + scheduled restore drills | §19 covers code rollback, not data disaster recovery | M | ☐ |
| 1.6 | **Data-retention policy + right-to-erasure** (hard-delete/anonymize path alongside soft-delete) | §20 gap; required once real data enters (governance sign-off) | M | ☐ |
| 1.7 | **Cloudflare Access JWT re-validation at the origin** | Defense-in-depth deferred in §20; validates the `Cf-Access-Jwt-Assertion` even if the tunnel were ever bypassed | S | ☑ shipped, **env-gated / default-off** — set `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` to enable (both blank = inert) |
| 1.8 | **Formal request-schema validation** (TypeBox/zod) on every route body/params/query | Strengthens §5 from handler-level checks to a declarative, machine-readable contract; rejects unexpected/oversized fields uniformly | M | ☐ |

### P2 — Governance & assurance (process; enables audits/certification)

| # | Item | Why it matters | Status |
|---|---|---|---|
| 2.1 | **MFA enforced at the IdP** — document the requirement and verify the org policy | OIDC delegates auth to the IdP; MFA is only real if the IdP mandates it | ☐ |
| 2.2 | **Periodic access reviews** (quarterly) of `OWNER_EMAILS` and the permission matrix | Least-privilege drifts without review; auditors expect evidence | ☐ |
| 2.3 | **Independent penetration test** (annual) + remediation SLA | External assurance; usually a customer/compliance requirement | ☐ |
| 2.4 | **Written incident-response plan** + one tabletop exercise | Turns §19 runbooks into a full IR process (detect → contain → notify → post-mortem) | ☐ |
| 2.5 | **DPIA / data-flow + PII inventory** and a **subprocessor list** (Cloudflare, IdP, GHCR, push vendors) | Foundation for GDPR/SOC2-style compliance and the data-governance sign-off | ☐ |
| 2.6 | **Security training + secure-SDLC doc** referencing §18 contributor rules | Makes the controls durable as the team grows | ☐ |

> **Sequencing note:** P0 is a half-day audit and should happen before any new feature work — it tells us whether the posture we *describe* is the posture we *have*. P1.1 (session revocation) is the highest-value code change; P1.6/2.5 are gated on the data-governance sign-off that also gates real data entering the system.
