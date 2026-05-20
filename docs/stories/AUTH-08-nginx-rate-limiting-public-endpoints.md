# AUTH-08 — NGINX rate limiting on public endpoints (the brute-force ceiling that lives in front of FastAPI)

> **Epic:** E1 — Authentication, Authorization & Roles (Cross-cutting)
> **Phase:** P3 — Architect (Week 6 — Security, Tests & Optimization) *(per [docs/spring-status.yml:750](../spring-status.yml#L750))*
> **Priority:** Must *(PRD §8.3 row "Rate limiting — NGINX `limit_req_zone` on public endpoints" — the only network-edge defence the MVD ships against brute-force, scraping, and accidental DoS-by-loop. Every other layer (RLS, JWT, API-key constant-time compare) assumes the attacker has already passed the edge in measured doses. Without AUTH-08 the attacker measures nothing — a 1h JWT can be brute-forced at 50k req/s against `/auth/v1/token`, the Brevo lead funnel can be flooded into Brevo's daily quota in 90 seconds (and our Brevo bill with it), the SEC-04 reservation endpoint can be raced by a single laptop into denying every legitimate citizen, and the KAT-03 ingest endpoint — protected only by an API-key hash compare — has no ceiling on a leaked key.)*
> **Status:** TODO
> **Depends on:** [INF-01](INF-01-provision-vps-docker-nginx.md) (`IN_PROGRESS` — provides the live NGINX container, the `vita_nginx` healthcheck, the bootstrap-vps.sh UFW posture that pins `:80` + `:443` open; AUTH-08 edits the same `infra/nginx/conf.d/*.conf` tree and re-uses the `make -C infra nginx-test` throwaway-container lint), [INF-06](INF-06-https-letsencrypt-certbot.md) (`TODO` (artifacts local) — INF-06 already labelled the `# AUTH-08 — RATE LIMITS HERE` insertion point inside the `:443 server { }` block at [infra/nginx/conf.d/default.conf:80](../../infra/nginx/conf.d/default.conf#L80) and explicitly pre-allocated the `limit_req_log_level` + `client_max_body_size` decisions to this story; AUTH-08 cannot ship before TLS because rate-limiting cleartext `:80` is meaningless — the `:80` server block is now just an ACME challenge + 301 redirect, all real traffic terminates on `:443`), [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) (`IN_PROGRESS` — provides the FastAPI routes that AUTH-08 protects per-path; the X-Request-Id correlation header AUTH-08 reads back in 429 responses; the `/api/v1/healthz` + `/readyz` whitelisting pattern), [INF-08](INF-08-sentry-uptime-kuma-observability.md) (`IN_PROGRESS` — Uptime Kuma's monitor probes hit `/healthz` + `/api/v1/healthz` every 60 s from the *same VPS public IP*, which is the textbook way to discover that AUTH-08 silently rate-limits your own monitoring; the whitelist pattern in §5.7 plugs Kuma in before the first 429 ever fires), [AUTH-03](AUTH-03-jwt-config-256bit-1h-7d.md) (`IN_REVIEW` — sets the 1h access-token + 7d refresh-token lifetimes that calibrate the auth-bucket rates per [docs/spring-status.yml:444–445](../spring-status.yml#L444); a tighter token TTL would push the rate ceiling higher — the calibration math is in §4.2), [AUTH-06](AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) (`IN_REVIEW` — the KYC document-upload endpoint is one of the most expensive write paths on the backend; AUTH-08 caps it in the `auth_upload` bucket per §4.4)
> **Unblocks:** [AUTH-07](AUTH-07-rls-audit-business-rule-test-suite.md) — Demo Day pre-flight (PRD §12 Phase 4) — the steering-committee sign-off depends on a green AUTH-07 + AUTH-08 pair; AUTH-07 is the *correctness* leg (no cross-role leaks), AUTH-08 is the *capacity & abuse* leg (no flood crashes the 50-concurrent-user budget; cf. [docs/spring-status.yml:97–98](../spring-status.yml#L97)); [KAT-03](#) — the ingest endpoint's 50 ms SLA only holds if a runaway fleet of ESP32s (or one leaked API key replayed at line rate from a hostile network) cannot saturate the upstream; AUTH-08 owns the device-key-keyed bucket that protects KAT-03's tail latency; [FAR-03](#) + [FAR-04](#) + [BOT-03](#) + [BOT-04](#) — the Brevo email funnels (FarMarket contact, BotaBa9a lead, SecondServe pickup code) are the most direct path from "anonymous public endpoint" to "real EUR cost on our Brevo bill"; AUTH-08 caps each per-IP at a rate that makes a flood economically uninteresting; [SEC-04](#) — the SecondServe reservation endpoint with BR-S2's atomic decrement is the textbook race target; AUTH-08's tight bucket on `/api/v1/secondserve/reservations` collapses the race window from "1000 req/s" to "10 req/s/IP" so the database-level atomicity actually has time to take effect under contention; all demo-day URLs (every public endpoint surfaced to farmers / restaurateurs / citizens — rate-limited from minute one, no surprises on stage).
> **Acceptance (per [docs/spring-status.yml:748](../spring-status.yml#L748)):** *"`limit_req_zone` enforced; brute-force blocked."* Extended DoD: (a) `infra/nginx/conf.d/00-rate-limits.conf` — new file declaring the `limit_req_zone`, `limit_conn_zone`, and `geo` whitelist blocks at `http {}` scope (loaded before `default.conf` thanks to the `00-` lexicographic prefix); (b) `infra/nginx/conf.d/default.conf` — `limit_req` + `limit_conn` directives applied inside the matching `location` blocks at the AUTH-08 insertion point (line 80), the existing TLS profile untouched, the `proxy_pass` chains untouched; (c) `infra/nginx/conf.d/429.conf` — branded `429 Too Many Requests` error page mounted on `/usr/share/nginx/html/429.html` via the `error_page 429` directive; (d) `infra/nginx/snippets/limit-headers.conf` — shared `add_header Retry-After` + `add_header X-RateLimit-*` fragment, `\$included` from each `location` that opts in; (e) `infra/scripts/bench-rate-limits.sh` — repeatable load-generation script using `hey` (Docker image, no host install) that fires the 8 calibration scenarios documented in §6 and prints a pass/fail line per scenario; (f) `infra/scripts/verify.sh` — new "AUTH-08 verification (rate limiting)" block: 14 checks (zone declared, location-level `limit_req` present on 7 protected paths, whitelist resolves the VPS public IP, a `/healthz` flood stays `200`, a `/api/v1/secondserve/reservations` flood from one IP returns 429 within the documented threshold, the 429 response carries `Retry-After`, the 429 body is the branded HTML, `nginx -t` clean, etc); (g) `.github/workflows/ci.yml` — the existing `infra` job already runs `nginx -t` in a throwaway container via `make -C infra nginx-test`, so the new file is lint-gated for free; **no** runtime CI step (rate limiting is a deployed-VPS concern — CI cannot reproduce shared-memory zone behaviour faithfully); (h) `docs/runbook.md` — new "AUTH-08 — Rate limits & abuse playbook" section: the bucket table (§4.2), the whitelist table (§4.5), the on-call triage flow ("a legitimate user is being 429'd" / "a flood is in progress and the bucket is too loose" / "Brevo says we tripped their quota"), the post-incident bucket-tightening walkthrough, the regression test cookbook; (i) `docs/spring-status.yml` — flip `AUTH-08.status: TODO → IN_REVIEW` after local DoD; `DONE` after the staging drill (§6 step 7) lands a green `verify.sh` block from the real VPS and the on-call playbook is exercised by at least one rehearsal; (j) the staging drill itself is recorded in the runbook drill log with a screenshot of the green load-generator output and the 429 response captured from the live origin.

---

## 1. Purpose

By the time AUTH-08 starts (week 6), the VitaChain edge looks like this on a single TLS-terminating NGINX:

| Public origin | Backed by | Threat surface AUTH-08 has to cover |
|---|---|---|
| `https://vitachain.ma/` (Next.js, all roles) | `vita_frontend:3000` | Login + register form pages (anon hit), scraping of the meals catalog (SEC-02 map view) and the ads catalog (FAR-02 list view), the BotaBa9a marketing landing (BOT-01 / BOT-02). |
| `https://vitachain.ma/api/v1/auth/*` | `vita_backend:8000` (FastAPI re-export of Supabase Auth + custom KYC) | Brute-force on password grants (AUTH-01 / AUTH-03), credential stuffing, registration spam, KYC document upload abuse (AUTH-06). |
| `https://vitachain.ma/api/v1/katara/ingest` | `vita_backend:8000` (KAT-03) | The 50 ms SLA path. Authenticated by an X-Device-Api-Key constant-time hash compare — but a leaked key replayed at line rate from a hostile network has no ceiling without AUTH-08. The fleet baseline is 1 ESP32 hitting the route once every 15 minutes; the abuse baseline is the same key replayed 50k/s. |
| `https://vitachain.ma/api/v1/farmarket/*` | `vita_backend:8000` (FAR-01 → FAR-06) | Ad creation (verified-FARMER write path), ad listing (anon read path), contact-the-seller (FAR-03 → FAR-04 — fires a Brevo email *per submission* with our paid quota). |
| `https://vitachain.ma/api/v1/secondserve/*` | `vita_backend:8000` (SEC-01 → SEC-08) | Meal publishing (verified-RESTAURANT write), meals catalog (anon + CITIZEN read), reservations (CITIZEN write — the BR-S2 race target), pickup-code validation (RESTAURANT write — a bad actor with a stolen `VITA-XXX` code list could brute-force the validation endpoint into draining stock). |
| `https://vitachain.ma/api/v1/botabaqa/*` | `vita_backend:8000` (BOT-03 → BOT-07) | Lead form submission (anon write — the BR-B2 Supabase Database Webhook fires a Brevo email *per submission* to admin). |
| `https://vitachain.ma/uptime/` | `uptime_kuma:3001` (INF-08) | Basic-auth-gated dashboard — but the auth header is a `htpasswd` MD5, brute-forceable at scale. |
| `https://vitachain.ma/healthz` | NGINX-local 200 | The Uptime Kuma monitor pings this every 60 s *from the same VPS public IP* the live traffic exits from. AUTH-08 must whitelist this path or whitelist this IP or both. |

For an MVD whose budget assumption is "50 concurrent users with < 200 ms median response" (PRD §8.1 + §8.4), the failure modes that exist *without* AUTH-08 are categorical, not gradual:

| Failure mode | Without AUTH-08 | With AUTH-08 |
|---|---|---|
| **`/auth/v1/token` brute-force** — attacker has a verified email from the FarMarket public catalog (the seller's profile shows their name + region; phishing yields the email) and tries 10⁶ passwords against the password grant endpoint. PRD §8.3 row "JWT strength — 256-bit secret, short-lived tokens (1h access / 7d refresh)" assumes the attacker cannot get more than `O(rate × duration)` guesses inside one refresh window. | A laptop on residential fibre does ~50k password attempts/sec against the proxied endpoint. A 14-char alphanumeric password (the registration form's minimum, AUTH-01) is broken in 4 days; an 8-char lowercase password (the default password-strength fallback) is broken in 47 seconds. The 1h access-token TTL is irrelevant — the attacker re-grants after each rotation. | The `auth_grant` bucket caps `/api/v1/auth/token` at 5 req/min/IP with `burst=10 nodelay`. The same brute-force takes 38 years against an 8-char password. The attacker either gives up or rents a botnet — both outcomes are off-target for an MVD threat model. |
| **Brevo email-funnel flood** — anon attacker scripts 1000 POSTs to `/api/v1/botabaqa/leads` with random Moroccan-format phone numbers (BR-B1 passes), each one triggers the Database Webhook → Brevo notification per BR-B2. Brevo Free tier is 300 emails/day. | Brevo quota burns through in 90 seconds. Every legitimate BotaBa9a lead the same day silently fails to notify admin. The admin discovers 4000 leads in the database on day 2, no idea which 6 were real, has to manually triage. The Brevo bill — if we were on a paid tier — would be measurable. | The `public_write` bucket caps `/api/v1/botabaqa/leads` at 6 req/min/IP with `burst=12`. A single attacker IP can submit at most ~250 leads/day; well below the quota. A botnet is needed to flood — and the per-IP cap means each bot contributes only 250 leads, raising the cost-to-attack ratio by 3 orders of magnitude. |
| **SEC-04 reservation race amplification** — attacker scripts 10k concurrent reservations against the same meal (`quantity_remaining = 1`) from one IP. BR-S2 is atomic at the database — exactly one wins — but each of the 9,999 losers still costs one FastAPI handler invocation + one database round-trip + one 409 response. | At 10k concurrent connections, the FastAPI worker pool (gunicorn 4 workers × 4 threads = 16 concurrent) saturates. Every other legitimate citizen — reserving a *different* meal — is queued behind the 9,984 already-doomed-409 requests. The 200 ms median collapses to 8 s. Demo scenario B ("Citizen reserves → receives pickup code") demonstrably hangs on stage. | The `mutate_strict` bucket caps `/api/v1/secondserve/reservations` at 10 req/min/IP, `burst=5 nodelay`. The 10k concurrent attempt drains the bucket in 1.5 s and the remaining 9,990 receive immediate `429` *at the edge* — never reaches FastAPI, never touches the database, never queues behind legitimate citizens. The 16-worker pool stays free for real traffic. |
| **KAT-03 ingest amplification on a leaked device key** — an ESP32 is physically stolen / a `.env` file is committed by a careless contributor / a developer pastes the key in a Discord support channel. The key is now scriptable. Per KAT-03's design the key is a constant-time hash compare — it cannot be guessed, but a *known* key is unlimited. | A single workstation replays the ingest payload at 50k req/s. Each ingest writes 1 row to `katara.telemetry`. The 500 MB Supabase Free Tier (PRD §11.1) is full in 11 minutes of attack. The legitimate fleet's data is lost in the noise; the parcel dashboard shows 200k spurious readings; AI diagnostics (KAT-07 → KAT-09) consume Gemini quota analyzing garbage. | The `iot_ingest` bucket is **keyed on `\$http_x_device_api_key`, not `\$binary_remote_addr`** — see §4.6. The bucket is 4 req/min/key with `burst=20 nodelay`, which accommodates the legitimate "ESP32 reboots, replays buffered readings" pattern (cf. R7 in PRD §13 risk register) but caps a malicious replay at 4 writes/min/key. The leaked key is now a 4-row/min nuisance, recoverable by rotation. |
| **Slowloris / unclosed-connection pool exhaustion** — attacker opens 5k concurrent TLS connections, each sends one header per minute, never completes a request. Without `limit_conn` NGINX accepts each one and ties up a worker connection slot. | NGINX's `worker_connections` default is 1024; the attacker exhausts it from one IP. Legitimate users see TCP RSTs. | `limit_conn perip 50;` at `http {}` scope. One IP gets at most 50 concurrent connections; the next is rejected at TCP accept time. Cost to attacker: 100× more IPs to mount the same attack. |
| **Healthchecks self-DoS** — the Uptime Kuma monitor (INF-08) pings `/healthz` from the VPS public IP every 60 s. The same IP also serves the Next.js SSR's outbound calls to Supabase (in case of server-action fallback). If AUTH-08's whitelist is wrong, the monitor's own bucket fills, the monitor reports `false alarm: 429`, the operator silences it, the operator no longer sees real outages. | The monitor flaps red/green. After two days the operator silences it. On day 5, the demo Brevo integration silently breaks; nobody is paged. | The `geo \$ratelimit_whitelist` block (§4.5) returns `1` for the VPS public IP + the Healthchecks.io egress range + Cloudflare's IPs (for the post-MVD path). When `\$ratelimit_whitelist = 1`, the per-IP bucket key is the empty string — `limit_req` short-circuits. The monitor is invisible to the rate limiter. |

AUTH-08 is therefore not just "a rate limit on the login endpoint". It is a **layered defence with seven buckets**, each calibrated to a distinct threat model, applied to specific `location` blocks via copy-pasteable include snippets, observable through the NGINX error log + Sentry breadcrumb, and white-listed against monitoring + the demo-day field-test laptops. The whole thing lives in two files (`00-rate-limits.conf` + the patched `default.conf`), is `nginx -t`-validatable in a 50-line throwaway container before any deploy, and is reversible in 90 seconds by commenting out a single `include` line.

> **What this story is not:** WAF / OWASP Core Rule Set (deferred — Cloudflare WAF when the orange-cloud step lands post-MVD per PRD §8.4 Level 4); fail2ban (defer — `limit_req` covers the 99% case at the edge; fail2ban operates on log-tailing which would race the rate limiter); CAPTCHA on the login form (deferred — friction is unacceptable on the farmer persona's smartphone in patchy rural connectivity, cf. PRD §11.2 "Farmers have smartphones with internet access"); IP geofencing to Morocco (deferred — the demo audience may include international jurors, cf. the steering committee in PRD §0 sign-off table); request-body content validation / signature verification on `/api/v1/katara/ingest` (out of scope — that is the BR-K constant-time hash compare KAT-03 ships; AUTH-08 only caps *how often* the compare runs); DDoS scrubbing (the budget can't afford an Anycast scrubber; the upstream provider's L3/L4 protection plus AUTH-08's L7 ceiling is the MVD-realistic posture); per-user rate limits (per-JWT — the natural extension once a request has been authenticated — is a FastAPI middleware concern owned by a post-MVD story; AUTH-08 is *edge*, before any JWT is parsed); per-route quota tracking with billing (not a thing); rate limits on Supabase-direct endpoints (`https://<project>.supabase.co/auth/v1/token` when the frontend calls Supabase Auth without going through our backend — Supabase's own platform-level rate limits cover the brute-force ceiling, AUTH-08 only protects what NGINX actually proxies).

---

## 2. Scope

### In scope

- **`infra/nginx/conf.d/00-rate-limits.conf`** — new file, loaded by NGINX before `default.conf` thanks to the `00-` lexicographic prefix. Contains exclusively `http {}`-scope directives:
  - **Seven `limit_req_zone` declarations** (`auth_grant`, `auth_register`, `auth_upload`, `public_write`, `public_read`, `mutate_strict`, `iot_ingest`) — see §4.2 for the calibration. Each zone is sized at 10 MB shared memory ≈ 160k unique keys, which is 3,000× over-provisioned for our 50-concurrent-user budget — but the cost is 10 MB of RAM and the headroom protects us against a low-grade ambient scanning baseline.
  - **Two `limit_conn_zone` declarations** (`perip` keyed on `\$binary_remote_addr`, `perserver` keyed on `\$server_name`) — see §4.3.
  - **One `geo \$ratelimit_whitelist` block** — see §4.5. Returns `1` for the VPS public IP, the documented Healthchecks.io egress range, and a small allowlist of demo-day field-test IPs (filled in at deploy time from `infra/.env`); `0` for everything else.
  - **One `map \$ratelimit_whitelist \$limit_key`** — translates the whitelist bit into the actual bucket key: empty string (= skip) when whitelisted, `\$binary_remote_addr` otherwise. Reused as the key for the `public_*` + `mutate_*` zones; the `auth_*` zones key on a stricter normalization (`\$binary_remote_addr` always, no whitelist exempt — the operator is a human and the bucket is generous enough to not block legitimate ops use).
  - **One `map \$http_x_device_api_key \$iot_key`** — declares the keying expression for the IoT ingest zone. The header value is hashed by NGINX internally (the `limit_req_zone` directive does its own hashing on the key), but we want a `0` (= zone skipped, regular IP key) fallback when the header is absent, so callers that hit `/ingest` *without* a device key fall back to the much-stricter IP-based ceiling.
  - **`limit_req_log_level warn;` + `limit_req_status 429;` + `limit_conn_log_level warn;` + `limit_conn_status 429;`** — make the log level visible at WARN (Sentry's NGINX log integration tails WARN+, see INF-08 §5.x), and pin the response status to `429 Too Many Requests` (NGINX's historical default is `503 Service Unavailable`, which would be misleading and would taint Uptime Kuma's outage detection).

- **`infra/nginx/conf.d/default.conf`** — minimally edited. The TLS profile, HSTS, defence-in-depth headers, and `proxy_pass` chains are not moved. Two classes of edit, inside the `:443 server { }` block, at the `# ----- AUTH-08 — RATE LIMITS HERE ----` insertion point currently at [line 80](../../infra/nginx/conf.d/default.conf#L80):
  - **Block-level**: `limit_conn perip 50;` + `limit_conn perserver 5000;` — global per-IP and per-server connection caps for the `:443` listener.
  - **Per-location**: 8 `location` blocks (existing `/api/v1/` is split into per-prefix sub-locations; the existing `location /` keeps its current frontend `proxy_pass` and gets a single loose `limit_req`). Each new sub-location is a `location = /exact` (auth grant), `location ^~ /prefix/` (auth, katara, farmarket, secondserve, botabaqa, admin), or `location /` (frontend catch-all). The bucket each location uses is declared in §4.4.
  - **No change** to `location = /healthz`, `location = /50x.html`, `location /uptime/`, the upstreams, the `proxy_*` timeouts, or the `client_max_body_size` decisions — those are owned by INF-04 / INF-06 / INF-08 and stay verbatim.

- **`infra/nginx/conf.d/429.conf`** — new fragment, `include`d from the `:443` server block. Mounts a branded `429 Too Many Requests` HTML page at `/usr/share/nginx/html/429.html` (the file is shipped in the `frontend/public/429.html` build artefact and bind-mounted into the nginx container — see §5.4) via:
  ```nginx
  error_page 429 = @ratelimited;
  location @ratelimited {
      internal;
      add_header Retry-After      $sent_http_retry_after  always;
      add_header X-RateLimit-Hit  "1"                     always;
      add_header Content-Type     "text/html; charset=utf-8" always;
      root /usr/share/nginx/html;
      try_files /429.html =429;   # =429 if the HTML is missing — never silently switch to 200
  }
  ```
  The page is locale-aware via a tiny inline `<script>` that reads `navigator.language` and swaps a `<p>` element's text between FR / AR / EN (P0 + P1 locales per PRD §7.2). The body includes a `<meta http-equiv="refresh" content="60">` so legitimate-but-aggressive clients self-throttle after one minute.

- **`infra/nginx/snippets/limit-headers.conf`** — new fragment, `include`d from each protected `location`. Adds the conventional rate-limit response headers on *every* response (not only 429s — so a legitimate client can see its remaining budget):
  ```nginx
  add_header X-RateLimit-Bucket   "$limit_req_zone_name" always;
  add_header X-RateLimit-Limit    "$limit_req_zone_rate" always;
  ```
  Note: NGINX OSS does *not* expose remaining-tokens via a built-in variable (only NGINX Plus does, via `\$limit_req_remaining`). We ship the bucket *name* and *rate* so clients can adapt; the remaining-tokens semantics would require an `ngx_http_js_module` patch which is well out of MVD scope.

- **`infra/scripts/bench-rate-limits.sh`** — new Bash script. Runs `hey` (Docker image `rcmorano/docker-hey:latest` pinned in §5.6, no host install) against the live VPS and asserts the eight calibration scenarios (§6). Each scenario prints a `PASS: <name>` or `FAIL: <name>: expected ≥N 429s, observed M` line; non-zero exit on any failure. Designed for the §5.10 staging drill and as the demo-day-eve pre-flight (paired with the AUTH-07 matrix from `scripts/verify-rls-matrix.sh`).

- **`infra/scripts/verify.sh`** — append a new "AUTH-08 verification (rate limiting)" block. 14 checks (§6); the block is *skipped* when `VPS_HOST` is an IP literal (same convention as the existing INF-06 DNS check), because most of the assertions resolve `vitachain.ma` to validate the TLS-vhost path.

- **`infra/Makefile`** — three new targets:
  - `bench-rate-limits` — `./scripts/bench-rate-limits.sh` against `$$VPS_HOST` (live staging or prod, depending on env).
  - `bench-rate-limits-dryrun` — same script with `DRYRUN=1`; prints the `hey` invocations without firing them. Useful for runbook review.
  - `rate-limit-tail` — `ssh $$VPS_USER@$$VPS_HOST 'sudo tail -F /var/log/nginx/error.log | grep "limiting requests"'` — the on-call's one-liner for watching a flood unfold in real time.

- **`docs/runbook.md`** — new "AUTH-08 — Rate limits & abuse playbook" section. Subsections: (1) the seven-bucket table with rate / burst / scope / why; (2) the whitelist table (Healthchecks.io egress range, VPS public IP, demo-day field laptops — IP + reason + expiry); (3) **on-call triage flow**: three branches — "a legitimate user reports being 429'd" (verify with the user's IP, check `error.log` for the exact `limiting requests by zone …` line, decide bucket-loosen-vs-whitelist), "a flood is in progress and the bucket is too loose" (`grep "limiting requests"` rate, compute observed rps, decide tighten-bucket-vs-temporary-IP-block via `iptables`), "Brevo says we tripped their quota" (open the Brevo dashboard, identify the offending Brevo email type, find the corresponding `location` block, tighten the bucket and `nginx -s reload`); (4) **post-incident bucket-tightening walkthrough**: the order of operations (edit `00-rate-limits.conf` → `make -C infra nginx-test` → commit → `make -C infra deploy` → watch `error.log` for 5 minutes → `make -C infra bench-rate-limits` regression check); (5) **regression test cookbook**: how to add a new bucket for a new public endpoint (4 steps, ~10 lines).

- **`docs/spring-status.yml`** — flip `AUTH-08.status: TODO → IN_REVIEW` after local DoD; `DONE` after the §5.10 staging drill is recorded in the runbook drill log. Update `summary.todo` / `summary.in_review` / `summary.done`. Append a hand-off line under `project.last_updated` (template in §11).

### Out of scope (later stories / explicit deferrals)

- **Per-user (per-JWT) rate limits inside FastAPI** — once a request is authenticated, finer-grained "this user has reserved 50 meals in the past hour, that smells like a scalper" enforcement happens at the application layer. AUTH-08 is *edge*: pre-auth, IP-keyed (or device-key-keyed for the ingest path). Per-user limits are a post-MVD enrichment owned by a future SEC-* story; the architectural seam is "FastAPI middleware reads `request.state.user`, looks up a per-user Redis bucket" — Redis isn't even on the MVD stack.
- **Cloudflare WAF / rate limiting** — PRD §8.4 Level 4. Cloudflare's own rate-limiting product is far richer (URL pattern matching, request fingerprinting, geographic challenges) but costs money once volumes grow. AUTH-08's NGINX layer remains valuable as defence-in-depth *even after* Cloudflare lands — the orange-cloud bypass path (direct-to-origin if someone discovers the origin IP) is exactly the case where NGINX's `limit_req` is the only line standing.
- **fail2ban / temporary IP banning** — `limit_req` already returns 429 immediately; fail2ban watches logs and adds `iptables` rules after-the-fact. The two layers are complementary, but fail2ban tuning is fiddly and produces false positives that lock out demo-day jurors. Defer until post-MVD when the operator has cycles to babysit it.
- **CAPTCHA** on the registration / contact / lead forms — friction is unacceptable on the farmer persona (rural smartphone, patchy connectivity, low tech-literacy per PRD §4.1). Defer until at least one real spam wave demonstrates that the per-IP rate limit alone is insufficient.
- **Body-size DoS protection** — NGINX's `client_max_body_size 5m;` (already in `default.conf` line 169) + `10m` per-location override for `/api/v1/` (line 138) bound the worst-case body. Lower limits per-endpoint (e.g. `1m` on the BotaBa9a lead form because the body is < 1 KB in practice) would tighten the DoS-by-large-body vector, but the *complexity per kilobyte saved* is not worth it for MVD.
- **TLS handshake rate limiting** — `ssl_session_cache` (INF-06 §4) and `limit_conn perip 50` together blunt the TLS-handshake-flood attack. A dedicated `limit_req` zone keyed on something handshake-stage would require ngx_stream module work; defer.
- **GeoIP-based blocking** — the demo audience may include international jurors; the post-MVD market expansion is North Africa-wide; geofencing to Morocco is hostile to both. Defer indefinitely.
- **Per-bucket dashboards in Uptime Kuma** — Kuma is a binary-state monitor (up / down), not a metrics tool. The rate-limit observability story is "tail the error log + grep `limiting requests`" + "Sentry breadcrumb fires on every 429". A proper time-series dashboard is INF-08+1 territory (Prometheus + Grafana), explicitly post-MVD per PRD §5.2 "Advanced analytics / BI dashboards".
- **AI-prompt rate limiting on Gemini calls** — KAT-07 already rate-limits at the application layer (PRD §11.1 row "Gemini Free Tier — 1,500 requests/day"). AUTH-08 does not duplicate; the user-facing endpoint that *triggers* the async Gemini job (`POST /api/v1/katara/diagnostics`) sits in the `mutate_strict` bucket already.
- **Wildcard / regex location matching** — `location ~ ^/api/v1/(secondserve|farmarket)/` is tempting but expensive (NGINX evaluates regex locations linearly per request). The story uses prefix matching (`location ^~ /api/v1/secondserve/`) which is constant-time. Regex is reserved for a hypothetical future "rate-limit any path containing `/admin/`" need.
- **Rate limiting on `:80`** — the `:80` server block is just an ACME challenge + 301 redirect per INF-06. Both paths are cheap; rate-limiting them adds complexity for no defensive value (ACME challenges are issued by Let's Encrypt's own infrastructure, redirects don't reach the upstream).

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-01](INF-01-provision-vps-docker-nginx.md) reaches DONE on the staging VPS | `vita_nginx` healthy on `:443`, `make -C infra verify` green. AUTH-08 edits the same `conf.d/` tree; without a live NGINX nothing is testable. The artifact-only status is acceptable for the *first* PR (the `nginx -t` lint runs in CI's throwaway container) but the staging drill (§5.10) requires a real VPS. |
| [INF-06](INF-06-https-letsencrypt-certbot.md) reaches DONE | The `:443` listener must be live with a real Let's Encrypt cert. Rate-limiting `:80` is theatre — all traffic 301s to `:443` immediately. The `# AUTH-08 — RATE LIMITS HERE` comment marker (currently at line 80 of `default.conf`) is the literal insertion point. |
| [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) at least IN_REVIEW | The FastAPI routes must respond at the documented paths so the calibration in §4.4 maps real endpoints. The five `/api/v1/<module>/*` prefixes (`auth`, `katara`, `farmarket`, `secondserve`, `botabaqa`) are stable per [backend/app/routers/__init__.py](../../backend/app/routers/__init__.py); the per-endpoint splits in §4.4 reference paths that exist or are about to. |
| `hey` available — either Docker (`rcmorano/docker-hey:latest`) or host-installed (`brew install hey` on macOS, `go install github.com/rakyll/hey@latest` elsewhere) | Used by `bench-rate-limits.sh`. The script defaults to the Docker variant so the operator's host stays clean; opt out with `BENCH_USE_HOST_HEY=1`. |
| `infra/.env` populated with `RATELIMIT_WHITELIST_IPS` | Comma-separated IPv4/v6 of monitoring + demo-day laptops. Default is empty (only the VPS-side static whitelist from §4.5 applies); operator fills it in before the demo. |
| `dig +short healthchecks.io` resolves to a current IP | Healthchecks.io rotates egress IPs occasionally. The whitelist uses the documented [Healthchecks egress range](https://healthchecks.io/docs/contacting_uptimerobot/) — verify it hasn't drifted before the §5.10 drill. |
| Supabase Dashboard access | Not strictly required for AUTH-08 itself, but the on-call triage flow in the runbook expects the operator to be able to look up a user by email when a "legitimate user is being 429'd" report comes in. |
| You are *not* behind a corporate NAT for the staging drill | The §5.10 drill requires firing from an IP that is *not* whitelisted, with predictable rate. A corporate NAT shares the IP across the floor and pollutes the bucket with unrelated traffic. Use a phone hotspot or a residential laptop. |

---

## 4. Target configuration

### 4.1 Architecture (in one diagram)

```
                            ┌─────────────────────────────────────────────────────────────────┐
   client (anon / JWT)      │             VPS — single NGINX container (:443)                 │
   ────────────────►        │                                                                 │
                            │   :443  ──► [TLS terminator (INF-06)]                           │
                            │              │                                                  │
                            │              ▼                                                  │
                            │      [geo $ratelimit_whitelist]  ── matches VPS IP / monitor    │
                            │              │  yes ─► $limit_key = "" → bucket skipped         │
                            │              │                                                  │
                            │              ▼  no                                              │
                            │   ┌────────────────────────────────────────────────────────┐    │
                            │   │  location-aware bucket dispatch (default.conf)         │    │
                            │   │                                                        │    │
                            │   │   /api/v1/auth/token              → auth_grant (5/min) │    │
                            │   │   /api/v1/auth/register           → auth_register     │    │
                            │   │   /api/v1/auth/kyc/upload         → auth_upload       │    │
                            │   │   /api/v1/botabaqa/leads          → public_write      │    │
                            │   │   /api/v1/farmarket/.+/contact    → public_write      │    │
                            │   │   /api/v1/farmarket/ads (GET)     → public_read       │    │
                            │   │   /api/v1/secondserve/meals (GET) → public_read       │    │
                            │   │   /api/v1/secondserve/reservations→ mutate_strict     │    │
                            │   │   /api/v1/katara/ingest           → iot_ingest (key=  │    │
                            │   │                                       device api key) │    │
                            │   │   /api/v1/admin/*                 → mutate_strict     │    │
                            │   │   /                                → public_read      │    │
                            │   │   /healthz / /uptime/             → whitelist short-  │    │
                            │   │                                       circuit         │    │
                            │   └────────────────────────────────────────────────────────┘    │
                            │              │                                                  │
                            │              ▼  bucket has tokens                               │
                            │      [limit_conn perip 50]  (slowloris cap)                     │
                            │              │                                                  │
                            │              ▼                                                  │
                            │      [proxy_pass to upstream]  ──► frontend / backend / kuma    │
                            │              ▲                                                  │
                            │              │  bucket exhausted                                │
                            │              ▼                                                  │
                            │      [error_page 429 = @ratelimited]                            │
                            │              │                                                  │
                            │              ▼                                                  │
                            │      [/429.html + Retry-After header]                           │
                            └─────────────────────────────────────────────────────────────────┘
```

### 4.2 The seven buckets — calibration

The rates below are calibrated to the **AUTH-03 1h access-token + 7d refresh-token** lifetimes (cf. [docs/spring-status.yml:444–445](../spring-status.yml#L444)). A tighter token TTL would force higher rates to avoid friction on legitimate clients; a looser TTL would allow tighter rates. The math:

- **`auth_grant`** (5 req/min/IP, burst 10 nodelay) — covers `POST /api/v1/auth/token` (Supabase Auth password grant if proxied + refresh-token exchange). Legitimate ceiling: a user who's forgotten their password retries ~3 times before clicking "forgot password"; a refresh on each tab open at 4 tabs/min is the upper bound — well below 5. Attacker ceiling: 5 × 1440 = 7,200 attempts/day. Against an 8-char lowercase password (26⁸ ≈ 2×10¹¹ space) that's 86,000 years to exhaust. Against a 14-char alphanumeric (62¹⁴) it's geologic. The `burst=10 nodelay` admits a momentary 10-request spike (multi-tab refresh after a 12h sleep) without 429-ing, then refills at 5/min.
- **`auth_register`** (3 req/min/IP, burst 5 nodelay) — covers `POST /api/v1/auth/register`. Legitimate ceiling: a real human registers once; a family sharing one residential NAT might register 3–4 times an hour during the demo. The 3/min × 60 = 180 registrations/hour/IP gives plenty of headroom while making mass account creation (a captcha-bypass-spam goal) economically uninteresting.
- **`auth_upload`** (2 req/min/IP, burst 3 nodelay) — covers `POST /api/v1/auth/kyc/upload` (AUTH-06 document upload, expected file size 1–4 MB). The bucket is *requests* not *bytes* — large-body DoS is handled by `client_max_body_size`. 2/min is generous for legitimate KYC (one upload + one re-upload + one ID-card upload, total 3 documents); it blocks the "upload 1000 garbage files to fill the storage quota" attack.
- **`public_write`** (6 req/min/IP, burst 12 nodelay) — covers Brevo-email-triggering anon POSTs: `/api/v1/botabaqa/leads`, `/api/v1/farmarket/<ad_id>/contact`. The math: Brevo Free Tier is 300 emails/day. 6/min × 1440 min = 8,640 max/day/IP, but the leads-table-INSERT-vs-Brevo-Webhook coupling means a flood from one IP overflows our Brevo quota in ~50 min. Combined with the global `limit_conn perserver 5000` and the natural ceiling of "one human submits a contact form maybe 2 times/day" — the per-IP cap is the right shape; the bucket *size* (12 burst) accommodates page double-submits, the *rate* (6/min) deters scripted floods.
- **`public_read`** (60 req/min/IP, burst 120 nodelay) — covers anonymous catalog reads: `GET /api/v1/farmarket/ads`, `GET /api/v1/secondserve/meals`, the Next.js frontend's static assets via `location /`. The legitimate ceiling is the SEC-02 map view's pan-and-zoom interaction: each pan refetches the meals viewport, easily 5–10 req/sec. 60/min = 1 req/sec sustained, with `burst=120 nodelay` admitting a 2-minute interactive burst at full speed before throttling kicks in. Above the bucket the user perceives "the map is slow" rather than "the map is broken".
- **`mutate_strict`** (10 req/min/IP, burst 5 nodelay) — covers SEC-04 reservation, SEC-06 pickup-code validation, FAR-01 ad creation, ADM-* admin actions. These are the BR-S2 / BR-F1 / KAT verification-gated write paths. Legitimate ceiling: a citizen reserves ≤ 1 meal at a time; a restaurateur validates pickup codes at the pace of real customer arrivals (1–2/min peak). 10/min × `burst=5 nodelay` covers a back-to-back legitimate burst without 429ing, and capers any race-amplification attack at 10/min — the database-layer atomicity (BR-S2's single transaction) then has 10× headroom to resolve every race correctly.
- **`iot_ingest`** (4 req/min/key, burst 20 nodelay, **key = `\$http_x_device_api_key`**) — covers `POST /api/v1/katara/ingest`. The legitimate fleet pattern is one ESP32 hitting the route every 15 minutes per KAT-03 §6.1.3 — that's 0.067 req/min, two orders of magnitude under the bucket. The `burst=20 nodelay` accommodates the R7 fallback (PRD §13: circular buffer + exponential backoff retry → device replays buffered readings on reconnect, plausibly 20 in a row). The 4/min/*key* — not /IP — bound means a single physical ESP32 cannot be replayed from N attacker IPs to amplify: the key is the bucket identifier; the IP is irrelevant. A leaked key is rate-limited at the source, recoverable by rotating the key in the `katara.devices` table.

### 4.3 The two connection caps

- **`limit_conn perip 50;`** at `:443 server { }` scope — one IP gets at most 50 concurrent TCP connections. The Next.js initial page load opens ~6–10 parallel connections (HTTP/2 multiplexing reduces this; the actual ceiling is fewer streams but `limit_conn` counts at the TCP layer); HMR/dev work would push higher but the dev origin is `localhost`, never this NGINX. 50 is 5× the highest legitimate observed; raises slowloris cost.
- **`limit_conn perserver 5000;`** at `:443 server { }` scope — the whole vhost gets at most 5000 concurrent connections. The MVD budget is 50 concurrent users × ~10 connections/user = 500; the cap is 10× over budget, leaving headroom for organic growth without becoming a DoS amplifier itself. The cap acts as a backstop if the `perip` cap is bypassed by a botnet — at 5000 the upstream FastAPI workers are saturated long before NGINX is, and the right next action is to scale up not to lower the cap.

### 4.4 Bucket → location mapping (per `default.conf` edits)

| Location (NGINX matching) | Path | Bucket | Burst | Whitelist? | Notes |
|---|---|---|---|---|---|
| `location = /api/v1/auth/token` | exact | `auth_grant` | 10 nodelay | no | password grant + refresh-token exchange |
| `location = /api/v1/auth/register` | exact | `auth_register` | 5 nodelay | no | account creation |
| `location ^~ /api/v1/auth/kyc/` | prefix | `auth_upload` | 3 nodelay | no | document upload (AUTH-06) — also `client_max_body_size 5m` already from INF-04 |
| `location = /api/v1/katara/ingest` | exact | `iot_ingest` (key=`\$http_x_device_api_key`) | 20 nodelay | no | the 50 ms SLA path. SLA preservation requires `nodelay` (queueing destroys p50). |
| `location ^~ /api/v1/secondserve/reservations` | prefix | `mutate_strict` | 5 nodelay | no | covers POST + the GET-by-id (citizen's own reservation history) |
| `location ^~ /api/v1/secondserve/meals/` (POST/PUT/DELETE only, via `if (\$request_method !~ ^(GET|HEAD)$)`) | prefix | `mutate_strict` | 5 nodelay | no | publishing a surprise box |
| `location = /api/v1/secondserve/meals` (GET) | exact | `public_read` | 120 nodelay | yes | catalog read; map view |
| `location ^~ /api/v1/farmarket/ads` (POST/PUT/DELETE only) | prefix | `mutate_strict` | 5 nodelay | no | ad CRUD by verified FARMER |
| `location = /api/v1/farmarket/ads` (GET) | exact | `public_read` | 120 nodelay | yes | catalog read; ad list |
| `location ~ ^/api/v1/farmarket/ads/[^/]+/contact$` | regex | `public_write` | 12 nodelay | no | the Brevo-trigger path (FAR-04) |
| `location = /api/v1/botabaqa/leads` | exact | `public_write` | 12 nodelay | no | the Brevo-trigger path (BOT-04) |
| `location ^~ /api/v1/admin/` | prefix | `mutate_strict` | 5 nodelay | no | admin shell — gated by AUTH-04 RLS + AUTH-06 verified+admin role; AUTH-08 is defence-in-depth |
| `location = /healthz` | exact | (none) | — | — | NGINX-local 200, unchanged from INF-01 / INF-06 |
| `location /uptime/` | prefix | (whitelist short-circuit) | — | yes | basic-auth-gated, hit by ops only |
| `location /` | prefix | `public_read` | 120 nodelay | yes | Next.js catch-all — frontend assets, SSR pages, dev redirects |

Notes on the `\$request_method` switch: NGINX's `if` directive is discouraged inside `location` (the "If is Evil" page) but is safe for the specific case of *applying* a `limit_req` conditionally on method. The pattern used is:

```nginx
location ^~ /api/v1/secondserve/meals/ {
    if ($request_method ~ ^(POST|PUT|DELETE|PATCH)$) {
        set $apply_strict 1;
    }
    # Limit_req cannot be put inside `if`; instead, use a map+limit_req trick:
    # limit_req zone=$rate_zone burst=...; with $rate_zone resolved by a top-level map.
    ...
}
```

The runbook documents the `map`-based pattern in full; it avoids the `if` foot-gun while still enabling method-aware buckets. The implementation is in §5.3.

### 4.5 The whitelist (`geo $ratelimit_whitelist`)

```nginx
geo $ratelimit_whitelist {
    default                 0;

    # VPS own public IP — Uptime Kuma probes & Next.js SSR fallback both egress from here.
    # Source: infra/.env $VPS_HOST (filled at deploy time via envsubst, see §5.5).
    ${VPS_PUBLIC_IP}        1;

    # Healthchecks.io egress range (documented at healthchecks.io/docs/).
    # Verify quarterly per runbook drill.
    52.21.110.144/29        1;

    # Operator-supplied demo-day field laptops & on-call workstations.
    # Filled from infra/.env $RATELIMIT_WHITELIST_IPS (comma-separated).
    # ${RATELIMIT_WHITELIST_IPS_NGINX_LINES}
}

map $ratelimit_whitelist $limit_key {
    0     $binary_remote_addr;
    1     "";   # empty key = limit_req treats the request as un-keyed = skipped
}
```

The `envsubst` template substitution (§5.5) is run at container start by the existing `vita_nginx`'s `command:` entrypoint (`/docker-entrypoint.sh` already handles `*.template` files; we name the file `00-rate-limits.conf.template` to opt in).

### 4.6 The IoT key (`map $http_x_device_api_key $iot_key`)

```nginx
map $http_x_device_api_key $iot_key {
    default     $http_x_device_api_key;   # device-key-keyed bucket
    ""          $binary_remote_addr;       # no header? fall back to IP-keyed (stricter, smaller bucket via separate zone)
}

limit_req_zone $iot_key  zone=iot_ingest:10m  rate=4r/m;
```

The header is hashed by NGINX's `limit_req_zone` internally — we do not need to pre-hash; the key length on the wire is bounded by typical headers (≤ 256 chars in practice), so the 10 MB zone fits ~160k unique keys (10 MB / 64 B per entry).

---

## 5. Step-by-Step Implementation

### 5.1 Create `infra/nginx/conf.d/00-rate-limits.conf.template`

```nginx
# AUTH-08 — Rate limiting zones (http {}-scope directives).
# Loaded before default.conf via the `00-` lexicographic prefix.
# This file is a template — ${VAR} placeholders are expanded by envsubst at container start.

# ---- Whitelist of IPs that bypass all per-IP rate limits ----------------------
geo $ratelimit_whitelist {
    default                 0;
    ${VPS_PUBLIC_IP}        1;
    52.21.110.144/29        1;
}

map $ratelimit_whitelist $limit_key {
    0     $binary_remote_addr;
    1     "";
}

# ---- IoT ingest key — keys by device API key header, falls back to IP --------
map $http_x_device_api_key $iot_key {
    default     $http_x_device_api_key;
    ""          $binary_remote_addr;
}

# ---- The seven buckets -------------------------------------------------------
limit_req_zone $limit_key  zone=auth_grant:10m       rate=5r/m;
limit_req_zone $limit_key  zone=auth_register:10m    rate=3r/m;
limit_req_zone $limit_key  zone=auth_upload:10m      rate=2r/m;
limit_req_zone $limit_key  zone=public_write:10m     rate=6r/m;
limit_req_zone $limit_key  zone=public_read:10m      rate=60r/m;
limit_req_zone $limit_key  zone=mutate_strict:10m    rate=10r/m;
limit_req_zone $iot_key    zone=iot_ingest:10m       rate=4r/m;

# ---- Connection caps ----------------------------------------------------------
limit_conn_zone $binary_remote_addr  zone=perip:10m;
limit_conn_zone $server_name         zone=perserver:10m;

# ---- Observability + status codes --------------------------------------------
limit_req_log_level    warn;
limit_req_status       429;
limit_conn_log_level   warn;
limit_conn_status      429;
```

### 5.2 Patch `infra/nginx/conf.d/default.conf`

Locate the `# ----- AUTH-08 — RATE LIMITS HERE ----` block at line 80 of the existing file. Replace it with the block-level connection caps + the per-location patches. Critically, do **not** touch lines 1–79 (TLS profile, HSTS, hardening headers) or lines 86–169 (`/healthz`, `/50x.html`, `/uptime/`, `/api/v1/`, `/`, `server_tokens off`).

The full patch — exactly the diff to apply — is shipped in [docs/runbook.md §AUTH-08-default-conf-patch](../runbook.md). High-level shape:

```nginx
server {
    listen 443 ssl;
    http2  on;
    ...
    # (lines 64–79 unchanged: TLS include, HSTS, defence-in-depth headers)

    # ----- AUTH-08 — RATE LIMITS HERE ---------------------------------------
    # Block-level connection caps (per-IP slowloris + per-vhost backstop).
    limit_conn perip      50;
    limit_conn perserver  5000;

    # Branded 429 page.
    error_page 429 = @ratelimited;
    location @ratelimited {
        internal;
        add_header Retry-After      $sent_http_retry_after  always;
        add_header X-RateLimit-Hit  "1"                     always;
        root /usr/share/nginx/html;
        try_files /429.html =429;
    }

    # ----- Per-location bucket assignment -----------------------------------
    location = /healthz { ... }   # unchanged
    location = /50x.html { ... }  # unchanged
    location /uptime/    { ... }  # unchanged (whitelist short-circuit applies via $limit_key)

    # NEW: split /api/v1/auth/* before the catch-all /api/v1/.
    location = /api/v1/auth/token {
        limit_req zone=auth_grant burst=10 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }
    location = /api/v1/auth/register {
        limit_req zone=auth_register burst=5 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }
    location ^~ /api/v1/auth/kyc/ {
        limit_req zone=auth_upload burst=3 nodelay;
        client_max_body_size 5m;
        include /etc/nginx/snippets/proxy-backend.conf;
    }

    # NEW: KAT-03 ingest with the device-key-keyed bucket.
    location = /api/v1/katara/ingest {
        limit_req zone=iot_ingest burst=20 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
        # KAT-03 SLA: keep the 50 ms ceiling tight.
        proxy_read_timeout    2s;
        proxy_send_timeout    2s;
        proxy_connect_timeout 500ms;
    }

    # NEW: SecondServe — mutate paths strict; reads loose.
    location ^~ /api/v1/secondserve/reservations {
        limit_req zone=mutate_strict burst=5 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }
    location = /api/v1/secondserve/meals {
        limit_req zone=public_read burst=120 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }
    location ^~ /api/v1/secondserve/meals/ {
        # method-aware: GET → public_read; POST/PUT/DELETE → mutate_strict.
        limit_req zone=$secondserve_meals_zone burst=120 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }

    # NEW: FarMarket — same split.
    location = /api/v1/farmarket/ads {
        limit_req zone=public_read burst=120 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }
    location ^~ /api/v1/farmarket/ads/ {
        limit_req zone=$farmarket_ads_zone burst=120 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }
    location ~ ^/api/v1/farmarket/ads/[^/]+/contact$ {
        limit_req zone=public_write burst=12 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }

    # NEW: BotaBa9a leads (Brevo-trigger path).
    location = /api/v1/botabaqa/leads {
        limit_req zone=public_write burst=12 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }

    # NEW: Admin shell — defence in depth on top of RLS + role gates.
    location ^~ /api/v1/admin/ {
        limit_req zone=mutate_strict burst=5 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }

    # NEW: catch-all /api/v1/ — anything that didn't match above.
    location /api/v1/ {
        limit_req zone=public_read burst=120 nodelay;
        include /etc/nginx/snippets/proxy-backend.conf;
    }

    # CHANGED: frontend catch-all gets the loose public_read bucket.
    location / {
        limit_req zone=public_read burst=120 nodelay;
        ...   # existing proxy_pass to vita_frontend
    }

    server_tokens off;
    client_max_body_size 5m;
}
```

The `$secondserve_meals_zone` / `$farmarket_ads_zone` variables are method-aware aliases set by top-level `map` blocks in `00-rate-limits.conf` (added in this story):

```nginx
map $request_method $secondserve_meals_zone {
    default       public_read;
    POST          mutate_strict;
    PUT           mutate_strict;
    PATCH         mutate_strict;
    DELETE        mutate_strict;
}
map $request_method $farmarket_ads_zone {
    default       public_read;
    POST          mutate_strict;
    PUT           mutate_strict;
    PATCH         mutate_strict;
    DELETE        mutate_strict;
}
```

### 5.3 Extract `infra/nginx/snippets/proxy-backend.conf`

The `proxy_pass http://vita_backend;` + the 7 `proxy_set_header` lines + the timeouts that already exist in `default.conf` lines 121–142 are duplicated across every new `location` in §5.2. Extract them once:

```nginx
# infra/nginx/snippets/proxy-backend.conf
proxy_pass         http://vita_backend;
proxy_http_version 1.1;
proxy_set_header   Host              $host;
proxy_set_header   X-Real-IP         $remote_addr;
proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header   X-Forwarded-Proto $scheme;
proxy_set_header   X-Forwarded-Host  $host;
proxy_set_header   X-Request-Id      $request_id;
proxy_connect_timeout 5s;
proxy_send_timeout    300s;
proxy_read_timeout    300s;
client_max_body_size  10m;
proxy_intercept_errors on;
error_page 502 503 504 /50x.html;
```

Each new `location` includes this; the per-location overrides (e.g., the KAT-03 ingest tightens `proxy_read_timeout` to 2s) are placed *after* the include so the override wins.

### 5.4 Ship `frontend/public/429.html`

A static, locale-aware (FR / AR / EN), no-JS-required HTML page. Mount it into `nginx` via the existing `frontend_build` shared volume (the Next.js build already copies `public/*` into the production image; `429.html` ships alongside `favicon.ico` etc.) — or, simpler, bind-mount `infra/nginx/html/429.html` directly. The latter avoids coupling the rate-limit response to a successful frontend build.

```html
<!DOCTYPE html>
<html lang="fr" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="60">
  <title>VitaChain — 429 Too Many Requests</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40em; margin: 4em auto; padding: 0 1em; color: #1a1a1a; }
    h1 { color: #b04020; }
    code { background: #f3f3f3; padding: 0.1em 0.3em; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Trop de requêtes — Too Many Requests</h1>
  <p id="msg-fr">Vous avez envoyé trop de requêtes en peu de temps. Merci de patienter une minute avant de réessayer.</p>
  <p id="msg-en" hidden>You have sent too many requests in a short time. Please wait one minute before retrying.</p>
  <p id="msg-ar" hidden lang="ar" dir="rtl">لقد أرسلت طلبات كثيرة في وقت قصير. يرجى الانتظار دقيقة واحدة قبل المحاولة مرة أخرى.</p>
  <p><small>VitaChain MVD · AUTH-08 rate limit · Retry-After header indique le délai.</small></p>
  <script>
    var lang = (navigator.language || 'fr').slice(0,2);
    if (lang === 'en' || lang === 'ar') {
      document.getElementById('msg-fr').hidden = true;
      document.getElementById('msg-' + lang).hidden = false;
      document.documentElement.lang = lang;
      if (lang === 'ar') document.documentElement.dir = 'rtl';
    }
  </script>
</body>
</html>
```

### 5.5 envsubst the template at container start

The official `nginx:1.27-alpine` image's `/docker-entrypoint.sh` already expands `.template` files: drop the file as `/etc/nginx/conf.d/00-rate-limits.conf.template` and the entrypoint runs `envsubst '${VPS_PUBLIC_IP} ${RATELIMIT_WHITELIST_IPS_NGINX_LINES}' < … > 00-rate-limits.conf` before NGINX boots.

Add to `infra/docker-compose.yml` nginx service env:
```yaml
environment:
  - VPS_PUBLIC_IP=${VPS_PUBLIC_IP}
  - RATELIMIT_WHITELIST_IPS_NGINX_LINES   # generated by infra/scripts/deploy.sh from $RATELIMIT_WHITELIST_IPS
  - NGINX_ENVSUBST_TEMPLATE_SUFFIX=.template
  - NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d
```

Update `infra/scripts/deploy.sh` to compute `RATELIMIT_WHITELIST_IPS_NGINX_LINES` from `$RATELIMIT_WHITELIST_IPS` (comma-separated CSV → newline-separated `<ip>\t1;` NGINX directives) before `docker compose up`.

### 5.6 Write `infra/scripts/bench-rate-limits.sh`

```bash
#!/usr/bin/env bash
# AUTH-08 — load-generation harness. Fires 8 calibration scenarios against
# the live VPS and asserts pass/fail per scenario.
set -euo pipefail

VPS_HOST="${VPS_HOST:?VPS_HOST required}"
BASE="https://${VPS_HOST}"
HEY="docker run --rm rcmorano/docker-hey:latest"
[[ "${BENCH_USE_HOST_HEY:-0}" == "1" ]] && HEY="hey"

scenario() {
    local name=$1 url=$2 method=$3 n=$4 c=$5 expected_429_min=$6 extra=$7
    echo "▶ $name"
    out=$($HEY -n $n -c $c -m $method $extra "$BASE$url" 2>/dev/null || true)
    obs_429=$(echo "$out" | grep -oP '\[429\]\s+\K\d+' || echo 0)
    if [[ $obs_429 -ge $expected_429_min ]]; then
        echo "  PASS: $name — ${obs_429} of $n hits 429-limited (≥ $expected_429_min expected)"
    else
        echo "  FAIL: $name — only ${obs_429} of $n hit 429 (expected ≥ $expected_429_min)" >&2
        return 1
    fi
}

# Eight calibration scenarios — paths must exist; uses unauthenticated probes
# where the bucket is reached pre-auth (auth_grant rejects malformed creds before
# the bucket; that's fine for the test).
scenario "auth_grant flood"          "/api/v1/auth/token"                 POST 60   20 40 ""
scenario "auth_register flood"       "/api/v1/auth/register"              POST 30   10 20 ""
scenario "public_write botabaqa"     "/api/v1/botabaqa/leads"             POST 30   10 18 ""
scenario "public_write farmarket"    "/api/v1/farmarket/ads/00000000-0000-0000-0000-000000000000/contact" POST 30 10 18 ""
scenario "mutate_strict reservation" "/api/v1/secondserve/reservations"   POST 50   20 35 ""
scenario "iot_ingest flood (no key)" "/api/v1/katara/ingest"              POST 40   10 30 ""
scenario "iot_ingest flood (1 key)"  "/api/v1/katara/ingest"              POST 40   10 30 "-H X-Device-Api-Key:auth08-bench-key"
scenario "public_read meals (loose)" "/api/v1/secondserve/meals"          GET  100   10  0 ""   # expect ~0 429s — bucket is loose

echo "✅ AUTH-08 bench complete"
```

### 5.7 Patch `infra/scripts/verify.sh`

Append a new block (skip when `VPS_HOST` is an IP literal, same convention as INF-06):

```bash
echo
echo "─── AUTH-08 verification (rate limiting) ───"
[[ "$VPS_HOST" =~ ^[0-9]+\. ]] && { echo "  skipped: VPS_HOST is an IP literal"; } || {

    # 1. Zone declarations present in deployed config
    ssh "$VPS_USER@$VPS_HOST" "docker exec vita_nginx grep -c 'limit_req_zone' /etc/nginx/conf.d/00-rate-limits.conf" | grep -q '^7$' && echo "  ✓ 7 limit_req zones declared" || fail "zone count != 7"

    # 2. Whitelist resolves VPS public IP
    ssh "$VPS_USER@$VPS_HOST" "docker exec vita_nginx grep -F '$VPS_PUBLIC_IP' /etc/nginx/conf.d/00-rate-limits.conf" && echo "  ✓ VPS IP in whitelist"

    # 3. /healthz flood stays 200 even at 200 req/s (whitelisted on $limit_key=='')
    out=$(hey -n 200 -c 50 "https://$VPS_HOST/healthz" 2>/dev/null | grep -oP '\[200\]\s+\K\d+')
    [[ $out -ge 195 ]] && echo "  ✓ /healthz flood: $out/200 succeeded" || fail "healthz throttled at $out/200"

    # 4. Reservation flood from one IP hits 429
    out=$(hey -n 40 -c 20 -m POST "https://$VPS_HOST/api/v1/secondserve/reservations" 2>/dev/null | grep -oP '\[429\]\s+\K\d+' || echo 0)
    [[ $out -ge 25 ]] && echo "  ✓ reservation flood: $out/40 hit 429" || fail "reservation flood not throttled ($out 429s)"

    # 5. 429 response carries Retry-After
    curl -s -o /dev/null -D - -X POST "https://$VPS_HOST/api/v1/secondserve/reservations" \
        "$(for i in $(seq 1 30); do echo -n '--next -X POST https://'$VPS_HOST'/api/v1/secondserve/reservations '; done)" \
        2>/dev/null | grep -i 'retry-after:' && echo "  ✓ Retry-After header present"

    # 6. nginx -t clean
    ssh "$VPS_USER@$VPS_HOST" "docker exec vita_nginx nginx -t" 2>&1 | grep -q 'syntax is ok' && echo "  ✓ nginx -t clean"

    # ... 8 more checks (429 body shape, X-RateLimit-Bucket header on 200s, iot_ingest key-keyed, etc.)
}
```

### 5.8 Update `infra/Makefile`

```makefile
bench-rate-limits: ## AUTH-08 — run the 8 calibration scenarios against VPS
	@test -n "$$VPS_HOST" || (echo "VPS_HOST required (infra/.env)" && exit 1)
	@./scripts/bench-rate-limits.sh

bench-rate-limits-dryrun:
	@DRYRUN=1 ./scripts/bench-rate-limits.sh

rate-limit-tail: ## AUTH-08 — tail the NGINX limit_req error log on the VPS
	@ssh "$$VPS_USER@$$VPS_HOST" 'sudo docker exec vita_nginx tail -F /var/log/nginx/error.log | grep --line-buffered "limiting requests"'
```

### 5.9 Document everything in `docs/runbook.md`

Append a "AUTH-08 — Rate limits & abuse playbook" section. See §2 of this story for the subsection list. The full text is left to the runbook edit (one ~600-line section in the same voice as the existing INF-06 / INF-07 runbook chapters).

### 5.10 Staging drill — the §6 acceptance trigger

1. Open a PR with `00-rate-limits.conf.template`, the `default.conf` patch, the 429.html, the snippets, the bench script, and the `verify.sh` extension. CI gates: `nginx -t` lint via `make -C infra nginx-test` (the throwaway-container check from INF-06).
2. Merge to `main`. The `infra/scripts/deploy.sh` rsyncs the changes to the staging VPS and runs `docker compose up -d`. NGINX reloads with the new zones declared.
3. From a *non-whitelisted* IP (laptop on phone hotspot, **not** office WiFi), run `make -C infra bench-rate-limits`. All 8 scenarios must `PASS`.
4. SSH to the VPS, `make -C infra rate-limit-tail`, and re-run the bench from the same laptop. The `error.log` should show ~150 `limiting requests by zone "…"` lines across the 8 scenarios — a clean live demonstration.
5. From a whitelisted IP (the VPS itself, via `ssh $VPS_HOST 'hey ...'`), repeat the same scenarios. *No* 429s for the `public_read` / `mutate_strict` / `public_write` flows (the whitelist short-circuits the per-IP key). The `auth_*` and `iot_ingest` flows still 429 because they don't use the whitelist (deliberate — operator brute-force is still brute-force).
6. Record the test in `docs/runbook.md` drill log: date, operator, IP used, bench output, screenshot of the 429 page rendered in a browser. Reference the commit SHA the drill ran against.
7. Flip `AUTH-08.status: IN_REVIEW → DONE` in `docs/spring-status.yml`. Hand-off line per §11.

### 5.11 Rollback procedure

If a bucket is too tight in production and is 429-ing legitimate users:

```bash
# Option 1 (preferred): bucket tweak. Edit 00-rate-limits.conf.template's
# `rate=Xr/m` for the offending zone, commit, deploy, watch the tail.

# Option 2 (emergency, < 60 seconds): disable a single bucket.
ssh "$VPS_USER@$VPS_HOST"
docker exec vita_nginx sed -i 's|limit_req zone=auth_grant|# limit_req zone=auth_grant|' /etc/nginx/conf.d/default.conf
docker exec vita_nginx nginx -s reload
# That `location` is now un-rate-limited. Document in incident log,
# tighten in a follow-up PR within 24h.

# Option 3 (nuclear): remove the include.
ssh "$VPS_USER@$VPS_HOST"
docker exec vita_nginx mv /etc/nginx/conf.d/00-rate-limits.conf /etc/nginx/conf.d/00-rate-limits.conf.disabled
docker exec vita_nginx nginx -s reload
# All rate limiting is OFF. Use only if a config bug is taking down the site;
# revert and re-enable within the hour.
```

---

## 6. Verification Checklist

| # | Check | How |
|---|---|---|
| 1 | `00-rate-limits.conf.template` exists with 7 `limit_req_zone` + 2 `limit_conn_zone` + 1 `geo` + 3 `map` blocks | `grep -c` against the file |
| 2 | `default.conf` insertion point (line 80) replaced with `limit_conn` + per-location `limit_req` directives — 12 new `location` blocks, TLS profile untouched (lines 64–79 byte-identical to INF-06's version) | `git diff --stat default.conf` shows additions only, no deletions in the TLS region |
| 3 | `nginx -t` clean inside `make -C infra nginx-test` throwaway container | CI `infra` job green on the PR |
| 4 | After deploy, `docker exec vita_nginx grep -c 'limit_req_zone' /etc/nginx/conf.d/00-rate-limits.conf` returns `7` | `verify.sh` check 1 |
| 5 | After deploy, `curl -i https://vitachain.ma/healthz` returns `200` with no `X-RateLimit-Hit` header *even at 200 req/s sustained from one IP* | `verify.sh` check 3 |
| 6 | `make -C infra bench-rate-limits` from a non-whitelisted IP exits 0 (all 8 scenarios PASS) | §5.10 step 3 |
| 7 | `make -C infra bench-rate-limits` from a whitelisted IP shows *zero* 429s on `public_read` / `mutate_strict` / `public_write` flows | §5.10 step 5 |
| 8 | The `auth_grant`, `auth_register`, `auth_upload`, and `iot_ingest` buckets *still* 429 from a whitelisted IP (whitelist deliberately excludes these — see §4.4) | §5.10 step 5 |
| 9 | A 429 response carries `Retry-After: <seconds>` and `X-RateLimit-Hit: 1` headers | `curl -i` against any flood |
| 10 | A 429 response body is the branded `429.html` (FR / AR / EN per `navigator.language`) | open the URL in a browser at 50 req/s from devtools, observe the page |
| 11 | The `error.log` carries `limiting requests by zone "..."` WARN lines during a flood; Sentry breadcrumb fires (INF-08 integration) | `make -C infra rate-limit-tail` + Sentry "Issues" view |
| 12 | IoT ingest with a *device key* is keyed by the key, not the IP: hitting the same endpoint with two different keys from one IP shows independent bucket consumption (key A's 4/min budget is unaffected by key B's flood) | `bench-rate-limits.sh` scenario 7 with two distinct `-H X-Device-Api-Key:` values |
| 13 | A leaked / revoked device key continues to 429 even after rotation (NGINX has no awareness of "key is revoked" — that's KAT-03 backend's job; AUTH-08's contract is "cap the call rate", which it does regardless) | manual test: hit ingest with a known-bad key, observe 429s, then rotate the key in `katara.devices`, observe the *backend* now returns 401 (not 429) once the bucket refills |
| 14 | The branded 429 page does not contain any link to internal infra (no `/uptime/`, no `/api/v1/admin/`, no Sentry DSN, no Supabase URL) — a 429 is a *public* response | `curl` the page, `grep -E '(uptime\|admin\|sentry\|supabase)'` returns empty |

---

## 7. Deliverables

- `infra/nginx/conf.d/00-rate-limits.conf.template` *(new)*
- `infra/nginx/conf.d/default.conf` *(patched — block-level conn caps + 12 new location blocks at the AUTH-08 insertion point; TLS region untouched)*
- `infra/nginx/snippets/proxy-backend.conf` *(new — extracted from `default.conf` duplication)*
- `infra/nginx/snippets/limit-headers.conf` *(new)*
- `infra/nginx/html/429.html` *(new — FR / AR / EN branded error page)*
- `infra/scripts/bench-rate-limits.sh` *(new — 8 calibration scenarios via `hey`)*
- `infra/scripts/verify.sh` *(patched — appended AUTH-08 verification block with 14 checks)*
- `infra/scripts/deploy.sh` *(patched — generates `$RATELIMIT_WHITELIST_IPS_NGINX_LINES` from `$RATELIMIT_WHITELIST_IPS`)*
- `infra/docker-compose.yml` *(patched — added `VPS_PUBLIC_IP`, `RATELIMIT_WHITELIST_IPS_NGINX_LINES`, `NGINX_ENVSUBST_*` env vars to the `nginx` service)*
- `infra/.env.example` *(patched — added `VPS_PUBLIC_IP`, `RATELIMIT_WHITELIST_IPS` keys with comments)*
- `infra/Makefile` *(patched — `bench-rate-limits`, `bench-rate-limits-dryrun`, `rate-limit-tail` targets)*
- `docs/runbook.md` *(patched — new "AUTH-08 — Rate limits & abuse playbook" section, 5 subsections)*
- `docs/spring-status.yml` *(patched — `AUTH-08.status` flipped; summary counters updated; hand-off line under `project.last_updated`)*

---

## 8. Risks & Mitigations

| # | Risk | Probability | Impact | Mitigation | Fallback |
|---|---|---|---|---|---|
| R-A8-1 | **Bucket too tight, legitimate user 429'd on demo day** | Medium | Critical | §5.10 staging drill exercises every bucket from a real IP at realistic rates; the calibration in §4.2 has 2–3× headroom over observed legitimate usage; the runbook documents the 60-second rollback (§5.11 Option 2) | The on-call has `ssh root@vps + sed + nginx -s reload` muscle memory from the drill; rolling back a single bucket takes 60 seconds |
| R-A8-2 | **Whitelist is wrong → Uptime Kuma sees 429s → operator silences monitor → real outage missed** | Medium | High | The `verify.sh` AUTH-08 block explicitly tests `/healthz` under flood (check 5); the runbook drill log records the whitelist contents at deploy time; INF-08's Sentry integration fires on `limit_req` WARN lines so a silent monitor is still loud in Sentry | Operator notices the Uptime Kuma flapping within hours; the runbook's triage flow for "monitor is flapping" routes them to the whitelist check before they silence anything |
| R-A8-3 | **A new public endpoint is added in a domain story (e.g., a future SEC-* or KAT-* PR) and the developer forgets to add a `limit_req` directive** | High | Medium | The runbook's "regression test cookbook" section (§2 (5)) documents the 4-step recipe for adding a new bucket; the catch-all `location /api/v1/` falls back to `public_read` (60r/m/IP) so an unprotected new endpoint is *still* rate-limited by default, just at the loose-read rate; AUTH-07's role-matrix tests will flag a new endpoint with a missing rate limit only if the operator manually adds it to the matrix | The catch-all default is the fallback; a follow-up PR after the omission is noticed adds the right bucket. Worst case: a new write endpoint is exposed at 60r/m/IP for a few days before tightening |
| R-A8-4 | **NGINX OSS limitation: no built-in "remaining tokens" header** — clients cannot adaptive-throttle gracefully | Low | Low | The `X-RateLimit-Bucket` and `X-RateLimit-Limit` headers (§2 — `limit-headers.conf` snippet) at least tell the client *which* bucket and *what rate*; a well-behaved client backs off on first 429 + `Retry-After` rather than expecting a token-count header | Post-MVD: install `ngx_http_js_module` and compute remaining tokens via njs. Out of scope for AUTH-08. |
| R-A8-5 | **`limit_req` rate granularity (per-second / per-minute) is coarse — short-but-bursty legitimate workloads can clip even with `burst nodelay`** | Low | Medium | The calibration in §4.2 sets `burst` 2–4× the bucket size, which in practice means a 30-second human-paced burst is admitted before throttling. The exception is `auth_grant` (5/min, burst 10) which is intentionally tight — brute-force is the threat model | If a legitimate workload pattern emerges (e.g., a restaurateur batching 50 menu updates), the runbook's bucket-tightening walkthrough applies in reverse: loosen the bucket, redeploy, drill |
| R-A8-6 | **Shared-memory zones (`10m` each) consume RAM permanently** — 7 zones × 10 MB = 70 MB resident in NGINX | Low | Low | The VPS has 4 GB RAM (PRD §8.4 Level 1); 70 MB is < 2%; the 10 MB-per-zone size is recommended by NGINX's own docs for ≥ 50k-key scales, which is 1000× our MVD reality | Resize zones to `1m` each if RAM ever becomes the binding constraint. Trivial; one-line edit. |
| R-A8-7 | **The IoT ingest bucket keyed on `$http_x_device_api_key` leaks one bit of information: an attacker can probe for valid device keys by observing whether the rate-limit response indicates "key A is throttled" vs "key B isn't"** | Very Low | Very Low | The response shape is identical (429 + `Retry-After` + the same body) regardless of whether the bucket exists or was created on-demand; an attacker cannot distinguish "first request with this key" from "first request with any random string" — both populate a fresh bucket | If the threat ever matures, switch the key fallback to a constant string ("`unknown-iot-key`") so all keyless requests share one bucket. One-line edit. |
| R-A8-8 | **A regex location (`location ~ ^/api/v1/farmarket/ads/[^/]+/contact$`) is more expensive to evaluate than a prefix location** | Low | Low | NGINX evaluates locations once per request; the cost is microseconds. The `/api/v1/farmarket/ads/<id>/contact` shape is the only path that *requires* regex (the `<id>` is variable). All other locations use prefix matching | Replace with an exact-match wildcard at the FastAPI layer (rewrite `/contact` to a query-string param) — too invasive for AUTH-08; defer |

---

## 9. Time Estimate

| Subtask | Estimate |
|---|---|
| Write `00-rate-limits.conf.template` (zones + maps + geo + status) | 1 h |
| Patch `default.conf` (12 new locations, extract snippet, preserve TLS region byte-for-byte) | 2 h |
| Write `429.html` (FR / AR / EN, no-JS-required) | 30 min |
| Patch `docker-compose.yml` + `deploy.sh` + `.env.example` (envsubst plumbing) | 1 h |
| Write `bench-rate-limits.sh` (8 scenarios, `hey`-Docker, pass/fail asserts) | 1.5 h |
| Patch `verify.sh` (14-check AUTH-08 block) | 1.5 h |
| Patch `Makefile` (3 targets) | 15 min |
| Write `docs/runbook.md` section (5 subsections — bucket table, whitelist, triage, walkthrough, cookbook) | 2 h |
| `make -C infra nginx-test` local lint + iterate on syntax | 30 min |
| Staging deploy + §5.10 drill from non-whitelisted IP + drill from whitelisted IP + record drill log | 2 h |
| Tighten / loosen any bucket caught off-calibration by the live drill | 1 h |
| PR review + address feedback | 1.5 h |
| **Total** | **~15 h** (~2 dev-days; budget 3 to absorb VPS provisioning friction or a tricky `if ($request_method)` corner) |

---

## 10. Definition of Done

The story is `DONE` (not `IN_REVIEW`) when **all** of the following hold:

1. The 12 deliverables in §7 are merged to `main`.
2. CI `infra` job is green on the merge commit (covers `nginx -t` lint).
3. The §5.10 staging drill has been run from at least two distinct source IPs (one whitelisted, one not), and the bench script exited 0 on the non-whitelisted run.
4. The drill is recorded in `docs/runbook.md`'s drill log table with: date, operator, both source IPs, bench output (paste or screenshot), 429-page screenshot, commit SHA the drill ran against.
5. `make -C infra verify` from a developer laptop against the staging VPS exits 0 *including* the new AUTH-08 verification block (14 checks).
6. No legitimate Uptime Kuma probe has been 429'd in the 24h following deploy — verified by `sudo docker exec vita_nginx grep "limiting requests" /var/log/nginx/error.log | grep -F "<UPTIME_KUMA_SOURCE_IP>"` returning empty.
7. `docs/spring-status.yml`'s `AUTH-08.status` is `DONE`; `summary.done` / `summary.in_review` / `summary.todo` counters reflect the flip; a hand-off line is appended under `project.last_updated` (template in §11).
8. The on-call's quarterly drill calendar (in `docs/runbook.md`'s drill schedule table — same convention as INF-07's restore drill) has a "AUTH-08 — re-run `bench-rate-limits.sh` against prod" entry on the first Friday of each quarter.

---

## 11. Hand-off — (to be filled on completion)

Template for the `project.last_updated` line in [docs/spring-status.yml](../spring-status.yml):

```yaml
  # 2026-MM-DD — AUTH-08 DONE: NGINX rate limiting on public endpoints. Seven `limit_req_zone` declarations
  # (auth_grant 5/min, auth_register 3/min, auth_upload 2/min, public_write 6/min, public_read 60/min,
  # mutate_strict 10/min, iot_ingest 4/min keyed on $http_x_device_api_key) live in
  # infra/nginx/conf.d/00-rate-limits.conf.template — envsubst-expanded at container start with VPS_PUBLIC_IP
  # + RATELIMIT_WHITELIST_IPS from infra/.env. Twelve new `location` blocks in default.conf at the
  # INF-06-labelled insertion point (line 80 unchanged); TLS profile + HSTS untouched. `geo $ratelimit_whitelist`
  # exempts the VPS public IP + Healthchecks.io egress range + operator-supplied demo-day laptops; the
  # whitelist short-circuits `public_*`/`mutate_strict` buckets but deliberately NOT `auth_*`/`iot_ingest`
  # (operator brute-force is still brute-force). Branded /429.html ships FR/AR/EN via `navigator.language`
  # + `<meta http-equiv=refresh content=60>` for graceful auto-recovery. Block-level `limit_conn perip 50`
  # + `limit_conn perserver 5000` caps slowloris-class attacks. Staging drill 2026-MM-DD from non-whitelisted
  # phone hotspot IP a.b.c.d: all 8 bench scenarios PASS; ~150 limit_req lines in error.log; 429 page
  # rendered + screenshot logged in runbook drill table. Same drill from VPS-side IP shows 0 throttling on
  # public_*/mutate_strict (whitelist working) and full throttling on auth_*/iot_ingest (anti-self-brute-force).
  # Unblocks: AUTH-07 (Phase-3 partner story — correctness + capacity gate as a pair), Demo Day (the brute-force
  # ceiling that every demo URL inherits from minute one), KAT-03 50 ms SLA (the per-key bucket prevents a
  # leaked device key from saturating the upstream), FAR-04 + BOT-04 + SEC-04 + SEC-05 Brevo paths (per-IP
  # public_write cap turns a flood into a 250-emails/day-per-IP nuisance, well under our quota). Status DONE.
```

---

*AUTH-08 is the L7 rate-limit ceiling. AUTH-07 is the authorization-correctness floor. The pair together is the security posture the steering committee signs off on; neither one alone is enough.*
