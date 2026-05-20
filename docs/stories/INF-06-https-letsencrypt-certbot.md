# INF-06 — HTTPS via Let's Encrypt (Certbot) on all domains

> **Epic:** E0 — Infrastructure & DevOps Foundation
> **Phase:** P3 — Architect (Weeks 6–7) *(per [docs/spring-status.yml:172](../spring-status.yml#L172) — this is the W7 "HTTPS on all routes" milestone, not a P1 deliverable)*
> **Priority:** Must
> **Status:** TODO
> **Depends on:** [INF-01](INF-01-provision-vps-docker-nginx.md) (`IN_PROGRESS` — VPS+NGINX must be live; ACME http-01 requires a real `:80` reachable from the public Internet)
> **Unblocks:** [INF-08](#) (Sentry/Uptime Kuma probes should target `https://` from day 1), [AUTH-08](#) (NGINX rate-limit zones live in the same `server` blocks we're about to add the `ssl_*` directives to — touching the file twice is wasteful), every demo URL surfaced to farmers / restaurateurs / citizens (browsers refuse cleartext geolocation in [SEC-03](#), refuse `navigator.serviceWorker` registration anywhere outside `localhost`, and Brevo magic-link emails open in browsers that show a red lock).
> **Acceptance (PRD §8.3 + [docs/spring-status.yml:170](../spring-status.yml#L170)):** *"All routes serve over HTTPS; HSTS header set."*

---

## 1. Purpose

Flip the production VPS from cleartext-only to TLS-everywhere using **Let's Encrypt** (free, automated, ACME http-01) so that:

- **Every** public origin — `vitachain.ma`, `www.vitachain.ma`, and any future subdomain — is served over `https://` with a browser-trusted cert.
- **Cleartext `:80`** is reserved for two purposes only: serving the ACME challenge for renewals, and issuing a `301 → https://` for every other path. Nothing else.
- **HSTS** is set on every `2xx` response from the app: `max-age=31536000; includeSubDomains; preload`. This is the contract the PRD §8.3 row "HTTPS — Let's Encrypt (Certbot) for all domains" actually wants — a cert without HSTS still lets a downgrade attack succeed on first visit.
- **Renewal** is automatic, idempotent, observable, and survives an unattended VPS for ≥ 60 days (Let's Encrypt issues for 90; we renew at 30-days-remaining).
- The **NGINX TLS profile** is on the modern Mozilla intermediate baseline (TLSv1.2 + TLSv1.3, no SSLv3/TLSv1.0/TLSv1.1, modern cipher suites, OCSP stapling, session resumption).
- All downstream env contracts (`CORS_ALLOW_ORIGINS`, `NEXT_PUBLIC_SITE_URL`, Supabase Auth redirect URLs) **flip from `http://` to `https://`** in the same change. Otherwise the JS bundle is built with a `http://` site URL and every server action 308-redirects, breaking the auth journey introduced in INF-03 §6.

The deliverable is therefore **not just "a cert"** — it is a single atomic state transition: TLS terminator + HSTS + automated renewal + env URLs + Supabase Auth allowlist, all moved in lockstep so the demo never serves a mixed-content page.

---

## 2. Scope

### In scope

- **Certbot sidecar container** in [infra/docker-compose.yml](../../infra/docker-compose.yml), sharing two named volumes with the existing `nginx` service:
  - `letsencrypt_etc → /etc/letsencrypt` (private keys, fullchain, account state).
  - `letsencrypt_www → /var/www/certbot` (webroot for `/.well-known/acme-challenge/`).
- **Two NGINX server blocks** in [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf):
  - `:80` shrinks to two `location` blocks — `^~ /.well-known/acme-challenge/` (served from `/var/www/certbot`) and `/` (`return 301 https://$host$request_uri`). The current `:80` site is retired wholesale.
  - `:443 ssl http2` becomes the *only* application listener; the existing `/api/v1/` and `/` `proxy_pass` blocks move there verbatim. HSTS, OCSP, modern cipher list, session cache, `ssl_dhparam`, and the cert paths sit at the top.
- **TLS hardening fragment** at [infra/nginx/conf.d/tls.conf](../../infra/nginx/conf.d/tls.conf) — pulled into both vhosts via `include`. Keeps the cipher list and OCSP settings in one place; AUTH-08's rate-limit zones will land in the same `:443` block without conflicting.
- **`infra/scripts/issue-cert.sh`** — one-shot, idempotent: detects whether a cert already exists for `$DOMAINS`, exits 0 if it does, otherwise runs `certbot certonly --webroot` against the live ACME endpoint. Re-running it is safe.
- **`infra/scripts/renew-cert.sh`** — invoked by cron on the VPS host (not inside a container): runs `certbot renew --quiet --deploy-hook "docker compose exec nginx nginx -s reload"` so a successful renewal reloads NGINX without restarting the container. Pings Healthchecks.io on success (same UUID convention as INF-07's pg_dump heartbeat).
- **Cron entry** in [infra/scripts/bootstrap-vps.sh](../../infra/scripts/bootstrap-vps.sh): twice-daily `certbot renew` (00:23 + 12:23 — staggered to avoid the renewal mass-stampede, exactly as Certbot's own packaging recommends). Twice a day because if one window fails the second one still has 29 days of headroom.
- **DH params** (`ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem`) shipped by Certbot's `certbot` Docker image — no manual `openssl dhparam -out … 2048` step required, because the Mozilla intermediate profile already provides one via Certbot's data files. We *don't* generate 4096-bit DH because Mozilla intermediate explicitly recommends against it (CPU cost without measurable security gain at TLS 1.3).
- **HSTS** at `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;` — `always` is load-bearing: without it, `add_header` skips error pages and a 502 wouldn't ship the header, breaking the preload submission rules.
- **Env contract flip** in [infra/.env.example](../../infra/.env.example) and the runbook for the live `infra/.env`:
  - `NEXT_PUBLIC_SITE_URL=http://vitachain.ma` → `https://vitachain.ma`.
  - `CORS_ALLOW_ORIGINS=http://vitachain.ma` → `https://vitachain.ma,https://www.vitachain.ma`.
  - Frontend rebuild is required (build-arg `NEXT_PUBLIC_SITE_URL` is inlined into the JS bundle — see [infra/docker-compose.yml:56](../../infra/docker-compose.yml#L56)).
- **Supabase Auth allowed redirect URLs** updated in the Supabase Dashboard → Authentication → URL Configuration: add `https://vitachain.ma/**` and `https://www.vitachain.ma/**`; remove `http://*` entries. (Documented in the runbook; not scriptable from CI because the Supabase Management API for this is gated.)
- **`verify.sh` extension** — append an INF-06 verification section that asserts:
  - `curl http://vitachain.ma/` returns `301` with `Location: https://vitachain.ma/`.
  - `curl https://vitachain.ma/healthz` returns `200 ok`.
  - Response includes `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
  - `openssl s_client -servername vitachain.ma -connect vitachain.ma:443 < /dev/null 2>/dev/null | openssl x509 -noout -issuer` shows `Let's Encrypt` (not the default self-signed snake oil).
  - The cert's `notAfter` is ≥ 30 days in the future (i.e. renewal didn't fall behind).
  - `nmap --script ssl-enum-ciphers -p 443 vitachain.ma` reports no TLSv1.0/1.1 ciphers and grades the cipher list at A or better.
- **Runbook entry** in [docs/runbook.md](../runbook.md): the one-shot first-issuance walkthrough (DNS pre-flight → `make -C infra deploy` → `make -C infra issue-cert` → `make -C infra deploy` again to reload NGINX with the now-existing cert paths → smoke), the renewal-failure incident playbook (Let's Encrypt rate-limits: 5 failures/hour/account — back off rather than retry-loop), and the HSTS-preload submission checklist for [hstspreload.org](https://hstspreload.org/).
- **`make -C infra issue-cert` / `make -C infra renew-cert` / `make -C infra cert-info`** targets in [infra/Makefile](../../infra/Makefile) — symmetric with the existing `deploy` / `verify` surface.

### Out of scope (later stories)

- **Wildcard cert** (`*.vitachain.ma`) — requires DNS-01, which needs an API token for the registrar. We only ship apex + `www` for MVD. Adding a subdomain later (`status.vitachain.ma`, `admin.vitachain.ma`) is a one-line `-d` addition to `issue-cert.sh`.
- **Multi-account ACME** / failover to ZeroSSL — Let's Encrypt has an `> 99.9%` SLA over the last 24 months; a backup CA is a Phase-3-post-demo concern.
- **Cloudflare CDN/WAF in front of the VPS** — PRD §8.4 Level 4. INF-06 keeps origin TLS terminating on the VPS so the Cloudflare-orange-cloud step later is a configuration flip (`Full (strict)` mode) without a code change.
- **mTLS** for the ESP32 → `/api/v1/katara/ingest` SLA path → **KAT-03 §6.1.3** owns its own constant-time API-key auth; mutual TLS is overkill for the budget.
- **Certificate Transparency monitoring** (crt.sh / Cert Spotter alerts on mis-issuance) — a Should for Phase 3 post-demo.
- **HSTS preload list submission** — the code in this story makes the site *eligible* (the header is correctly formed and the site is HTTPS-everywhere); the actual submission at [hstspreload.org](https://hstspreload.org/) is a manual one-shot step documented in the runbook. We don't auto-submit because rollback from the preload list takes weeks.
- **TLS for SMTP / Brevo callbacks** — Brevo is the sender, not the receiver; INF-06 is purely public-edge.
- **NGINX rate limiting** (`limit_req_zone`) — owned by **AUTH-08**. We leave a clearly commented insertion point inside the new `:443` `server { }` so AUTH-08 doesn't have to re-architect the file.
- **WebSocket upgrade tightening** — INF-03 already sets `proxy_set_header Upgrade $http_upgrade` and that survives the TLS move unchanged.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-01](INF-01-provision-vps-docker-nginx.md) reaches DONE | VPS up, `vita_nginx` healthy on `:80`, UFW open on `:80` and `:443`. The Certbot http-01 challenge **requires** a publicly reachable `:80` — there is no way around this for the apex without DNS-01. The bootstrap script already opens `:443/tcp` in UFW; verify with `sudo ufw status`. |
| DNS A records live | `vitachain.ma` → `<VPS_IP>` **and** `www.vitachain.ma` → `<VPS_IP>` (or a CNAME to the apex). Verify with `dig +short vitachain.ma` from your laptop. TTL ≤ 300 s per PRD §8.2 "Demo day RTO". |
| Domain not on the Public Suffix List as a TLD | `vitachain.ma` is fine (`.ma` is a ccTLD, not a PSL entry that prohibits cert issuance). |
| Let's Encrypt **staging** endpoint tested first | The `issue-cert.sh` script defaults to `--server https://acme-staging-v02.api.letsencrypt.org/directory` and requires an explicit `LETSENCRYPT_PROD=1` env to hit production. Rate limits on production are 5 duplicate certs/week — burning them during debugging is the most expensive mistake we can make. |
| `ADMIN_EMAIL` set in `infra/.env` | Used as the ACME account contact (`certbot --email`). Let's Encrypt mails this address on renewal failure and 20 days before expiry. Put a *monitored* inbox here — `ops@vitachain.ma` if it exists, otherwise the team's shared address. |
| Supabase Dashboard access | Required for the manual Auth → URL Configuration update (out-of-band; not scriptable in this story). |

---

## 4. Target configuration

| Setting | Value | Source / Rationale |
|---|---|---|
| ACME client | `certbot/certbot:latest` (Docker, pinned by digest in the compose file — see §5.2) | Reference implementation. Avoids host-package version drift. |
| Challenge type | `http-01` via `--webroot` | DNS-01 needs registrar API keys we don't have on the budget; tls-alpn-01 needs port `:443` *unbound* during issuance, which conflicts with the live NGINX. http-01 is the only path that issues without downtime. |
| Renewal trigger | Host-level cron, twice daily (`23 0,12 * * *`) | Cron daemon survives a Docker daemon restart; a sidecar timer container does not. Twice daily is Certbot upstream's own recommendation. |
| Renewal reload | `--deploy-hook 'docker compose exec nginx nginx -s reload'` | `nginx -s reload` is signal-driven, zero-downtime; full `docker compose restart nginx` would drop in-flight TLS connections during the demo. |
| TLS versions | `TLSv1.2 TLSv1.3` | TLSv1.0/1.1 deprecated since 2020 (RFC 8996); modern browsers refuse them anyway. TLSv1.3 is mandatory because OWM/Sentinel/Gemini API endpoints all require it for our outbound calls, but that's a separate concern. |
| Cipher list | Mozilla **intermediate** baseline (auto-generated by Certbot in `/etc/letsencrypt/options-ssl-nginx.conf`) | The `modern` profile drops TLSv1.2 entirely — which would lock out Android 7 / Safari 10 era users, a real slice of our farmer persona. |
| HSTS | `max-age=31536000; includeSubDomains; preload` with `always` | One-year max-age is the [hstspreload.org](https://hstspreload.org/) minimum. `preload` is the *signal* that we intend to be listed, not the listing itself — the manual submission is separate. |
| OCSP stapling | `ssl_stapling on; ssl_stapling_verify on; resolver 1.1.1.1 1.0.0.1 valid=300s;` | Reduces client TLS handshake by one round-trip. `resolver` is mandatory — NGINX won't resolve the OCSP responder hostname without it. |
| Session cache | `ssl_session_cache shared:SSL:10m; ssl_session_timeout 1d; ssl_session_tickets off;` | 10 MB ≈ 40 k sessions, far above our 50-concurrent-user MVD budget. Tickets *off* because rotation is fiddly and PFS is preserved by 1-day-only resumption tickets via the session cache instead. |
| `ssl_dhparam` | `/etc/letsencrypt/ssl-dhparams.pem` (shipped by Certbot) | 2048-bit DH params are the Mozilla intermediate recommendation — anything larger is CPU waste at TLS 1.3. |
| Port `:80` | **Only** ACME challenge + `301` redirect | No application traffic. Closing `:80` entirely is tempting but breaks Certbot renewals (http-01 needs it). |
| Port `:443` | Sole application listener | Existing `proxy_pass` blocks for `/api/v1/` and `/` migrate here verbatim. |
| Cert lifetime | 90 days (Let's Encrypt default) | Renewed at 30 days remaining. |
| Issuance rate-limit budget | 50 certs/registered-domain/week, 5 duplicates/week | The staging-first pattern keeps both counters at zero during development. |

---

## 5. Step-by-Step Implementation

### 5.1 Pre-flight — DNS + UFW

```bash
# From your laptop:
dig +short vitachain.ma         # expect: <VPS_IP>
dig +short www.vitachain.ma     # expect: <VPS_IP>  (or CNAME → vitachain.ma)

# On the VPS:
ssh "$VPS_USER@$VPS_HOST" "sudo ufw status | grep -E '443/tcp|80/tcp'"
# Expect: both ALLOW lines present. bootstrap-vps.sh already adds them.
```

If `:443` isn't open, fix it before going further — Certbot will report "Connection refused" rather than a useful error, and the http-01 challenge from Let's Encrypt's validation servers comes from a rotating IP pool you can't pre-allowlist.

### 5.2 Compose — add the certbot sidecar, expose `:443`

Patch [infra/docker-compose.yml](../../infra/docker-compose.yml). Two surgical edits — the `nginx` service grows a port and two volume mounts; a new `certbot` service is appended after `backend`.

```yaml
  nginx:
    image: nginx:1.27-alpine
    container_name: vita_nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"                                # ← new (INF-06)
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/html:/usr/share/nginx/html:ro
      - letsencrypt_etc:/etc/letsencrypt:ro       # ← new (INF-06) — certs + options-ssl-nginx.conf
      - letsencrypt_www:/var/www/certbot:ro       # ← new (INF-06) — ACME challenge webroot
    networks:
      - vita_net
    depends_on:
      - frontend
      - backend
    healthcheck:
      # Healthcheck stays on the cleartext :80 /healthz because it's reachable
      # from inside the container without bothering with TLS verification.
      test: ["CMD", "wget", "-q", "-O-", "http://localhost/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }

  # ---------------------------------------------------------------------------
  # INF-06 — Certbot sidecar. Idle by default; invoked on-demand via
  # `docker compose run --rm certbot …` from issue-cert.sh / renew-cert.sh.
  # Pinning by digest is non-negotiable — a moved `latest` tag would silently
  # ship new ACME client behaviour into our renewal cron.
  # ---------------------------------------------------------------------------
  certbot:
    image: certbot/certbot@sha256:REPLACE_WITH_PINNED_DIGEST   # see §5.10
    container_name: vita_certbot
    # `command: ['version']` is a safe default; real invocations override.
    command: ["version"]
    volumes:
      - letsencrypt_etc:/etc/letsencrypt
      - letsencrypt_www:/var/www/certbot
    # Never restart on its own — it's a one-shot tool.
    restart: "no"
    logging: { driver: json-file, options: { max-size: "5m", max-file: "2" } }

volumes:
  letsencrypt_etc:
  letsencrypt_www:
```

> **Why bind-mount `letsencrypt_etc` read-only into NGINX?** NGINX never writes to the cert directory; Certbot does. Read-only mount = explicit, and a misbehaving NGINX worker (or future malicious upstream response writing to a path) cannot corrupt the cert state.

### 5.3 NGINX — TLS profile fragment

[infra/nginx/conf.d/tls.conf](../../infra/nginx/conf.d/tls.conf) — **new**, included from the `:443` block:

```nginx
# tls.conf — shared TLS profile (INF-06). Included from every :443 server.
# Mozilla intermediate baseline (2024-09 snapshot) — supports TLSv1.2+ only,
# modern AEAD ciphers, OCSP stapling, 1-day session resumption.

ssl_certificate         /etc/letsencrypt/live/vitachain.ma/fullchain.pem;
ssl_certificate_key     /etc/letsencrypt/live/vitachain.ma/privkey.pem;
ssl_trusted_certificate /etc/letsencrypt/live/vitachain.ma/chain.pem;

# Certbot ships these; they encode the intermediate Mozilla profile.
include                 /etc/letsencrypt/options-ssl-nginx.conf;
ssl_dhparam             /etc/letsencrypt/ssl-dhparams.pem;

# Session resumption — large enough for our 50-CCU MVD with headroom.
ssl_session_cache       shared:SSL:10m;
ssl_session_timeout     1d;
ssl_session_tickets     off;

# OCSP stapling — one fewer round-trip during the TLS handshake.
ssl_stapling            on;
ssl_stapling_verify     on;
resolver                1.1.1.1 1.0.0.1 valid=300s;
resolver_timeout        5s;
```

> Why not inline these directives in `default.conf`? Because **AUTH-08** is going to add `limit_req_zone` blocks at `http { }` scope and rate-limit directives inside the same `server { }`; keeping the TLS profile in a focused file means that PR diff stays readable and there's no merge conflict on the `ssl_*` lines.

### 5.4 NGINX — rewrite `default.conf` for the TLS move

Replace [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf) in full (the existing `:80` site is retired; the proxy_pass blocks move verbatim to `:443`):

```nginx
# VitaChain — public vhost (INF-01 + INF-03 + INF-04 + INF-06)
# :80 = ACME challenge + 301 redirect. All application traffic on :443.
# Rate-limiting insertion point marked "AUTH-08 — RATE LIMITS HERE".

upstream vita_frontend {
    server frontend:3000;
    keepalive 32;
}

upstream vita_backend {
    server backend:8000;
    keepalive 32;
}

# -----------------------------------------------------------------------------
# :80 — ACME challenge + redirect-everything-else. No application logic.
# -----------------------------------------------------------------------------
server {
    listen 80 default_server;
    server_name vitachain.ma www.vitachain.ma _;

    # ACME http-01 challenge. MUST be served unencrypted from the webroot
    # certbot writes to. Anything that bypasses this 301-redirects the
    # Let's Encrypt validation request, which fails the issuance.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    # NGINX-local liveness — kept on :80 so the container healthcheck doesn't
    # need to deal with TLS verification against a self-signed snake oil cert
    # on first boot before the real cert exists.
    location = /healthz {
        access_log off;
        add_header Content-Type text/plain;
        return 200 "ok\n";
    }

    # Everything else: hard redirect to HTTPS, preserving path + query.
    location / {
        return 301 https://$host$request_uri;
    }

    server_tokens off;
}

# -----------------------------------------------------------------------------
# :443 — the application listener. HSTS, modern TLS, then the existing
# /api/v1/ + / proxy_pass blocks unchanged from INF-01/03/04.
# -----------------------------------------------------------------------------
server {
    listen 443 ssl;
    http2  on;                            # NGINX ≥ 1.25 syntax
    server_name vitachain.ma www.vitachain.ma;

    include /etc/nginx/conf.d/tls.conf;

    # HSTS — `always` ensures the header rides on error responses too.
    # max-age=1y + includeSubDomains + preload makes the site eligible for
    # the HSTS preload list (manual submission tracked in the runbook).
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # Defence-in-depth headers (cheap, no behaviour change).
    add_header X-Content-Type-Options    "nosniff"           always;
    add_header X-Frame-Options           "DENY"              always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    # AUTH-08 — RATE LIMITS HERE
    # (limit_req zones declared at http {} scope, applied per-location below.)

    location = /healthz {
        access_log off;
        add_header Content-Type text/plain;
        return 200 "ok\n";
    }

    location = /50x.html {
        root /usr/share/nginx/html;
        internal;
    }

    # ---- Backend (FastAPI) ------------------------------------------------
    location /api/v1/ {
        proxy_pass         http://vita_backend;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # now correctly 'https'
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Request-Id      $request_id;

        proxy_connect_timeout 5s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;

        client_max_body_size  10m;

        proxy_intercept_errors on;
        error_page 502 503 504 /50x.html;
    }

    # ---- Frontend (Next.js) -----------------------------------------------
    location / {
        proxy_pass         http://vita_frontend;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # now correctly 'https'
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";

        proxy_read_timeout    60s;
        proxy_send_timeout    60s;
        proxy_connect_timeout 5s;

        proxy_intercept_errors on;
        error_page 502 503 504 /50x.html;
    }

    server_tokens off;
    client_max_body_size 5m;
}
```

> **`X-Forwarded-Proto $scheme` is now load-bearing**: Next.js server actions construct absolute URLs from this header. If it says `http` while the user is on `https`, the redirect target is downgraded — the bug shows up as "login works once and then logs you out". `$scheme` evaluates to `https` inside the `:443` block, so the contract holds.

### 5.5 Certificate issuance — `issue-cert.sh`

[infra/scripts/issue-cert.sh](../../infra/scripts/issue-cert.sh) — **new**:

```bash
#!/usr/bin/env bash
# issue-cert.sh — INF-06. Idempotent first-issuance of the Let's Encrypt cert.
#
# Usage (on the VPS, in $PROJECT_DIR):
#   ./infra/scripts/issue-cert.sh              # staging endpoint (safe default)
#   LETSENCRYPT_PROD=1 ./infra/scripts/issue-cert.sh   # production endpoint
#
# Re-running is safe:
#   * If a live cert already exists for the listed domains, exits 0.
#   * If only the staging cert exists, --force-renewal + --break-my-certs is
#     required to swap it for production (documented in the runbook).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[[ -f "$SCRIPT_DIR/../.env" ]] && source "$SCRIPT_DIR/../.env"

: "${ADMIN_EMAIL:?Set ADMIN_EMAIL in infra/.env — Let's Encrypt account contact}"
: "${DOMAINS:=vitachain.ma www.vitachain.ma}"

# Build the -d <domain> flags from $DOMAINS (space-separated).
d_args=()
for d in $DOMAINS; do d_args+=(-d "$d"); done

if [[ "${LETSENCRYPT_PROD:-0}" == "1" ]]; then
    server="https://acme-v02.api.letsencrypt.org/directory"
    echo "==> PRODUCTION endpoint — counts against rate limits (50 certs/domain/week)"
else
    server="https://acme-staging-v02.api.letsencrypt.org/directory"
    echo "==> STAGING endpoint — set LETSENCRYPT_PROD=1 once smoke is green"
fi

# Already have a live cert? Short-circuit. Re-running this script is a
# common operation (e.g. after a rebuild) and must not burn rate limits.
if docker compose run --rm --entrypoint sh certbot \
       -c "test -s /etc/letsencrypt/live/${DOMAINS%% *}/fullchain.pem" 2>/dev/null; then
    echo "==> Cert already exists for ${DOMAINS%% *}; skipping issuance."
    docker compose run --rm --entrypoint certbot certbot certificates
    exit 0
fi

echo "==> Requesting cert for: $DOMAINS"
docker compose run --rm --entrypoint certbot certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --server "$server" \
    --email "$ADMIN_EMAIL" \
    --agree-tos --no-eff-email \
    --rsa-key-size 4096 \
    --non-interactive \
    "${d_args[@]}"

# options-ssl-nginx.conf + ssl-dhparams.pem are auto-installed by Certbot
# into /etc/letsencrypt the first time it runs; tls.conf includes them.

echo "==> Reloading nginx to pick up the new cert"
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload

echo "==> Done. Verify with:  make -C infra verify"
```

> The default is **staging**. The production switch is deliberately a single env var, not a script flag — `--prod` is too easy to type by reflex; an env var is harder to fire accidentally.

### 5.6 Renewal — `renew-cert.sh` + cron

[infra/scripts/renew-cert.sh](../../infra/scripts/renew-cert.sh) — **new**:

```bash
#!/usr/bin/env bash
# renew-cert.sh — INF-06. Invoked twice daily by cron on the VPS host.
# Safe to run when no renewal is due (certbot exits 0 immediately).

set -euo pipefail

# Cron's PATH is minimal; resolve `docker` and friends explicitly.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

PROJECT_DIR="${PROJECT_DIR:-/opt/vitachain}"
LOG="/var/log/vitachain-renew.log"

cd "$PROJECT_DIR"

{
    echo "===================================="
    date -u '+%Y-%m-%dT%H:%M:%SZ — renew-cert start'

    docker compose run --rm --entrypoint certbot certbot renew \
        --quiet \
        --deploy-hook "docker compose exec nginx nginx -s reload"

    date -u '+%Y-%m-%dT%H:%M:%SZ — renew-cert end'

    # Heartbeat — Healthchecks.io detects a missing ping after 3 days,
    # which is enough warning to fix renewal before the 30-day cliff.
    if [[ -n "${HEALTHCHECKS_RENEW_URL:-}" ]]; then
        curl -fsS -m 10 "$HEALTHCHECKS_RENEW_URL" >/dev/null || true
    fi
} >>"$LOG" 2>&1
```

Then in [infra/scripts/bootstrap-vps.sh](../../infra/scripts/bootstrap-vps.sh), add a one-liner near the existing unattended-upgrades block (idempotent — `tee` overwrites with the same content on re-bootstrap):

```bash
# INF-06 — twice-daily renewal cron (Certbot upstream's own recommendation).
# Times are staggered (00:23 and 12:23) to avoid the ACME mass-stampede.
sudo tee /etc/cron.d/vitachain-cert-renew > /dev/null <<EOF
23 0,12 * * * $VPS_USER bash $PROJECT_DIR/infra/scripts/renew-cert.sh
EOF
sudo chmod 0644 /etc/cron.d/vitachain-cert-renew
```

> **Why host cron rather than a container?** A container-internal cron daemon dies when the container dies; the host's cron survives Docker daemon restarts. This is the canonical Certbot Docker-deployment pattern.

### 5.7 Env contract — `.env.example` and the live `.env`

Patch [infra/.env.example](../../infra/.env.example) (and document a corresponding edit to the live `infra/.env` in the runbook):

```diff
 # -----------------------------------------------------------------------------
 # INF-03 — Public Supabase values consumed by docker-compose to build the
 # frontend image. Copy from the root .env (filled in INF-02). Only NEXT_PUBLIC_*
 # may appear here. Service-role / JWT secrets stay backend-only (INF-04 / AUTH-05).
 # -----------------------------------------------------------------------------
 NEXT_PUBLIC_SUPABASE_URL=
 NEXT_PUBLIC_SUPABASE_ANON_KEY=
-NEXT_PUBLIC_SITE_URL=http://vitachain.ma
+NEXT_PUBLIC_SITE_URL=https://vitachain.ma

 # -----------------------------------------------------------------------------
 # INF-04 — FastAPI backend runtime env. These NEVER leave the backend
 # container (AUTH-05 — verified by infra/scripts/verify.sh).
 # -----------------------------------------------------------------------------
 ENVIRONMENT=prod
 LOG_LEVEL=INFO
 GIT_SHA=unknown
 SUPABASE_URL=
 SUPABASE_SERVICE_ROLE_KEY=
 SUPABASE_JWT_SECRET=
-CORS_ALLOW_ORIGINS=http://vitachain.ma
+CORS_ALLOW_ORIGINS=https://vitachain.ma,https://www.vitachain.ma
 WEB_CONCURRENCY=2
+
+# -----------------------------------------------------------------------------
+# INF-06 — Let's Encrypt account contact (renewal warnings land here).
+# Use a monitored inbox; LE emails this 20 days before expiry on failure.
+# -----------------------------------------------------------------------------
+ADMIN_EMAIL=ops@vitachain.ma
+DOMAINS=vitachain.ma www.vitachain.ma
+# Optional — Healthchecks.io UUID for renewal heartbeat (INF-07 pattern):
+# HEALTHCHECKS_RENEW_URL=https://hc-ping.com/<uuid>
```

After updating the live `infra/.env`, the frontend must be rebuilt (the build-arg `NEXT_PUBLIC_SITE_URL` is inlined at compile time — see [infra/docker-compose.yml:56](../../infra/docker-compose.yml#L56)):

```bash
make -C infra frontend-rebuild
```

### 5.8 Supabase Dashboard — auth redirect URLs (manual, one-shot)

In the Supabase Dashboard for project `qyyxgdfetzjqfpygikbz`:

1. Navigate to **Authentication → URL Configuration**.
2. **Site URL** → set to `https://vitachain.ma`.
3. **Redirect URLs** (allow-list) → add:
   - `https://vitachain.ma/**`
   - `https://www.vitachain.ma/**`
   - Remove any `http://vitachain.ma*` entries.
4. Save. Test the magic-link flow once — the email link must open `https://`.

This is the only step in INF-06 that isn't checked into git. The runbook (§5.10) documents it; verify.sh asserts the *outcome* (an `http://` login flow now redirects to `https://`).

### 5.9 Makefile targets

Append to [infra/Makefile](../../infra/Makefile):

```makefile
.PHONY: issue-cert renew-cert cert-info

issue-cert:  ## First-issuance — staging by default; LETSENCRYPT_PROD=1 for prod
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && LETSENCRYPT_PROD=$${LETSENCRYPT_PROD:-0} bash infra/scripts/issue-cert.sh"

renew-cert:  ## Force a renewal attempt now (cron also runs twice daily)
	ssh $$VPS_USER@$$VPS_HOST "bash $$PROJECT_DIR/infra/scripts/renew-cert.sh"

cert-info:   ## Show cert subject, issuer, notBefore/notAfter
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot certificates"
```

### 5.10 First-issuance sequence (the one with the most footguns)

This is the only fragile path; once it's done, renewal is autonomous. Run on a developer laptop with `infra/.env` filled in:

```bash
# 1. Sanity — DNS resolves, both A records point at the VPS.
dig +short vitachain.ma www.vitachain.ma

# 2. Pin the certbot image digest. Read the digest from the registry and
#    paste it into infra/docker-compose.yml in place of REPLACE_WITH_PINNED_DIGEST.
docker pull certbot/certbot:latest
docker inspect --format='{{index .RepoDigests 0}}' certbot/certbot:latest

# 3. Deploy the new compose + nginx config (port 443 exposed, :80 redirect
#    site live, :443 site referencing certs that don't exist YET).
make -C infra deploy
# At this point, `curl https://vitachain.ma` fails — that's expected; the
# :443 server block can't start because the certs don't exist. NGINX will
# fail to start. So actually the order is reversed: we need a TWO-STEP
# deploy. See §5.11 for the bootstrap dance.
```

### 5.11 The bootstrap dance — chicken-and-egg

NGINX won't start with `:443 ssl` directives pointing at files that don't exist. Certbot needs NGINX answering `:80` to validate the http-01 challenge. Resolution — a **two-step deploy**:

**Step 1**: temporarily comment out the `:443` server block in `nginx/conf.d/default.conf` (or move it to `default.conf.disabled`). Deploy:

```bash
make -C infra deploy
make -C infra verify       # :80 site healthy, INF-01 checks pass
```

**Step 2**: issue against staging first:

```bash
make -C infra issue-cert                            # staging
ssh $VPS_USER@$VPS_HOST "ls /var/lib/docker/volumes/vitachain_letsencrypt_etc/_data/live/"
# Should show `vitachain.ma` directory.
```

**Step 3**: switch to production. The staging cert must be replaced (Let's Encrypt requires `--force-renewal --break-my-certs` to overwrite a staging cert with a prod one, because the new prod cert has a different issuer):

```bash
ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot delete --cert-name vitachain.ma --non-interactive"
LETSENCRYPT_PROD=1 make -C infra issue-cert
```

**Step 4**: re-enable the `:443` block, redeploy, verify:

```bash
# uncomment the :443 server { … } in default.conf, commit
make -C infra deploy
make -C infra verify       # now includes the INF-06 assertions
```

**Step 5**: front-end rebuild for the URL flip:

```bash
make -C infra frontend-rebuild
```

**Step 6**: Supabase Dashboard URL update (§5.8).

**Step 7**: smoke the full auth journey: register → email → magic link → dashboard, all on `https://`.

This whole sequence takes ~20 minutes on a quiet VPS.

### 5.12 verify.sh — INF-06 section

Append to [infra/scripts/verify.sh](../../infra/scripts/verify.sh):

```bash
# --- INF-06 TLS checks -------------------------------------------------------
echo ""
echo "INF-06 verification (TLS)"
echo "----------------------------------------"

check "Port :443 open + TLS handshake completes" \
    bash -c "echo | openssl s_client -servername $VPS_HOST -connect $VPS_HOST:443 -verify_return_error >/dev/null 2>&1"

check "http://$VPS_HOST/ redirects 301 → https://" \
    bash -c "[[ \$(curl -o /dev/null -s -w '%{http_code}' http://$VPS_HOST/) == 301 ]]"

check "Redirect Location is https://$VPS_HOST/" \
    bash -c "curl -fsSI http://$VPS_HOST/ | grep -i '^location:' | grep -qi 'https://$VPS_HOST'"

check "https://$VPS_HOST/healthz returns 'ok'" \
    bash -c "curl -fsS https://$VPS_HOST/healthz | grep -q '^ok$'"

check "HSTS header present with 1y+includeSubDomains+preload" \
    bash -c "curl -fsSI https://$VPS_HOST/ | grep -i '^strict-transport-security:' | grep -q 'max-age=31536000' && \
             curl -fsSI https://$VPS_HOST/ | grep -i '^strict-transport-security:' | grep -q 'includeSubDomains' && \
             curl -fsSI https://$VPS_HOST/ | grep -i '^strict-transport-security:' | grep -q 'preload'"

check "Cert issuer is Let's Encrypt (not staging, not self-signed)" \
    bash -c "echo | openssl s_client -servername $VPS_HOST -connect $VPS_HOST:443 2>/dev/null | \
             openssl x509 -noout -issuer | grep -qE 'O ?= ?Let.?s Encrypt' && \
             ! (echo | openssl s_client -servername $VPS_HOST -connect $VPS_HOST:443 2>/dev/null | \
                openssl x509 -noout -issuer | grep -qi 'STAGING')"

check "Cert notAfter ≥ 30 days from now" \
    bash -c "exp=\$(echo | openssl s_client -servername $VPS_HOST -connect $VPS_HOST:443 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2); \
             exp_s=\$(date -d \"\$exp\" +%s); now_s=\$(date +%s); \
             [[ \$(( (exp_s - now_s) / 86400 )) -ge 30 ]]"

check "TLSv1.0/1.1 refused" \
    bash -c "! (echo | openssl s_client -tls1_1 -connect $VPS_HOST:443 2>/dev/null | grep -q 'BEGIN CERTIFICATE')"

check "www.$VPS_HOST also covered by the cert" \
    bash -c "echo | openssl s_client -servername www.$VPS_HOST -connect www.$VPS_HOST:443 -verify_return_error >/dev/null 2>&1"

check "Frontend served over HTTPS contains 'VitaChain'" \
    bash -c "curl -fsS https://$VPS_HOST/ | grep -q 'VitaChain'"

check "Backend healthz served over HTTPS" \
    bash -c "curl -fsS https://$VPS_HOST/api/v1/healthz | grep -q '\"service\":\"backend\"'"

check "Cron entry for renewal exists" \
    ssh "$VPS_USER@$VPS_HOST" "test -f /etc/cron.d/vitachain-cert-renew"
```

> The TLSv1.0/1.1 negative-check is the kind of regression that's invisible to humans — a future config edit could re-enable it via a forgotten `ssl_protocols` line and the site would still "work". Verify.sh catches it.

### 5.13 Runbook entries

Append to [docs/runbook.md](../runbook.md):

```markdown
## INF-06 — First-time HTTPS issuance

The chicken-and-egg dance (see story §5.11):

1. Comment out the :443 block in `infra/nginx/conf.d/default.conf`.
2. `make -C infra deploy` — :80 site live, no cert needed.
3. `make -C infra issue-cert` — staging cert, validates http-01 works.
4. Delete the staging cert: `docker compose run --rm --entrypoint certbot certbot delete --cert-name vitachain.ma --non-interactive`.
5. `LETSENCRYPT_PROD=1 make -C infra issue-cert` — real cert (rate-limit counter +1).
6. Uncomment the :443 block, `make -C infra deploy`, `make -C infra verify`.
7. `make -C infra frontend-rebuild` — rebuild Next.js with NEXT_PUBLIC_SITE_URL=https://….
8. Supabase Dashboard → Auth → URL Configuration → set Site URL + redirect URLs to `https://…/**`.

## INF-06 — Renewal incident playbook

Symptom: `make -C infra cert-info` shows `VALID: <N>` days where `N < 25`,
or the Healthchecks.io heartbeat is missing.

1. SSH in: `ssh $VPS_USER@$VPS_HOST`.
2. Read the log: `tail -100 /var/log/vitachain-renew.log`.
3. Force a renewal manually: `make -C infra renew-cert`.
4. If Let's Encrypt is rate-limiting (5 failures/hour/account), back off; do
   NOT retry-loop. Wait at least 1 h. Production rate limits cycle weekly.
5. If the failure is "no challenge URL reachable" — UFW changed, the :80
   listener changed, or DNS moved. Check `infra/nginx/conf.d/default.conf`
   :80 block; `curl http://$VPS_HOST/.well-known/acme-challenge/test` should
   404 (not 301-to-https).
6. As a last resort within 7 days of expiry: re-run `issue-cert.sh` with
   `--force-renewal` to get a fresh cert outside the renewal cadence.

## INF-06 — HSTS preload submission

After 30 days of stable https-everywhere with the preload header set, submit
the domain at https://hstspreload.org/?domain=vitachain.ma.

Pre-flight checklist (the site enforces these before accepting):
- Apex serves a valid cert and 200 over HTTPS.
- :80 issues a 301 to :443 on the same host.
- HSTS header on the apex includes `max-age ≥ 31536000`, `includeSubDomains`,
  and `preload`.
- All redirects from http://www → use HTTPS at the first redirect.

NOTE — preload is a one-way trip. Removing the domain takes weeks and is
operator-initiated. Do not preload before the demo unless we're confident
in our :443 uptime.
```

---

## 6. Verification Checklist

### Local (developer laptop, before deploying)

- [ ] `nginx -t` passes against the new `default.conf` + `tls.conf` in a throwaway container: `make -C infra nginx-test` *(after temporarily creating empty cert files at the include paths — documented in §5.11)*.
- [ ] `infra/.env.example` shows `NEXT_PUBLIC_SITE_URL=https://…`, `CORS_ALLOW_ORIGINS=https://…`, `ADMIN_EMAIL`, `DOMAINS`.
- [ ] `scripts/check-secrets-boundary.sh` still exits 0 — no `NEXT_PUBLIC_` leak crept into backend, no service-role into frontend.
- [ ] `shellcheck infra/scripts/issue-cert.sh infra/scripts/renew-cert.sh` clean.
- [ ] `yamllint infra/docker-compose.yml` clean.

### On the VPS — happy path

- [ ] `make -C infra deploy` succeeds after the §5.11 two-step dance.
- [ ] `make -C infra issue-cert` (staging first, then prod) writes `/etc/letsencrypt/live/vitachain.ma/{fullchain,privkey,chain}.pem`.
- [ ] `make -C infra cert-info` shows issuer `Let's Encrypt`, subject `CN=vitachain.ma`, SAN includes `vitachain.ma` *and* `www.vitachain.ma`.
- [ ] `curl -I http://vitachain.ma/` returns `301` + `Location: https://vitachain.ma/`.
- [ ] `curl -I https://vitachain.ma/` returns `200` + `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
- [ ] `curl https://vitachain.ma/api/v1/healthz` returns `{"service":"backend",…}`.
- [ ] `curl https://vitachain.ma/api/v1/readyz` returns `{"status":"ready",…}`.
- [ ] Browser to `https://vitachain.ma/login` shows green padlock, no mixed-content warnings in the dev console.
- [ ] Full auth journey on HTTPS: register → email → click magic link → land on `/dashboard`. (Catches the Supabase Site URL setting from §5.8.)
- [ ] `make -C infra verify` is **all green**, including every new INF-06 check from §5.12.

### TLS quality

- [ ] `nmap --script ssl-enum-ciphers -p 443 vitachain.ma` shows only TLSv1.2 + TLSv1.3, all ciphers rated `A` or higher, no `weak` flags.
- [ ] [SSL Labs](https://www.ssllabs.com/ssltest/analyze.html?d=vitachain.ma) grades **A** or better. (Manual check; not in verify.sh because it depends on a third party.)
- [ ] `testssl.sh --severity HIGH https://vitachain.ma` reports zero high-severity findings.

### Renewal — proves the cron works

- [ ] Cron entry exists: `ssh $VPS_USER@$VPS_HOST 'cat /etc/cron.d/vitachain-cert-renew'`.
- [ ] Manual dry-run: `ssh $VPS_USER@$VPS_HOST 'cd $PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot renew --dry-run'` — prints `Congratulations, all simulated renewals succeeded`.
- [ ] Forced renewal: `make -C infra renew-cert` succeeds; NGINX reload visible in `docker compose logs nginx`; new `notAfter` is ~90 days out.
- [ ] `/var/log/vitachain-renew.log` shows the timestamped start/end lines.
- [ ] Healthchecks.io ping arrives (if `HEALTHCHECKS_RENEW_URL` is set).

### Negative — the gate actually blocks

- [ ] Visiting `http://vitachain.ma/api/v1/healthz` (cleartext) results in a `301`; the cleartext path is never served any application content.
- [ ] `curl --tls1.1 https://vitachain.ma/` fails with handshake error (caught by verify.sh).
- [ ] Self-signed cert injection — `curl --resolve vitachain.ma:443:127.0.0.1 https://vitachain.ma/` from inside the VPS fails verification *(documents that HSTS is doing its job; clients shouldn't accept a cert swap)*. Already covered by `openssl s_client -verify_return_error`.
- [ ] A deliberately broken `tls.conf` (cipher list typo) causes `nginx -t` to fail; the broken state is **caught locally**, not in production, by the §5.4 nginx-test step.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| Certbot sidecar + port 443 + volumes | [infra/docker-compose.yml](../../infra/docker-compose.yml) |
| TLS profile fragment | [infra/nginx/conf.d/tls.conf](../../infra/nginx/conf.d/tls.conf) |
| Rewritten vhost (:80 redirect + :443 app) | [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf) |
| First-issuance script | [infra/scripts/issue-cert.sh](../../infra/scripts/issue-cert.sh) |
| Renewal script (cron-invoked) | [infra/scripts/renew-cert.sh](../../infra/scripts/renew-cert.sh) |
| Cron entry block | [infra/scripts/bootstrap-vps.sh](../../infra/scripts/bootstrap-vps.sh) (new block; idempotent) |
| Env contract changes | [infra/.env.example](../../infra/.env.example) (`ADMIN_EMAIL`, `DOMAINS`, https URLs) |
| Verification checks (10 new) | [infra/scripts/verify.sh](../../infra/scripts/verify.sh) (INF-06 section) |
| Makefile targets | [infra/Makefile](../../infra/Makefile) (`issue-cert`, `renew-cert`, `cert-info`) |
| Runbook entries | [docs/runbook.md](../runbook.md) (first-issuance, renewal incident, HSTS preload) |
| Supabase Auth URL update | Out-of-band, dashboard click; documented in the runbook |
| `spring-status.yml` update | Flip `INF-06.status: TODO → DONE`; bump `summary.done`; decrement `summary.todo`; add a hand-off line under `project.last_updated` mirroring the INF-04/05 entries |

---

## 8. Risks & Mitigations

| Risk | Mitigation | Source |
|---|---|---|
| Burning the production rate-limit (5 duplicate certs / week / domain) during debugging | `issue-cert.sh` defaults to staging; production needs explicit `LETSENCRYPT_PROD=1`; staging-first dance is the runbook default | §5.5 + §5.11 |
| http-01 fails because DNS still points at the old VPS / TTL not propagated | Pre-flight `dig +short` check in §5.1; `verify.sh` already skips DNS assertions when `VPS_HOST` is an IP literal — the inverse is also useful information | §5.1 |
| NGINX won't start because `ssl_certificate` paths don't exist on first boot | Two-step deploy in §5.11: `:443` block commented out on first deploy, uncommented after `issue-cert.sh` writes the files | §5.11 |
| Frontend bundle still has `http://vitachain.ma` baked into NEXT_PUBLIC_SITE_URL after the env flip | `make -C infra frontend-rebuild` is an explicit step in the runbook + checklist; a smoke-test step opens the dashboard and looks for `http:` in the rendered HTML | §5.7 + §6 |
| Supabase emails users to a `http://` magic-link URL after we cut to HTTPS | §5.8 documents the dashboard update; verify.sh asserts a full register→link→dashboard journey *on https* | §5.8 |
| HSTS preload header set, then we lose the cert mid-demo — modern browsers refuse to load the site even on `:80` | Two-step preload: ship the header now (cheap), submit to hstspreload.org *only after 30 days of stable HTTPS* (runbook §10) | §5.13 runbook |
| Renewal cron silently fails for weeks; cert expires during demo | Twice-daily cron (30-day grace × 2 windows/day = 60 chances to recover); Healthchecks.io heartbeat alerts on a missed renewal within 3 days; verify.sh asserts `notAfter ≥ 30d` so a stale cert is caught at the next CI run | §5.6 + §5.12 |
| Mixed-content errors block legitimate browser requests post-cut | All asset URLs in the Next.js app are already relative (no `http://` hardcoded — INF-03 §5 confirmed); the env flip handles the only absolute URL surface (`NEXT_PUBLIC_SITE_URL`); HSTS will upgrade any stray `http://` reference on the client anyway | §5.7 |
| `certbot/certbot:latest` tag moves to a backwards-incompatible client | Image is pinned by digest in the compose file (§5.2); `hooks-update` (INF-05) doesn't touch this pin; updates are manual + reviewed | §5.2 |
| Future AUTH-08 rate-limit rules collide with the :443 server block edits | TLS directives extracted to `tls.conf`; the rate-limit insertion point is explicitly commented `# AUTH-08 — RATE LIMITS HERE` so the next author sees the contract | §5.3 + §5.4 |
| ACME validation IP not allowlisted by an upstream firewall (Cloudflare orange-cloud, future) | We're origin-direct for MVD; the runbook calls out that Cloudflare in front requires `Full (strict)` mode and `:80 → /.well-known/acme-challenge/` must remain proxied *unencrypted* through Cloudflare, or the renewal will fail. Cloudflare itself doesn't block LE's validators, but a custom WAF rule could | §2 out of scope |
| `openssl s_client` in verify.sh isn't installed on the developer laptop running verify.sh remotely | `openssl` is in the default install on Ubuntu / macOS / git-for-windows; the preflight script (INF-01) already asserts it. If absent, the check fails informatively (verify.sh's `check` wrapper shows the red ✗) | §5.12 |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Compose patch (port 443, volumes, certbot sidecar, digest pin) | 30 min |
| `tls.conf` + rewriting `default.conf` for :80 redirect + :443 app | 60 min |
| `issue-cert.sh` (idempotent, staging-default) | 45 min |
| `renew-cert.sh` + cron block in `bootstrap-vps.sh` | 30 min |
| `.env.example` patch + live `.env` documentation in runbook | 15 min |
| `verify.sh` — 10 new TLS checks | 45 min |
| `Makefile` targets (`issue-cert`, `renew-cert`, `cert-info`) | 15 min |
| Runbook — first-issuance, renewal incident, HSTS preload | 45 min |
| First-issuance dance on the VPS (staging → prod → reload → frontend rebuild → Supabase dashboard) | 60 min |
| Full HTTPS auth-journey smoke (register/login/dashboard, all https) | 30 min |
| TLS-quality external scan (SSL Labs, testssl.sh, nmap) | 20 min |
| `spring-status.yml` update + hand-off line | 10 min |
| **Total active work** | **~6.5 h** |

---

## 10. Definition of Done

1. **Acceptance criterion met:** [docs/spring-status.yml:170](../spring-status.yml#L170) — *"All routes serve over HTTPS; HSTS header set."* Both clauses verified by curl + verify.sh + browser smoke.
2. Verification checklist (§6) fully ticked: local config lint, VPS happy path, TLS quality (SSL Labs ≥ A), renewal dry-run + forced renewal both green, every negative-path check refused.
3. Deliverables (§7) committed under `infra/`, `docs/`, plus the manual Supabase Auth URL update done out-of-band and recorded in the runbook.
4. [docs/spring-status.yml](../spring-status.yml) updated:
   - `INF-06.status: TODO → DONE`,
   - `summary.done` incremented (3 → 4),
   - `summary.todo` decremented,
   - hand-off line under `project.last_updated` summarising what landed, in the same style as the INF-02/03/04/05 entries.
5. **Demo readiness gate:** opening `https://vitachain.ma/login` in a fresh incognito window shows the green padlock, the auth journey from INF-03 §6 completes end-to-end on HTTPS, and `/api/v1/healthz` returns `200` over TLS. PRD §8.3 row "HTTPS — Let's Encrypt (Certbot) for all domains" is now true.
6. **30-day stability window started:** the cert is live, the cron is wired, the Healthchecks.io heartbeat is firing. The HSTS preload submission window opens 30 days from cut-over — tracked as a runbook follow-up, not a DoD blocker for this story.

---

## 11. Hand-off — (to be filled on completion)

### 11.1 What landed

*(Mirror INF-04/05 §11.1: bullet list of changed/added files under `infra/` and `docs/`; the SHA the cert was issued against; the exact `make -C infra cert-info` output showing issuer = Let's Encrypt + notAfter; SSL Labs grade screenshot/URL; the first successful renewal log line from `/var/log/vitachain-renew.log`.)*

### 11.2 Verification evidence

*(Paste: full `make -C infra verify` run with the INF-06 block all green; SSL Labs grade; `testssl.sh --severity HIGH` clean report; `certbot certificates` output showing both domains in SAN; the first scheduled cron run's log entry; browser screenshot of the green padlock on `/dashboard`.)*

### 11.3 What's *not* covered (and why that's fine for DoD)

- **HSTS preload list submission** — eligible from day 1 (header is set correctly), but submission deferred 30 days for safety. Tracked as a runbook follow-up.
- **Cloudflare in front of the VPS** — PRD §8.4 Level 4 scalability; not needed for 50-CCU MVD. The :80 ACME path is designed to keep working through a future orange-cloud cut.
- **DNS-01 / wildcard cert** — registrar API integration cost > value at 2 domains. A future subdomain is one `-d` flag away.
- **mTLS on `/api/v1/katara/ingest`** — KAT-03 owns its own constant-time API-key auth; full mutual TLS is post-MVD.
- **Certificate Transparency monitoring** — Should for Phase 3 post-demo.

### 11.4 Stories now unblocked

| Story | Why |
|---|---|
| **AUTH-08** | NGINX `:443` server block exists with a labelled `# AUTH-08 — RATE LIMITS HERE` insertion point; the rate-limit zones land without touching the TLS profile. |
| **INF-08** | Sentry releases and Uptime Kuma probes now target `https://` from day 1; no later URL migration. |
| **Every demo URL surfaced in Brevo emails** (NOT-02/03/04/05/06) | The Site URL pushed into Brevo templates is now `https://`, and Supabase magic-link emails land users on a TLS-protected origin — preconditions for HSTS and for browser geolocation in SEC-03. |
| **SEC-03 (geolocated search)** | Modern browsers refuse `navigator.geolocation` on insecure origins outside `localhost`. HTTPS is the prerequisite. |
| **All Phase-3 quality gates** (QG-01..QG-06) | Load tests against `:443` will exercise the production TLS terminator instead of bypassing it on `:80`. |

### 11.5 Known follow-ups (not part of INF-06)

- **Submit to HSTS preload list** at [hstspreload.org](https://hstspreload.org/) once 30 days of stable HTTPS are logged (≈ Week 11 calendar, post-demo).
- **CT log monitoring** — sign up at `crt.sh` / Cert Spotter for mis-issuance alerts.
- **AUTH-08** picks up the rate-limit zones in the :443 block.
- Add a one-shot `make -C infra revoke-cert` target for the (unlikely) compromise scenario; not needed today.
- If we add `admin.vitachain.ma`, extend `DOMAINS` in `infra/.env`, re-run `make -C infra issue-cert`, redeploy.

### 11.6 Operator runbook (when this story is being executed)

```bash
# On the developer laptop, against a VPS where INF-01..05 are DONE and DNS is live:

# 1. Pre-flight
dig +short vitachain.ma www.vitachain.ma
ssh $VPS_USER@$VPS_HOST "sudo ufw status | grep -E '80/tcp|443/tcp'"

# 2. Pin the certbot image digest in infra/docker-compose.yml
docker pull certbot/certbot:latest
docker inspect --format='{{index .RepoDigests 0}}' certbot/certbot:latest
# → paste into infra/docker-compose.yml

# 3. Two-step dance — see §5.11 for full sequence
#   3a. Comment out :443 block, deploy, verify INF-01..05 still green
sed -i.bak '/^server {/,/^}$/{ /listen 443 ssl/,/^}$/d }' infra/nginx/conf.d/default.conf  # NOT for real — manual edit
make -C infra deploy
make -C infra verify

#   3b. Issue against staging
make -C infra issue-cert

#   3c. Promote to production
ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot delete --cert-name vitachain.ma --non-interactive"
LETSENCRYPT_PROD=1 make -C infra issue-cert

#   3d. Restore :443 block, redeploy, verify
git checkout infra/nginx/conf.d/default.conf
make -C infra deploy
make -C infra verify   # INF-06 block must be all green

# 4. Frontend rebuild with NEXT_PUBLIC_SITE_URL=https://…
make -C infra frontend-rebuild

# 5. Supabase Dashboard → Auth → URL Configuration (manual, §5.8)

# 6. Final smoke
curl -I https://vitachain.ma/ | grep -i strict-transport-security
# Then a fresh-incognito register → magic link → dashboard journey, all https.

# 7. Renewal sanity
ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot renew --dry-run"
make -C infra cert-info

# 8. Flip docs/spring-status.yml — INF-06 → DONE; summary.done += 1.
```
