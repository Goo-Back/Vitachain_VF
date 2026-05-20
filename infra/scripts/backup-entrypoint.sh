#!/usr/bin/env bash
# backup-entrypoint.sh — INF-07. Runs inside the db-backup sidecar.
# All paths are container-internal. The host script (backup-db.sh) is the
# observer; this script is the actor.

set -Eeuo pipefail
IFS=$'\n\t'

# ---------------------------------------------------------------------------
# 0) Config — all required, all sourced from `docker compose` env injection.
# ---------------------------------------------------------------------------
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${BACKUP_BUCKET:=vitachain-backups}"
: "${BACKUP_REMOTE_PATH:=postgres}"
: "${BACKUP_RETENTION_LOCAL_DAYS:=7}"
: "${BACKUP_RETENTION_REMOTE_DAYS:=30}"

BACKUP_DIR="/backups"
RCLONE_CONFIG_PATH="/config/rclone/rclone.conf"
TS="$(date -u +%Y%m%d_%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/vitachain_db_${TS}.sql.gz"
SHA_FILE="${DUMP_FILE}.sha256"

log()  { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { printf '%s [FAIL]   %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
[[ -f "$RCLONE_CONFIG_PATH" ]] || die "rclone config not initialised — run 'make -C infra backup-rclone-config' first"

log "===== backup start ($(hostname)) ====="
log "ts=$TS  bucket=b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH  retain_local=${BACKUP_RETENTION_LOCAL_DAYS}d  retain_remote=${BACKUP_RETENTION_REMOTE_DAYS}d"

# Clean up any stale .partial from a previous crashed run before we start.
find "$BACKUP_DIR" -name 'vitachain_db_*.sql.gz.partial' -print -delete || true

# ---------------------------------------------------------------------------
# 1) pg_dump — schema + data, public + auth + extensions only.
#    The set of --exclude-schema flags is the source of truth; if Supabase
#    adds a new internal schema we should review whether it belongs in the
#    backup (almost certainly not).
# ---------------------------------------------------------------------------
log "step 1/5: pg_dump"
# shellcheck disable=SC2094  # we deliberately read from a process substitution.
if ! pg_dump \
        --format=plain \
        --no-owner --no-acl \
        --quote-all-identifiers \
        --no-publications --no-subscriptions \
        --exclude-schema=storage \
        --exclude-schema=graphql --exclude-schema=graphql_public \
        --exclude-schema=net \
        --exclude-schema=pgsodium --exclude-schema=pgsodium_masks \
        --exclude-schema=vault \
        --exclude-schema=_realtime --exclude-schema=realtime \
        --exclude-schema=supabase_functions \
        "$SUPABASE_DB_URL" \
     | gzip -9 > "$DUMP_FILE.partial"; then
    rm -f "$DUMP_FILE.partial"
    die "pg_dump or gzip failed — leaving previous backups untouched"
fi
mv "$DUMP_FILE.partial" "$DUMP_FILE"
SIZE_BYTES=$(stat -c %s "$DUMP_FILE")
log "dump ok: $(du -h "$DUMP_FILE" | cut -f1) ($SIZE_BYTES bytes)"
# Sanity floor — a healthy schema dump is never < 1 KB compressed. < 1 KB
# almost always means pg_dump succeeded but the DB was empty (the URL pointed
# at a fresh empty project — common misconfiguration).
if (( SIZE_BYTES < 1024 )); then
    die "dump suspiciously small ($SIZE_BYTES bytes) — wrong DB URL?"
fi

# ---------------------------------------------------------------------------
# 2) SHA-256 — stored as a sibling file, format compatible with `sha256sum -c`.
# ---------------------------------------------------------------------------
log "step 2/5: sha256"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$DUMP_FILE")" > "$(basename "$SHA_FILE")" )
log "sha256 ok: $(cat "$SHA_FILE")"

# ---------------------------------------------------------------------------
# 3) Upload to B2 — both files. rclone retries on transient errors.
# ---------------------------------------------------------------------------
log "step 3/5: rclone copy → b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/"
rclone --config "$RCLONE_CONFIG_PATH" \
    copy "$DUMP_FILE" \
    "b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/" \
    --transfers=2 --checkers=2 \
    --retries=3 --low-level-retries=5 \
    --stats=0 --quiet
rclone --config "$RCLONE_CONFIG_PATH" \
    copy "$SHA_FILE" \
    "b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/" \
    --transfers=2 --checkers=2 \
    --retries=3 --low-level-retries=5 \
    --stats=0 --quiet
log "upload ok"

# ---------------------------------------------------------------------------
# 4) Round-trip verification — pull the remote sha256 and compare to the
#    one we just wrote locally. Catches in-flight corruption (rare but
#    has happened during B2 incidents).
# ---------------------------------------------------------------------------
log "step 4/5: round-trip sha256 check"
REMOTE_SHA=$(rclone --config "$RCLONE_CONFIG_PATH" \
                cat "b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/$(basename "$SHA_FILE")" \
              | awk '{print $1}')
LOCAL_SHA=$(awk '{print $1}' "$SHA_FILE")
[[ "$REMOTE_SHA" == "$LOCAL_SHA" ]] || die "sha256 mismatch — local=$LOCAL_SHA remote=$REMOTE_SHA"
log "round-trip ok: $LOCAL_SHA"

# ---------------------------------------------------------------------------
# 5) Retention prune — local first (cheap), then remote (B2 API calls).
#    Runs ONLY after the new backup has been verified on both ends, so a
#    failure in steps 1-4 never reduces the existing backup floor.
# ---------------------------------------------------------------------------
log "step 5/5: retention prune"
find "$BACKUP_DIR" -name 'vitachain_db_*.sql.gz'        -mtime "+${BACKUP_RETENTION_LOCAL_DAYS}" -print -delete
find "$BACKUP_DIR" -name 'vitachain_db_*.sql.gz.sha256' -mtime "+${BACKUP_RETENTION_LOCAL_DAYS}" -print -delete

rclone --config "$RCLONE_CONFIG_PATH" \
    delete "b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/" \
    --min-age "${BACKUP_RETENTION_REMOTE_DAYS}d" \
    --include 'vitachain_db_*' \
    --quiet
log "prune ok"

log "===== backup ok — $(basename "$DUMP_FILE") ====="
