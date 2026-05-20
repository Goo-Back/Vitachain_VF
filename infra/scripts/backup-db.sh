#!/usr/bin/env bash
# backup-db.sh — INF-07. Host-side wrapper invoked by cron at 02:00 daily.
# Runs the db-backup sidecar via `docker compose run --rm`, observes the
# exit code, pings Healthchecks on success, posts to the alert webhook on
# failure. Idempotent — safe to invoke manually (`make -C infra backup-now`).

set -Eeuo pipefail
IFS=$'\n\t'

# Cron's PATH is minimal; resolve `docker` and friends explicitly. Same
# treatment as INF-06's renew-cert.sh.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

PROJECT_DIR="${PROJECT_DIR:-/opt/vitachain}"
LOG="/var/log/vitachain-backup.log"

# shellcheck disable=SC1091
[[ -f "$PROJECT_DIR/infra/.env" ]] && source "$PROJECT_DIR/infra/.env"

mkdir -p "$(dirname "$LOG")"

ts_now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

post_alert() {
    # $1: short reason, $2: full log excerpt (multi-line)
    local reason="$1"
    local excerpt="$2"
    [[ -z "${ALERT_WEBHOOK_URL:-}" ]] && return 0
    # Discord-shaped JSON; works for Slack incoming-webhooks too because both
    # accept a `content` field. Telegram bots take `text` — adjust if needed.
    local payload
    payload=$(jq -nc \
        --arg t "🚨 VitaChain backup FAILED at $(ts_now): $reason" \
        --arg e "$excerpt" \
        '{content: ($t + "\n```\n" + $e + "\n```")}')
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
        --data "$payload" "$ALERT_WEBHOOK_URL" >/dev/null || true
}

ping_healthcheck() {
    [[ -z "${HEALTHCHECKS_BACKUP_URL:-}" ]] && return 0
    curl -fsS -m 10 --retry 3 "$HEALTHCHECKS_BACKUP_URL" >/dev/null || true
}

cd "$PROJECT_DIR"

{
    echo "===================================="
    echo "$(ts_now) — backup-db.sh start"

    # `docker compose run --rm` runs the sidecar with the project's env file
    # already loaded by compose itself (env_file inheritance from infra/.env).
    # Output is captured into $LOG via the surrounding block redirection.
    if docker compose -f infra/docker-compose.yml run --rm \
            --entrypoint bash db-backup /usr/local/bin/backup-entrypoint.sh; then
        echo "$(ts_now) — backup-db.sh end (ok)"
        # Heartbeat is the LAST thing we do — never before the success log.
        ping_healthcheck
        exit 0
    else
        rc=$?
        echo "$(ts_now) — backup-db.sh end (FAIL rc=$rc)"
        post_alert "exit=$rc" "$(tail -n 20 "$LOG")"
        exit "$rc"
    fi
} >>"$LOG" 2>&1
