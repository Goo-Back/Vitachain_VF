#!/usr/bin/env bash
# AUTH-05 — decode the two Supabase JWTs in an env file and assert role shape.
#
# The single most common AUTH-05 violation is a copy-paste error: an operator
# pastes the service-role key into NEXT_PUBLIC_SUPABASE_ANON_KEY (or vice
# versa) while filling in /opt/vitachain/.env. The source-tree boundary
# script can't catch this — the file is never committed and the variable
# NAMES are correct. Only DECODING the values reveals the mistake.
#
# Usage: scripts/verify-env-key-roles.sh /path/to/.env
#        scripts/verify-env-key-roles.sh           (defaults to infra/.env)
set -uo pipefail

ENV_FILE="${1:-infra/.env}"

if [ ! -f "$ENV_FILE" ]; then
    echo "AUTH-05 verify-env-key-roles: $ENV_FILE not found" >&2
    # Exit 2 = "couldn't check" (distinct from 1 = "violation found").
    # Callers can choose how strict to be.
    exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "AUTH-05 verify-env-key-roles: 'jq' not installed (apt-get install -y jq)." >&2
    exit 2
fi

if ! command -v base64 >/dev/null 2>&1; then
    echo "AUTH-05 verify-env-key-roles: 'base64' not installed." >&2
    exit 2
fi

# shellcheck disable=SC2002
ANON=$(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true)
SVC=$( grep -E '^SUPABASE_SERVICE_ROLE_KEY='     "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true)

decode_role() {
    local tok="$1"
    local payload pad padded decoded
    payload=$(awk -F. '{print $2}' <<< "$tok")
    if [ -z "$payload" ]; then
        echo "<not a JWT>"
        return
    fi
    pad=$(( (4 - ${#payload} % 4) % 4 ))
    padded="$payload"
    if (( pad > 0 )); then
        padded="$payload$(printf '=%.0s' $(seq 1 $pad))"
    fi
    decoded=$(printf '%s' "$padded" | tr '_-' '/+' | base64 -d 2>/dev/null || true)
    if [ -z "$decoded" ]; then
        echo "<malformed base64>"
        return
    fi
    echo "$decoded" | jq -r '.role // "<no role claim>"' 2>/dev/null || echo "<malformed JSON>"
}

fails=0

if [ -z "$ANON" ]; then
    echo "  ✗ NEXT_PUBLIC_SUPABASE_ANON_KEY missing from $ENV_FILE" >&2
    fails=$((fails + 1))
else
    role=$(decode_role "$ANON")
    if [ "$role" != "anon" ]; then
        echo "  ✗ NEXT_PUBLIC_SUPABASE_ANON_KEY decodes to role=\"$role\" — expected \"anon\". You likely pasted the service-role key here. Re-fetch from Supabase Dashboard → Settings → API." >&2
        fails=$((fails + 1))
    else
        echo "  ✓ NEXT_PUBLIC_SUPABASE_ANON_KEY → role=anon"
    fi
fi

if [ -z "$SVC" ]; then
    echo "  ✗ SUPABASE_SERVICE_ROLE_KEY missing from $ENV_FILE" >&2
    fails=$((fails + 1))
else
    role=$(decode_role "$SVC")
    if [ "$role" != "service_role" ]; then
        echo "  ✗ SUPABASE_SERVICE_ROLE_KEY decodes to role=\"$role\" — expected \"service_role\". You likely pasted the anon key here, OR the value is a forged/test JWT. Re-fetch from Supabase Dashboard → Settings → API." >&2
        fails=$((fails + 1))
    else
        echo "  ✓ SUPABASE_SERVICE_ROLE_KEY → role=service_role"
    fi
fi

if [ -n "$ANON" ] && [ -n "$SVC" ] && [ "$ANON" = "$SVC" ]; then
    echo "  ✗ NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY have IDENTICAL values. This is a critical misconfiguration — every browser would receive service-role privileges. Rotate the service-role key in the Supabase Dashboard immediately." >&2
    fails=$((fails + 1))
fi

if (( fails > 0 )); then
    echo "AUTH-05 FAIL — $fails env-shape violation(s) in $ENV_FILE" >&2
    exit 1
fi
echo "AUTH-05 OK — env shape clean."
exit 0
