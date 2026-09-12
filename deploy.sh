#!/usr/bin/env bash
# EKP production deploy on the Hostinger VPS.
#
# Pulls latest from GitHub, then rebuilds/restarts Compose (Traefik + pgvector).
# Secrets stay in the gitignored .env (never overwritten).
#
# Usage on the VPS:
#   cd /opt/revasyst/ekp && bash deploy.sh
#   DEPLOY_BRANCH=main bash deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-ekp}"

die() { echo "deploy: $*" >&2; exit 1; }

[[ -f .env ]] || die "missing $ROOT/.env — copy from .env.example and set secrets"
[[ -f config.yaml ]] || die "missing $ROOT/config.yaml"
[[ -d .git ]] || die "not a git checkout at $ROOT — clone revasyst-projects/ekp-agent here first"
[[ -f docker-compose.prod.yml ]] || die "missing docker-compose.prod.yml"

COMPOSE_ARGS=(-f docker-compose.prod.yml)
if docker network inspect revasyst >/dev/null 2>&1; then
  echo "==> Traefik network revasyst present"
else
  die "Docker network 'revasyst' not found — start the shared edge stack first"
fi

echo "==> Repo: $ROOT"
echo "==> Branch: $BRANCH"
echo "==> HEAD before: $(git rev-parse --short HEAD 2>/dev/null || echo none)"

git fetch --prune origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> HEAD after:  $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

echo "==> Building and restarting"
docker compose "${COMPOSE_ARGS[@]}" --env-file .env up -d --build --remove-orphans

docker image prune -f
docker compose "${COMPOSE_ARGS[@]}" --env-file .env ps
echo "==> Deploy complete"
