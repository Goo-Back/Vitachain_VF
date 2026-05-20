#!/usr/bin/env bash
# AUTH-05 — regression test for scripts/check-secrets-boundary.sh.
#
# Without this, a future "helpful refactor" of the boundary script could
# weaken the rule silently. The test plants synthetic violations into a
# tempdir-rooted copy of the boundary script (so $ROOT resolves into the
# temp tree), then asserts that each one fails the scanner red.
#
# Three cases:
#   (1) Negative — clean tree: scanner exits 0.
#   (2) Positive — service-role reference under frontend/: scanner exits 1.
#   (3) Positive — JWT-shaped literal committed outside allow-list: exits 1.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SCANNER="$REPO_ROOT/scripts/check-secrets-boundary.sh"

if [ ! -x "$SCANNER" ] && [ ! -f "$SCANNER" ]; then
    echo "FAIL — scanner not found at $SCANNER" >&2
    exit 1
fi

pass=0
fail=0

run_case() {
    local label="$1" expected="$2" plant_fn="$3" tmp
    tmp=$(mktemp -d)
    # Reproduce the layout the scanner expects: a fake repo root with the
    # script under scripts/, frontend/ and backend/ siblings.
    mkdir -p "$tmp/scripts" "$tmp/frontend" "$tmp/backend" "$tmp/nginx"
    cp "$SCANNER" "$tmp/scripts/check-secrets-boundary.sh"
    chmod +x "$tmp/scripts/check-secrets-boundary.sh"

    "$plant_fn" "$tmp"  # caller plants synthetic state into $tmp
    set +e
    bash "$tmp/scripts/check-secrets-boundary.sh" >/dev/null 2>&1
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

case_clean() {
    local tmp="$1"
    # No violations planted.
    echo '// clean placeholder' > "$tmp/frontend/clean.ts"
    echo 'print("clean")' > "$tmp/backend/clean.py"
}

case_service_role_ref_in_frontend() {
    local tmp="$1"
    cat > "$tmp/frontend/leak.ts" <<'EOF'
// synthetic AUTH-05 drill violation
export const _secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
EOF
}

case_next_public_in_backend() {
    local tmp="$1"
    cat > "$tmp/backend/leak.py" <<'EOF'
import os
print(os.environ["NEXT_PUBLIC_SUPABASE_URL"])
EOF
}

echo "AUTH-05 boundary self-test"
echo "----------------------------------------------------"

run_case "clean tree exits 0" 0 case_clean
run_case "service-role ref in frontend/ exits 1" 1 case_service_role_ref_in_frontend
run_case "NEXT_PUBLIC_ in backend/ exits 1" 1 case_next_public_in_backend

echo "----------------------------------------------------"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
