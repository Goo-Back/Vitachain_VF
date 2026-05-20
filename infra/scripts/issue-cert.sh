#!/usr/bin/env bash
# issue-cert.sh — INF-06. Idempotent first-issuance of the Let's Encrypt cert.
#
# Usage (on the VPS, in $PROJECT_DIR):
#   ./infra/scripts/issue-cert.sh                       # STAGING (safe default)
#   LETSENCRYPT_PROD=1 ./infra/scripts/issue-cert.sh    # PRODUCTION
#
# Re-running is safe:
#   * If a live cert already exists for the primary domain, exits 0 and
#     prints the current cert info — does NOT contact Let's Encrypt.
#   * Promoting staging → production requires deleting the staging cert
#     first; the runbook documents the one-liner.
#
# Pre-conditions:
#   * `infra/.env` populated (ADMIN_EMAIL, DOMAINS, VPS_HOST optional).
#   * NGINX :80 reachable from the public Internet on every domain.
#   * UFW open on 80/tcp.
#   * The :443 server block in nginx/conf.d/default.conf is TEMPORARILY
#     COMMENTED OUT on the very first run (see story §5.11).

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -f $INFRA_DIR/docker-compose.yml"

# shellcheck disable=SC1091
[[ -f "$INFRA_DIR/.env" ]] && source "$INFRA_DIR/.env"

: "${ADMIN_EMAIL:?Set ADMIN_EMAIL in infra/.env — ACME account contact email}"
: "${DOMAINS:=vitachain.ma www.vitachain.ma}"

# Primary domain = first whitespace-separated token. Used as the cert-name.
PRIMARY="${DOMAINS%% *}"

# Build the -d <domain> flags from $DOMAINS (space-separated).
d_args=()
for d in $DOMAINS; do d_args+=(-d "$d"); done

if [[ "${LETSENCRYPT_PROD:-0}" == "1" ]]; then
    server="https://acme-v02.api.letsencrypt.org/directory"
    echo "==> PRODUCTION endpoint — counts against rate limits (50 certs/domain/week)"
    read -r -p "    Continue? [type YES to proceed]: " confirm
    [[ "$confirm" == "YES" ]] || { echo "aborted"; exit 1; }
else
    server="https://acme-staging-v02.api.letsencrypt.org/directory"
    echo "==> STAGING endpoint — set LETSENCRYPT_PROD=1 once smoke is green"
fi

# Short-circuit if a live cert already exists for the primary domain.
# Re-running this script is a common operation; we must not burn rate limits.
if $COMPOSE run --rm --entrypoint sh certbot \
       -c "test -s /etc/letsencrypt/live/${PRIMARY}/fullchain.pem" 2>/dev/null; then
    echo "==> Cert already exists for ${PRIMARY}; skipping issuance."
    echo "==> Current state:"
    $COMPOSE run --rm --entrypoint certbot certbot certificates
    exit 0
fi

echo "==> Requesting cert for: $DOMAINS"
echo "==> ACME server:         $server"
echo "==> Account email:       $ADMIN_EMAIL"

# --webroot writes the challenge file to /var/www/certbot, which nginx
# serves under /.well-known/acme-challenge/ on :80 (default.conf).
$COMPOSE run --rm --entrypoint certbot certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --server "$server" \
    --email "$ADMIN_EMAIL" \
    --agree-tos --no-eff-email \
    --rsa-key-size 4096 \
    --cert-name "$PRIMARY" \
    --non-interactive \
    "${d_args[@]}"

# options-ssl-nginx.conf + ssl-dhparams.pem are auto-installed by certbot
# into /etc/letsencrypt on the first run; tls.conf includes them.

echo "==> Reloading nginx to pick up the new cert"
if $COMPOSE ps --status running --format '{{.Service}}' | grep -qx nginx; then
    $COMPOSE exec -T nginx nginx -t
    $COMPOSE exec -T nginx nginx -s reload
else
    echo "    (nginx not running yet — start it after uncommenting the :443 block)"
fi

echo
echo "==> Done. Next steps:"
echo "    1. Uncomment the :443 server block in infra/nginx/conf.d/default.conf"
echo "    2. make -C infra deploy"
echo "    3. make -C infra verify   # INF-06 checks should all pass"
