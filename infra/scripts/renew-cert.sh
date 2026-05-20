#!/usr/bin/env bash
# renew-cert.sh — INF-06. Invoked twice daily by /etc/cron.d/vitachain-cert-renew.
# Safe to run when no renewal is due (certbot exits 0 within seconds).
#
# Why a script and not a one-line cron entry?
#   * Cron's PATH is minimal; we need to set it explicitly.
#   * We log to a known file for forensics.
#   * We ping Healthchecks.io on success so a silent failure is caught
#     within ~3 days, well before the 30-day cliff.
#   * The deploy-hook reloads nginx WITHOUT restarting the container, so
#     in-flight TLS connections survive the renewal.

set -Eeuo pipefail
IFS=$'\n\t'

# Cron's PATH is minimal; resolve `docker` and friends explicitly.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

PROJECT_DIR="${PROJECT_DIR:-/opt/vitachain}"
LOG="${RENEW_LOG:-/var/log/vitachain-renew.log}"

cd "$PROJECT_DIR"

# shellcheck disable=SC1091
[[ -f "$PROJECT_DIR/infra/.env" ]] && source "$PROJECT_DIR/infra/.env"

COMPOSE="docker compose -f $PROJECT_DIR/infra/docker-compose.yml"

{
    echo "===================================="
    date -u '+%Y-%m-%dT%H:%M:%SZ — renew-cert start'

    # `--quiet` suppresses noise when nothing's due (most days). The
    # deploy-hook only fires when at least one cert actually renewed.
    $COMPOSE run --rm --entrypoint certbot certbot renew \
        --quiet \
        --deploy-hook "$COMPOSE exec -T nginx nginx -s reload"

    date -u '+%Y-%m-%dT%H:%M:%SZ — renew-cert end (exit $?)'

    # Heartbeat — Healthchecks.io detects a missing ping after 3 days
    # (configurable on their dashboard), enough warning to fix renewal
    # before the 30-day grace window collapses.
    if [[ -n "${HEALTHCHECKS_RENEW_URL:-}" ]]; then
        curl -fsS -m 10 "$HEALTHCHECKS_RENEW_URL" >/dev/null \
            && echo "    heartbeat ✓" \
            || echo "    heartbeat ✗ (Healthchecks unreachable)"
    fi
} >>"$LOG" 2>&1
