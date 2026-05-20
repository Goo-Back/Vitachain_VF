#!/usr/bin/env bash
# AUTH-05 — the frontend service's build.args block may only contain
# NEXT_PUBLIC_* keys. Anything else (e.g. SUPABASE_SERVICE_ROLE_KEY)
# would be inlined into the JS bundle at compile time, the worst
# possible leak shape.
#
# Usage: scripts/check-compose-build-args.sh [path/to/docker-compose.yml]
#        scripts/check-compose-build-args.sh                  # default infra/docker-compose.yml
set -uo pipefail

COMPOSE="${1:-infra/docker-compose.yml}"

if [ ! -f "$COMPOSE" ]; then
    echo "AUTH-05 check-compose-build-args: $COMPOSE not found" >&2
    exit 2
fi

if ! command -v yq >/dev/null 2>&1; then
    echo "AUTH-05 check-compose-build-args: 'yq' not installed (pip install yq, or apt-get install -y yq)." >&2
    exit 2
fi

fails=0

# Enumerate every build.args key on the frontend service. The yq invocation
# is compatible with both kislyuk/yq (python) and mikefarah/yq (go) — both
# accept `-r` and the `.services.frontend.build.args // {}` expression.
ARGS=$(yq -r '.services.frontend.build.args // {} | keys[]' "$COMPOSE" 2>/dev/null || true)
if [ -z "$ARGS" ]; then
    echo "  ⚠ frontend.build.args is empty — confirm the NEXT_PUBLIC_* inlining isn't lost (INF-03)." >&2
fi

while IFS= read -r key; do
    [ -z "$key" ] && continue
    if [[ ! "$key" =~ ^NEXT_PUBLIC_[A-Z0-9_]+$ ]]; then
        echo "  ✗ frontend.build.args.$key — not a NEXT_PUBLIC_* key. Move runtime-only values to the 'environment:' block (they will NOT be inlined into the JS bundle)." >&2
        fails=$((fails + 1))
    fi
done <<< "$ARGS"

# Backend service must have no build.args at all — its config comes from
# `environment:` at runtime. A build-arg there would still be safe (no public
# bundle) but signals config-shape drift. Warn, don't fail.
BACKEND_ARGS=$(yq -r '.services.backend.build.args // {} | keys | length' "$COMPOSE" 2>/dev/null || echo 0)
if [[ "$BACKEND_ARGS" =~ ^[0-9]+$ ]] && [ "$BACKEND_ARGS" -gt 0 ]; then
    echo "  ⚠ backend.build.args is non-empty ($BACKEND_ARGS keys). Backend config should flow through 'environment:'; promote any build-arg to a runtime env. (Not failing the build; this is a design smell.)" >&2
fi

if (( fails > 0 )); then
    echo "AUTH-05 FAIL — $fails compose build-args violation(s)" >&2
    exit 1
fi
echo "AUTH-05 OK — compose build-args shape clean."
exit 0
