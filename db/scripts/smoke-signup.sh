#!/usr/bin/env bash
# smoke-signup.sh — INF-02 §5.12 smoke test.
# Creates two throwaway users via the Supabase Auth ADMIN API (not the public
# /signup endpoint) so the test is deterministic and not subject to Supabase's
# email-validation heuristics, disposable-domain blocklists, or rate limiting.
# The admin path still creates real auth.users rows, so the on_auth_user_created
# trigger fires exactly the same way as for a public signup.
#
# Usage:
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DB_URL=... \
#     ./db/scripts/smoke-signup.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
[[ -f "$DB_DIR/.env" ]] && source "$DB_DIR/.env"

: "${SUPABASE_URL:?Set SUPABASE_URL in db/.env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY in db/.env}"
: "${DB_URL:?Set DB_URL in db/.env}"

# Unique emails per run so reruns don't collide. Domain is overrideable.
STAMP="$(date +%s)"
SMOKE_EMAIL_DOMAIN="${SMOKE_EMAIL_DOMAIN:-vitachain.ma}"
EMAIL_OK="smoke-${STAMP}@${SMOKE_EMAIL_DOMAIN}"
EMAIL_BAD="smoke-bad-${STAMP}@${SMOKE_EMAIL_DOMAIN}"
PASSWORD="SmokeTest!${STAMP}"

admin_create() {
    local email="$1" role="$2"
    curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
        -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Content-Type: application/json" \
        -w '\n__HTTP__%{http_code}' \
        -d "{
            \"email\":         \"$email\",
            \"password\":      \"$PASSWORD\",
            \"email_confirm\": true,
            \"user_metadata\": { \"role\": \"$role\", \"full_name\": \"Smoke Test\", \"locale\": \"fr\" }
        }"
}

admin_delete_by_email() {
    local email="$1"
    local uid
    uid="$(psql "$DB_URL" -tA -v ON_ERROR_STOP=1 \
        -c "select id from auth.users where email = '${email//\'/\'\'}';" 2>/dev/null || true)"
    [[ -z "$uid" ]] && return 0
    curl -s -X DELETE \
        -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        "$SUPABASE_URL/auth/v1/admin/users/$uid" >/dev/null || true
}

cleanup() {
    admin_delete_by_email "$EMAIL_OK"
    admin_delete_by_email "$EMAIL_BAD"
}
trap cleanup EXIT

PASS=0; FAIL=0
pass() { printf '  \033[1;32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf '  \033[1;31m✗\033[0m %s — %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }

echo "INF-02 signup smoke test against $SUPABASE_URL"
echo "(admin path, domain=@$SMOKE_EMAIL_DOMAIN)"
echo "----------------------------------------"

# -----------------------------------------------------------------------------
# Positive case — admin create with role=CITIZEN → trigger writes profile row.
# -----------------------------------------------------------------------------
resp="$(admin_create "$EMAIL_OK" CITIZEN)"
http="${resp##*__HTTP__}"
body="${resp%__HTTP__*}"
if [[ "$http" =~ ^2 ]]; then
    pass "admin create role=CITIZEN returned $http"
else
    fail "admin create role=CITIZEN" "HTTP $http body: $body"
fi

row="$(psql "$DB_URL" -tA -v ON_ERROR_STOP=1 -c \
    "select role || '|' || verification_status || '|' || locale
     from public.profiles where email = '${EMAIL_OK//\'/\'\'}';" 2>/dev/null || true)"
if [[ "$row" == "CITIZEN|PENDING|fr" ]]; then
    pass "trigger inserted profile (CITIZEN|PENDING|fr)"
else
    fail "trigger inserted profile" "got: '$row'"
fi

# -----------------------------------------------------------------------------
# Negative case — role=PIRATE → trigger raises → user create fails → no row.
# Supabase wraps the trigger exception in a generic "Database error", so we
# verify the failure indirectly: no auth.users row, no public.profiles row.
# -----------------------------------------------------------------------------
resp_bad="$(admin_create "$EMAIL_BAD" PIRATE)"
http_bad="${resp_bad##*__HTTP__}"
body_bad="${resp_bad%__HTTP__*}"

if [[ "$http_bad" =~ ^(4|5) ]]; then
    pass "admin create role=PIRATE rejected (HTTP $http_bad)"
else
    fail "admin create role=PIRATE should be rejected" "HTTP $http_bad body: $body_bad"
fi

orphan_auth="$(psql "$DB_URL" -tA -v ON_ERROR_STOP=1 -c \
    "select count(*) from auth.users where email = '${EMAIL_BAD//\'/\'\'}';" 2>/dev/null || echo "ERR")"
orphan_prof="$(psql "$DB_URL" -tA -v ON_ERROR_STOP=1 -c \
    "select count(*) from public.profiles where email = '${EMAIL_BAD//\'/\'\'}';" 2>/dev/null || echo "ERR")"

if [[ "$orphan_auth" == "0" && "$orphan_prof" == "0" ]]; then
    pass "no orphan rows (auth.users=0, public.profiles=0)"
else
    fail "rejected signup left a row behind" "auth.users=$orphan_auth, public.profiles=$orphan_prof"
fi

echo "----------------------------------------"
printf 'Passed: \033[1;32m%d\033[0m   Failed: \033[1;31m%d\033[0m\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
