# VitaChain — Epic 2 (Katara) Completion Guide

> **Scope:** Everything needed to flip all 14 KAT stories from `TODO → DONE` and have the
> full smart-irrigation pipeline running end-to-end on staging.
>
> **Audience:** Developer picking this up fresh, or yourself returning after a break.
> Read top to bottom the first time; use section headers as a jump map after that.

---

## Status snapshot (as of 2026-05-18)

| Story | Code | DB | Workers | Frontend | Missing to flip DONE |
|---|---|---|---|---|---|
| KAT-01 Parcel registry | ✅ | ✅ 0016 | — | ✅ | Staging migration + e2e smoke |
| KAT-02 Device pairing | ✅ | ✅ 0017 | — | ✅ | Staging migration + e2e smoke |
| KAT-03 Telemetry ingest | ✅ | ✅ 0018-0019 | — | — | Staging Locust run (§ step 8) |
| KAT-04 Charts | ✅ | ✅ 0020 | — | ✅ | Staging migration + e2e smoke |
| KAT-05 Thresholds UI | ✅ | ✅ 0021 | — | ✅ | Staging migration + e2e smoke |
| KAT-06 Threshold alerts | ✅ | — | ✅ | — | Brevo key + templates (§ 2) |
| KAT-07 Diagnostic request | ✅ | ✅ 0022 | — | ✅ | Staging migration + e2e smoke |
| KAT-08 AI diagnostic worker | ✅ | ✅ 0023 | ✅ | — | OWM + Sentinel + Gemini keys (§ 3–5) |
| KAT-09 Diagnostic email | ✅ | ✅ 0024 | ✅ | — | Brevo key + templates (§ 2) |
| KAT-10 Polling UI | ✅ | — | — | ✅ | KAT-08 DONE first |
| KAT-11 Offline detection | ✅ | ✅ 0025 | ✅ | — | Brevo key + templates (§ 2) |
| KAT-12 Unlink/relink | ✅ | ✅ 0026 | — | ✅ | Staging migration + e2e smoke |
| KAT-13 History after unlink | ✅ | ✅ 0027 | — | — | Staging migration + pgTAP |
| KAT-14 Multi-parcel overview | ✅ | ✅ 0028 | — | ✅ | Staging migration + e2e smoke |

**Short answer:** all code is written. The only blockers are:
1. External API credentials wired into `.env` files.
2. All 28 migrations applied to the Supabase project.
3. Three staging validation runs (Locust, pgTAP, e2e).

---

## 1. Prerequisites checklist

Before touching any API, confirm these already work:

```
make -C db verify              # migrations 0001-0028 applied, RLS enabled, JWT hook live
make auth07                    # 22-cell role matrix green (or SKIP — never red)
make -C backend test           # all unit tests green
make -C frontend build         # Next.js standalone build succeeds
```

If any of the above are red, fix those first — they are the foundation the API wiring sits on.

---

## 2. Brevo — Transactional email (KAT-06 / KAT-09 / KAT-11 / NOT-01)

Brevo sends every alert and diagnostic email the system produces. One account covers all stories.

### 2.1 Create a free Brevo account

1. Go to **app.brevo.com** → Sign up with `ops@vitachain.ma` (or your team email).
2. Verify your sender domain `vitachain.ma`:
   - Brevo dashboard → **Senders & IP** → **Domains** → Add domain → follow the DNS TXT record instructions.
   - This is required before any transactional email will actually deliver.
3. Verify the sender address `no-reply@vitachain.ma` under **Senders & IP** → **Senders**.

### 2.2 Get the transactional API key

Brevo dashboard → top-right avatar → **SMTP & API** → **API Keys** tab → **Generate a new API key**.

- Name it `vitachain-backend`.
- Copy the key — it is shown only once.
- Paste it into both env files:

```dotenv
# root .env  AND  infra/.env
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-XXXXXXXX
```

### 2.3 Create a read-only probe key (for Uptime Kuma)

Same page → generate a second key named `vitachain-kuma-probe`.  
In **API Key Permissions** uncheck everything except **Account → Get account information**.

```dotenv
# infra/.env only
UPTIME_KUMA_BREVO_API_KEY=xkeysib-...probe-key...
```

### 2.4 Create the email templates

The HTML files live in `infra/brevo-templates/`. Upload each one to Brevo:

Brevo dashboard → **Email** → **Templates** → **Create a template** → paste HTML → Save.

| Template file | Story | `infra/.env` variable |
|---|---|---|
| `kat06_threshold_alert/fr.html` | KAT-06 | `BREVO_TEMPLATE_KAT_THRESHOLD_FR` |
| `kat06_threshold_alert/ar.html` | KAT-06 | `BREVO_TEMPLATE_KAT_THRESHOLD_AR` |
| `kat06_threshold_alert/en.html` | KAT-06 | `BREVO_TEMPLATE_KAT_THRESHOLD_EN` |
| `kat09_diagnostic_completion/fr.html` | KAT-09 | `BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR` |
| `kat09_diagnostic_completion/ar.html` | KAT-09 | `BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR` |
| `kat09_diagnostic_completion/en.html` | KAT-09 | `BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN` |
| `kat11_offline_alert/fr.html` | KAT-11 | `BREVO_TEMPLATE_KAT_OFFLINE_FR` |
| `kat11_offline_alert/ar.html` | KAT-11 | `BREVO_TEMPLATE_KAT_OFFLINE_AR` |
| `kat11_offline_alert/en.html` | KAT-11 | `BREVO_TEMPLATE_KAT_OFFLINE_EN` |

Each template gets a numeric ID (shown in the URL after saving, e.g. `/templates/42`). Paste that number into the corresponding `infra/.env` variable.

> **Shortcut for MVP:** AR and EN templates can temporarily point to the same ID as FR.
> Fill the real values when I18N-06 ships the translated content.

---

## 3. OpenWeatherMap — Weather data (KAT-08)

### 3.1 Get a free API key

1. Go to **openweathermap.org** → Create account.
2. Dashboard → **API keys** tab → the `Default` key is created automatically.
3. Copy it.

```dotenv
# root .env  AND  infra/.env
OPENWEATHERMAP_API_KEY=<your-openweathermap-api-key>
```

> **Free tier limits:** 60 calls/min, 1 M calls/month.
> The KAT-08 worker caches OWM results for 3 hours per ~1 km grid cell (BR-K3),
> so at MVD scale this stays under 1% of the monthly quota.

### 3.2 Verify the key works

```bash
curl "https://api.openweathermap.org/data/2.5/forecast?lat=33.59&lon=-7.62&cnt=40&appid=YOUR_KEY&units=metric"
```

Expect a JSON response with `cod: "200"` and a `list` array. If you get `401 Invalid API key`, wait 10 minutes — new keys take a few minutes to activate.

---

## 4. Sentinel Hub — Satellite NDVI (KAT-08)

### 4.1 Create a free account

1. Go to **sentinelhub.com** → Sign up (free tier, no credit card required).
2. After login go to **Dashboard** → **User Settings** → **OAuth clients** tab.
3. Click **+ Add** → Name: `vitachain-worker` → copy the **Client ID** and **Client Secret** (secret shown once).

```dotenv
# root .env  AND  infra/.env
SENTINEL_HUB_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
SENTINEL_HUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> **Free tier limits:** 30,000 processing units (PU) per month.
> Each NDVI Process API call ≈ 4 PU. The KAT-08 worker caches results for 12 hours
> per parcel (BR-K7) and caps at 3 calls per parcel per 24 h (BR-K6).
> Worst case for MVD scale ≈ 10% of monthly quota.

### 4.2 Verify the OAuth flow

```bash
curl -X POST "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET"
```

Expect a JSON response with `access_token`. If you get `401`, double-check the client secret — it is easy to copy with a trailing space.

---

## 5. Google Gemini — AI diagnostic (KAT-08)

### 5.1 Get a free API key

1. Go to **aistudio.google.com** → Sign in with a Google account.
2. Click **Get API key** → **Create API key in new project**.
3. Copy the key.

```dotenv
# root .env  AND  infra/.env
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
GEMINI_MODEL=gemini-1.5-flash
```

> **Free tier limits:** 1,500 requests/day, 1 M token context window.
> The KAT-08 worker sends one Gemini call per diagnostic request. At MVD scale
> this is well within the free tier.

### 5.2 Verify the key

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

Expect a JSON response with `candidates[0].content.parts[0].text`.

---

## 6. Complete `.env` files

### 6.1 Root `.env` (development / local testing)

Copy `.env.example` → `.env` and fill every blank:

```dotenv
# Public (frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...  # anon key from Supabase dashboard
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Backend only
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...       # service_role key from Supabase dashboard
SUPABASE_JWT_SECRET=your-jwt-secret-from-dashboard
SUPABASE_DB_PASSWORD=your-db-password

# Direct Postgres (for workers + migrations)
DB_URL=postgresql://postgres:<PASS>@db.<ref>.supabase.co:5432/postgres

# Third-party (filled from §2-5 above)
BREVO_API_KEY=
OPENWEATHERMAP_API_KEY=
SENTINEL_HUB_CLIENT_ID=
SENTINEL_HUB_CLIENT_SECRET=
GEMINI_API_KEY=
```

Where to find the Supabase values:
- Supabase dashboard → **Settings** → **API** → copy `URL`, `anon public`, `service_role`.
- **Settings** → **API** → **JWT Settings** → copy the JWT Secret.
- **Settings** → **Database** → **Connection string** (use the direct `:5432` URL, not the pooler).

### 6.2 `infra/.env` (staging / production VPS)

Copy `infra/.env.example` → `infra/.env` and fill every blank.
Key additions beyond the root `.env`:

```dotenv
VPS_HOST=vitachain.ma          # or IP before DNS is live
VPS_USER=vitachain
PROJECT_DIR=/opt/vitachain

# TLS
ADMIN_EMAIL=ops@vitachain.ma
DOMAINS=vitachain.ma www.vitachain.ma

# Backup
SUPABASE_DB_URL=postgresql://postgres:<PASS>@db.<ref>.supabase.co:5432/postgres
BACKUP_BUCKET=vitachain-backups
BACKUP_RETENTION_LOCAL_DAYS=7
BACKUP_RETENTION_REMOTE_DAYS=30
HEALTHCHECKS_BACKUP_URL=https://hc-ping.com/<uuid>
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Observability
SENTRY_DSN_BACKEND=https://xxx@oXXX.ingest.sentry.io/XXX
NEXT_PUBLIC_SENTRY_DSN=https://yyy@oYYY.ingest.sentry.io/YYY
UPTIME_KUMA_ADMIN_USER=admin
UPTIME_KUMA_ADMIN_PASSWORD_HASH=   # generated in §9 below

# Brevo (all values from §2)
BREVO_API_KEY=
BREVO_SENDER_NAME=VitaChain
BREVO_SENDER_EMAIL=no-reply@vitachain.ma
BREVO_TEMPLATE_KAT_THRESHOLD_FR=
BREVO_TEMPLATE_KAT_THRESHOLD_AR=
BREVO_TEMPLATE_KAT_THRESHOLD_EN=
BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR=
BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR=
BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN=
BREVO_TEMPLATE_KAT_OFFLINE_FR=
BREVO_TEMPLATE_KAT_OFFLINE_AR=
BREVO_TEMPLATE_KAT_OFFLINE_EN=

# KAT-08 (all values from §3-5)
OPENWEATHERMAP_API_KEY=
SENTINEL_HUB_CLIENT_ID=
SENTINEL_HUB_CLIENT_SECRET=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash

# Healthchecks (one UUID per worker — see §8)
HEALTHCHECKS_KAT_THRESHOLD_PING_URL=
HEALTHCHECKS_KAT_DIAGNOSTIC_PING_URL=
HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL=
HEALTHCHECKS_KAT_OFFLINE_PING_URL=
FRONTEND_BASE_URL=https://vitachain.ma

# Rate-limiting
VPS_PUBLIC_IP=           # ssh $VPS_USER@$VPS_HOST 'curl -s ifconfig.me'
RATELIMIT_WHITELIST_IPS=
```

---

## 7. Apply all database migrations

All 28 migrations must run against the Supabase project in order.

```bash
# From repo root
make -C db migrate         # applies pending migrations (0001 → 0028)
make -C db verify          # asserts RLS enabled on every table, JWT hook registered
make -C db test-auth07     # runs the pgTAP role matrix + business rules
```

If `make -C db migrate` is not wired yet, apply them manually:

```bash
cd db
for f in migrations/*.sql; do
  echo "Applying $f..."
  psql "$DB_URL" -f "$f"
done
```

Verify the KAT tables exist:

```sql
-- Run in Supabase SQL editor or psql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'm1_katara%'
order by table_name;
```

Expected: `m1_katara_devices`, `m1_katara_diagnostics`, `m1_katara_ndvi_cache`,
`m1_katara_owm_cache`, `m1_katara_parcels`, `m1_katara_telemetry`,
`m1_katara_alert_thresholds`.

---

## 8. Healthchecks.io setup (worker heartbeats)

Each background worker pings a URL every 60 s. If the ping stops for 5 minutes, Healthchecks pages you.

1. Go to **healthchecks.io** → Sign up (free: 20 checks).
2. Create one check per worker:

| Check name | Schedule | Grace |
|---|---|---|
| `vitachain-db-backup` | `0 2 * * *` | 60 min |
| `vitachain-cert-renew` | `0 3 * * *` | 60 min |
| `vitachain-katara-threshold` | `* * * * *` | 5 min |
| `vitachain-katara-diagnostic` | `* * * * *` | 5 min |
| `vitachain-katara-diagnostic-email` | `* * * * *` | 5 min |
| `vitachain-katara-offline` | `* * * * *` | 5 min |

3. For each check, copy its **Ping URL** (format: `https://hc-ping.com/<uuid>`) and paste into `infra/.env`:
   - `HEALTHCHECKS_BACKUP_URL`
   - `HEALTHCHECKS_RENEW_URL` (in `infra/.env` as a comment — uncomment it)
   - `HEALTHCHECKS_KAT_THRESHOLD_PING_URL`
   - `HEALTHCHECKS_KAT_DIAGNOSTIC_PING_URL`
   - `HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL`
   - `HEALTHCHECKS_KAT_OFFLINE_PING_URL`

4. Under **Integrations** → add your Discord/Slack webhook so Healthchecks can alert you when a check goes down.

---

## 9. Sentry — Error tracking (INF-08)

1. Go to **sentry.io** → Create account → New project → **FastAPI** → copy DSN.
2. In the same project, go to **Settings** → **Client Keys** → **Add key** for the frontend.

```dotenv
# infra/.env
SENTRY_DSN_BACKEND=https://public_key@o123.ingest.sentry.io/456
NEXT_PUBLIC_SENTRY_DSN=https://public_key2@o123.ingest.sentry.io/456
```

> Two separate Client Keys in the same project is the recommended setup — they produce separate
> stats and the AUTH-05 boundary scanner can enforce that the backend DSN never leaks into the
> frontend bundle.

For CI source map uploads:
- Sentry → **Settings** → **Auth Tokens** → create token with `project:write` scope.
- Add as a GitHub Actions secret named `SENTRY_AUTH_TOKEN`.

---

## 10. Uptime Kuma — Monitoring dashboard (INF-08)

Uptime Kuma is included in `docker-compose.yml` and gated behind NGINX basic-auth at `/uptime/`.

### 10.1 Generate the htpasswd entry

```bash
# On any machine with Apache utils installed:
htpasswd -nbB admin 'your-strong-password'
# Output: admin:$2y$05$xxxx...
# Copy everything AFTER the colon:
```

```dotenv
# infra/.env
UPTIME_KUMA_ADMIN_USER=admin
UPTIME_KUMA_ADMIN_PASSWORD_HASH=$2y$05$xxxx...
```

Or use the Make target on the VPS:

```bash
make -C infra observability-htpasswd USER=admin PASS='your-strong-password'
```

### 10.2 Monitors to add after first login

After deploy, visit `https://vitachain.ma/uptime/` and add these monitors:

| Name | Type | URL / endpoint | Interval |
|---|---|---|---|
| Frontend liveness | HTTP | `https://vitachain.ma/api/healthz` | 60 s |
| Backend liveness | HTTP | `https://vitachain.ma/api/v1/healthz` | 60 s |
| Brevo API | HTTP | `https://api.brevo.com/v3/account` + header `api-key: UPTIME_KUMA_BREVO_API_KEY` | 5 min |
| OWM API | HTTP | `https://api.openweathermap.org/data/2.5/forecast?lat=33&lon=-7&cnt=1&appid=KEY` | 5 min |
| Katara threshold worker | Healthchecks.io | `HEALTHCHECKS_KAT_THRESHOLD_PING_URL` | 60 s |
| Katara diagnostic worker | Healthchecks.io | `HEALTHCHECKS_KAT_DIAGNOSTIC_PING_URL` | 60 s |
| Katara offline worker | Healthchecks.io | `HEALTHCHECKS_KAT_OFFLINE_PING_URL` | 60 s |

---

## 11. Backblaze B2 — Database backups (INF-07)

1. Go to **backblaze.com** → Sign up → **B2 Cloud Storage** → Create bucket named `vitachain-backups` (private).
2. **App Keys** → **Add a New Application Key**:
   - Name: `vitachain-backup`
   - Allow access: select `vitachain-backups` only
   - Type of access: Read and Write
   - Copy the **keyID** and **applicationKey**.
3. On the VPS, run the rclone config ceremony:

```bash
# SSH into VPS first
ssh vitachain@vitachain.ma

# Run the one-shot B2 config wizard
make -C /opt/vitachain/infra backup-rclone-config
# It will prompt for keyID and applicationKey, writes to the rclone_config Docker volume
```

```dotenv
# infra/.env
BACKUP_BUCKET=vitachain-backups
BACKUP_REMOTE_PATH=postgres
BACKUP_RETENTION_LOCAL_DAYS=7
BACKUP_RETENTION_REMOTE_DAYS=30
```

Verify it works:

```bash
make -C infra backup-now        # triggers a manual backup
make -C infra backup-verify     # lists the remote and checks the sha256
```

---

## 12. VPS deployment (INF-01 / INF-06)

### 12.1 Bootstrap the VPS (once)

```bash
# From your local machine — VPS must be accessible via SSH
bash infra/scripts/bootstrap-vps.sh
```

This installs Docker, UFW, hardens sshd, sets up cron jobs, and creates the `vitachain` Linux user.

### 12.2 Issue TLS certificate (INF-06)

```bash
# Staging certificate first (no rate-limit risk)
make -C infra issue-cert

# Production certificate (run only after staging cert is clean)
make -C infra issue-cert STAGING=0
```

### 12.3 Deploy the full stack

```bash
# Push code, build images, start all containers, run health gate
make -C infra deploy
```

### 12.4 Verify everything

```bash
make -C infra verify
```

This runs 100+ checks including: DNS, TLS grade, RLS enabled on all tables, AUTH-05 boundary, backup status, all worker heartbeats, rate-limit zones, Uptime Kuma, Sentry connectivity.

---

## 13. KAT-03 staging load test (completes KAT-03 DoD)

KAT-03 is code-complete. Its DoD requires a Locust load-test run on staging.

```bash
cd load
pip install locust
locust -f locustfile.py --host=https://vitachain.ma \
  --users=50 --spawn-rate=10 --run-time=60s \
  --headless --csv=ingest_stats
```

Pass criteria (from spring-status.yml KAT-03 DoD):
- p50 < 50 ms
- p99 < 150 ms
- 0 failures

Save the output URL / `ingest_stats.csv` path in `docs/runbook.md` under the KAT-03 drills table.

---

## 14. Run the complete test suite

```bash
# Database layer
make -C db test-auth07

# Backend unit + integration tests
cd backend
pytest --tb=short -q

# Frontend tests
cd frontend
npm test

# E2E matrix (requires SUPABASE_URL set to staging)
SUPABASE_URL=https://xxx.supabase.co pytest backend/tests/test_auth07_business_rules.py --run-e2e
```

All must be green before flipping stories to DONE in `spring-status.yml`.

---

## 15. Story-by-story flip checklist

Work through stories in dependency order. Each requires:

1. Migration applied on the linked Supabase project and verified.
2. Backend route reachable at staging (`curl https://vitachain.ma/api/v1/...`).
3. Frontend page loads without console errors.
4. Auth-07 matrix cells for this story green (no red, SKIP is fine until owner story merges).
5. Update `docs/spring-status.yml` status field to `DONE` (with a timestamp comment).

**Order to follow:**

```
KAT-01 → KAT-02 → KAT-03* → KAT-04 → KAT-05
  → KAT-06** → KAT-07 → KAT-08** → KAT-09** → KAT-10
  → KAT-11** → KAT-12 → KAT-13 → KAT-14
```

`*` = also requires Locust load test  
`**` = also requires external API keys (§ 2–5)

---

## 16. Quick-reference: where each key goes

| Variable | File(s) | Story |
|---|---|---|
| `BREVO_API_KEY` | root `.env`, `infra/.env` | KAT-06, KAT-09, KAT-11 |
| `BREVO_TEMPLATE_KAT_THRESHOLD_*` | `infra/.env` | KAT-06 |
| `BREVO_TEMPLATE_KAT_DIAGNOSTIC_*` | `infra/.env` | KAT-09 |
| `BREVO_TEMPLATE_KAT_OFFLINE_*` | `infra/.env` | KAT-11 |
| `OPENWEATHERMAP_API_KEY` | root `.env`, `infra/.env` | KAT-08 |
| `SENTINEL_HUB_CLIENT_ID` | root `.env`, `infra/.env` | KAT-08 |
| `SENTINEL_HUB_CLIENT_SECRET` | root `.env`, `infra/.env` | KAT-08 |
| `GEMINI_API_KEY` | root `.env`, `infra/.env` | KAT-08 |
| `GEMINI_MODEL` | `infra/.env` | KAT-08 |
| `SENTRY_DSN_BACKEND` | `infra/.env` | INF-08 |
| `NEXT_PUBLIC_SENTRY_DSN` | `infra/.env` | INF-08 |
| `UPTIME_KUMA_ADMIN_PASSWORD_HASH` | `infra/.env` | INF-08 |
| `UPTIME_KUMA_BREVO_API_KEY` | `infra/.env` | INF-08 |
| `HEALTHCHECKS_*` | `infra/.env` | INF-07, KAT-06/08/09/11 |
| `BACKUP_BUCKET` | `infra/.env` | INF-07 |
| `ALERT_WEBHOOK_URL` | `infra/.env` | INF-07 |

---

## 17. Troubleshooting

**Worker not picking up PENDING diagnostics**
- Check the Supabase NOTIFY channel: `LISTEN katara_diagnostic_requested;` in `psql` then insert a row and watch for the notification.
- Check worker logs: `docker logs vitachain-katara_diagnostic_worker-1 --tail=50`.

**OWM returning 401**
- New keys can take up to 10 minutes to activate after creation. Wait and retry.

**Sentinel Hub returning 401**
- The OAuth token endpoint changed. Verify you are hitting `identity.dataspace.copernicus.eu` not the older `services.sentinel-hub.com` endpoint.

**Gemini 429 errors**
- Free tier is 1,500 req/day. The worker has exponential backoff (max 2 retries). If quota is exhausted, the diagnostic row lands in `status='FAILED'` with `error_detail='gemini_rate_limited'` — farmer can retry next day.

**`make -C db test-auth07` shows SKIP not green**
- SKIP is expected until the owner story for that cell is merged. It becomes a red failure only after the owner story status in spring-status.yml is set to `IN_REVIEW` or `DONE`.

**Migrations fail on re-run**
- All migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE POLICY IF NOT EXISTS`). Safe to re-run. If a migration fails mid-way, check the specific SQL error and fix the migration file (do not delete and recreate — append a new migration instead).
