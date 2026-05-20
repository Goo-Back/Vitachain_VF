#!/usr/bin/env bash
# preflight.sh — sanity-check the operator's workstation before running
# bootstrap.sh or deploy.sh. Fast, read-only, idempotent.
#
# Usage:  bash infra/scripts/preflight.sh

set -uo pipefail
IFS=$'\n\t'

PASS=0; FAIL=0
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[1;33m·\033[0m %s\n' "$*"; }

echo "Workstation pre-flight (INF-01)"
echo "----------------------------------------"

# --- Required CLIs ---------------------------------------------------------
for cmd in ssh rsync curl dig ssh-keygen; do
    if command -v "$cmd" >/dev/null 2>&1; then
        ok "$cmd present"
    else
        bad "$cmd MISSING — install before bootstrap"
    fi
done

# --- Docker (only required for `make smoke-local`) -------------------------
if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
        ok "docker engine reachable ($(docker --version))"
    else
        warn "docker installed but engine unreachable (only needed for smoke-local)"
    fi
    if docker compose version >/dev/null 2>&1; then
        ok "docker compose plugin present ($(docker compose version --short 2>/dev/null || echo "?"))"
    else
        warn "docker compose plugin missing (only needed for smoke-local)"
    fi
else
    warn "docker not installed (only needed for smoke-local)"
fi

# --- SSH key ---------------------------------------------------------------
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519.pub}"
if [[ -f "$KEY" ]]; then
    ok "SSH public key found: $KEY"
else
    bad "SSH public key not found at $KEY — generate with: ssh-keygen -t ed25519 -C vitachain"
fi

# --- infra/.env ------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [[ -f "$ENV_FILE" ]]; then
    ok "infra/.env present"
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    if [[ -n "${VPS_HOST:-}" ]]; then
        ok "VPS_HOST set: $VPS_HOST"
    else
        bad "VPS_HOST is empty in infra/.env"
    fi
    [[ "${VPS_USER:-vitachain}" == "vitachain" ]] && ok "VPS_USER=vitachain" \
        || warn "VPS_USER='${VPS_USER:-}' (expected 'vitachain')"
    [[ "${PROJECT_DIR:-/opt/vitachain}" == "/opt/vitachain" ]] && ok "PROJECT_DIR=/opt/vitachain" \
        || warn "PROJECT_DIR='${PROJECT_DIR:-}' (expected '/opt/vitachain')"
else
    bad "infra/.env missing — run: cp infra/.env.example infra/.env"
fi

# --- DNS sanity (optional — only when VPS_HOST is a hostname) --------------
if [[ -n "${VPS_HOST:-}" && ! "$VPS_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    if [[ -n "$(dig +short +time=2 +tries=1 "$VPS_HOST" 2>/dev/null | head -1)" ]]; then
        ok "DNS A record for $VPS_HOST resolves"
    else
        warn "DNS A record for $VPS_HOST does not resolve yet (TTL/propagation?)"
    fi
fi

# --- Connectivity to the VPS (best-effort) ---------------------------------
if [[ -n "${VPS_HOST:-}" ]]; then
    if ssh -o BatchMode=yes -o ConnectTimeout=5 \
           "${VPS_USER:-vitachain}@$VPS_HOST" true >/dev/null 2>&1; then
        ok "ssh ${VPS_USER:-vitachain}@$VPS_HOST works (key auth)"
    else
        warn "cannot SSH as ${VPS_USER:-vitachain}@$VPS_HOST yet — fine before bootstrap"
    fi
fi

echo "----------------------------------------"
printf 'Passed: \033[1;32m%d\033[0m   Failed: \033[1;31m%d\033[0m\n' "$PASS" "$FAIL"
exit $(( FAIL > 0 ? 1 : 0 ))
