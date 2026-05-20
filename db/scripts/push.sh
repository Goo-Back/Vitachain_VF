#!/usr/bin/env bash
# push.sh — apply every db/migrations/*.sql to $DB_URL in numeric order.
# Usage: DB_URL=postgresql://... ./db/scripts/push.sh [--reset]
#
# Migrations are bookkept in a public._migrations table so reruns are no-ops.
# Each migration runs inside its own transaction; failure halts the batch.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
[[ -f "$DB_DIR/.env" ]] && source "$DB_DIR/.env"

: "${DB_URL:?Set DB_URL in db/.env (template in db/.env.example)}"

RESET=0
if [[ "${1:-}" == "--reset" ]]; then
    RESET=1
fi

# Safety: refuse --reset against anything that looks like the production project.
# Adjust the regex when the production ref is known.
if [[ $RESET -eq 1 ]]; then
    if [[ "$DB_URL" == *"@db.vitachain"* ]] || [[ "${ENV:-}" == "production" ]]; then
        echo "✗ refusing to --reset what looks like production. Set ENV=staging and a non-prod DB_URL."
        exit 2
    fi
    echo "⚠  Dropping schema public on $DB_URL in 3s — Ctrl-C to abort."
    sleep 3
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c "drop schema if exists public cascade; create schema public;"
fi

# Bookkeeping table.
# AUTH-04: every public.* relation must have RLS enabled (event trigger from
# migration 0009 enforces it on CREATE TABLE statements issued inside
# migrations; this preamble runs BEFORE any migration, so we enable RLS here
# explicitly to keep _migrations under the AUTH-04 contract on fresh DBs).
# Migration 0010 is the idempotent path for already-existing DBs.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create table if not exists public._migrations (
    version     text        primary key,
    applied_at  timestamptz not null default now(),
    checksum    text        not null
);
alter table public._migrations enable row level security;
SQL

shopt -s nullglob
MIGRATIONS=( "$DB_DIR"/migrations/*.sql )
if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
    echo "no migrations found under $DB_DIR/migrations/"
    exit 1
fi

# Deterministic ordering — C locale ensures 0001 < 0002 < … 0010.
IFS=$'\n' MIGRATIONS=( $(LC_ALL=C printf '%s\n' "${MIGRATIONS[@]}" | sort) )
unset IFS

APPLIED=0; SKIPPED=0
for path in "${MIGRATIONS[@]}"; do
    version="$(basename "$path" .sql)"
    checksum="$(sha256sum "$path" | awk '{print $1}')"

    existing_checksum="$(psql "$DB_URL" -tA -v ON_ERROR_STOP=1 \
        -c "select checksum from public._migrations where version = '${version//\'/\'\'}';" \
        2>/dev/null || true)"

    if [[ -n "$existing_checksum" ]]; then
        if [[ "$existing_checksum" != "$checksum" ]]; then
            echo "✗ $version — checksum mismatch. The file was edited after being applied."
            echo "   Add a new migration instead of editing $version."
            exit 3
        fi
        printf '  \033[1;90m·\033[0m %s (already applied)\n' "$version"
        SKIPPED=$((SKIPPED+1))
        continue
    fi

    printf '  \033[1;36m▶\033[0m applying %s …\n' "$version"
    psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$path" >/dev/null
    psql "$DB_URL" -v ON_ERROR_STOP=1 -c \
        "insert into public._migrations (version, checksum) values ('${version//\'/\'\'}', '$checksum');" >/dev/null
    printf '  \033[1;32m✓\033[0m %s\n' "$version"
    APPLIED=$((APPLIED+1))
done

echo "----------------------------------------"
printf 'Applied: \033[1;32m%d\033[0m   Skipped: \033[1;90m%d\033[0m\n' "$APPLIED" "$SKIPPED"
