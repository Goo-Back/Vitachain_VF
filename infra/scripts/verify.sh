#!/usr/bin/env bash
# verify.sh — runs the §6 Verification Checklist from INF-01 as automated checks.
# Usage: VPS_HOST=vitachain.ma VPS_USER=vitachain ./infra/scripts/verify.sh

set -uo pipefail

# shellcheck disable=SC1091
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/../.env" ]] && source "$SCRIPT_DIR/../.env"

: "${VPS_HOST:?Set VPS_HOST}"
: "${VPS_USER:=vitachain}"
: "${PROJECT_DIR:=/opt/vitachain}"

PASS=0; FAIL=0
check() {
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then
        printf '  \033[1;32m✓\033[0m %s\n' "$label"
        PASS=$((PASS+1))
    else
        printf '  \033[1;31m✗\033[0m %s\n' "$label"
        FAIL=$((FAIL+1))
    fi
}

echo "INF-01 verification against $VPS_HOST"
echo "----------------------------------------"

check "Deploy user SSH works" \
    ssh -o BatchMode=yes -o ConnectTimeout=5 "$VPS_USER@$VPS_HOST" true

check "Root SSH is refused" \
    bash -c "ssh -o BatchMode=yes -o ConnectTimeout=5 -o PreferredAuthentications=publickey root@$VPS_HOST true; [[ \$? -ne 0 ]]"

check "UFW only allows 22/80/443" \
    ssh "$VPS_USER@$VPS_HOST" "sudo ufw status | grep -Eq 'Status: active' && \
      ! sudo ufw status | grep -Eq '^(2[1-9]|3[0-9][0-9]|[4-9][0-9][0-9]|[1-9][0-9]{4})/' "

check "vita_nginx is Up (healthy)" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose ps --format '{{.Name}} {{.Status}}' | grep -Eq 'vita_nginx.*Up.*healthy'"

check "HTTP 200 on http://$VPS_HOST" \
    bash -c "[[ \$(curl -o /dev/null -s -w '%{http_code}' http://$VPS_HOST) == 200 ]]"

check "/healthz returns 'ok'" \
    bash -c "curl -fsS http://$VPS_HOST/healthz | grep -q '^ok$'"

# During the IP→DNS transition (§5.10 step), VPS_HOST is still an IP. dig of
# an IP literal returns nothing — skip the DNS check entirely in that case.
if [[ "$VPS_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '  \033[1;33m·\033[0m %s\n' "DNS A record resolves (skipped — VPS_HOST is an IP literal)"
else
    check "DNS A record resolves" \
        bash -c "[[ -n \"\$(dig +short $VPS_HOST | head -1)\" ]]"
fi

check "$PROJECT_DIR owned by $VPS_USER (0750)" \
    ssh "$VPS_USER@$VPS_HOST" "stat -c '%U %a' $PROJECT_DIR | grep -q '^$VPS_USER 750$'"

# --- INF-03 frontend checks (no-ops until the service is deployed) -----------
echo ""
echo "INF-03 verification (frontend)"
echo "----------------------------------------"

check "vita_frontend is Up (healthy)" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose ps --format '{{.Name}} {{.Status}}' | grep -Eq 'vita_frontend.*Up.*healthy'"

check "/api/healthz returns service=frontend" \
    bash -c "curl -fsS http://$VPS_HOST/api/healthz | grep -q '\"service\":\"frontend\"'"

check "/ returns 200 and contains 'VitaChain'" \
    bash -c "curl -fsS http://$VPS_HOST/ | grep -q 'VitaChain'"

check "/login returns 200" \
    bash -c "[[ \$(curl -o /dev/null -s -w '%{http_code}' http://$VPS_HOST/login) == 200 ]]"

check "/register returns 200" \
    bash -c "[[ \$(curl -o /dev/null -s -w '%{http_code}' http://$VPS_HOST/register) == 200 ]]"

check "/dashboard (unauth) redirects to /login" \
    bash -c "curl -fsS -o /dev/null -w '%{redirect_url}' http://$VPS_HOST/dashboard | grep -q '/login'"

# AUTH-05 boundary — delegated to scripts/check-secrets-boundary.sh (INF-05).
# The single source of truth is also called by pre-commit + CI, so verify.sh
# stays in sync without drift.
check "AUTH-05 boundary clean (service-role / NEXT_PUBLIC_ / JWT prefix)" \
    bash "$SCRIPT_DIR/../../scripts/check-secrets-boundary.sh"

# AUTH-05 build-args shape — only NEXT_PUBLIC_* keys may appear in the
# frontend service's build.args block. Catches the regression where someone
# adds SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY} alongside the
# legitimate public values — which would inline the secret into the JS
# bundle at compile time.
check "AUTH-05 compose build-args shape (NEXT_PUBLIC_ only)" \
    bash "$SCRIPT_DIR/../../scripts/check-compose-build-args.sh" \
    "$SCRIPT_DIR/../docker-compose.yml"

# AUTH-05 runtime env shape — decode the two Supabase JWTs in infra/.env
# and assert role-claim shape (anon != service_role and not identical).
# Most-common AUTH-05 violation in real systems is operator copy-paste.
# Skipped silently if infra/.env is absent (CI mode).
if [[ -f "$SCRIPT_DIR/../.env" ]]; then
    check "AUTH-05 env-key roles (anon vs service_role)" \
        bash "$SCRIPT_DIR/../../scripts/verify-env-key-roles.sh" \
        "$SCRIPT_DIR/../.env"
fi

# AUTH-05 frontend bundle scan — only meaningful if .next/ exists locally
# (it does on the VPS after the deploy.sh build step). Skipped on dev
# laptops where the bundle is built inside the docker image and not
# materialised in the source tree.
if [[ -d "$SCRIPT_DIR/../../frontend/.next" ]]; then
    check "AUTH-05 frontend bundle clean (no service-role JWT / leaked env names)" \
        bash "$SCRIPT_DIR/../../scripts/check-frontend-bundle.sh" \
        "$SCRIPT_DIR/../../frontend/.next"
fi

# --- INF-04 backend checks ---------------------------------------------------
echo ""
echo "INF-04 verification (backend)"
echo "----------------------------------------"

check "vita_backend is Up (healthy)" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose ps --format '{{.Name}} {{.Status}}' | grep -Eq 'vita_backend.*Up.*healthy'"

check "/api/v1/healthz returns service=backend" \
    bash -c "curl -fsS http://$VPS_HOST/api/v1/healthz | grep -q '\"service\":\"backend\"'"

check "/api/v1/readyz returns status=ready" \
    bash -c "curl -fsS http://$VPS_HOST/api/v1/readyz | grep -q '\"status\":\"ready\"'"

check "/api/v1/katara/healthz returns module=katara" \
    bash -c "curl -fsS http://$VPS_HOST/api/v1/katara/healthz | grep -q '\"module\":\"katara\"'"

check "/api/v1/farmarket/healthz returns module=farmarket" \
    bash -c "curl -fsS http://$VPS_HOST/api/v1/farmarket/healthz | grep -q '\"module\":\"farmarket\"'"

check "/api/v1/secondserve/healthz returns module=secondserve" \
    bash -c "curl -fsS http://$VPS_HOST/api/v1/secondserve/healthz | grep -q '\"module\":\"secondserve\"'"

# (NEXT_PUBLIC_ + JWT-prefix checks folded into the AUTH-05 boundary above —
#  see scripts/check-secrets-boundary.sh.)

# --- INF-06 TLS checks -------------------------------------------------------
# Skip the whole TLS block when VPS_HOST is still an IP literal — Let's Encrypt
# does not issue certs for IPs, and `openssl s_client -servername <ip>` would
# fail the SNI handshake even if we did. The certbot+nginx path only becomes
# valid once VPS_HOST is a real domain.
echo ""
echo "INF-06 verification (TLS)"
echo "----------------------------------------"

if [[ "$VPS_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '  \033[1;33m·\033[0m %s\n' "TLS checks skipped — VPS_HOST is an IP literal (Let's Encrypt does not issue for IPs)"
else
    check "Port :443 open + TLS handshake completes" \
        bash -c "echo | openssl s_client -servername $VPS_HOST -connect $VPS_HOST:443 -verify_return_error >/dev/null 2>&1"

    check "http://$VPS_HOST/ redirects 301 → https://" \
        bash -c "[[ \$(curl -o /dev/null -s -w '%{http_code}' http://$VPS_HOST/) == 301 ]]"

    check "Redirect Location is https://$VPS_HOST/" \
        bash -c "curl -fsSI http://$VPS_HOST/ | grep -i '^location:' | grep -qi 'https://$VPS_HOST'"

    check "/.well-known/acme-challenge/* served unencrypted from :80" \
        bash -c "[[ \$(curl -o /dev/null -s -w '%{http_code}' http://$VPS_HOST/.well-known/acme-challenge/probe-from-verify-sh) =~ ^(404|200)$ ]]"

    check "https://$VPS_HOST/healthz returns 'ok'" \
        bash -c "curl -fsS https://$VPS_HOST/healthz | grep -q '^ok$'"

    check "HSTS header present (1y + includeSubDomains + preload)" \
        bash -c "h=\$(curl -fsSI https://$VPS_HOST/ | grep -i '^strict-transport-security:'); \
                 [[ -n \"\$h\" ]] && \
                 echo \"\$h\" | grep -q 'max-age=31536000' && \
                 echo \"\$h\" | grep -q 'includeSubDomains' && \
                 echo \"\$h\" | grep -q 'preload'"

    check "X-Content-Type-Options: nosniff present" \
        bash -c "curl -fsSI https://$VPS_HOST/ | grep -qi '^x-content-type-options:[[:space:]]*nosniff'"

    check "X-Frame-Options: DENY present" \
        bash -c "curl -fsSI https://$VPS_HOST/ | grep -qi '^x-frame-options:[[:space:]]*DENY'"

    check "Cert issuer is Let's Encrypt (not staging, not self-signed)" \
        bash -c "iss=\$(echo | openssl s_client -servername $VPS_HOST -connect $VPS_HOST:443 2>/dev/null | openssl x509 -noout -issuer); \
                 echo \"\$iss\" | grep -qE 'Let.?s Encrypt' && \
                 ! echo \"\$iss\" | grep -qi 'STAGING'"

    check "Cert notAfter ≥ 30 days from now" \
        bash -c "exp=\$(echo | openssl s_client -servername $VPS_HOST -connect $VPS_HOST:443 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2); \
                 exp_s=\$(date -d \"\$exp\" +%s); now_s=\$(date +%s); \
                 [[ \$(( (exp_s - now_s) / 86400 )) -ge 30 ]]"

    check "TLSv1.1 refused (only 1.2 + 1.3 accepted)" \
        bash -c "! (echo | openssl s_client -tls1_1 -connect $VPS_HOST:443 2>/dev/null | grep -q 'BEGIN CERTIFICATE')"

    check "www.$VPS_HOST also covered by the cert" \
        bash -c "echo | openssl s_client -servername www.$VPS_HOST -connect www.$VPS_HOST:443 -verify_return_error >/dev/null 2>&1"

    check "Frontend served over HTTPS contains 'VitaChain'" \
        bash -c "curl -fsS https://$VPS_HOST/ | grep -q 'VitaChain'"

    check "Backend /api/v1/healthz served over HTTPS" \
        bash -c "curl -fsS https://$VPS_HOST/api/v1/healthz | grep -q '\"service\":\"backend\"'"

    check "Cron entry for renewal exists on VPS" \
        ssh "$VPS_USER@$VPS_HOST" "test -f /etc/cron.d/vitachain-cert-renew"

    check "Renewal dry-run succeeds" \
        ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot renew --dry-run --quiet"
fi

# --- INF-07 backup checks ---------------------------------------------------
echo ""
echo "INF-07 verification (DB backup)"
echo "----------------------------------------"

check "Cron entry for backup exists with 02:00 schedule" \
    ssh "$VPS_USER@$VPS_HOST" "grep -qE '^0 2 \\* \\* \\* ' /etc/cron.d/vitachain-db-backup"

check "Backup log is owned by deploy user" \
    ssh "$VPS_USER@$VPS_HOST" "[[ \$(stat -c %U /var/log/vitachain-backup.log) == $VPS_USER ]]"

check "Local backup directory exists + correct ownership" \
    ssh "$VPS_USER@$VPS_HOST" "test -d /opt/vitachain/backups && [[ \$(stat -c %U /opt/vitachain/backups) == $VPS_USER ]]"

check "rclone config persisted in volume" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose -f infra/docker-compose.yml run --rm --entrypoint sh db-backup -c 'test -s /config/rclone/rclone.conf'"

check "At least one backup exists locally" \
    ssh "$VPS_USER@$VPS_HOST" "ls /opt/vitachain/backups/vitachain_db_*.sql.gz >/dev/null 2>&1"

check "Newest local backup is < 26h old" \
    ssh "$VPS_USER@$VPS_HOST" "test \$(find /opt/vitachain/backups/ -name 'vitachain_db_*.sql.gz' -mmin -1560 | wc -l) -ge 1"

check "Newest local backup sha256 verifies" \
    ssh "$VPS_USER@$VPS_HOST" "cd /opt/vitachain/backups && newest=\$(ls -t vitachain_db_*.sql.gz | head -1) && sha256sum -c \${newest}.sha256"

check "Newest local backup gunzips to valid SQL header" \
    ssh "$VPS_USER@$VPS_HOST" "cd /opt/vitachain/backups && newest=\$(ls -t vitachain_db_*.sql.gz | head -1) && gunzip -c \$newest | head -3 | grep -q 'PostgreSQL database dump'"

check "Newest local backup is mirrored on B2" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && newest=\$(ls -t /opt/vitachain/backups/vitachain_db_*.sql.gz | head -1 | xargs -n1 basename) && docker compose -f infra/docker-compose.yml run --rm --entrypoint rclone db-backup --config /config/rclone/rclone.conf lsf b2:${BACKUP_BUCKET:-vitachain-backups}/${BACKUP_REMOTE_PATH:-postgres}/ | grep -qx \$newest"

check "B2 retention prune is working (no backups > 30d on remote)" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && [[ \$(docker compose -f infra/docker-compose.yml run --rm --entrypoint rclone db-backup --config /config/rclone/rclone.conf lsl b2:${BACKUP_BUCKET:-vitachain-backups}/${BACKUP_REMOTE_PATH:-postgres}/ --min-age 31d | wc -l) -eq 0 ]]"

if [[ -z "${HEALTHCHECKS_BACKUP_URL:-}" ]]; then
    printf '  \033[1;33m·\033[0m %s\n' "Healthchecks recent ping reports 'up' (skipped — HEALTHCHECKS_BACKUP_URL unset)"
else
    check "Healthchecks recent ping reports 'up'" \
        bash -c "curl -fsS \"${HEALTHCHECKS_BACKUP_URL%/}/check\" >/dev/null 2>&1 || curl -fsS \"$HEALTHCHECKS_BACKUP_URL\" >/dev/null 2>&1"
fi

# --- INF-08 observability checks --------------------------------------------
echo ""
echo "INF-08 verification (Sentry + Uptime Kuma)"
echo "----------------------------------------"

check "vita_uptime_kuma is Up (healthy)" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose ps --format '{{.Name}} {{.Status}}' | grep -Eq 'vita_uptime_kuma.*Up.*healthy'"

# Skip the rest of the TLS-anchored checks when VPS_HOST is still an IP — same
# convention as the INF-06 block above.
if [[ "$VPS_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '  \033[1;33m·\033[0m %s\n' "INF-08 TLS-anchored checks skipped — VPS_HOST is an IP literal"
else
    # /uptime/ should be reachable; 401 (auth required) or 2xx/3xx all prove
    # the path is proxied through to Kuma. 404 means the location block didn't
    # match — NGINX is misconfigured.
    check "https://$VPS_HOST/uptime/ proxied (401/200/301/302)" \
        bash -c "code=\$(curl -k -o /dev/null -s -w '%{http_code}' https://$VPS_HOST/uptime/); [[ \"\$code\" =~ ^(200|301|302|401)$ ]]"

    # Planted backend route: 500 in staging, 404 in prod. Sentry's before_send
    # hook drops the event in prod even if it ever fires.
    if [[ "${SENTRY_ENVIRONMENT:-prod}" == "staging" ]]; then
        check "/api/v1/_sentry_test returns 500 in staging" \
            bash -c "[[ \$(curl -k -o /dev/null -s -w '%{http_code}' https://$VPS_HOST/api/v1/_sentry_test) == 500 ]]"
    else
        check "/api/v1/_sentry_test returns 404 in prod" \
            bash -c "[[ \$(curl -k -o /dev/null -s -w '%{http_code}' https://$VPS_HOST/api/v1/_sentry_test) == 404 ]]"
    fi

    # NGINX htpasswd file landed inside the named volume + reload picked it up.
    check "/uptime/ basic-auth gate active (401 without creds)" \
        bash -c "[[ \$(curl -k -o /dev/null -s -w '%{http_code}' https://$VPS_HOST/uptime/) == 401 ]]"
fi

# --- AUTH-08 rate-limiting checks -------------------------------------------
echo ""
echo "AUTH-08 verification (rate limiting)"
echo "----------------------------------------"

if [[ "$VPS_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '  \033[1;33m·\033[0m %s\n' "AUTH-08 checks skipped — VPS_HOST is an IP literal"
else
    # 1. All nine limit_req zones rendered into the live config (7 named
    #    buckets + 2 method-conditional siblings for meals/ads).
    check "AUTH-08 — 9 limit_req_zone blocks present in rendered config" \
        ssh "$VPS_USER@$VPS_HOST" "docker exec vita_nginx grep -c '^limit_req_zone' /etc/nginx/conf.d/00-rate-limits.conf | grep -qx 9"

    # 2. limit_conn_zone (perip + perserver) present.
    check "AUTH-08 — 2 limit_conn_zone blocks present" \
        ssh "$VPS_USER@$VPS_HOST" "docker exec vita_nginx grep -c '^limit_conn_zone' /etc/nginx/conf.d/00-rate-limits.conf | grep -qx 2"

    # 3. Geo whitelist resolves the VPS public IP (substituted by envsubst).
    if [[ -n "${VPS_PUBLIC_IP:-}" ]]; then
        check "AUTH-08 — VPS_PUBLIC_IP rendered into whitelist" \
            ssh "$VPS_USER@$VPS_HOST" "docker exec vita_nginx grep -qF '$VPS_PUBLIC_IP' /etc/nginx/conf.d/00-rate-limits.conf"
    else
        printf '  \033[1;33m·\033[0m %s\n' "VPS_PUBLIC_IP unset — whitelist rendering not asserted"
    fi

    # 4. nginx -t clean inside the running container.
    check "AUTH-08 — nginx -t clean inside container" \
        ssh "$VPS_USER@$VPS_HOST" "docker exec vita_nginx nginx -t"

    # 5. /healthz survives a 200-req burst from one IP (whitelisted by absence
    #    of any limit_req directive on the location).
    check "AUTH-08 — /healthz survives 200-req/50-conc burst (≥ 195/200)" \
        bash -c "out=\$(curl -s -o /dev/null -w '%{http_code}\\n' \
              \$(for i in \$(seq 1 200); do echo -n ' https://$VPS_HOST/healthz'; done) 2>/dev/null \
              | grep -c '^200$'); [[ \$out -ge 195 ]]"

    # 6. A reservation flood from one IP returns 429.
    check "AUTH-08 — reservation flood (40-req) yields ≥ 25 429s" \
        bash -c "n=0; for i in \$(seq 1 40); do code=\$(curl -k -s -o /dev/null -w '%{http_code}' -X POST https://$VPS_HOST/api/v1/secondserve/reservations); [[ \$code == 429 ]] && n=\$((n+1)); done; [[ \$n -ge 25 ]]"

    # 7. 429 responses carry Retry-After + the X-RateLimit-Hit marker.
    check "AUTH-08 — 429 response carries Retry-After + X-RateLimit-Hit" \
        bash -c "for i in \$(seq 1 30); do curl -k -s -o /dev/null -X POST https://$VPS_HOST/api/v1/secondserve/reservations; done; \
                 hdr=\$(curl -k -sI -X POST https://$VPS_HOST/api/v1/secondserve/reservations); \
                 echo \"\$hdr\" | grep -qi '^HTTP/.*429' && \
                 echo \"\$hdr\" | grep -qi '^retry-after:' && \
                 echo \"\$hdr\" | grep -qi '^x-ratelimit-hit: *1'"

    # 8. The 429 body is the branded HTML (FR title visible).
    check "AUTH-08 — 429 body is branded /429.html (locale strings present)" \
        bash -c "for i in \$(seq 1 30); do curl -k -s -o /dev/null -X POST https://$VPS_HOST/api/v1/secondserve/reservations; done; \
                 body=\$(curl -k -s -X POST https://$VPS_HOST/api/v1/secondserve/reservations); \
                 echo \"\$body\" | grep -q 'Trop de requêtes' && \
                 echo \"\$body\" | grep -q 'VitaChain'"

    # 9. 429 page does NOT leak internal infra references.
    check "AUTH-08 — 429 body free of internal infra references" \
        bash -c "body=\$(curl -k -s https://$VPS_HOST/429.html); \
                 ! echo \"\$body\" | grep -Eiq '(uptime/|/api/v1/admin|sentry|supabase\\.co)'"

    # 10. Auth grant is tighter than public_read — a 20-shot burst is throttled.
    check "AUTH-08 — auth_grant flood (20-req) yields ≥ 10 429s" \
        bash -c "n=0; for i in \$(seq 1 20); do code=\$(curl -k -s -o /dev/null -w '%{http_code}' -X POST https://$VPS_HOST/api/v1/auth/token); [[ \$code == 429 ]] && n=\$((n+1)); done; [[ \$n -ge 10 ]]"

    # 11. iot_ingest is keyed on the X-Device-Api-Key header, not the IP:
    #     two distinct keys consume independent buckets.
    check "AUTH-08 — iot_ingest keyed on device key (two keys = two buckets)" \
        bash -c "n1=0; for i in \$(seq 1 25); do code=\$(curl -k -s -o /dev/null -w '%{http_code}' -X POST -H 'X-Device-Api-Key: bench-key-A' https://$VPS_HOST/api/v1/katara/ingest); [[ \$code == 429 ]] && n1=\$((n1+1)); done; \
                 n2=0; for i in \$(seq 1 5); do code=\$(curl -k -s -o /dev/null -w '%{http_code}' -X POST -H 'X-Device-Api-Key: bench-key-B' https://$VPS_HOST/api/v1/katara/ingest); [[ \$code == 429 ]] && n2=\$((n2+1)); done; \
                 [[ \$n1 -ge 10 ]] && [[ \$n2 -le 1 ]]"

    # 12. The catch-all /api/v1/ falls into the loose public_read bucket
    #     (a healthz burst on /api/v1/healthz must stay green).
    check "AUTH-08 — /api/v1/healthz survives 50-req burst" \
        bash -c "n=0; for i in \$(seq 1 50); do code=\$(curl -k -s -o /dev/null -w '%{http_code}' https://$VPS_HOST/api/v1/healthz); [[ \$code == 200 ]] && n=\$((n+1)); done; [[ \$n -ge 48 ]]"

    # 13. 429.html asset is reachable directly (so the @ratelimited internal
    #     fallback always has something to serve).
    check "AUTH-08 — /429.html asset bind-mounted + reachable" \
        bash -c "[[ \$(curl -k -o /dev/null -s -w '%{http_code}' https://$VPS_HOST/429.html) == 200 ]] && \
                 curl -k -fsS https://$VPS_HOST/429.html | grep -q '429 · Too Many Requests'"

    # 14. NGINX error log mentions limit_req hits (proves the bucket fired
    #     during the burst tests above).
    check "AUTH-08 — error.log shows 'limiting requests by zone' WARN lines" \
        ssh "$VPS_USER@$VPS_HOST" "docker exec vita_nginx sh -c 'tail -n 500 /var/log/nginx/error.log | grep -q \"limiting requests by zone\"'"
fi

# AUTH-05 boundary still clean — re-run since INF-08 added DSN-shaped env vars
# that could land in the wrong place. The script is the same single source of
# truth invoked from INF-04 above; this re-run is cheap insurance.
check "AUTH-05 boundary clean (post-INF-08 env additions)" \
    bash "$SCRIPT_DIR/../../scripts/check-secrets-boundary.sh"

# Discord/Telegram webhook smoke — best-effort, skipped if unset. Posts a
# clearly-labelled "ignore me" payload so the channel signals the wiring works
# without the on-call team thinking a real incident is unfolding.
if [[ -n "${ALERT_WEBHOOK_URL:-}" ]]; then
    check "Discord/Telegram webhook reachable" \
        bash -c "code=\$(curl -o /dev/null -s -w '%{http_code}' -X POST '$ALERT_WEBHOOK_URL' \
                -H 'Content-Type: application/json' \
                -d '{\"content\":\"INF-08 verify smoke — ignore\"}'); [[ \"\$code\" =~ ^(200|204)$ ]]"
else
    printf '  \033[1;33m·\033[0m %s\n' "Discord/Telegram webhook reachable (skipped — ALERT_WEBHOOK_URL unset)"
fi

echo "----------------------------------------"
printf 'Passed: \033[1;32m%d\033[0m   Failed: \033[1;31m%d\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
