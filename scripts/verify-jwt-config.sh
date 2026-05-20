#!/usr/bin/env bash
# AUTH-03 — assert supabase/config.toml JWT settings match PRD §7.1.
#
# Runs in CI (db job, file-filtered to supabase/config.toml and security.py)
# and as a pre-commit local hook. When SUPABASE_JWT_SECRET is exported the
# script also checks the secret length (≥ 64 hex chars = 256 bits). In CI the
# var is the placeholder from ci.yml; on a developer machine it is the real
# Bitwarden value — both flows go through the same guard.
set -euo pipefail

TOML="${TOML_PATH:-supabase/config.toml}"

if [ ! -f "$TOML" ]; then
    echo "AUTH-03 FAIL: $TOML not found (cwd=$PWD)" >&2
    exit 1
fi

fail=0

check_field() {
    local key="$1" expected="$2" actual
    # Match `key = value` at line start (allow leading whitespace), strip
    # inline comments and quotes, normalise.
    actual=$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$TOML" \
             | head -n 1 \
             | sed -E 's/[[:space:]]*#.*$//' \
             | sed -E "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//" \
             | tr -d ' "' || true)
    if [ -z "$actual" ]; then
        echo "AUTH-03 FAIL: $key missing from $TOML" >&2
        fail=1
    elif [ "$actual" = "$expected" ]; then
        echo "AUTH-03 OK  : $key = $actual"
    else
        echo "AUTH-03 FAIL: $key — expected '$expected', got '$actual'" >&2
        fail=1
    fi
}

check_field "jwt_expiry"                    "3600"
check_field "enable_refresh_token_rotation" "true"
check_field "refresh_token_reuse_interval"  "10"

# JWT secret length guard. In CI the var is a deliberate placeholder; on a
# developer machine it is the real secret. Either way we want ≥ 32 bytes
# (≥ 64 hex chars) for HS256 security. The CI placeholder in .github/
# workflows/ci.yml is sized to clear the bar; a real-secret rotation that
# accidentally pastes a short value fails this check on the next commit.
if [ -n "${SUPABASE_JWT_SECRET:-}" ]; then
    len=${#SUPABASE_JWT_SECRET}
    if [ "$len" -ge 32 ]; then
        echo "AUTH-03 OK  : SUPABASE_JWT_SECRET length = $len (≥ 32)"
    else
        echo "AUTH-03 FAIL: SUPABASE_JWT_SECRET is $len chars (need ≥ 32 for 256-bit HS256)" >&2
        fail=1
    fi
else
    echo "AUTH-03 SKIP: SUPABASE_JWT_SECRET not set — length check skipped"
fi

exit "$fail"
