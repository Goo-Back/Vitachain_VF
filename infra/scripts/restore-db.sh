#!/usr/bin/env bash
# restore-db.sh — INF-07. Restore drill driver.
#
# Default: restores into $STAGING_DB_URL — a throwaway Supabase project
# stood up for the quarterly drill. The script HARD REFUSES to restore
# into the production URL unless both:
#     RESTORE_TARGET_IS_PROD=1
# and an interactive "YES, OVERWRITE PRODUCTION" confirmation are present.
#
# Usage:
#     ./infra/scripts/restore-db.sh <BACKUP_FILE> <TARGET_DB_URL>
#     ./infra/scripts/restore-db.sh latest        <TARGET_DB_URL>   # fetches newest
#
# Examples:
#     ./infra/scripts/restore-db.sh vitachain_db_20260513_020000Z.sql.gz "$STAGING_DB_URL"
#     ./infra/scripts/restore-db.sh latest                              "$STAGING_DB_URL"

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[[ -f "$SCRIPT_DIR/../.env" ]] && source "$SCRIPT_DIR/../.env"

BACKUP_FILE="${1:-}"
TARGET_DB_URL="${2:-}"
[[ -n "$BACKUP_FILE"   ]] || { echo "usage: $0 <BACKUP_FILE|latest> <TARGET_DB_URL>" >&2; exit 2; }
[[ -n "$TARGET_DB_URL" ]] || { echo "usage: $0 <BACKUP_FILE|latest> <TARGET_DB_URL>" >&2; exit 2; }

PROJECT_DIR="${PROJECT_DIR:-/opt/vitachain}"
BUCKET="${BACKUP_BUCKET:-vitachain-backups}"
REMOTE_PATH="${BACKUP_REMOTE_PATH:-postgres}"

# Compose invocations all run from the project dir so relative volume paths
# in docker-compose.yml resolve identically to the nightly cron path.
cd "$PROJECT_DIR"
COMPOSE=(docker compose -f infra/docker-compose.yml)

# --- Guardrail #1: refuse to restore into production by accident ----------
if [[ "$TARGET_DB_URL" == "${SUPABASE_DB_URL:-__not_set__}" ]]; then
    if [[ "${RESTORE_TARGET_IS_PROD:-0}" != "1" ]]; then
        echo "REFUSING: target == SUPABASE_DB_URL (production). Set RESTORE_TARGET_IS_PROD=1 to override." >&2
        exit 1
    fi
    read -r -p "Type 'YES, OVERWRITE PRODUCTION' to continue: " ack
    [[ "$ack" == "YES, OVERWRITE PRODUCTION" ]] || { echo "Aborted."; exit 1; }
fi

# --- Step 1: fetch the dump if not already local --------------------------
if [[ "$BACKUP_FILE" == "latest" ]]; then
    BACKUP_FILE=$("${COMPOSE[@]}" run --rm --entrypoint rclone db-backup \
        --config /config/rclone/rclone.conf \
        lsf "b2:${BUCKET}/${REMOTE_PATH}/" \
        --include 'vitachain_db_*.sql.gz' | sort | tail -n1 | tr -d '\r')
    [[ -n "$BACKUP_FILE" ]] || { echo "No backups found on b2:${BUCKET}/${REMOTE_PATH}/" >&2; exit 1; }
    echo "Resolved 'latest' → $BACKUP_FILE"
fi

LOCAL_DUMP="/opt/vitachain/backups/$BACKUP_FILE"
LOCAL_SHA="${LOCAL_DUMP}.sha256"

if [[ ! -f "$LOCAL_DUMP" ]]; then
    echo "Fetching $BACKUP_FILE from B2…"
    "${COMPOSE[@]}" run --rm --entrypoint rclone db-backup \
        --config /config/rclone/rclone.conf \
        copy "b2:${BUCKET}/${REMOTE_PATH}/$BACKUP_FILE" "/backups/"
    "${COMPOSE[@]}" run --rm --entrypoint rclone db-backup \
        --config /config/rclone/rclone.conf \
        copy "b2:${BUCKET}/${REMOTE_PATH}/$BACKUP_FILE.sha256" "/backups/"
fi

# --- Step 2: verify checksum ----------------------------------------------
echo "Verifying SHA-256…"
( cd "$(dirname "$LOCAL_DUMP")" && sha256sum -c "$(basename "$LOCAL_SHA")" ) \
    || { echo "CHECKSUM FAILED — refusing to restore." >&2; exit 1; }

# --- Step 3: restore with ON_ERROR_STOP ----------------------------------
# We pipe gunzip → psql inside the db-backup sidecar so we don't need a host
# postgres-client install. ON_ERROR_STOP makes a partial restore impossible.
echo "Restoring → ${TARGET_DB_URL%@*}@…"
"${COMPOSE[@]}" run --rm --entrypoint bash db-backup -c "
    set -euo pipefail
    gunzip -c /backups/$BACKUP_FILE | psql '$TARGET_DB_URL' \
        -v ON_ERROR_STOP=on \
        -v VERBOSITY=verbose \
        --single-transaction \
        > /tmp/restore.log 2>&1 || { tail -50 /tmp/restore.log; exit 1; }
    tail -10 /tmp/restore.log
"

echo "Restore complete. Now diff against db/migrations/ — see runbook §INF-07 drill."
