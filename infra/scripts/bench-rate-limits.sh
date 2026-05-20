#!/usr/bin/env bash
# AUTH-08 — load-generation harness.
# Fires 8 calibration scenarios against the live VPS and asserts pass/fail
# per scenario. Designed for the staging drill (§5.10 in the story) and as a
# demo-day-eve pre-flight paired with the AUTH-07 RLS matrix.
#
# Usage:
#   VPS_HOST=vitachain.ma ./infra/scripts/bench-rate-limits.sh
#
# Env:
#   VPS_HOST              — target host (DNS or IP). Required.
#   BENCH_USE_HOST_HEY=1  — use host-installed `hey` instead of Docker image.
#   DRYRUN=1              — print the `hey` invocations without firing them.
#
# Notes:
#   * Run from a *non-whitelisted* IP. Phone hotspot, not office WiFi behind
#     the VPS's own egress. A whitelisted IP will see zero 429s on the public
#     buckets (deliberate — that's the §5.10 step 5 contrast test).
#   * The auth_* and iot_ingest zones do NOT exempt the whitelist by design;
#     operator brute force is still brute force.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/../.env" ]] && source "$SCRIPT_DIR/../.env"

: "${VPS_HOST:?Set VPS_HOST (e.g. vitachain.ma)}"
BASE="https://${VPS_HOST}"

HEY_IMAGE="${HEY_IMAGE:-rcmorano/docker-hey:latest}"
if [[ "${BENCH_USE_HOST_HEY:-0}" == "1" ]]; then
    HEY=(hey)
    command -v hey >/dev/null 2>&1 || { echo "hey not on PATH; unset BENCH_USE_HOST_HEY" >&2; exit 2; }
else
    HEY=(docker run --rm "$HEY_IMAGE")
fi

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
pass()  { printf '  \033[1;32mPASS\033[0m %s\n' "$*"; }
fail()  { printf '  \033[1;31mFAIL\033[0m %s\n' "$*" >&2; }

PASS=0; FAIL=0
TOTAL_SCENARIOS=0

# ---------------------------------------------------------------------------
# scenario <name> <path> <method> <total_n> <concurrency> <expected_429_min> [extra args...]
# Asserts: at least <expected_429_min> of <total_n> responses came back 429.
# Set expected_429_min=0 for loose buckets where 429 is unexpected.
# ---------------------------------------------------------------------------
scenario() {
    local name=$1 path=$2 method=$3 n=$4 c=$5 expected_429_min=$6
    shift 6
    TOTAL_SCENARIOS=$((TOTAL_SCENARIOS+1))

    local url="${BASE}${path}"
    local cmd=("${HEY[@]}" -n "$n" -c "$c" -m "$method" "$@" "$url")

    bold "▶ ${name}"
    if [[ "${DRYRUN:-0}" == "1" ]]; then
        printf '  (dryrun) %q ' "${cmd[@]}"; echo
        return 0
    fi

    local out
    out=$("${cmd[@]}" 2>/dev/null || true)

    # `hey` summary format:
    #   Status code distribution:
    #     [200]  120 responses
    #     [429]   80 responses
    local obs_429 obs_200
    obs_429=$(echo "$out" | grep -oE '\[429\][[:space:]]+[0-9]+' | grep -oE '[0-9]+' || true)
    obs_200=$(echo "$out" | grep -oE '\[200\][[:space:]]+[0-9]+' | grep -oE '[0-9]+' || true)
    obs_429=${obs_429:-0}
    obs_200=${obs_200:-0}

    if [[ "$expected_429_min" -eq 0 ]]; then
        # Loose-bucket scenario — expect MOSTLY 200s. Allow ≤ 10% 429.
        local cap=$(( n / 10 ))
        if [[ $obs_429 -le $cap ]]; then
            pass "${name} — ${obs_200}/${n} OK, ${obs_429} 429 (≤ ${cap} tolerated)"
            PASS=$((PASS+1))
        else
            fail "${name} — bucket too tight: ${obs_429}/${n} hit 429 (cap ${cap})"
            FAIL=$((FAIL+1))
        fi
    else
        if [[ $obs_429 -ge $expected_429_min ]]; then
            pass "${name} — ${obs_429}/${n} hit 429 (≥ ${expected_429_min} expected)"
            PASS=$((PASS+1))
        else
            fail "${name} — only ${obs_429}/${n} hit 429 (expected ≥ ${expected_429_min})"
            FAIL=$((FAIL+1))
        fi
    fi
}

bold "AUTH-08 rate-limit bench against ${BASE}"
echo

# Eight calibration scenarios. Methods are chosen so the FastAPI handler
# either 4xxs (auth grant on bad creds, validation failure on empty body)
# or 401s; the rate-limit decision happens at the edge BEFORE the handler,
# so the request-shape correctness is irrelevant to the assertion.

scenario "1) auth_grant flood"             "/api/v1/auth/token"                 POST 60 20 40
scenario "2) auth_register flood"          "/api/v1/auth/register"              POST 30 10 20
scenario "3) public_write botabaqa"        "/api/v1/botabaqa/leads"             POST 30 10 18
scenario "4) public_write farmarket-ct"    "/api/v1/farmarket/ads/00000000-0000-0000-0000-000000000000/contact" POST 30 10 18
scenario "5) mutate_strict reservation"    "/api/v1/secondserve/reservations"   POST 50 20 35
scenario "6) iot_ingest no key (per-IP)"   "/api/v1/katara/ingest"              POST 40 10 30
scenario "7) iot_ingest single key"        "/api/v1/katara/ingest"              POST 40 10 30 -H "X-Device-Api-Key: auth08-bench-key-001"
scenario "8) public_read meals (loose)"    "/api/v1/secondserve/meals"          GET  100 10  0

echo
bold "----------------------------------------"
printf 'Scenarios: %d   Passed: \033[1;32m%d\033[0m   Failed: \033[1;31m%d\033[0m\n' \
       "$TOTAL_SCENARIOS" "$PASS" "$FAIL"

[[ "$FAIL" -eq 0 ]]
