#!/usr/bin/env bash
# AUTH-05 — assert the built Next.js bundle contains no service-role key
#           value, no service-role/JWT-secret env-var NAMES (typical
#           Next.js inline-leak signature), and no DB password.
#
# Runs against the build output, NOT the source tree (that is what
# scripts/check-secrets-boundary.sh covers). The two scripts are
# complementary: source-tree catches "the code REFERENCES the wrong
# variable"; this one catches "the BUILD produced a chunk that
# contains the wrong value", which can happen even when the source
# tree is clean (misconfigured docker compose build, errant env
# inherited from the runner, etc.).
#
# Usage: scripts/check-frontend-bundle.sh <path-to-.next>
#        scripts/check-frontend-bundle.sh frontend/.next
set -uo pipefail

BUNDLE_DIR="${1:-frontend/.next}"

if [ ! -d "$BUNDLE_DIR" ]; then
    echo "AUTH-05 SKIP: $BUNDLE_DIR does not exist — run 'npm run build' first" >&2
    # SKIP, not FAIL — local dev may run the script before building. CI
    # always runs it AFTER the build step (the `if: success()` guard).
    exit 0
fi

fails=0
note() { printf '  \033[1;31m✗\033[0m %s\n' "$1" >&2; fails=$((fails + 1)); }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }

echo "AUTH-05 bundle scan ($BUNDLE_DIR)"
echo "----------------------------------------------------"

# Targets: every JS chunk the browser can fetch + the standalone server.js
# (server-side bundle — leaks here are less severe but still a code smell
# because they suggest the source-tree contract is being bypassed).
TARGETS=()
for d in "$BUNDLE_DIR/static" "$BUNDLE_DIR/standalone" "$BUNDLE_DIR/server"; do
    [ -e "$d" ] && TARGETS+=("$d")
done

if [ "${#TARGETS[@]}" -eq 0 ]; then
    echo "AUTH-05 SKIP: no static/standalone/server subdirs found under $BUNDLE_DIR" >&2
    exit 0
fi

# (1) Env-var NAMES that should never appear as string literals in the bundle.
#     Next.js inlines `process.env.X` as a string substitution; the LEFT-HAND
#     SIDE of that substitution (the variable name) ends up in the bundle
#     ONLY when someone wrote a literal that happens to match — itself a
#     code smell on the frontend side. High-signal grep.
FORBIDDEN_NAMES='SUPABASE_SERVICE_ROLE_KEY|SUPABASE_JWT_SECRET|SUPABASE_DB_PASSWORD|SUPABASE_DB_URL'

hits=$(grep -RIlE "$FORBIDDEN_NAMES" "${TARGETS[@]}" 2>/dev/null || true)
if [[ -n "$hits" ]]; then
    note "service-role / JWT-secret / DB env-var names found in built bundle:"
    while IFS= read -r f; do
        echo "    $f" >&2
        grep -nE "$FORBIDDEN_NAMES" "$f" 2>/dev/null | head -1 | sed 's/^/      /' >&2
    done <<< "$hits"
else
    ok "no forbidden env-var names in built bundle"
fi

# (2) Service-role-JWT-shaped values in the bundle. Every Supabase HS256 JWT
#     begins with the URL-safe Base64 of {"alg":"HS256","typ":"JWT"}, which is
#     `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`. The PAYLOAD distinguishes anon
#     vs service_role. The anon key legitimately matches the header prefix,
#     so we extract every JWT-looking token and decode each one — fail iff
#     any decodes to `"role":"service_role"`.
mapfile -t TOKENS < <(grep -RIohE 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' \
    "${TARGETS[@]}" 2>/dev/null | sort -u || true)

service_role_hits=0
for tok in "${TOKENS[@]}"; do
    [ -z "$tok" ] && continue
    payload=$(awk -F. '{print $2}' <<< "$tok")
    [ -z "$payload" ] && continue
    pad=$(( (4 - ${#payload} % 4) % 4 ))
    padded="$payload"
    if (( pad > 0 )); then
        padded="$payload$(printf '=%.0s' $(seq 1 $pad))"
    fi
    decoded=$(printf '%s' "$padded" | tr '_-' '/+' | base64 -d 2>/dev/null || true)
    if echo "$decoded" | grep -q '"role"[[:space:]]*:[[:space:]]*"service_role"'; then
        note "service-role JWT found in built bundle (prefix=$(echo "$tok" | cut -c1-32)...)"
        service_role_hits=$((service_role_hits + 1))
    fi
done
if (( service_role_hits == 0 )); then
    ok "no service-role-decoded JWTs in built bundle (${#TOKENS[@]} JWT-looking tokens scanned)"
fi

echo "----------------------------------------------------"
if (( fails > 0 )); then
    printf '\033[1;31mFAIL\033[0m — %d bundle violation(s). Rotate the leaked key in the Supabase Dashboard, rebuild, redeploy. See docs/runbook.md §AUTH-05.\n' "$fails" >&2
    exit 1
fi
printf '\033[1;32mOK\033[0m — bundle clean.\n'
exit 0
