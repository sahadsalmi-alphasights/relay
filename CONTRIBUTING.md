# Contributing to Relay

Relay (internally "Cap Tracker") is a React + Fastify + PostgreSQL app deployed
via Docker to a GCP VM. Live at https://captracker.alphasights.ae.

This guide is the workflow for contributing code. It applies whether you work
from a laptop with git or from a Cowork/Claude sandbox — the git operations are
the same.

## Access

1. You must be a **collaborator** on `github.com/sahadsalmi-alphasights/relay`
   (ask the repo owner to invite you).
2. Authenticate over **HTTPS** with a GitHub **fine-grained Personal Access
   Token** (scope: this repo, Contents: read/write). Store it in a gitignored
   file — never commit it or paste it into chat.
3. Note the environment limits if you're in a Cowork sandbox: **SSH and the
   GitHub API are blocked.** Push over HTTPS, and **open pull requests in the
   GitHub web UI** (not via `gh` or the API).

## Branch & PR workflow

Direct pushes to `main` are blocked by branch protection. Every change goes
through a pull request.

```bash
git clone https://github.com/sahadsalmi-alphasights/relay.git   # or: git pull
git checkout -b feature/<short-name>
# ...make changes...
git add .
git commit -m "Describe the change"
git push origin feature/<short-name>
# then open a PR (base: main) in the browser
```

A PR can only merge once **all 6 CI checks are green**:

- Secret scanning (Gitleaks)
- Dependency vulnerability scan (Trivy)
- Static analysis (Semgrep)
- Server build + tests
- Web build
- Container image scan (Trivy)

Merging to `main` auto-deploys to the VM. You don't need to touch infrastructure.

## Before you push

Run the build and tests locally so CI passes on the first try:

```bash
# server
cd server && npm install && npm run build && npm test
# web
cd ../web && npm install && npm run build
```

## Conventions & gotchas

- **Keep the repo structure.** Work inside `server/` and `web/`. Do not reshape
  the project into a zip, and do not commit the standalone top-level
  `RelayApp.jsx` prototype — it is not part of the built app.
- **Do not downgrade the build config.** Keep `vitest` at `^4.1.10` and keep the
  `"exclude"` of `*.test.ts` / `*.spec.ts` files in `server/tsconfig.json`.
  Older values were the cause of previous CI failures.
- **Database migrations:** add a **new timestamped file** per schema change
  (e.g. `server/migrations/1731000008000_<name>.js`). Never edit an existing
  migration — migrations run automatically on deploy via `npm run migrate:up`.
- **Audit logging:** any new mutating (create/update/delete) endpoint must write
  an entry via `insertAuditLog(...)` so changes stay attributable. See
  `docs/AUDIT_LOG_SPEC.md`.
- **Deployment resources:** the VM is small. Heavy work is fine, but be aware CI
  deploys build both Docker images.

## Deployment (reference)

On merge to `main`, GitHub Actions SSHes to the VM, pulls, and runs
`docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`.
Migrations run on API container start. No manual steps required.
