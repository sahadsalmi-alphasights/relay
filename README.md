# Relay

Internal capacity-and-delivery tracker for the research/sourcing team: it
matches deliverers to projects, tracks sourcing progress against a goal, and
replaces a shared spreadsheet for who's free to take on the next project.

**Audience:** ~50 internal users (project leads and deliverers, every person
is both depending on which project they're looking at). No external users,
no customer-facing surface.

This document is written for **IT / infrastructure** — what to provision,
what to configure, and what to hand back so the app can go live. For product
behavior and the full functional spec, see
[RELAY_BUILD_SPEC.md](./RELAY_BUILD_SPEC.md).

---

## 1. What you're standing up

Three pieces:

| Component | What it is | Runs as |
|---|---|---|
| `web` | React + TypeScript SPA (Vite) | Static files behind any web server/CDN, **or** the bundled dev container if you're fine serving it that way |
| `api` | Fastify + TypeScript REST + WebSocket API | A single Node.js container |
| Postgres | All app data | Managed Postgres (RDS or equivalent) — do **not** run the Postgres container from `docker-compose.yml` in production, it's dev-only |

No other backing services are required. Notifications (in-app + optional
Web Push) are handled entirely by the `api` container and Postgres — no
external message queue or push service beyond the standard Web Push
protocol (which talks directly to each browser vendor's push endpoint).

**Stack:** Node.js 20, TypeScript, Fastify, PostgreSQL 16, React 18 + Vite,
plain WebSockets (`@fastify/websocket`). No ORM (hand-written SQL via `pg`),
migrations via `node-pg-migrate`.

---

## 2. What you need to provision

1. **A container host** for the `api` image (ECS/Fargate, or any
   Docker-capable host/orchestrator). It's a stateless Node process — no
   local disk state, no sticky sessions beyond the signed cookie, so it
   scales horizontally with no special affinity requirements.
2. **Static hosting for `web`** — the build output (`web`'s `npm run build`
   produces a `dist/` folder of static files) can be served from S3+CloudFront,
   any static host, or a simple nginx/static container. It's a pure SPA: no
   server-side rendering, no build-time secrets baked in besides the public
   API URL (see env vars below).
3. **Managed PostgreSQL 16** (or compatible), reachable from the `api`
   container. One database, no read replicas required.
4. **A secrets manager** (AWS Secrets Manager, Parameter Store, Vault,
   whatever your org standardizes on) to hold: `DATABASE_URL`,
   `SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`. None of these
   should ever live in a plain env file or in source control.
5. **TLS** in front of both `web` and `api` — the API sets `secure: true` on
   its session cookie whenever `NODE_ENV=production`, so it will not send a
   session cookie back over plain HTTP in production. Terminate TLS at your
   load balancer/CDN and route to the containers over your internal network.
6. **An SSO app registration** with your identity provider (Okta / Azure AD /
   Google Workspace / any standards-compliant OIDC provider — the app does
   not assume a specific one). Register a new **Authorization Code + PKCE**
   (public or confidential client, either works since we use PKCE) web
   application with:
   - **Redirect URI:** `https://<your-relay-host>/auth/oidc/callback`
     (exact host depends on where you put the `api` container/DNS)
   - **Scopes:** `openid`, `email`, `profile`
   - The provider must expose a standard `/.well-known/openid-configuration`
     discovery document at the issuer URL — Relay uses that to find every
     other endpoint (authorization, token, etc.) itself; nothing else needs
     to be configured by hand on our side.

---

## 3. Environment variables

All of these are read by `server/src/config.ts`. **The server refuses to
start** if any of the boot-time-required ones are missing (see "Hard-fail
behavior" below) — this is deliberate, so a misconfigured deploy fails loudly
instead of running with broken auth.

| Variable | Secret? | Required when | Description |
|---|:---:|---|---|
| `DATABASE_URL` | **Yes** | always | Postgres connection string, e.g. `postgres://user:pass@host:5432/dbname` |
| `PORT` | no | always | Port the API listens on (defaults to `4000`) |
| `NODE_ENV` | no | always | `production` in production. Also gates the DEV_AUTH hard-fail below |
| `DEV_AUTH` | no | always | Must be `false` (or unset) in production. `true` is for local dev only |
| `SESSION_SECRET` | **Yes** | always | Signs the session cookie. Generate a long random value; rotating it logs everyone out |
| `WEB_ORIGIN` | no | always | The exact origin `web` is served from (used for CORS — cookies need an exact origin, not a wildcard) |
| `VITE_API_URL` | no | always (build-time, for `web`) | Public URL of the `api` service. Baked into the web build, not read at runtime |
| `OIDC_ISSUER_URL` | no | when `DEV_AUTH` is not `true` | Your IdP's issuer URL (the base URL that serves `/.well-known/openid-configuration`) |
| `OIDC_CLIENT_ID` | no | when `DEV_AUTH` is not `true` | Client ID from your IdP's app registration |
| `OIDC_CLIENT_SECRET` | **Yes** | when `DEV_AUTH` is not `true` | Client secret from your IdP's app registration |
| `OIDC_REDIRECT_URI` | no | when `DEV_AUTH` is not `true` | Must exactly match what you registered with the IdP: `https://<host>/auth/oidc/callback` |
| `VAPID_PUBLIC_KEY` | no | only if Web Push is wanted | Generated once, see §5 |
| `VAPID_PRIVATE_KEY` | **Yes** | only if Web Push is wanted | Generated once, see §5 |
| `VAPID_SUBJECT` | no | only if Web Push is wanted | A `mailto:` address or URL identifying who owns the push keys |

### Hard-fail behavior (boot-time checks in `config.ts`)

The server **refuses to start** — not just warns — in any of these cases:

- `DEV_AUTH=true` and `NODE_ENV=production` at the same time.
- `DEV_AUTH` is not `true` and **any** of `OIDC_ISSUER_URL` /
  `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` is missing —
  since with DEV_AUTH off, OIDC is the *only* way anyone can log in.
- `SESSION_SECRET` is empty.

At the route level, the two auth modes are also mutually exclusive: the
`/auth/oidc/*` routes reject with 403 while `DEV_AUTH=true`, and the
`/auth/dev-*` routes reject with 403 once it's `false`. There is no
in-between state where both are live.

---

## 4. Build, migrate, seed

### Local development (has everything pre-wired)

```
cp .env.example .env
docker compose up
```

This starts Postgres, runs migrations, seeds **dummy data only**, and starts
both the API (`DEV_AUTH=true` — pick a seeded user, no real login) and the
web dev server. `web` → http://localhost:5173, `api` → http://localhost:4000.

### Production build

**API:**
```
cd server
npm ci
npm run build      # tsc -> dist/
npm run migrate:up # applies any pending migrations against DATABASE_URL
npm start          # node dist/index.js
```
Do **not** run `npm run seed` in production — it's dummy data only (see §6).

The shipped `server/Dockerfile` is dev-oriented (installs devDependencies,
runs via `tsx watch` for hot reload under `docker compose`). For a hardened
production image, build a container around the three commands above instead
(a small multi-stage Dockerfile — `npm ci && npm run build` in a build
stage, then `npm ci --omit=dev` + the compiled `dist/` in a slim runtime
stage). Happy to do this as a follow-up if useful.

**Web:**
```
cd web
npm ci
npm run build       # tsc -b && vite build -> dist/
```
Serve the resulting `web/dist/` as static files (S3+CloudFront, nginx,
whatever your org already uses for static sites). `VITE_API_URL` must be set
**at build time** (it's baked into the bundle, not read at runtime), so
rebuild if the API's public URL ever changes.

### Migrations going forward

Each schema change ships as a new file in `server/migrations/`
(node-pg-migrate). Run `npm run migrate:up` as part of every deploy, before
starting the new API version.

---

## 5. Web Push setup (optional feature, spec §8b)

Push notifications work without any external push service — the browser
vendors (Apple/Google/Mozilla) run the actual push infrastructure; the app
just needs a VAPID key pair to identify itself to them:

```
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Put the public key in `VAPID_PUBLIC_KEY`, the private key in
`VAPID_PRIVATE_KEY` (treat it as a secret), and set `VAPID_SUBJECT` to a
`mailto:` address someone actually reads. Push is **opt-in per user** — no
one is subscribed automatically.

**iOS caveat:** Safari on iOS only delivers Web Push to an installed PWA
(Share → Add to Home Screen), never to a page open in a regular browser tab,
regardless of permission granted. This is an iOS platform limitation, not a
bug. Android/Chrome has no such restriction.

---

## 6. Data — dummy only until sign-off

**Every piece of data in this repository and every default deploy is
placeholder/dummy data** (`server/seed/seed.ts`, fixture people, fictional
clients). **Do not point this app at real client, project, or personnel data
until data governance has signed off.** There is currently no data
retention policy, no PII handling review, and no audit of what the
`audit_log` table (see spec §3 schema and §5g) captures against your org's
requirements — all of that should be part of governance sign-off, not
assumed from the code.

---

## 7. What to send back to me

Once you've registered the SSO app registration (§2, item 6), send back:

1. **OIDC issuer URL**
2. **Client ID**
3. **Client secret** (via whatever secure channel your org uses for
   secrets — not email/Slack in plaintext)

I'll also need to know the final public hostname for the `api` service
before you register the app, since it determines the exact
`OIDC_REDIRECT_URI` (`https://<host>/auth/oidc/callback`) you'll register
with the IdP and that gets set as an env var on our side.

---

## 8. Repo layout

- `server/` — Fastify + TypeScript API
  - `src/rules/` — the rules engine (spec §5): pure functions, unit-tested,
    no DB/HTTP involved (goal/staffing math, load scoring, matching,
    eligibility, stage transitions).
  - `src/routes/`, `src/repositories/` — REST API + WebSocket routes, backed
    by Postgres.
  - `src/auth/` — `plugin.ts` (session cookie handling, shared by both auth
    modes) and `oidc.ts` (the OIDC client — discovery, PKCE, token exchange).
  - `migrations/` — node-pg-migrate schema history.
  - `seed/seed.ts` — dummy data only (§6).
- `web/` — React + TypeScript + Vite SPA, desktop-first responsive (mobile
  gets a real adaptive layout, not a shrunken desktop view).
- `docker-compose.yml` — **local dev only**: Postgres container + api + web,
  wired together with the dummy `.env.example` defaults.

---

## 9. Running tests

```
docker compose exec api npx vitest run
```

`src/routes/*.api.test.ts` are integration tests that hit real HTTP routes
(via Fastify's `inject()`) against the real Postgres database, and
**truncate the domain tables** as part of each run. Restore the demo data
afterward with:

```
docker compose exec api npm run seed
```
