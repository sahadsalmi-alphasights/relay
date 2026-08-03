#!/usr/bin/env bash
#
# Safely set/update an optional integration credential in .env.production on the
# CapTracker VM and roll it out, WITHOUT taking the site down.
#
# Why this script exists: docker-compose.prod.yml resolves every value via
# ${...} substitution, which Compose only reads from .env.production when you
# pass `--env-file .env.production`. Running `docker compose ... up` WITHOUT that
# flag makes every var blank -> the API boots with no SESSION_SECRET/DATABASE_URL
# and crash-loops -> 502. This wrapper always includes the flag, and restarts
# nginx so it re-resolves the (possibly new) API container IP.
#
# Usage (run on the VM, from the repo dir):
#   ./scripts/set-integration-env.sh BAMBOOHR_SUBDOMAIN
#   ./scripts/set-integration-env.sh BAMBOOHR_API_KEY --secret
#   ./scripts/set-integration-env.sh SLACK_WEBHOOK_URL --secret
#
set -euo pipefail

COMPOSE=(docker compose --env-file .env.production -f docker-compose.prod.yml)
ENV_FILE=".env.production"
VAR="${1:-}"
SECRET="${2:-}"

[ -n "$VAR" ] || { echo "usage: $0 VAR_NAME [--secret]"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Run from the repo dir containing $ENV_FILE"; exit 1; }

if [ "$SECRET" = "--secret" ]; then
  read -rsp "$VAR (input hidden): " VAL; echo
else
  read -rp "$VAR: " VAL
fi

cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"          # backup first
sed -i "/^${VAR}=/d" "$ENV_FILE"                     # drop old line if present
printf '%s="%s"\n' "$VAR" "$VAL" >> "$ENV_FILE"      # append, value quoted
echo "Set $VAR in $ENV_FILE (value not echoed)."

# Roll out with the env file, then restart nginx so it re-resolves the API IP.
"${COMPOSE[@]}" up -d
"${COMPOSE[@]}" restart web
"${COMPOSE[@]}" ps

echo "Verify:  curl -sS -o /dev/null -w '%{http_code}\\n' http://localhost/api/health   (expect 200)"
