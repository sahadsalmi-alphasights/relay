# Ops: editing env / running Docker Compose on the CapTracker VM

**The one rule that prevents outages:** every manual `docker compose` command on
the VM MUST include `--env-file .env.production`.

`docker-compose.prod.yml` resolves every value via `${...}` substitution, which
Compose reads from `.env.production` **only** when that flag is passed. Omit it
and all vars resolve to blank → the API boots with an empty `SESSION_SECRET` /
`DATABASE_URL`, refuses to start, and crash-loops → Cloudflare 502.

```bash
# ✅ correct
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=40 api

# ❌ WRONG — blanks every env var, crash-loops the API
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

## Setting an integration credential (BambooHR, Slack, …)

1. A credential only reaches the container if it is BOTH in `.env.production`
   AND forwarded in the `api.environment:` block of `docker-compose.prod.yml`.
   (BAMBOOHR_*/SLACK_* are forwarded as of this change.)
2. Use the helper — it prompts (hidden for secrets), backs up `.env.production`,
   rolls out with `--env-file`, and restarts nginx:
   ```bash
   ./scripts/set-integration-env.sh BAMBOOHR_SUBDOMAIN
   ./scripts/set-integration-env.sh BAMBOOHR_API_KEY --secret
   ```
3. Verify (API port is not published to the host — test via nginx on :80):
   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" http://localhost/api/health   # expect 200
   ```

## Recreating containers

- Prefer `up -d` on the whole stack over `--force-recreate api` alone.
- If you do recreate `api` by itself, also `restart web` — nginx caches the API
  container's IP at startup (`proxy_pass http://api:4000`), so a new API IP
  leaves nginx proxying to a dead address (`/api` → 502) until it re-resolves.
- Never paste secrets into a terminal in a way that lands in shell history; use
  the helper's hidden prompt.
