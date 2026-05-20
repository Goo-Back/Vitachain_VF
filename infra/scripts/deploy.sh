#!/usr/bin/env bash
# deploy.sh — sync the infra/ stack to the VPS and bring it up.
#
# Usage:
#   VPS_HOST=vitachain.ma VPS_USER=vitachain ./infra/scripts/deploy.sh
#
# Or with infra/.env:
#   VPS_HOST=...
#   VPS_USER=vitachain
#   PROJECT_DIR=/opt/vitachain
#
# Safe to re-run. Steps:
#   1. rsync infra/ (and frontend/, backend/ if present) to the VPS.
#   2. Validate the new nginx config inside a throwaway container.
#   3. docker compose build + up -d (zero-downtime where possible).
#   4. Poll http://$VPS_HOST/healthz until 200 or timeout.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_DIR/frontend"
BACKEND_DIR="$REPO_DIR/backend"

# shellcheck disable=SC1091
[[ -f "$INFRA_DIR/.env" ]] && source "$INFRA_DIR/.env"

: "${VPS_HOST:?Set VPS_HOST (e.g. vitachain.ma or an IP)}"
: "${VPS_USER:=vitachain}"
: "${PROJECT_DIR:=/opt/vitachain}"
: "${SSH_OPTS:=-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30}"
: "${HEALTH_TIMEOUT_S:=180}"

log()  { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n'   "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n'    "$*" >&2; exit 1; }
trap 'die "failed at line $LINENO (exit $?)"' ERR

# ---------------------------------------------------------------------------
# 1) Pre-flight on the workstation
# ---------------------------------------------------------------------------
for cmd in ssh rsync curl; do
    command -v "$cmd" >/dev/null 2>&1 || die "missing dependency: $cmd"
done

log "target: $VPS_USER@$VPS_HOST  →  $PROJECT_DIR"

# ---------------------------------------------------------------------------
# 2) rsync infra/
# ---------------------------------------------------------------------------
log "syncing infra/ → $VPS_USER@$VPS_HOST:$PROJECT_DIR"
rsync -az --delete \
    --exclude '.env' \
    --exclude 'scripts/bootstrap-vps.sh' \
    --exclude 'frontend/' \
    --exclude 'backend/' \
    -e "ssh $SSH_OPTS" \
    "$INFRA_DIR/" "$VPS_USER@$VPS_HOST:$PROJECT_DIR/"

# ---------------------------------------------------------------------------
# 3) rsync application trees (when present)
# ---------------------------------------------------------------------------
if [[ -d "$FRONTEND_DIR" ]]; then
    log "syncing frontend/ → $VPS_USER@$VPS_HOST:$PROJECT_DIR/frontend/  (INF-03)"
    rsync -az --delete \
        --exclude 'node_modules' \
        --exclude '.next' \
        --exclude '.env' \
        --exclude '.env.local' \
        --exclude '.env.*.local' \
        -e "ssh $SSH_OPTS" \
        "$FRONTEND_DIR/" "$VPS_USER@$VPS_HOST:$PROJECT_DIR/frontend/"
else
    log "frontend/ not found locally — skipping (pre-INF-03 state)"
fi

if [[ -d "$BACKEND_DIR" ]]; then
    log "syncing backend/ → $VPS_USER@$VPS_HOST:$PROJECT_DIR/backend/  (INF-04)"
    rsync -az --delete \
        --exclude '.venv' \
        --exclude '__pycache__' \
        --exclude '.pytest_cache' \
        --exclude '.ruff_cache' \
        --exclude '.mypy_cache' \
        --exclude '.env' \
        -e "ssh $SSH_OPTS" \
        "$BACKEND_DIR/" "$VPS_USER@$VPS_HOST:$PROJECT_DIR/backend/"
else
    log "backend/ not found locally — skipping (pre-INF-04 state)"
fi

# ---------------------------------------------------------------------------
# 4) Validate the NGINX config BEFORE swapping it
#    Runs `nginx -t` inside a throwaway nginx:alpine container against the
#    just-rsynced conf.d/. If the syntax is bad, bail before `compose up`
#    so the live site keeps serving the previous config.
# ---------------------------------------------------------------------------
log "validating nginx config inside a throwaway container"
# shellcheck disable=SC2029
ssh $SSH_OPTS "$VPS_USER@$VPS_HOST" "PROJECT_DIR='$PROJECT_DIR' bash -se" <<'REMOTE'
set -Eeuo pipefail
cd "$PROJECT_DIR"
docker run --rm \
    -v "$PWD/nginx/conf.d:/etc/nginx/conf.d:ro" \
    -v "$PWD/nginx/html:/usr/share/nginx/html:ro" \
    nginx:1.27-alpine nginx -t
REMOTE
log "✓ nginx -t passed"

# ---------------------------------------------------------------------------
# 5) Build + up
# ---------------------------------------------------------------------------
log "docker compose build + up -d (remote)"
# shellcheck disable=SC2029
ssh $SSH_OPTS "$VPS_USER@$VPS_HOST" "PROJECT_DIR='$PROJECT_DIR' bash -se" <<'REMOTE'
set -Eeuo pipefail
cd "$PROJECT_DIR"

# AUTH-08 — expand RATELIMIT_WHITELIST_IPS (CSV in infra/.env) into the
# multi-line NGINX `<ip> 1;` form. docker-compose's .env loader can't carry
# newlines, so the expansion lives here and we export the result into the
# parent shell of `docker compose up`. The nginx service's `environment:`
# block forwards both VPS_PUBLIC_IP and RATELIMIT_WHITELIST_IPS_NGINX_LINES
# into the container, where the official entrypoint's envsubst pass renders
# 00-rate-limits.conf.template → /etc/nginx/conf.d/00-rate-limits.conf.
if [[ -f .env ]]; then
    set -a; . ./.env; set +a
fi
: "${VPS_PUBLIC_IP:=127.0.0.1}"
export VPS_PUBLIC_IP

RATELIMIT_WHITELIST_IPS_NGINX_LINES=""
if [[ -n "${RATELIMIT_WHITELIST_IPS:-}" ]]; then
    while IFS= read -r ip; do
        ip="${ip// /}"
        [[ -z "$ip" ]] && continue
        RATELIMIT_WHITELIST_IPS_NGINX_LINES+="    ${ip} 1;"$'\n'
    done < <(printf '%s' "$RATELIMIT_WHITELIST_IPS" | tr ',' '\n')
fi
export RATELIMIT_WHITELIST_IPS_NGINX_LINES
echo "[deploy:auth08] VPS_PUBLIC_IP=$VPS_PUBLIC_IP; extra whitelist entries: $(printf '%s' "${RATELIMIT_WHITELIST_IPS:-}" | tr ',' '\n' | grep -c . || true)"

# Pull registry images (nginx, future Sentry/Kuma); ignore failures from
# services whose image is locally built (frontend, backend).
docker compose pull --quiet 2>/dev/null || true

docker compose build --pull
docker compose up -d --remove-orphans
docker compose ps
REMOTE

# ---------------------------------------------------------------------------
# 6) Health gate
# ---------------------------------------------------------------------------
log "waiting up to ${HEALTH_TIMEOUT_S}s for http://$VPS_HOST/healthz"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S ))
while (( $(date +%s) < deadline )); do
    if curl -fsS --max-time 5 "http://$VPS_HOST/healthz" >/dev/null 2>&1; then
        log "✓ http://$VPS_HOST/healthz → ok"
        echo
        log "Next: make -C infra verify"
        exit 0
    fi
    sleep 5
done

warn "healthcheck did not pass within ${HEALTH_TIMEOUT_S}s"
echo "Investigate: ssh $VPS_USER@$VPS_HOST 'cd $PROJECT_DIR && docker compose logs --tail=200'" >&2
exit 1
