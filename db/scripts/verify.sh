#!/usr/bin/env bash
# verify.sh — runs the automatable subset of INF-02 §6 Verification Checklist.
# Usage: DB_URL=postgresql://... ./db/scripts/verify.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
[[ -f "$DB_DIR/.env" ]] && source "$DB_DIR/.env"

: "${DB_URL:?Set DB_URL in db/.env}"

PASS=0; FAIL=0

check_sql() {
    local label="$1"; local sql="$2"; local expect="$3"
    local got
    got="$(psql "$DB_URL" -tA -v ON_ERROR_STOP=1 -c "$sql" 2>/dev/null || echo "__ERR__")"
    if [[ "$got" == "$expect" ]]; then
        printf '  \033[1;32m✓\033[0m %s\n' "$label"
        PASS=$((PASS+1))
    else
        printf '  \033[1;31m✗\033[0m %s  (got: %s, want: %s)\n' "$label" "$got" "$expect"
        FAIL=$((FAIL+1))
    fi
}

# Redact the password section so CI logs (and screenshots) don't leak it.
DB_URL_SAFE="$(printf '%s' "$DB_URL" | sed -E 's|://([^:]+):[^@]+@|://\1:***@|')"
echo "INF-02 verification against $DB_URL_SAFE"
echo "----------------------------------------"

check_sql "pgcrypto extension installed" \
    "select count(*) from pg_extension where extname='pgcrypto';" "1"

check_sql "user_role enum exists" \
    "select count(*) from pg_type where typname='user_role';" "1"

check_sql "verification_status enum exists" \
    "select count(*) from pg_type where typname='verification_status';" "1"

check_sql "locale_code enum exists" \
    "select count(*) from pg_type where typname='locale_code';" "1"

check_sql "public.profiles table exists" \
    "select count(*) from information_schema.tables where table_schema='public' and table_name='profiles';" "1"

check_sql "RLS enabled on public.profiles" \
    "select relrowsecurity::int from pg_class where oid='public.profiles'::regclass;" "1"

check_sql "profiles_select_own policy exists" \
    "select count(*) from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_select_own';" "1"

check_sql "profiles_update_own policy exists" \
    "select count(*) from pg_policies where schemaname='public' and tablename='profiles' and policyname='profiles_update_own';" "1"

check_sql "on_auth_user_created trigger exists" \
    "select count(*) from pg_trigger where tgname='on_auth_user_created' and not tgisinternal;" "1"

check_sql "handle_new_user function is security definer" \
    "select prosecdef::int from pg_proc where proname='handle_new_user';" "1"

check_sql "farmarket-photos storage bucket exists" \
    "select count(*) from storage.buckets where id='farmarket-photos';" "1"

check_sql "kyc-documents storage bucket is private" \
    "select (not public)::int from storage.buckets where id='kyc-documents';" "1"

check_sql "_migrations bookkeeping has ≥ 4 rows" \
    "select (count(*) >= 4)::int from public._migrations;" "1"

echo "----------------------------------------"
printf 'Passed: \033[1;32m%d\033[0m   Failed: \033[1;31m%d\033[0m\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
