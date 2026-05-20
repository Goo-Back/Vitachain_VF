#!/usr/bin/env bash
# AUTH-07 — local pre-flight wrapper.
#
# Runs all three legs of the AUTH-07 regression suite in sequence and exits
# non-zero on the first failure. Designed for:
#   (a) the local "before requesting a main merge" pre-flight;
#   (b) the demo-day rehearsal ≤ 30 minutes before kickoff.
#
# Legs:
#   [1/3] pgTAP — make -C db test-auth07
#         (role × table × verb matrix + DB-layer BR assertions)
#   [2/3] backend pytest — application-layer BRs (BR-K3 / F4 / B2 / S1 / S2)
#   [3/3] e2e matrix — only if SUPABASE_URL is set; runs the 22-cell sweep
#         against the staging Supabase project + FastAPI staging API
#
# Exit codes:
#   0   every leg green (or [3/3] skipped because SUPABASE_URL is unset)
#   1   any leg red
#
# Notes:
# - Leg [1/3] requires db/.env with DB_URL (service-role DIRECT :5432).
# - Leg [3/3] additionally requires SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, and
#   API_BASE_URL.
set -euo pipefail

cd "$(dirname "$0")/.."

echo ""
echo "=========================================================================="
echo "AUTH-07 [1/3] — pgTAP role × table × verb matrix + DB-layer BR assertions"
echo "=========================================================================="
make -C db test-auth07

echo ""
echo "=========================================================================="
echo "AUTH-07 [2/3] — application-layer BR pytest"
echo "=========================================================================="
( cd backend && pytest tests/test_auth07_business_rules.py -v )

echo ""
echo "=========================================================================="
if [[ -n "${SUPABASE_URL:-}" ]]; then
    echo "AUTH-07 [3/3] — staging e2e matrix sweep (22 cells)"
    echo "=========================================================================="
    ( cd backend && pytest tests/test_auth07_role_matrix_e2e.py -v )
else
    echo "AUTH-07 [3/3] — SKIPPED (SUPABASE_URL is unset)"
    echo "=========================================================================="
    echo ""
    echo "  To exercise the staging matrix, set:"
    echo "    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, API_BASE_URL"
    echo ""
fi

echo ""
echo "  ✓ AUTH-07 — all green. Safe to merge to main."
