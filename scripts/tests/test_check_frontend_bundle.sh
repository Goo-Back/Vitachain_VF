#!/usr/bin/env bash
# AUTH-05 — regression test for scripts/check-frontend-bundle.sh.
#
# Two cases:
#   (1) Clean fake .next/ — exits 0.
#   (2) Fake .next/static/foo.js containing process.env.SUPABASE_SERVICE_ROLE_KEY
#       as a string literal — exits 1.
#   (3) Fake .next/static/foo.js containing a service-role-payload JWT
#       (forged HS256 token with `"role":"service_role"` payload) — exits 1.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SCANNER="$REPO_ROOT/scripts/check-frontend-bundle.sh"

if [ ! -f "$SCANNER" ]; then
    echo "FAIL — scanner not found at $SCANNER" >&2
    exit 1
fi

pass=0
fail=0

b64url() {
    # Portable URL-safe base64 (no padding).
    printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '='
}

forge_jwt() {
    # Build a JWT-shaped string: header.payload.signature.
    # Header MUST be exactly the Supabase HS256 header so the scanner's
    # regex picks it up; signature is arbitrary (the scanner does not verify).
    local payload="$1" header sig
    header="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    sig="$(b64url "fake-signature-not-verified")"
    printf '%s.%s.%s' "$header" "$(b64url "$payload")" "$sig"
}

run_case() {
    local label="$1" expected="$2" plant_fn="$3" tmp
    tmp=$(mktemp -d)
    mkdir -p "$tmp/.next/static" "$tmp/.next/server" "$tmp/.next/standalone"
    "$plant_fn" "$tmp"
    set +e
    bash "$SCANNER" "$tmp/.next" >/dev/null 2>&1
    local rc=$?
    set -e
    if [ "$rc" = "$expected" ]; then
        echo "  ✓ $label (exit $rc as expected)"
        pass=$((pass + 1))
    else
        echo "  ✗ $label (exit $rc, expected $expected)" >&2
        fail=$((fail + 1))
    fi
    rm -rf "$tmp"
}

plant_clean() {
    local tmp="$1"
    cat > "$tmp/.next/static/clean.js" <<'EOF'
"use strict";var x=process.env.NEXT_PUBLIC_SUPABASE_URL;
EOF
}

plant_env_name_leak() {
    local tmp="$1"
    cat > "$tmp/.next/static/leak.js" <<'EOF'
"use strict";var s="SUPABASE_SERVICE_ROLE_KEY";
EOF
}

plant_service_role_jwt() {
    local tmp="$1"
    local jwt
    jwt="$(forge_jwt '{"role":"service_role","iss":"supabase","exp":9999999999}')"
    printf '"use strict";var k="%s";\n' "$jwt" > "$tmp/.next/static/jwt.js"
}

echo "AUTH-05 bundle-scanner self-test"
echo "----------------------------------------------------"

run_case "clean .next/ exits 0" 0 plant_clean
run_case "env-var name leak exits 1" 1 plant_env_name_leak
run_case "service-role JWT in bundle exits 1" 1 plant_service_role_jwt

echo "----------------------------------------------------"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
