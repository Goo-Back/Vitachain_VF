#!/usr/bin/env bash
# check-secrets-boundary.sh — enforces PRD §7.1 AUTH-05.
#
# Three invariants:
#   (1) Supabase service-role key + JWT secret never appear in any path the
#       browser can reach (frontend/, nginx/).
#   (2) Frontend-only NEXT_PUBLIC_* env names never appear in backend Python.
#   (3) No literal Supabase-shaped JWT blobs (eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...)
#       are committed outside *.env.example / story docs / allowlisted scanners.
#
# Owns: INF-05 §5.1.
# Callable from pre-commit, GitHub Actions, infra/scripts/verify.sh, and
# `make secrets-check`. Exit 0 on clean; exit 1 on any violation, with a
# precise file:line list printed to stderr.
#
# Scope note: the rule is about *committed* content. The script therefore
# excludes the standard ignored paths (.env / .env.* / node_modules / .venv /
# .next / __pycache__ / .git / build caches). On a CI runner the working tree
# only contains tracked files anyway, so the excludes are a developer-laptop
# convenience; they do not relax the rule.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

fails=0
note() { printf '  \033[1;31m✗\033[0m %s\n' "$1" >&2; fails=$((fails + 1)); }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }

# A grep that survives "no such file" (frontend/nginx may not exist on a
# partial checkout) and prints nothing on no-match.
safe_grep() {
    grep -RIn "$@" 2>/dev/null || true
}

# Common excludes — these are either git-ignored (so not committed), or build
# artefacts, or this script itself.
COMMON_EXCLUDES=(
    --exclude-dir=node_modules
    --exclude-dir=.next
    --exclude-dir=.turbo
    --exclude-dir=.venv
    --exclude-dir=__pycache__
    --exclude-dir=.git
    --exclude-dir=.pre-commit-cache
    --exclude-dir=.pytest_cache
    --exclude-dir=.ruff_cache
    --exclude-dir=.mypy_cache
    --exclude=.env
    --exclude='.env.*'
    --exclude='*.env'             # matches `db/.env`, `backend/.env`, etc.
    --exclude='*.env.local'
    --exclude='check-secrets-boundary.sh'
)

echo "AUTH-05 boundary (scripts/check-secrets-boundary.sh)"
echo "----------------------------------------------------"

# -----------------------------------------------------------------------------
# (1) service-role / JWT-secret names must not appear in frontend or nginx.
#     The names alone are the leak signal — values don't matter; the very
#     reference from a browser-reachable file is a code-smell.
#     Allow:
#       - *.env.example (templates list the var names by design)
#       - *.md (docs may reference the names when explaining the rule)
#       - comments that explicitly *forbid* the leak (AUTH-05 / "NEVER" / etc.)
# -----------------------------------------------------------------------------
hits=$(safe_grep -E 'SUPABASE_SERVICE_ROLE_KEY|SUPABASE_JWT_SECRET|SUPABASE_DB_PASSWORD' \
    "$ROOT/frontend" "$ROOT/nginx" \
    "${COMMON_EXCLUDES[@]}" \
    --exclude='*.env.example' --exclude='*.md' \
    | grep -v 'AUTH-05\|INF-0[0-9]\|MUST NOT\|never.*expose\|forbidden\|NEVER add')

if [[ -n "$hits" ]]; then
    note "service-role / JWT-secret names found under frontend/ or nginx/:"
    printf '%s\n' "$hits" >&2
else
    ok "no service-role / JWT-secret names under frontend/ or nginx/"
fi

# -----------------------------------------------------------------------------
# (2) NEXT_PUBLIC_* must not appear in backend Python. The frontend owns these
#     prefixes (Next.js inlines them at build time); referencing them from the
#     backend is either confusion ("which env do I read?") or a copy-paste leak.
# -----------------------------------------------------------------------------
hits=$(safe_grep 'NEXT_PUBLIC_' "$ROOT/backend" --include='*.py' "${COMMON_EXCLUDES[@]}")
if [[ -n "$hits" ]]; then
    note "NEXT_PUBLIC_ reference found in backend/*.py:"
    printf '%s\n' "$hits" >&2
else
    ok "no NEXT_PUBLIC_ references in backend/*.py"
fi

# -----------------------------------------------------------------------------
# (3) Literal Supabase-shaped JWT prefix anywhere outside the allowlist.
#     Every Supabase HS256 JWT starts with this URL-safe-Base64 header.
#     Allow:
#       - *.env.example (templates can show shaped placeholders)
#       - docs/**/*.md and Documents/**/*.md (the rule itself appears here)
#       - .gitleaks.toml (this regex is part of the leak policy)
#       - the legacy INF-04 grep line in infra/scripts/verify.sh — replaced
#         by §5.9 of this story, but until that edit lands the line is
#         allowlisted here so first-run is green.
# -----------------------------------------------------------------------------
hits=$(safe_grep 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' "$ROOT" \
    "${COMMON_EXCLUDES[@]}" \
    --exclude-dir=docs --exclude-dir=Documents \
    --exclude='*.env.example' \
    --exclude='.gitleaks.toml' \
    --exclude='check-frontend-bundle.sh' \
    --exclude='verify-env-key-roles.sh' \
    --exclude='test_check_frontend_bundle.sh' \
    | grep -v 'infra/scripts/verify.sh:.*--exclude-dir=.venv')

if [[ -n "$hits" ]]; then
    note "literal JWT prefix committed outside allowlist:"
    printf '%s\n' "$hits" >&2
else
    ok "no committed JWT-looking blobs outside *.env.example / docs"
fi

echo "----------------------------------------------------"
if (( fails > 0 )); then
    printf '\033[1;31mFAIL\033[0m — %d violation(s). Fix and re-run.\n' "$fails" >&2
    exit 1
fi
printf '\033[1;32mOK\033[0m — boundary clean.\n'
exit 0
