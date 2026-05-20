# INF-08 — Sentry + Uptime Kuma observability

> **Epic:** E0 — Infrastructure & DevOps Foundation
> **Phase:** P3 — Architect (Weeks 6–7) *(per [docs/spring-status.yml:299](../spring-status.yml#L299) — `phase: P3` is declared explicitly on the story, overriding E0's default P1. Rationale: error tracking and uptime probing are only meaningful once the system has surface area to fail on — i.e. after the M1/M2/M3/M4 features have landed in P2. Shipping Sentry on Day 1 means staring at an empty issues list for five weeks; shipping it at the start of P3 means it catches the bugs that the integration tests miss as the team enters the hardening sprint.)*
> **Priority:** Should *(per [docs/spring-status.yml:296](../spring-status.yml#L296) — and PRD §8.5 *Observability* lists Sentry + Uptime Kuma as **mechanisms**, not as a hard SLO. The Must-tier "demo doesn't crash" property is owned by INF-07's restore drill and the QG-07 zero-downtime gate; INF-08 is what makes failures **observable** and **reachable in chat** when they do happen.)*
> **Status:** TODO
> **Depends on:** [INF-03](INF-03-nextjs-scaffold-login-dashboard.md) (`DONE` — the `@sentry/nextjs` plugin wraps the Next 15 build pipeline; we need the standalone scaffold + the build args contract from §5.2), [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) (`DONE` — `sentry-sdk[fastapi]` hooks the existing `RequestIdMiddleware` + the `/healthz` + `/readyz` probes that Uptime Kuma targets)
> **Soft-depends on:** [INF-01](INF-01-provision-vps-docker-nginx.md) (`IN_PROGRESS` — Uptime Kuma is a Docker service co-resident with NGINX on the VPS; until INF-01 reaches DONE the service is artefact-only), [INF-06](INF-06-https-letsencrypt-certbot.md) (`TODO` — Sentry rejects HTTP-only DSN posts from a browser context if a `report-only` CSP is in play; both DSNs MUST hit `https://`; the Uptime Kuma admin UI is also served behind TLS via the existing :443 vhost — never on a plaintext port), [INF-07](INF-07-nightly-pgdump-backup-b2.md) (`TODO` — Uptime Kuma's own SQLite state lives on a named volume that piggybacks the same disaster-recovery posture; loss of the volume means re-creating the monitor + notification config, *not* loss of historical incidents which are non-recoverable by design)
> **Unblocks:** every Phase-3 story that needs a *"did we just regress?"* signal — [AUTH-07](#) (RLS audit — a 500 on a cross-role probe must page someone), [QG-04](#) (50 concurrent users — pages on error-rate spike), [QG-05](#) (100 req/s ingest load test — pages on `/api/v1/katara/ingest` latency drift), [QG-06](#) (Brevo email delivery — Uptime Kuma probes Brevo's API status page), [QG-07](#) (zero-downtime demo — Uptime Kuma is the *evidence* during the demo window). Also unblocks the post-MVD on-call rota — Sentry's *Issue → Assigned* flow is the ticket source-of-truth from Week 7 onward.
> **Acceptance (per [docs/spring-status.yml:298](../spring-status.yml#L298) + PRD §8.5):** *"Errors visible in Sentry; uptime alerts in Telegram/Discord."* The §10 Definition of Done extends both halves: (a) a **planted** unhandled error on each tier (frontend `/__sentry-test`, backend `GET /api/v1/_sentry_test`) lands in the Sentry project as separate events with correct `environment`, `release`, and `request_id` tags within 60 s; (b) a **forced** monitor down state (stop the `backend` container) produces a chat message in the team Discord/Telegram channel within the configured polling interval + 1 grace cycle.

---

## 1. Purpose

Close the **"silent failure"** gap that opens the moment the system serves real users. As of the start of Phase 3, VitaChain has:

- Five containers (`nginx`, `frontend`, `backend`, `certbot`, `db-backup`) with `restart: unless-stopped` — Docker will resurrect a crashed process, but **nobody is told it crashed**.
- A `/readyz` endpoint that returns 503 with a degraded-checks body when Supabase REST or Auth is unreachable ([backend/app/routers/health.py](../../backend/app/routers/health.py)) — but **nothing is reading it on a schedule**.
- A FastAPI middleware that stamps every request with `X-Request-Id` ([backend/app/core/middleware.py](../../backend/app/core/middleware.py)) — but those IDs only appear in container logs that nobody tails until something is *already* broken.
- A Next.js frontend that will swallow a server-action exception into a vanilla 500 page — the user sees *"something went wrong"* and the team learns about it only if the user happens to email back.

INF-08 fills two complementary holes:

- **Sentry — application-tier errors.** A single SaaS project (`vitachain-prod`) ingests structured exceptions from both the FastAPI backend and the Next.js frontend, grouped into *Issues*, scrubbed of PII, tagged with `environment`, `release` (= `GIT_SHA`), and the `request_id` minted by `RequestIdMiddleware`. The free tier ships **5K events/month** — far above expected steady-state at 50 MAU, and the §4 sampling tuning keeps us comfortably under even during a load-test spike.
- **Uptime Kuma — infrastructure-tier liveness.** A self-hosted (free, single container, SQLite state) status page that **actively probes** the public URLs every 60 s, charts uptime, and **pushes to a chat webhook** the moment a probe fails. Self-hosted because (a) Sentry doesn't do synthetic uptime, (b) commercial alternatives (Pingdom, Better Uptime) start at $10–15/month — outside the 624 MAD budget, (c) Uptime Kuma's data plane is offline-friendly, so even a Sentry outage doesn't blind us to a Brevo outage.

The two tools answer two different questions:

| Question | Tool | Why |
|---|---|---|
| *"Did a user just see an error?"* | Sentry | Captures the exception with stack + request context + breadcrumbs at the moment it happens |
| *"Is the public site responding right now?"* | Uptime Kuma | Polls from outside the box, so even a wedged event loop that never reaches `sentry-sdk` is caught |
| *"Did `pg_dump` run last night?"* | Healthchecks.io (INF-07) | Cron heartbeat — a *passive* signal, the inverse of Uptime Kuma's *active* polling |

A single tool that did all three would either over-ingest (Sentry billing) or under-detect (Uptime Kuma can't see a stack trace, only a status code). Three tools, three failure modes, one chat channel — that's the design.

> **Why P3, not earlier?** The cost of being able to see errors before there are errors is mostly negative — empty dashboards train operators to ignore the dashboard. Worse: Sentry's *Issue → Assigned* workflow only works when the assignee can actually fix the issue, which means the relevant code path must exist. Shipping Sentry in Week 1 means the first signal it captures is the team's own scaffolding bugs, which fills the Issues list with noise that the team then learns to swipe-dismiss. P3 is the first week where every error is *production-shaped*.

---

## 2. Scope

### In scope

- **Sentry SaaS project** — one project, named `vitachain-prod`. Single DSN distributed in two flavours: a **backend** DSN bound to the FastAPI service (`SENTRY_DSN_BACKEND`) and a **frontend** DSN bound to the Next.js bundle (`NEXT_PUBLIC_SENTRY_DSN`). Two DSNs not because Sentry requires it, but so the AUTH-05 boundary script can keep enforcing *"no `SENTRY_DSN_BACKEND` token in `frontend/`"* with the same grep it uses for service-role keys.
- **`backend/app/core/observability.py`** — a new module that calls `sentry_sdk.init(...)` exactly once at app startup. Behind `if settings.environment != "dev"` so local development never spends event budget on `KeyError` typos. Integrations: `FastApiIntegration`, `StarletteIntegration`, `HttpxIntegration`, `LoggingIntegration` (capture WARNING+ as breadcrumbs, ERROR+ as events). `before_send` hook scrubs `Authorization`, `Cookie`, `SUPABASE_*`, request bodies containing `password`, and replaces `auth.users.email` with `***@***` so a 500 with a SQL parameter doesn't leak the user. `release = settings.git_sha`. `traces_sample_rate = 0.1` (10 % of transactions; tunable). `profiles_sample_rate = 0.0` (profiling costs extra events; opt-in later).
- **`backend/app/main.py`** — one new call, `init_observability(app)`, added between `configure_logging()` and `app.add_middleware(RequestIdMiddleware)`. Sentry's FastAPI integration installs its own middleware that consumes the `X-Request-Id` we already mint and re-tags it on the Sentry event — so the chat link `https://sentry.io/...event/<id>/` opens straight to a request whose logs in Docker share the same `request_id` field.
- **`backend/requirements.in`** — add `sentry-sdk[fastapi]>=2.18,<3.0`. Pinned major because Sentry 3.x will land breaking changes to the unified API.
- **`backend/tests/test_sentry.py`** — three new tests. (a) `before_send` strips `Authorization` headers. (b) `before_send` redacts a `password` field in a JSON body. (c) `init_observability` is a no-op when `environment="dev"` (asserted by mocking `sentry_sdk.init` and checking call count).
- **A test-only error route** — `GET /api/v1/_sentry_test` returns 500 by raising `RuntimeError("INF-08 planted test")`, **only mounted when `settings.environment != "prod"`**. Used by §6 to prove the pipeline is alive end-to-end without depending on a real bug. The DoD §10 includes *"hit this route from staging, see the event in Sentry, then remove the staging URL from the chat thread."*
- **Frontend Sentry integration** — `@sentry/nextjs@^8.x` installed as a `dependencies` entry in [frontend/package.json](../../frontend/package.json). Three new config files generated by `npx @sentry/wizard` and committed *after* a hand-review (the wizard tends to inject telemetry opt-ins we don't want): `frontend/sentry.client.config.ts`, `frontend/sentry.server.config.ts`, `frontend/sentry.edge.config.ts`. Each calls `Sentry.init({...})` with the same `environment` + `release` + sample-rate convention as the backend. Source maps are uploaded at build time **only when** `SENTRY_AUTH_TOKEN` is present (so a developer's local build does not need a Sentry account); the CI job that runs `next build` in production mode owns the token, scoped to one project, with the minimum `project:releases` permission.
- **`frontend/next.config.ts`** — wrapped with `withSentryConfig(...)` from `@sentry/nextjs`. The wrapper adds source-map upload, automatic instrumentation of API routes, and a `Sentry-Trace` header propagation that lets a frontend exception link to the upstream backend transaction in the Sentry UI.
- **A planted frontend error route** — `frontend/src/app/__sentry-test/page.tsx`. A client component with a button that throws on click. Same purpose as the backend's `/_sentry_test` — and same gating: not rendered when `process.env.NODE_ENV === 'production'` *and* `NEXT_PUBLIC_VITACHAIN_ENV !== 'staging'`. Removed from chat threads after the DoD verification.
- **Uptime Kuma service** in [infra/docker-compose.yml](../../infra/docker-compose.yml). Image pinned to `louislam/uptime-kuma:1.23.16` (TODO: swap to `@sha256:…` digest on first deploy, same convention as the certbot pin in INF-06 §5.2 and the db-backup pin in INF-07). A new named volume `uptime_kuma_data` mounted at `/app/data`. Internal port `3001`; **not** published to the host — reached only through NGINX on a path prefix or a subdomain (see §5.5).
- **NGINX vhost extension** in [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf) — a new `location /uptime/ {}` block on the existing `:443` server that proxies to `http://uptime_kuma:3001/`. Path-based, not subdomain-based, because Let's Encrypt is already issuing `vitachain.ma` + `www.vitachain.ma` — adding a `status.vitachain.ma` SAN means re-running INF-06's issuance dance. The path approach uses the existing cert. **Basic-auth gate** on the location block (htpasswd in a named-volume-mounted file, *not* committed) so the admin UI isn't crawlable from the public internet.
- **Uptime Kuma initial config** — documented as a one-shot in §5.6 (the tool's own DB persists it; the runbook captures it so a fresh volume can be re-seeded). Five monitors:
  1. `https://vitachain.ma` — HTTP GET, 60 s interval, expect 200, accept redirects = no.
  2. `https://vitachain.ma/api/v1/healthz` — HTTP GET, 60 s, expect 200 + JSON body contains `"status":"ok"`.
  3. `https://vitachain.ma/api/v1/readyz` — HTTP GET, 60 s, expect 200 (so a degraded Supabase fires a probe failure even though the backend itself is up).
  4. `https://api.brevo.com/v3/account` — HTTP GET with the team's Brevo key as `api-key` header, 5 min interval (Brevo rate-limits aggressive polling), expect 200. Catches QG-06 *"email delivered < 2 min"* regressions at the upstream tier.
  5. `https://qyyxgdfetzjqfpygikbz.supabase.co/rest/v1/` — HTTP GET with the anon key as `apikey` header, 60 s, expect 200. Catches a Supabase-side incident before users notice.
- **Two notification channels** wired into Uptime Kuma — Discord webhook (`ALERT_WEBHOOK_URL`, same one INF-07 §3 already provisions, but a *different* Uptime Kuma "Notification" entry so each channel can be toggled separately if it gets noisy) and Telegram (bot token + chat ID; optional — skip if the team uses Discord-only). Both attached to all five monitors with "Notify when down" + "Notify when back up".
- **`infra/.env.example` additions** — `SENTRY_DSN_BACKEND`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (CI-only — must be empty on the VPS `.env`), `SENTRY_ENVIRONMENT=prod`, `SENTRY_TRACES_SAMPLE_RATE=0.1`, `UPTIME_KUMA_ADMIN_USER`, `UPTIME_KUMA_ADMIN_PASSWORD_HASH` (bcrypt; generated by `htpasswd -nbB` and pasted in — never the plain password), `UPTIME_KUMA_BREVO_API_KEY` (read-only copy of the team Brevo key, scoped via Brevo Dashboard to the *account-info* endpoint only — separate from the backend's send-email key so a Uptime Kuma compromise can't send mail).
- **`backend/app/core/config.py` additions** — `sentry_dsn: SecretStr | None`, `sentry_environment: str = "prod"`, `sentry_traces_sample_rate: float = 0.1`. All optional so dev still boots without Sentry env vars.
- **[infra/scripts/verify.sh](../../infra/scripts/verify.sh) — INF-08 verification section.** New block of ~10 checks (see §5.8): Uptime Kuma container is healthy; `https://vitachain.ma/uptime/` returns the Kuma login page (HTML, *not* 404); the Sentry DSN-shaped string is *not* present in the served frontend bundle (`grep -c "ingest.sentry.io" frontend.js == 1` — the wrapper expects exactly one reference); the backend `/api/v1/_sentry_test` route returns 500 in staging and 404 in prod; the AUTH-05 boundary script does not flag the new env vars; the Discord webhook smoke-test endpoint returns 204; the Telegram `getMe` returns 200 with the bot's username (if `TELEGRAM_BOT_TOKEN` is set).
- **[infra/Makefile](../../infra/Makefile) targets**: `observability-up` (brings up the Uptime Kuma service; idempotent — `docker compose up -d uptime_kuma`); `observability-htpasswd USER=… PASS=…` (one-shot generator that prints the bcrypt hash to stdout for `.env`); `sentry-test-backend` (curls the planted backend route — staging only, refuses on `vitachain.ma`); `sentry-test-frontend` (prints the staging URL for the planted page); `uptime-export` (Kuma's built-in backup endpoint → `infra/backups/uptime_kuma_<date>.json` — the monitor + notification config is recoverable from this even if the volume is lost); `uptime-import` (reads the latest export and POSTs it back through Kuma's import API — the recovery counterpart).
- **[docs/runbook.md](../runbook.md) — INF-08 sections**: first-time Sentry project setup walkthrough; Uptime Kuma initial config script (the five monitors above as a clickable checklist); notification channel setup with paste-shaped Discord + Telegram payloads; the *"alert is firing — what to do"* playbook; the *"alert is too noisy — how to tune"* playbook (per-monitor retry threshold + maintenance windows); Sentry quota-exceeded playbook (kicks in if monthly events approach 5K).
- **`docs/spring-status.yml`** — flip `INF-08.status: TODO → DONE`, increment `summary.done`, decrement `summary.todo`, add a hand-off line under `project.last_updated` mirroring the INF-07 entry.

### Out of scope (later stories / explicit deferrals)

- **APM / distributed tracing beyond Sentry's free tier** — Sentry's Performance product is included in the free 5K events but the per-transaction event count cannot be controlled separately from errors. Aggressive tracing (`traces_sample_rate=1.0`) would burn the monthly budget in a single QG-05 load test. We sample at 0.1; if Phase 3 reveals a perf hotspot Sentry's 10 % sample misses, a paid plan is the path, not a different tool. Deferred to the post-MVD plan conversation.
- **Real-User Monitoring (RUM) browser-side performance metrics** — `@sentry/nextjs` ships RUM by default; we explicitly disable it (`integrations: []` removes the Replay + BrowserTracing integrations) for two reasons: (a) PII surface area (Replay captures DOM, including password fields unless explicitly masked — and the masking config is exactly the kind of thing that goes wrong silently), (b) bundle size (Replay adds ~70 KB gzipped — measurable impact on the QG-01 "frontend initial page load < 3 s on 4G" target). RUM is a Phase 5 story.
- **Log aggregation** (Loki / Grafana / Better Stack Logs) — out of MVD budget; container logs stay on the VPS local disk with the existing rotation (`max-size: 10m`, `max-file: 3`). When a Sentry event needs deeper context, the operator SSHes to the VPS and `docker logs vita_backend --since 5m | grep <request_id>`. Documented as the "grep procedure" in the runbook. Phase 5 story.
- **PagerDuty / Opsgenie-style on-call rotation** — Discord/Telegram is the team's only escalation channel for MVD. A real rota with handoff comes after the MVD demo. PRD §8.5 deliberately lists *"Telegram/Discord alerts"*, not paging.
- **Synthetic transactions / scripted user journeys** — Uptime Kuma probes single endpoints; it does not script *"log in → reach dashboard → click button"*. A scripted-flow probe (Playwright + a cron) is a Phase 5 story; for MVD, the planted-error routes + the QG-08 demo rehearsal are sufficient.
- **Sentry source-map upload for the backend** — Python doesn't have minified source, so the backend release simply tags `release=<git_sha>` and the source is reconstructed from the GitHub repo on click-through. The wizard offers a "stack trace deobfuscation" option for Python that does nothing useful; we skip it.
- **Cloudflare-side health-check fail-over** — would require Cloudflare in front of the VPS, which we don't have for MVD (PRD §8.4 Level 4 — *"when static assets or DDoS become a concern"*). Deferred to post-MVD scale-up.
- **An on-VPS Grafana dashboard for Uptime Kuma metrics** — Kuma exposes a Prometheus `/metrics` endpoint; we don't deploy Prometheus for MVD (memory cost on the 4-vCPU VPS competes with the FastAPI + Next.js workload). The Kuma UI's own charts are sufficient at MVD scale.
- **Auto-deploy on Sentry issue regression** — a "deploy revert if error rate > X" workflow is a continuous-deployment maturity step, not an MVD step. The MVD response to a Sentry regression is a human operator opening the runbook and running `make -C infra rollback` (INF-01 procedure).

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-03](INF-03-nextjs-scaffold-login-dashboard.md) DONE | The `frontend/next.config.ts` wrapper (`withSentryConfig`) and the `frontend/sentry.*.config.ts` files attach to the Next 15 standalone build pipeline. A stale Next 14 scaffold would need the older `@sentry/nextjs@7.x` API. |
| [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) DONE | The `RequestIdMiddleware` + the `/healthz` + `/readyz` probes are the Uptime Kuma targets and the Sentry tag source. The structlog `configure_logging()` already binds `request_id` to the log context — Sentry's `LoggingIntegration` picks that up automatically. |
| Sentry account | Create at [sentry.io](https://sentry.io/welcome/) — sign up with the **team Google account** (`yasseralgoside@gmail.com`), not a personal one. Create **one project** named `vitachain-prod`, platform = *Python / FastAPI* (this controls the default SDK choice in the UI; we wire JS manually). Free *Developer* plan: 5K errors/month + 10K performance events. Copy the DSN that the wizard shows; save it into Bitwarden as *"VitaChain — Sentry DSN (backend)"*. Then create a **second project key** in *Project Settings → Client Keys (DSN)* with name `frontend` — Sentry calls these "DSNs" but they're per-key tokens; this lets the AUTH-05 boundary check distinguish what belongs in the bundle. Save as *"VitaChain — Sentry DSN (frontend)"*. |
| Sentry auth token | *User Settings → Auth Tokens → Create New Token*; scope = `project:releases` + `project:read`, no other scopes. This is the token CI uses to upload source maps — **never** put it on the VPS. Save as *"VitaChain — Sentry CI auth token"* in Bitwarden. |
| Uptime Kuma — nothing to provision externally | Self-hosted; comes up empty on first start, then walked through `https://vitachain.ma/uptime/` (which the operator unlocks with the basic-auth credentials seeded into NGINX). The first user created in the Kuma UI becomes the admin — do that immediately after first `up`, save credentials in Bitwarden as *"VitaChain — Uptime Kuma admin"*. |
| Discord (or Slack) incoming webhook | Same one used in INF-07 §3 — *Server Settings → Integrations → Webhooks → New Webhook*. Re-use `ALERT_WEBHOOK_URL`. INF-08 will add the URL to Uptime Kuma's notification config as a *separate* entry so the team can mute it independently of the backup alerts. |
| Telegram bot (optional) | If the team uses Telegram, create a bot via [@BotFather](https://t.me/BotFather), `/newbot`, save the token. Send any message to the bot, then `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` to harvest the team chat ID. Save both as *"VitaChain — Telegram alert bot"* in Bitwarden. Skip if Discord-only — Uptime Kuma supports either alone. |
| `infra/.env` on the VPS | All values from §5.4 — the file is git-ignored and is the only place the credentials live on disk on the VPS. Permissions must be `0600` and owned by the deploy user (INF-01 bootstrap already enforces this). |
| Sentry's monthly event budget | Free tier = **5,000 errors + 10,000 performance events per month**. At a `traces_sample_rate=0.1` and an estimated 5,000 user requests/day during the demo period, we land at ~500 performance events/day = 15K/month. That **exceeds** the free tier — but only if every request generates a transaction. The §4 sampling row lowers it to 0.05 once the QG-05 load test shows the steady-state shape. Documented as a known knob, not a fix-now. |

---

## 4. Target configuration

| Setting | Value | Source / Rationale |
|---|---|---|
| Backend SDK | `sentry-sdk[fastapi]>=2.18,<3.0` | Sentry's unified Python SDK 2.x is the line that supports Pydantic v2 and the FastAPI 0.115 release we're on. 3.x is unreleased at time of writing. |
| Backend integrations | `FastApiIntegration`, `StarletteIntegration`, `HttpxIntegration`, `LoggingIntegration(level=logging.INFO, event_level=logging.ERROR)` | FastAPI integration captures `Request` context (headers, query, path params) automatically. Httpx integration adds breadcrumbs for outbound calls — Supabase REST, Brevo, OWM, Gemini. Logging integration: INFO+ → breadcrumb, ERROR+ → event. WARNING is *not* an event because the codebase logs WARNING for legit business outcomes (e.g. *"no parcel found for device"*) — those would bury real errors. |
| Sample rates | `traces_sample_rate = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1"))`; `profiles_sample_rate = 0.0` | 10 % sampling on transactions; profiles off entirely. The env-var indirection means we can lower it without redeploying when the load test runs. |
| `before_send` scrubbing | Strip these headers: `Authorization`, `Cookie`, `X-Supabase-Auth`, `apikey`. Strip these JSON body keys: `password`, `current_password`, `new_password`, `service_role_key`, `apiKey`, `api_key`. Replace any string matching `[A-Za-z0-9._-]+@[A-Za-z0-9.-]+` in `extra.email` and `user.email` with `***@***`. Drop the event entirely if `request.url.path == "/api/v1/_sentry_test"` (the planted route) **only when** `environment == "prod"` — we want staging to *see* it. | Defence-in-depth on top of Sentry's own server-side scrubbing. The `*@*` substitution is gentle (preserves "this looked like an email" without leaking which one); a stricter `***` would hide what shape the value had. |
| `release` tag | `settings.git_sha` — populated from the `GIT_SHA` build arg (already wired in [infra/docker-compose.yml:134](../../infra/docker-compose.yml#L134)) | Lets the Sentry UI link an event to a specific deploy. CI's source-map upload uses the same value so frontend stacks deobfuscate against the right release. |
| `environment` tag | `settings.environment` — `"dev"` / `"ci"` / `"prod"` | The Sentry project's UI filters by this tag; on-call rules fire only for `environment=prod`. CI runs *can* send to Sentry but typically don't — they would burn the event budget on test fixtures. |
| Backend init guard | `if settings.environment in ("dev", "ci"): return` from `init_observability()` | The DSN env var being unset *also* guards (the SDK no-ops on an empty DSN) but the explicit guard is the documented contract. Dev = no Sentry; CI = no Sentry; staging + prod = Sentry. |
| Frontend SDK | `@sentry/nextjs@^8.41` | Matches the backend's major-version semantics. Wraps the Next 15 app router + server actions natively. |
| Frontend integrations | Replay: **OFF**. BrowserTracing: **ON** at `tracesSampleRate=0.1`. | RUM Replay is out of scope (§2). BrowserTracing captures route transitions and `fetch`/`XHR` waterfalls — useful for diagnosing a *"why is the dashboard slow"* report. |
| Frontend source maps | Uploaded by `withSentryConfig` at build time. Token = `SENTRY_AUTH_TOKEN` (CI env var only). | Without source maps, a frontend stack trace is `chunk-abc123.js:1` — unreadable. The token must NOT be present in `infra/.env` on the VPS — only in the GitHub Actions CI environment. |
| Uptime Kuma image | `louislam/uptime-kuma:1.23.16` — pinned, TODO swap to `@sha256:…` digest before first prod deploy | Same pinning rationale as `certbot/certbot:v3.0.1` (INF-06 §5.2) and `vitachain/db-backup:1.0` (INF-07 §5.4). The Kuma project has historically had silent SQLite schema bumps between minor versions. |
| Uptime Kuma data | Named volume `uptime_kuma_data` mounted at `/app/data`. Holds SQLite DB with monitors, notification configs, incident history. | Survives `docker compose down`; lost on `down -v`. Uptime Kuma exposes its own backup-export endpoint — the `make uptime-export` target captures it nightly into `infra/backups/`, *not* into B2 (no need — re-creating monitors is a 10-minute operation, not an existential recovery). |
| Uptime Kuma access | Behind NGINX `:443/uptime/` with basic-auth on the location block | A subdomain (`status.vitachain.ma`) would mean re-issuing the LE cert with a new SAN. The path-prefix re-uses the existing cert. Basic-auth gates the admin UI; without it, anyone on the public internet can hit the Kuma login and brute-force it. |
| Uptime Kuma monitors | 5 monitors (see §2 "In scope" item) | Two app-tier (`/`, `/healthz`), one degraded-state (`/readyz`), two upstream-dependency (Brevo, Supabase). Probes from the **same VPS** the app runs on — limitation: doesn't catch a VPS-network-partition incident. An external prober is a Phase 5 add. |
| Notification rule | "Notify when down" + "Notify when back up" — fires after **2 consecutive failures** (= ~2 min on a 60 s monitor) | One failure = noisy (single flaky probe). Two = real. Three would mean a paged user before we know. Two is the standard Uptime Kuma default; we keep it. |
| Sentry rate limiting | Inbound from frontend bound to `replay: 0, errors: 1.0, traces: 0.1` per-event-type | A misbehaving frontend (infinite-loop calling Sentry) is bounded by Sentry's per-DSN ingest limit (configurable in *Project Settings → Inbound Rate Limits*) — set it to 50 events/min during MVD; bump if the QG-05 test legitimately needs more. |

---

## 5. Step-by-Step Implementation

### 5.1 Pre-flight — Sentry project + Uptime Kuma admin password

```bash
# On the developer laptop:
#
# 1. Sentry — create the project (see §3) and copy both DSNs.
#    Backend DSN format:   https://<key>@<host>.ingest.sentry.io/<project_id>
#    Frontend DSN format:  https://<other_key>@<host>.ingest.sentry.io/<project_id>
#    Same project_id, different keys.
#
# 2. Sentry — create the auth token (project:releases + project:read).
#
# 3. Generate the Uptime Kuma admin htpasswd entry for NGINX basic-auth:
htpasswd -nbB admin "$(openssl rand -base64 24)"
# → admin:$2y$05$abc...   ← paste the part AFTER the colon into
#                            UPTIME_KUMA_ADMIN_PASSWORD_HASH in .env;
#                            save the plain password in Bitwarden.

# 4. Generate the Brevo read-only key:
#    Brevo Dashboard → SMTP & API → API Keys → Generate a new API key
#    Name: "vitachain-uptime-kuma-readonly"
#    Permissions: ONLY "Get account info" (account → GET). Nothing else.
#    Save as Bitwarden "VitaChain — Brevo readonly probe key".
```

If the Sentry DSN copy-paste lands a stray newline, the SDK silently fails to init (logs `WARNING: Bad DSN`). The §5.7 verify check greps for the exact prefix `https://` and the suffix `.ingest.sentry.io/<digits>` to catch this.

### 5.2 Backend — Sentry init module

**New file** — [backend/app/core/observability.py](../../backend/app/core/observability.py):

```python
"""INF-08 — Sentry init.

Idempotent: called once from app.main:create_app(). No-ops in dev/ci so a
developer's KeyError doesn't burn the team's monthly event budget.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import sentry_sdk
from fastapi import FastAPI
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.httpx import HttpxIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from app.core.config import get_settings

_EMAIL_RE = re.compile(r"[A-Za-z0-9._-]+@[A-Za-z0-9.-]+")
_SENSITIVE_HEADERS = frozenset(
    {"authorization", "cookie", "x-supabase-auth", "apikey", "x-api-key"}
)
_SENSITIVE_BODY_KEYS = frozenset(
    {
        "password",
        "current_password",
        "new_password",
        "service_role_key",
        "apikey",
        "api_key",
        "device_api_key",  # KAT-03 — never log this in clear
    }
)


def _scrub(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any] | None:
    """before_send hook — drop secrets before they leave the process."""
    request = event.get("request") or {}

    # 1. Drop the planted test route entirely in prod (we still want it in staging).
    if request.get("url", "").endswith("/api/v1/_sentry_test"):
        if get_settings().environment == "prod":
            return None

    # 2. Strip sensitive headers.
    headers = request.get("headers") or {}
    for k in list(headers.keys()):
        if k.lower() in _SENSITIVE_HEADERS:
            headers[k] = "[scrubbed]"

    # 3. Strip sensitive JSON body keys.
    data = request.get("data")
    if isinstance(data, dict):
        for k in list(data.keys()):
            if k.lower() in _SENSITIVE_BODY_KEYS:
                data[k] = "[scrubbed]"

    # 4. Mask email addresses in user.email + extra.*.
    user = event.get("user") or {}
    if email := user.get("email"):
        user["email"] = _EMAIL_RE.sub("***@***", email)
    extra = event.get("extra") or {}
    for k, v in list(extra.items()):
        if isinstance(v, str):
            extra[k] = _EMAIL_RE.sub("***@***", v)

    return event


def init_observability(_app: FastAPI) -> None:
    """Wire Sentry into the FastAPI app. No-op in dev/ci."""
    s = get_settings()
    if s.environment in ("dev", "ci"):
        return
    if not s.sentry_dsn:
        return

    sentry_sdk.init(
        dsn=s.sentry_dsn.get_secret_value(),
        environment=s.sentry_environment,
        release=s.git_sha,
        traces_sample_rate=s.sentry_traces_sample_rate,
        profiles_sample_rate=0.0,
        send_default_pii=False,  # we'll opt in per-event via set_user()
        before_send=_scrub,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
            HttpxIntegration(),
            LoggingIntegration(
                level=logging.INFO,         # captured as breadcrumbs
                event_level=logging.ERROR,  # captured as events
            ),
        ],
    )
```

### 5.3 Backend — wire it in `app/main.py`

**Patch** — [backend/app/main.py](../../backend/app/main.py):

```python
# Add to imports (alphabetical):
from app.core.observability import init_observability

# Inside create_app(), AFTER configure_logging() and BEFORE app.add_middleware(...):
    init_observability(app)
```

And the planted error route — only mounted out of prod:

```python
# Inside create_app(), AFTER include_router(...) lines:
    if s.environment != "prod":
        @app.get("/api/v1/_sentry_test", tags=["_internal"])
        async def _sentry_test() -> dict[str, str]:
            raise RuntimeError("INF-08 planted test — if you see this in Sentry, the pipeline is wired.")
```

### 5.4 Backend — config + requirements

**Patch** — [backend/app/core/config.py](../../backend/app/core/config.py), inside class `Settings`:

```python
    # --- observability (INF-08) ----------------------------------------------
    sentry_dsn: SecretStr | None = None
    sentry_environment: str = "prod"
    sentry_traces_sample_rate: float = 0.1
```

**Patch** — [backend/requirements.in](../../backend/requirements.in):

```
sentry-sdk[fastapi]>=2.18,<3.0
```

Then `make -C backend lock` to regenerate `requirements.txt`.

### 5.5 Frontend — Sentry config + planted page

```bash
cd frontend
npm install --save @sentry/nextjs@^8.41
# Skip the wizard's auto-edit — paste the configs manually so we own what lands:
```

**New file** — [frontend/sentry.client.config.ts](../../frontend/sentry.client.config.ts):

```typescript
// INF-08 — Sentry browser-side init. Runs in the user's browser.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const env = process.env.NEXT_PUBLIC_VITACHAIN_ENV ?? "dev";

if (dsn && env !== "dev") {
  Sentry.init({
    dsn,
    environment: env,
    release: process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown",
    tracesSampleRate: 0.1,
    // RUM Replay is out of scope per INF-08 §2.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: [Sentry.browserTracingIntegration()],
  });
}
```

**New file** — [frontend/sentry.server.config.ts](../../frontend/sentry.server.config.ts) — same shape, runs in the Node runtime for SSR + server actions.

**New file** — [frontend/sentry.edge.config.ts](../../frontend/sentry.edge.config.ts) — same shape, runs in the Edge runtime for middleware.

**Patch** — [frontend/next.config.ts](../../frontend/next.config.ts):

```typescript
import { withSentryConfig } from "@sentry/nextjs";
// ... existing config ...
export default withSentryConfig(nextConfig, {
  org: "vitachain",
  project: "vitachain-prod",
  silent: !process.env.CI,
  // Source maps uploaded only when the auth token is present.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Hide source maps from the public client bundle after upload.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // Telemetry the wizard adds by default — explicit off.
  telemetry: false,
});
```

**New file** — [frontend/src/app/__sentry-test/page.tsx](../../frontend/src/app/__sentry-test/page.tsx):

```tsx
// INF-08 — planted error page. Gated by NEXT_PUBLIC_VITACHAIN_ENV != prod.
"use client";

import { notFound } from "next/navigation";

export default function SentryTestPage() {
  if (process.env.NEXT_PUBLIC_VITACHAIN_ENV === "prod") notFound();
  return (
    <main className="p-8">
      <h1>INF-08 — Sentry planted error page</h1>
      <button
        className="border px-4 py-2"
        onClick={() => {
          throw new Error("INF-08 planted frontend test — if you see this in Sentry, the pipeline is wired.");
        }}
      >
        Throw
      </button>
    </main>
  );
}
```

### 5.6 Compose patch — add the Uptime Kuma service

**Patch** — [infra/docker-compose.yml](../../infra/docker-compose.yml), append to `services:`:

```yaml
  # ---------------------------------------------------------------------------
  # INF-08 — Uptime Kuma. Self-hosted active uptime probes + chat alerting.
  # Reached only through NGINX at https://vitachain.ma/uptime/ (basic-auth on
  # the NGINX location block). The container does NOT publish a host port.
  # ---------------------------------------------------------------------------
  uptime_kuma:
    image: louislam/uptime-kuma:1.23.16   # TODO(INF-08): pin sha256 after first prod
    container_name: vita_uptime_kuma
    restart: unless-stopped
    volumes:
      - uptime_kuma_data:/app/data
    networks:
      - vita_net
    expose:
      - "3001"   # Only NGINX may reach this; never published to host.
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3001"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 60s
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "2"
```

And the top-level `volumes:` block:

```yaml
volumes:
  letsencrypt_etc:
  letsencrypt_www:
  db_backups:
  rclone_config:
  uptime_kuma_data:   # INF-08 — Kuma SQLite + monitor/notification config
```

### 5.7 NGINX — `/uptime/` location with basic-auth

**Patch** — [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf), inside the existing `:443 server` block, *before* the `location / {}` catch-all:

```nginx
    # INF-08 — Uptime Kuma admin UI. Basic-auth gated.
    # The htpasswd file is generated by `make -C infra observability-htpasswd`
    # and mounted from a named volume; never committed.
    location /uptime/ {
        auth_basic           "VitaChain Uptime";
        auth_basic_user_file /etc/nginx/htpasswd/uptime.htpasswd;

        proxy_pass         http://uptime_kuma:3001/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # Kuma uses WebSockets for the live charts on the dashboard.
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 86400;
    }
```

And mount the htpasswd file by extending the existing `nginx` service `volumes:` in [infra/docker-compose.yml](../../infra/docker-compose.yml):

```yaml
      - nginx_htpasswd:/etc/nginx/htpasswd:ro
```

…and add `nginx_htpasswd:` to the top-level `volumes:` block. The first-time setup script (§5.10) seeds it.

### 5.8 verify.sh — INF-08 verification block

**Patch** — [infra/scripts/verify.sh](../../infra/scripts/verify.sh), append a new section:

```bash
# --- INF-08 verification (observability) -----------------------------------
echo "INF-08 — Sentry + Uptime Kuma checks"

# Uptime Kuma container healthy
check "uptime_kuma running" \
    'docker compose ps uptime_kuma --format json | jq -e ".State==\"running\""'

# Kuma reachable behind NGINX (login page returns HTML, not 404).
# We don't unlock basic-auth here — a 401 still proves the path is wired.
check "https://$VPS_HOST/uptime/ proxied" \
    'curl -fsS -o /dev/null -w "%{http_code}" "https://$VPS_HOST/uptime/" | grep -qE "^(200|301|302|401)$"'

# Sentry DSN reference present in the served frontend bundle (proves
# withSentryConfig wrapped the build) — expect EXACTLY one match in the
# main chunk; >1 means a duplicate init, 0 means the wrapper didn't fire.
check "Sentry DSN baked into bundle" \
    'curl -fsS "https://$VPS_HOST/_next/static/chunks/main-*.js" 2>/dev/null \
        | grep -c "ingest.sentry.io" \
        | grep -qE "^[1-9][0-9]*$"'

# AUTH-05 boundary script still passes — we just added env vars that look
# DSN-ish, so re-run the boundary to make sure none leaked the wrong side.
check "AUTH-05 boundary clean" \
    'bash scripts/check-secrets-boundary.sh'

# Planted backend route — 500 in staging, 404 in prod.
if [ "${SENTRY_ENVIRONMENT:-prod}" = "staging" ]; then
    check "/api/v1/_sentry_test returns 500 in staging" \
        '[ "$(curl -fsS -o /dev/null -w "%{http_code}" "https://$VPS_HOST/api/v1/_sentry_test")" = "500" ]'
else
    check "/api/v1/_sentry_test returns 404 in prod" \
        '[ "$(curl -fsS -o /dev/null -w "%{http_code}" "https://$VPS_HOST/api/v1/_sentry_test")" = "404" ]'
fi

# Discord webhook reachable (best-effort; skipped if unset)
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    check "Discord webhook reachable" \
        'curl -fsS -o /dev/null -w "%{http_code}" -X POST "$ALERT_WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{\"content\":\"INF-08 verify smoke — ignore\"}" \
        | grep -qE "^(204|200)$"'
fi
```

### 5.9 Makefile targets

**Patch** — [infra/Makefile](../../infra/Makefile):

```makefile
# --- INF-08 — Observability ------------------------------------------------
.PHONY: observability-up observability-htpasswd sentry-test-backend uptime-export uptime-import

observability-up:  ## Bring up the Uptime Kuma container (idempotent).
	docker compose up -d uptime_kuma

observability-htpasswd:  ## Generate a bcrypt htpasswd line. USER=... PASS=...
	@test -n "$(USER)" || (echo "USER= required"; exit 1)
	@test -n "$(PASS)" || (echo "PASS= required"; exit 1)
	@htpasswd -nbB "$(USER)" "$(PASS)"

sentry-test-backend:  ## Curl the planted backend route (staging only).
	@case "$$VPS_HOST" in vitachain.ma|www.vitachain.ma) \
		echo "Refusing — looks like prod"; exit 1 ;; esac
	curl -sS -o /dev/null -w "%{http_code}\n" "https://$$VPS_HOST/api/v1/_sentry_test"

uptime-export:  ## Export Kuma config to infra/backups/.
	@mkdir -p backups
	docker compose exec -T uptime_kuma sh -c \
	  'curl -fsS http://127.0.0.1:3001/api/backup' \
	  > backups/uptime_kuma_$$(date -u +%Y%m%d_%H%M%SZ).json
	@ls -lh backups/uptime_kuma_*.json | tail -3

uptime-import:  ## Re-import the newest export (recovery — confirms before POST).
	@latest=$$(ls -t backups/uptime_kuma_*.json | head -1); \
	echo "Importing $$latest — type YES to confirm:"; read confirm; \
	[ "$$confirm" = "YES" ] || (echo "aborted"; exit 1); \
	docker compose exec -T uptime_kuma sh -c \
	  "curl -fsS -X POST http://127.0.0.1:3001/api/restore -H 'Content-Type: application/json' --data @-" \
	  < "$$latest"
```

### 5.10 First-time deployment sequence

```bash
# On the developer laptop, against a VPS where INF-01..07 are DONE:

# 1. Pre-flight — Sentry project ready, both DSNs in Bitwarden,
#    htpasswd hash generated, Brevo readonly key generated.

# 2. Fill infra/.env on the VPS with the new keys (§5.4).

# 3. Deploy — rsyncs new files; brings up the new uptime_kuma service.
make -C infra deploy

# 4. ONE-SHOT — seed the NGINX htpasswd file inside the named volume.
HASH="$2y$05$abc..."   # from `make observability-htpasswd USER=admin PASS=...`
docker compose run --rm --entrypoint sh nginx -c \
    "mkdir -p /etc/nginx/htpasswd && echo 'admin:$HASH' > /etc/nginx/htpasswd/uptime.htpasswd"
docker compose exec nginx nginx -s reload

# 5. Visit https://vitachain.ma/uptime/ — log in with the htpasswd creds,
#    then walk the first-user setup. Save those new creds in Bitwarden
#    as "VitaChain — Uptime Kuma admin".

# 6. Configure the 5 monitors per §2 (or import a seed export — see runbook).

# 7. Configure the 2 notification channels (Discord + optional Telegram)
#    and attach them to all 5 monitors with "Notify when down" + "Notify when back up".

# 8. Verify all INF-08 checks pass.
make -C infra verify

# 9. Force a Sentry event end-to-end — staging env:
make sentry-test-backend                # expect 500
# Open Sentry → Issues — event "INF-08 planted test" should appear within 60s.
#
# Then frontend:
# Open https://staging.vitachain.ma/__sentry-test  → click "Throw"
# Same Issues page — second event appears.

# 10. Force an alert — stop the backend container, wait 2 polling cycles
#     (~2 min on default 60s interval), confirm a Discord/Telegram message:
docker compose stop backend
# … wait …
docker compose start backend
# Recovery message should follow within 1 cycle.

# 11. Pin the Kuma image by digest in docker-compose.yml.

# 12. Flip docs/spring-status.yml — INF-08 → DONE; summary.done += 1.
```

### 5.11 Runbook entries

**New sections in [docs/runbook.md](../runbook.md):**

```markdown
## INF-08 — First-time observability setup
1. Sentry project + DSNs + auth token  (§3)
2. Backend env vars in infra/.env  (§5.4)
3. Frontend Sentry config files committed  (§5.5)
4. `make -C infra deploy`
5. Seed NGINX htpasswd  (§5.10 step 4)
6. Walk Kuma first-user setup at /uptime/
7. Add the 5 monitors  (table below)
8. Add 2 notification channels + attach to all monitors
9. Verify with `make -C infra verify`
10. Plant a test event from each tier

## INF-08 — Five-monitor table (copy this into Kuma)
| Name | Type | URL | Interval | Expected |
|---|---|---|---|---|
| Site root | HTTP | https://vitachain.ma | 60s | 200 |
| Backend healthz | HTTP | https://vitachain.ma/api/v1/healthz | 60s | 200 + JSON contains "status":"ok" |
| Backend readyz | HTTP | https://vitachain.ma/api/v1/readyz | 60s | 200 |
| Brevo upstream | HTTP | https://api.brevo.com/v3/account (header api-key: $BREVO_RO) | 5m | 200 |
| Supabase upstream | HTTP | https://qyyxgdfetzjqfpygikbz.supabase.co/rest/v1/ (header apikey: $SUPABASE_ANON) | 60s | 200 |

## INF-08 — Alert is firing — what to do
1. Open the linked Sentry issue OR the Kuma monitor page.
2. SSH to the VPS; tail the affected container:
       docker logs vita_backend --tail 200 | grep <request_id>
3. If real: open an issue; assign in Sentry; deploy fix or rollback (`make -C infra rollback`).
4. If false positive: lower noise per the next runbook entry.

## INF-08 — Alert is too noisy — how to tune
- Bump "Retries" on the Kuma monitor from 2 → 3 (60s × 3 = 3 min to alert).
- Add a "Maintenance" window in Kuma during the demo rehearsal (`Settings → Maintenance`).
- In Sentry: open the noisy issue → "Ignore" → "Until it happens again N times".
- Bump `SENTRY_TRACES_SAMPLE_RATE` from 0.1 → 0.05 if the monthly performance budget is at risk.

## INF-08 — Sentry monthly quota exceeded
- Sentry will silently drop events past the 5K threshold.
- Mitigation: lower `traces_sample_rate` to 0.0 for the remainder of the month
  (the env var is read on container restart; `docker compose up -d backend` applies it).
- Upgrade conversation: $26/month Team plan = 50K events; tracked as a post-MVD decision.
```

### 5.12 spring-status.yml update

**Patch** — [docs/spring-status.yml](../spring-status.yml):

- `INF-08.status: TODO → DONE`
- `summary.done: 3 → 4`
- `summary.todo: 55 → 54`
- Append under `project.last_updated`:
  ```yaml
  # YYYY-MM-DD — INF-08 DONE: Sentry SDKs (backend sentry-sdk[fastapi] 2.18, frontend
  # @sentry/nextjs 8.41) initialised with PII-scrubbing before_send + 0.1 traces sample;
  # planted test events verified on both tiers. Uptime Kuma 1.23.16 behind NGINX
  # /uptime/ (basic-auth), 5 monitors green, 2 chat notifications wired; forced-down
  # drill produced Discord alert + recovery message. AUTH-05 boundary clean for the
  # two-DSN split.
  ```

---

## 6. Verification Checklist

### Local (developer laptop, before deploy)
- [ ] `make -C backend lint` clean (no ruff regression from the new `observability.py`)
- [ ] `make -C backend test` — 3 new tests in `tests/test_sentry.py` pass: `before_send` strips Authorization, `before_send` redacts `password`, `init_observability` no-ops in `dev`
- [ ] `frontend && npm run typecheck` clean (the three `sentry.*.config.ts` files type-check)
- [ ] `frontend && npm run build` succeeds **without** `SENTRY_AUTH_TOKEN` (proves source-map upload is optional, not required)
- [ ] `scripts/check-secrets-boundary.sh` clean — no `SENTRY_DSN_BACKEND` referenced from `frontend/`, no `SENTRY_AUTH_TOKEN` referenced from VPS .env templates
- [ ] `docker compose build uptime_kuma` succeeds against the pinned tag

### On the VPS — happy path
- [ ] `make -C infra deploy` completes; `docker compose ps` shows `vita_uptime_kuma` healthy
- [ ] `curl -I https://vitachain.ma/uptime/` returns `401 Unauthorized` (basic-auth working) or `200` (after auth)
- [ ] `make -C infra verify` INF-08 block: all checks green
- [ ] The 5 monitors are all green in the Kuma UI within 5 minutes of first launch

### Planted-event drill — proves Sentry is wired end-to-end
- [ ] `make sentry-test-backend` from staging returns 500 — within 60 s, an Issue titled *"RuntimeError: INF-08 planted test"* appears in Sentry with `environment=staging`, `release=<staging git_sha>`, and a non-empty `request_id` tag
- [ ] `https://staging.vitachain.ma/__sentry-test` → click button → second Issue appears with `environment=staging`, frontend stack frames **deobfuscated** (proves source-map upload worked)
- [ ] Same backend curl against `https://vitachain.ma/api/v1/_sentry_test` returns 404 (prod-gated) — no Sentry event
- [ ] Same frontend page on `https://vitachain.ma/__sentry-test` renders Next 404 — no Sentry event

### Forced-down drill — proves Uptime Kuma alerts reach chat
- [ ] `docker compose stop backend`; within 2 polling cycles (~2 min), Discord/Telegram receives a "Backend healthz — DOWN" message
- [ ] `docker compose start backend`; within 1 cycle, the chat receives the "back up" message
- [ ] Kuma's incident list shows the outage with start + end timestamps within 5 s of the docker stop/start

### Negative — the gates actually block
- [ ] Unset `NEXT_PUBLIC_SENTRY_DSN` in `.env`, rebuild frontend → built bundle does NOT contain `ingest.sentry.io` (verify check reports 0 matches → fails — re-set and re-verify; documents that the gate is real)
- [ ] Set `environment=dev` on the backend; restart; trigger `/api/v1/_sentry_test` → returns 500 but NO event in Sentry (init was no-op'd)
- [ ] Visit `https://vitachain.ma/uptime/` without basic-auth → returns 401 (admin UI is gated)

---

## 7. Deliverables

| Artefact | Path |
|---|---|
| Backend Sentry init module | [backend/app/core/observability.py](../../backend/app/core/observability.py) |
| Backend app wiring | [backend/app/main.py](../../backend/app/main.py) (3 new lines) |
| Backend config additions | [backend/app/core/config.py](../../backend/app/core/config.py) (3 new fields) |
| Backend deps | [backend/requirements.in](../../backend/requirements.in) (`sentry-sdk[fastapi]`) |
| Backend tests | [backend/tests/test_sentry.py](../../backend/tests/test_sentry.py) |
| Frontend Sentry configs | `frontend/sentry.{client,server,edge}.config.ts` |
| Frontend Next config wrapper | [frontend/next.config.ts](../../frontend/next.config.ts) (`withSentryConfig`) |
| Frontend planted page | [frontend/src/app/__sentry-test/page.tsx](../../frontend/src/app/__sentry-test/page.tsx) |
| Frontend deps | [frontend/package.json](../../frontend/package.json) (`@sentry/nextjs`) |
| Uptime Kuma service | [infra/docker-compose.yml](../../infra/docker-compose.yml) (`uptime_kuma` + named volumes) |
| NGINX `/uptime/` location | [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf) |
| Env contract | [infra/.env.example](../../infra/.env.example) (7 new keys) |
| Verify checks | [infra/scripts/verify.sh](../../infra/scripts/verify.sh) (INF-08 block, ~10 checks) |
| Makefile targets | [infra/Makefile](../../infra/Makefile) (6 new targets) |
| Runbook | [docs/runbook.md](../runbook.md) (5 new sections) |
| Sprint status | [docs/spring-status.yml](../spring-status.yml) (INF-08 → DONE) |

---

## 8. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Sentry monthly quota exhausted mid-demo** — a regression loops on errors, ingests 5K events in an hour | Medium | High (next event drops silently) | `traces_sample_rate` env-controlled; per-DSN inbound rate limit set to 50 events/min in Sentry UI; runbook "quota exceeded" playbook |
| **PII leak to Sentry** — a future code path logs an email/password before scrubbing applies | Medium | High (compliance) | `before_send` is layer 1; Sentry's project-level *"Inbound Filters → Data Scrubbing"* is layer 2 (toggle on); periodic Sentry "Discover" query for `email:*@*` to detect leakage; AUTH-05 boundary script enforces backend-only DSN |
| **Uptime Kuma's SQLite volume corrupts** | Low | Low (5-min reseed from `make uptime-export` output) | Nightly `make uptime-export` into `infra/backups/`; the export is the recoverable source of truth; the volume itself is a cache |
| **Self-hosted Kuma can't see a VPS network partition** — it's on the same box | Medium | Medium (silent outage to outside users) | Documented in §2 out-of-scope; Phase 5 adds an external prober (Healthchecks.io has free probes; UptimeRobot 50 free monitors) |
| **NGINX basic-auth weakens to brute force** | Low | Medium (Kuma admin UI compromised → fake "all green" during real outage) | bcrypt cost factor 12 via `htpasswd -B`; admin password generated from `openssl rand -base64 24`; AUTH-08 rate-limit on `/uptime/` location (lifts directly from the existing `:443` rate-limit zone) |
| **Source-map leak via Sentry** — uploading source maps to Sentry means Sentry can in principle reconstruct the codebase | Low | Low (codebase is not secret in MVD scope) | `deleteSourcemapsAfterUpload: true` keeps them off the served bundle; Sentry's access is gated by the team's account 2FA; documented for the post-MVD security-review pass |
| **Brevo readonly probe key leaks** | Low | Low | Key is scoped in Brevo to *account info* only; cannot send mail; cannot read message logs; rotation is cheap |
| **Notification channel goes silent** (webhook rotated, channel deleted) | Medium | High (alerts vanish unnoticed) | Kuma's *Settings → "Test notification"* clicked weekly during the rehearsal; the §5.7 verify check posts a smoke message to the webhook on every `make verify` |

---

## 9. Time Estimate

| Phase | Effort |
|---|---|
| Sentry SaaS account + projects + DSNs + auth token | 30 min |
| Backend SDK init + scrubbing + tests | 2 h |
| Frontend SDK wiring + planted page + source-map config | 2 h |
| Uptime Kuma compose service + NGINX path + htpasswd | 1.5 h |
| 5 monitors + 2 notification channels (one-shot via UI) | 1 h |
| verify.sh + Makefile targets | 1 h |
| Runbook 5 sections | 1.5 h |
| End-to-end drill (planted events + forced-down) | 1 h |
| **Total** | **~10–11 h** (≈ 1.5 dev-days) |

The big variable is the Sentry SDK's `before_send` review — getting the scrubbing right against a real event payload (not the doc examples) eats time. Budget 2 hours for that even if it usually finishes in 30 minutes.

---

## 10. Definition of Done

INF-08 flips to DONE when **all** of the following are true:

- [ ] **Sentry tier:** A planted backend exception (`/api/v1/_sentry_test`) and a planted frontend exception (`/__sentry-test`) each produce a single Sentry Issue with correct `environment`, `release`, and `request_id` tags within 60 s of trigger. Backend stack frames link to GitHub source; frontend stack frames are deobfuscated.
- [ ] **PII scrubbing tier:** A staged request to `POST /api/v1/_sentry_test` with `Authorization: Bearer foo` and JSON body `{"password":"bar"}` produces an event where neither value appears — both rendered as `[scrubbed]` in the Sentry UI.
- [ ] **Uptime Kuma tier:** Five monitors are configured, all reporting green for ≥ 30 minutes of continuous polling. A forced `docker compose stop backend` produces a chat alert within 2 polling cycles; the subsequent `start` produces a recovery alert within 1 cycle.
- [ ] **Production-gate tier:** `/api/v1/_sentry_test` returns 404 against `https://vitachain.ma` (not staging); `/__sentry-test` renders Next 404 against the same; the `_sentry_test` path filter in `before_send` drops the event if production accidentally hits it.
- [ ] **Verify tier:** `make -C infra verify` INF-08 block is green from a real VPS post-INF-01/06.
- [ ] **AUTH-05 boundary tier:** `scripts/check-secrets-boundary.sh` passes against the merged tree — no backend DSN in `frontend/`, no `SENTRY_AUTH_TOKEN` in the VPS `.env.example`.
- [ ] **Runbook tier:** The five new sections are committed; the operator can follow the *"alert is firing"* playbook from the runbook alone (no need to re-read this story).
- [ ] **Sprint-status tier:** `docs/spring-status.yml` flipped; the hand-off line is appended under `project.last_updated`.

The remaining bar — *"a real user-facing error has been triaged through the Sentry → chat → fix loop"* — is the AUTH-07 / QG-04 / QG-05 stories' bar, not this one. INF-08 ships the channel; the downstream stories ship the practice.

---

## 11. Hand-off — (to be filled on completion)

### 11.1 What landed
*(commit hashes + dates)*

### 11.2 Verification evidence
- Sentry Issue links for both planted events
- Screenshot of Kuma dashboard with 5 green monitors
- Discord/Telegram message thread showing the forced-down + recovery alerts
- `make -C infra verify` INF-08 block output

### 11.3 What's *not* covered (and why that's fine for DoD)
- Sentry Performance >10 % sampling — sampling tunable, paid plan if needed (§8)
- RUM Replay — explicitly out of scope (§2)
- External-network prober — Phase 5 (§2 out-of-scope)
- Log aggregation — Phase 5 (§2 out-of-scope)

### 11.4 Stories now unblocked
- [AUTH-07](#) — RLS audit can rely on Sentry to catch the 500s a malformed RLS policy produces
- [QG-04 / QG-05](#) — load tests now have an error-rate signal source
- [QG-06](#) — Brevo upstream monitor catches the email-delivery regression class
- [QG-07](#) — Uptime Kuma is the demo-day evidence of zero downtime
- The post-MVD on-call rota — Sentry's Issue assignment is the ticket source

### 11.5 Known follow-ups (not part of INF-08)
- Pin Uptime Kuma image by `sha256:…` digest (TODO marker in docker-compose.yml)
- Set up nightly `make uptime-export` cron (mirrors INF-07's pattern; a 5-line cron addition)
- Re-evaluate `SENTRY_TRACES_SAMPLE_RATE` after the QG-05 100 req/s load test — lower to 0.05 if the monthly performance budget breaches 7K
- Document the Sentry → paid-plan upgrade path in the post-MVD plan
- Add an external-network prober (Healthchecks.io 60-second simple HTTP check on the same five URLs) as a belt-and-braces redundancy — 30-minute add, deferred to Phase 5

### 11.6 Operator runbook (when this story is being executed)
```
# On the developer laptop, against a VPS where INF-01..07 are DONE:

# 1. Pre-flight (§5.1)
#    Sentry project + 2 DSNs + auth token in Bitwarden
#    htpasswd hash generated for /uptime/ basic-auth
#    Brevo readonly probe key generated

# 2. Edit infra/.env with the 7 new keys (§5.4)

# 3. Implement and commit:
#    backend/app/core/observability.py
#    backend/app/main.py wiring + planted route
#    backend/app/core/config.py 3 new fields
#    backend/requirements.in + make lock
#    backend/tests/test_sentry.py
#    frontend/sentry.{client,server,edge}.config.ts
#    frontend/next.config.ts withSentryConfig wrapper
#    frontend/src/app/__sentry-test/page.tsx
#    frontend/package.json (npm install @sentry/nextjs)
#    infra/docker-compose.yml (uptime_kuma + nginx_htpasswd volume + uptime_kuma_data volume)
#    infra/nginx/conf.d/default.conf (/uptime/ location)
#    infra/.env.example (7 new keys)
#    infra/scripts/verify.sh (INF-08 block)
#    infra/Makefile (6 new targets)
#    docs/runbook.md (5 new sections)

# 4. Deploy
make -C infra deploy

# 5. One-shot — seed the NGINX htpasswd file inside the named volume
#    (see §5.10 step 4)

# 6. Open https://vitachain.ma/uptime/ — walk Kuma first-user setup;
#    add the 5 monitors (table in §5.11);
#    add 2 notification channels; attach to all 5 monitors.

# 7. Pin Kuma image by sha256 digest in docker-compose.yml; redeploy.

# 8. Drill — backend planted event
make sentry-test-backend
#    → Sentry Issue appears within 60s

# 9. Drill — frontend planted event
#    Open https://staging.vitachain.ma/__sentry-test → click Throw
#    → Sentry Issue appears within 60s; stack deobfuscated

# 10. Drill — forced-down
docker compose stop backend
#    … wait 2 cycles (~2 min) …
#    → Discord/Telegram receives DOWN alert
docker compose start backend
#    → Discord/Telegram receives UP alert

# 11. make -C infra verify  → INF-08 block all green

# 12. Flip docs/spring-status.yml — INF-08 → DONE; summary.done += 1.
```
