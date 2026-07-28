# Brief for Claude — Relay project

Paste this into your Claude / Cowork session before working on Relay.

You're contributing to **Relay** (private repo `github.com/sahadsalmi-alphasights/relay`;
React + Fastify + PostgreSQL; live at `captracker.alphasights.ae`).

**Do all git from your Cowork sandbox — the laptop has no git and doesn't need
it.** The sandbox has git and can reach GitHub over HTTPS.

## Access & auth (one-time)

- The user must be added as a repo **collaborator** (ask the owner).
- Create a GitHub **fine-grained PAT** (scope: this repo, Contents: read/write),
  save it into a **gitignored file** in the working folder, and configure git's
  credential helper to read it. Do not paste it into chat.
- Sandbox limits: **SSH and the GitHub API are blocked.** So **push over HTTPS**
  and **open pull requests in the browser** (not via `gh` / API).

## Workflow (every feature)

1. `git clone https://github.com/sahadsalmi-alphasights/relay.git` (or pull latest).
2. `git checkout -b feature/<name>`.
3. Make changes **inside the existing repo structure** (`server/`, `web/`). Do
   not reshape into a zip; do not commit the top-level `RelayApp.jsx` prototype.
4. Run `npm run build` and tests (vitest) in both `server/` and `web/` so CI passes.
5. Commit, `git push origin feature/<name>`, then open a PR into `main` in the
   browser. Branch protection requires all **6 CI checks green**; you cannot push
   to `main` directly.

## Conventions / gotchas

- **Don't downgrade build config:** keep `vitest ^4.1.10` and the `tsconfig.json`
  `"exclude"` of `*.test.ts` files — older values break CI.
- **Migrations:** add a new timestamped file per schema change
  (e.g. `1731000008000_<name>.js`); never edit existing migrations.
- **Audit log:** the `audit_log` table is already written on mutations
  (`entity_type`, `entity_id`, `actor_id`, `action`, `old_value`, `new_value`).
  Keep adding audit entries on any new mutating endpoint. If building the
  "Audit log" sidebar, follow `docs/AUDIT_LOG_SPEC.md`.

Merging to `main` auto-deploys; don't worry about infra.

## Fallback if sandbox git is not allowed

Produce the changes in the correct repo layout (or a `git format-patch` diff)
and hand it to the repo owner, who will push it. This is more manual — the
sandbox-git route above is preferred.
