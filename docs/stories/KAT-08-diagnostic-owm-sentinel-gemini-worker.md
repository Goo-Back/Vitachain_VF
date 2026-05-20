# KAT-08 — Diagnostic worker assembles OWM + Sentinel NDVI + 7d sensor average and calls Gemini

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** System (worker)
> **Depends on:** [KAT-07](./KAT-07-ai-diagnostic-request.md) (table `m1_katara_diagnostics` + the FIFO PENDING contract — KAT-08 is the *sole* legitimate writer of `status`, `result_text`, `error_detail`, `started_at`, `completed_at` via `service_role`; the audit-guard trigger from KAT-07 blocks any other writer) · [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) (`m1_katara_telemetry` + the `(parcel_id, recorded_at DESC)` index KAT-03 created — the 7-day per-parcel aggregate runs against that index) · [KAT-01](./KAT-01-farmer-registers-parcel.md) (`m1_katara_parcels.geojson` polygon + `centroid_lat`/`centroid_lng` columns — OWM is queried at the centroid, Sentinel Process API consumes the polygon) · [INF-04](./INF-04-fastapi-backend-scaffold-healthcheck.md) (worker base image + `app.db.service_client()` + `app.core.logging`)
> **Unblocks:** [KAT-09](../spring-status.yml) (KAT-09 adds the Brevo email on the COMPLETED transition this story produces — KAT-08 surfaces `result_text` + `farmer_id` on the row; KAT-09 reads them. No worker rewrite — KAT-09 plugs an additional async callback into the same `evaluate_and_send` orchestrator KAT-08 defines) · [I18N-06](../spring-status.yml) (the locale-aware Gemini prompt builder this story introduces is the surface I18N-06 hardens; KAT-08 ships the FR baseline + the dispatch hook) · the AUTH-07 matrix's `m1_katara_diagnostics` UPDATE cell (service-role positive write — currently absent; KAT-08's pgTAP additions introduce it)
> **Acceptance:** When a verified FARMER POSTs to `/api/v1/katara/parcels/{id}/diagnostics` (KAT-07), the new `katara_diagnostic_worker` service picks up the PENDING row within < 5 s (LISTEN/NOTIFY hot path; 60 s polling backstop), atomically transitions it to `PROCESSING` (single `UPDATE ... WHERE id=? AND status='PENDING' RETURNING *` claim — only the worker that wins the row continues), assembles the composite payload (OWM current + 5-day forecast at the parcel centroid via the cached fetcher; Sentinel-2 NDVI mean for the parcel polygon via the cached fetcher; 7-day per-parcel sensor average over `soil_moisture / soil_temperature / soil_pH / soil_conductivity / battery_level`), calls the Gemini API with the locale-resolved prompt, and writes the response back as `status='COMPLETED'`, `result_text=<gemini markdown>`, `completed_at=now()` — end-to-end p95 < 30 s, p99 < 60 s. Any failure on any leg (OWM 5xx, Sentinel auth, Gemini quota, prompt build error) transitions the row to `status='FAILED'`, `error_detail=<engineer-facing message>`, `completed_at=now()` — and never leaves a row stuck in PROCESSING. BR-K3 (OWM cache ≥ 3 h per coarse lat/lng cell) is honoured by the OWM client and observed in `m1_katara_owm_cache`. BR-K7 (Sentinel NDVI cache ≥ 12 h per parcel) is observed in `m1_katara_ndvi_cache`. No Brevo email is sent (KAT-09). No frontend change in this story — the existing `DiagnosticSection` from KAT-07 surfaces the new status via the GET `/latest` endpoint (live polling is KAT-10).

---

## 1. Purpose

KAT-07 shipped the request surface — a verified farmer can persist a PENDING diagnostic row. KAT-08 closes the loop on the *AI side* of the pipeline: it picks up that row, fetches everything Gemini needs to give a useful agronomic answer (weather context, satellite NDVI context, sensor history context), calls Gemini, and writes the result back.

The split across **KAT-07 → KAT-08 → KAT-09 → KAT-10** is the same logic that split KAT-05 from KAT-06: each downstream story needs a stable contract to be designed against. KAT-08 deliberately does **not** send the Brevo email (that is KAT-09's single responsibility, and the email triggers on the COMPLETED state transition this story produces). KAT-08 also deliberately does **not** poll on the frontend (KAT-10 wires the `useInterval` against `GET /latest`).

Concretely KAT-08 delivers:

- **DB migration `0023_kat08_diagnostic_notify_and_caches.sql`** — three additions:
  1. A NOTIFY trigger on `m1_katara_diagnostics` INSERT that emits payload `<diagnostic_id>` on channel `katara_diagnostic_requested` (the hot path the worker LISTENs on; mirrors KAT-03's `katara_telemetry_inserted` shape).
  2. `m1_katara_owm_cache` — key `(lat_q numeric(5,2), lng_q numeric(5,2))`, payload `data jsonb`, `fetched_at timestamptz` — BR-K3 cache (3 h TTL, lat/lng quantised to 0.01° ≈ 1.1 km grid; multiple parcels in the same village hit one row).
  3. `m1_katara_ndvi_cache` — key `parcel_id uuid PRIMARY KEY REFERENCES m1_katara_parcels(id) ON DELETE CASCADE`, payload `mean_ndvi numeric(4,3)`, `acquisition_date date`, `fetched_at timestamptz` — BR-K7 cache (12 h TTL; Sentinel-2 revisit cadence is ~5 days, so a 12 h cache is a free win and Sentinel free-tier units are scarce).
- **Worker package `backend/app/workers/katara_diagnostic/`** — same shape as `katara_threshold` (KAT-06):
  - `__main__.py` — entrypoint (Sentry init, JSON log format, signal handlers, Windows event-loop fallback).
  - `listener.py` — LISTEN/NOTIFY on `katara_diagnostic_requested` + a 60 s polling backstop (`SELECT ... WHERE status='PENDING' ORDER BY requested_at ASC LIMIT 1` — BR-K6 caps inbound at 3/parcel/24 h, so backstop volume is bounded), bounded `asyncio.Queue(maxsize=256)`, exponential-backoff reconnect.
  - `claimer.py` — `claim_pending(diagnostic_id) -> dict | None` — atomic `UPDATE m1_katara_diagnostics SET status='PROCESSING', started_at=now() WHERE id=? AND status='PENDING' RETURNING *` returning `None` if another worker raced and won (idempotent).
  - `orchestrator.py` — `run_diagnostic(claimed_row) -> None` — sequential gather (OWM → Sentinel → 7d avg → prompt → Gemini → COMPLETED-or-FAILED update) wrapped in `try/except` that always lands the row in a terminal state.
  - `owm_client.py` — `fetch_weather(lat, lng) -> dict` — Supabase-cache-aware OWM `/data/2.5/forecast` wrapper; quantises lat/lng to two decimals; reads from `m1_katara_owm_cache` if `fetched_at > now() - interval '3 hours'` else fetches + upserts.
  - `sentinel_client.py` — `fetch_ndvi(parcel_id, polygon_geojson) -> dict` — Supabase-cache-aware Sentinel Hub Process API wrapper; OAuth client-credentials token flow (token cached in-process for its 1 h TTL); evalscript computes mean NDVI over the polygon; reads from `m1_katara_ndvi_cache` if `fetched_at > now() - interval '12 hours'` else fetches + upserts.
  - `telemetry_aggregator.py` — `fetch_7d_average(parcel_id) -> dict` — runs `SELECT AVG(soil_moisture) AS avg_moisture, AVG(soil_temperature) AS avg_temperature, AVG(soil_pH) AS avg_ph, AVG(soil_conductivity) AS avg_ec, AVG(battery_level) AS avg_battery, COUNT(*) AS sample_count FROM m1_katara_telemetry WHERE parcel_id=? AND recorded_at >= now() - interval '7 days'`. Returns a dict with a `no_sensor_data: true` flag when `sample_count = 0` (the orchestrator threads this into the Gemini prompt instead of failing — per KAT-07 §10 hand-off note).
  - `prompts.py` — `build_prompt(parcel, owm, ndvi, sensor_7d, locale) -> str` — Jinja2 template rendering the Gemini system + user message; `FALLBACK_LOCALE='fr'` per PRD §7.2 (`dar`/`zgh` fall back to FR at runtime). KAT-08 ships the FR template + the dispatch hook; AR/EN templates are added by I18N-06.
  - `gemini_client.py` — `call_gemini(prompt, locale) -> str` — `google-generativeai` SDK call against `gemini-1.5-flash` (free tier, 1.5K req/day per PRD §11.1); 30 s timeout; rate-limit-aware retry (429 → exponential back-off, max 2 retries). Returns the Markdown response.
  - `updater.py` — `mark_completed(diagnostic_id, result_text)` + `mark_failed(diagnostic_id, error_detail)` — service-role UPDATEs gated on `status='PROCESSING'` so a manual admin override is preserved.
- **Docker Compose service `katara_diagnostic_worker`** — same image as backend + `command: ["python", "-m", "app.workers.katara_diagnostic"]`, `restart: unless-stopped`, env-var bindings for `OPENWEATHERMAP_API_KEY`, `SENTINEL_HUB_CLIENT_ID`, `SENTINEL_HUB_CLIENT_SECRET`, `GEMINI_API_KEY`, `HEALTHCHECKS_KAT_DIAGNOSTIC_PING_URL`.
- **AUTH-05 allow-list** — `workers/katara_diagnostic/` prefix added to the service-client callsite allowlist test (`backend/tests/test_service_client_callsite_allowlist.py`).
- **Backend tests**:
  - `backend/tests/test_kat08_claimer.py` — atomic claim positive + lost-race no-op + already-PROCESSING no-op.
  - `backend/tests/test_kat08_owm_cache.py` — cache hit < 3 h returns DB row without HTTP fetch; cache stale > 3 h triggers fetch + upsert; quantisation collapses (33.589, -7.612) and (33.592, -7.615) to the same row.
  - `backend/tests/test_kat08_ndvi_cache.py` — cache hit < 12 h returns DB row without HTTP fetch; cache miss fetches + upserts; OAuth token cached for its TTL.
  - `backend/tests/test_kat08_aggregator.py` — 7-day window respected; `no_sensor_data=true` on empty parcel; soil_pH / soil_conductivity columns surfaced (memory drift guard).
  - `backend/tests/test_kat08_prompt.py` — FR template renders all five sensor metrics + OWM keys + NDVI; missing-data branches render the `aucune donnée capteur disponible` clause.
  - `backend/tests/test_kat08_orchestrator.py` — happy path lands COMPLETED; OWM 503 lands FAILED with `error_detail` containing `owm_unavailable`; Gemini 429 (after retries) lands FAILED with `gemini_rate_limited`; parcel with no centroid lands FAILED with `parcel_missing_centroid`.
  - `backend/tests/test_kat08_listener_e2e.py` — `--run-e2e` gated; verified-FARMER POST → row reaches COMPLETED in < 30 s on staging.
- **pgTAP cells appended to `db/tests/auth07_business_rules.sql`** — KAT-08 block:
  - D-9 service_role UPDATE `status=COMPLETED` + `result_text='...'` + `completed_at=now()` lands;
  - D-10 service_role UPDATE `status=FAILED` + `error_detail='...'` lands;
  - D-11 service_role UPDATE on a row already in COMPLETED is rejected by the orchestrator's `WHERE status='PROCESSING'` guard (admin override stays sticky);
  - D-12 OWM cache row keyed `(lat_q, lng_q)` is owner-isolated only via service_role; authenticated SELECT returns 0 rows (cache is system-internal);
  - D-13 NDVI cache row is owner-isolated to the parcel owner via RLS (`farmer_id = auth.uid()` join through `m1_katara_parcels`).
- **`spring-status.yml` flip** — KAT-08 status from `TODO` to `IN_REVIEW` + a §10 hand-off note for KAT-09 (the COMPLETED transition is the email trigger; the `result_text` + `farmer_id` + `locale` columns it reads are all on the same row).

Once `DONE`, KAT-09 plugs the Brevo email onto the COMPLETED transition with no schema change, KAT-10 wires the `useInterval` against the unchanged `GET /latest`, and the farmer sees the full diagnostic flow end-to-end on staging.

---

## 2. Scope

### In scope

- DB migration `0023_kat08_diagnostic_notify_and_caches.sql` — NOTIFY trigger on `m1_katara_diagnostics` INSERT + two cache tables (OWM, NDVI) + RLS on both (service-role-write, owner-read for NDVI via parcel join, no read for OWM) + indexes (`m1_katara_owm_cache(lat_q, lng_q)` PK already covers TTL lookup; `m1_katara_ndvi_cache(parcel_id)` PK already covers).
- Worker package `backend/app/workers/katara_diagnostic/` — eight modules listed in §1.
- OWM integration — current + 5-day forecast `/data/2.5/forecast`, free-tier endpoint, lat/lng quantised to 0.01° for the cache key. Read-through cache with 3 h TTL (BR-K3).
- Sentinel Hub integration — OAuth client-credentials flow, Process API call with NDVI evalscript over the parcel polygon, returning a single mean NDVI value. Read-through cache with 12 h TTL (BR-K7).
- 7-day per-parcel telemetry aggregate — one indexed query against `m1_katara_telemetry` covering all five metrics from the corrected payload (soil_moisture, soil_temperature, soil_pH, soil_conductivity, battery_level).
- Gemini integration — `google-generativeai` SDK against `gemini-1.5-flash`, 30 s timeout, 429-aware retry.
- Locale-aware FR prompt (the P0 baseline per PRD §7.2). The dispatch hook for AR/EN is in place but those templates land in [I18N-06](../spring-status.yml).
- Docker Compose service + env-var bindings + Healthchecks heartbeat.
- AUTH-05 allow-list extension (`workers/katara_diagnostic/`).
- Backend tests (7 files) + pgTAP cells (D-9..D-13).
- `spring-status.yml` flip.

### Out of scope

- **Brevo email on COMPLETED** → [KAT-09](../spring-status.yml). KAT-08 only updates the row. KAT-09 will subscribe to a second NOTIFY channel (`katara_diagnostic_completed`, emitted by an UPDATE trigger this story does not introduce — KAT-09 owns the schema for its own trigger so the AUTH-07 matrix stays clean) and send the FR/AR/EN Brevo template.
- **Frontend polling loop** → [KAT-10](../spring-status.yml). The existing KAT-07 `DiagnosticSection` already renders `PROCESSING`/`COMPLETED`/`FAILED` chips and the result `<details>` block; it just lacks a `useInterval`. KAT-08 does not edit any `.tsx` file.
- **AR / EN Gemini prompt templates** → [I18N-06](../spring-status.yml). The locale dispatch in `prompts.py` falls back to FR for any unsupported locale (PRD §7.2 contract).
- **Per-device or per-metric diagnostic** — parcel-wide only, as stated in KAT-07 §2 (post-MVD agronomic refinement).
- **Diagnostic history endpoint** — `GET /latest` from KAT-07 is sufficient. A `GET /diagnostics` paginated list is post-MVD.
- **Gemini Pro tier / longer context window** — `gemini-1.5-flash` free tier (1.5 K req/day, 1 M token context) is comfortably over-sized for our prompt (~2 KB input, ~1 KB output). Pro is post-MVD if quality measurement justifies the cost.
- **NDVI time-series** — we fetch one *current* mean NDVI per request. Trend lines (NDVI 30-day rolling) are post-MVD.
- **OWM Pro endpoints (history API, agricultural indices)** — free tier only for MVD; the architectural seam is `OwmClient` so a Pro client is a drop-in swap later.
- **Worker horizontal scaling** — single replica for MVD. The atomic-claim pattern (`UPDATE ... WHERE status='PENDING' RETURNING *`) already supports N replicas race-free; the Docker Compose service stays at `replicas: 1` for now.
- **`Idempotency-Key` for the POST** — KAT-07's BR-K5 (in-flight 409) plus BR-K6 (24 h rate limit) already covers duplicate-request idempotency at the request layer; the worker side is naturally idempotent because the `claim_pending` UPDATE filters on `status='PENDING'`.
- **Spec text update** for `Documents/VitaChain_Technical_Specifications.md` L922–926 (Gemini prompt) — the memory note flags this as a separate doc PR; KAT-08 ships code aligned with the *new* payload (soil_pH + soil_conductivity), and the spec edit is queued.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-07](./KAT-07-ai-diagnostic-request.md) `IN_REVIEW` or `DONE` | `m1_katara_diagnostics` table + audit-guard trigger present. KAT-08's worker writes to columns this story does *not* own — KAT-07 is the single source of truth for the schema, the worker is just a `service_role` writer. |
| [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) `DONE` | The `(parcel_id, recorded_at DESC)` index on `m1_katara_telemetry` covers the 7-day average without sequential scan. Verified by `EXPLAIN ANALYZE` in §5.6. |
| [KAT-01](./KAT-01-farmer-registers-parcel.md) `DONE` | `m1_katara_parcels.geojson` polygon + `centroid_lat` / `centroid_lng` columns (derived via the `st_centroid` trigger KAT-01 ships). KAT-08 fails the diagnostic with `parcel_missing_centroid` if these are null — defensive, since KAT-01's trigger should preclude that state. |
| [INF-04](./INF-04-fastapi-backend-scaffold-healthcheck.md) `DONE` | `app.db.service_client()` + `app.core.logging.configure_json_logging()` + the worker base image with `google-generativeai`, `httpx`, and `asyncpg` already in `requirements.txt`. KAT-06's worker proved the runtime layout. |
| [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) `DONE` | Service-key callsite allowlist test — KAT-08 extends the `_ALLOWED_PREFIXES` tuple with `app/workers/katara_diagnostic/`. The test would fail loudly otherwise. |
| [AUTH-07](./AUTH-07-rls-audit-business-rule-test-suite.md) `IN_REVIEW` | KAT-08's D-9..D-13 cells extend the matrix. The earlier KAT-07 D-1..D-8 cells must be present (they ship with KAT-07). |
| OpenWeatherMap free API key | Free tier: 60 calls/min, 1 M calls/month — three orders of magnitude over MVD demand (50 farmers × 2 diagnostics/week × 1 OWM call each = 400/week, and the 3 h cache deduplicates within villages). Provisioned by INF-04's secrets bootstrap. |
| Sentinel Hub free OAuth client | 30 K processing units/month free; each NDVI request ≈ 4 PU (small polygon, two bands); 12 h cache plus the 3/parcel/24 h request cap (BR-K6) keeps us at ~10% of the quota in the worst case. |
| Gemini free API key | 1.5 K req/day per PRD §11.1 — well above MVD demand. |
| Healthchecks.io ping URL | One additional check named `KAT_DIAGNOSTIC_WORKER_HEARTBEAT`, expected interval 5 min, grace 2 min. Wired in INF-08; this story adds the env var binding. |

---

## 4. Data Contract

### 4.1 NOTIFY channel — `katara_diagnostic_requested`

Emitted by an `AFTER INSERT` trigger on `m1_katara_diagnostics`. Payload is the diagnostic UUID as text:

```
NOTIFY katara_diagnostic_requested, '7c1f2a90-...';
```

The worker's listener parses the UUID and enqueues it. The trigger is intentionally separate from KAT-07's `m1_katara_diagnostics_fill_farmer_id` and `m1_katara_diagnostics_audit_guard` so KAT-08's migration is a *pure addition* and KAT-07's trigger surface stays unchanged.

### 4.2 OWM cache — `m1_katara_owm_cache`

```sql
create table public.m1_katara_owm_cache (
    lat_q       numeric(5,2) not null,
    lng_q       numeric(6,2) not null,
    data        jsonb        not null,
    fetched_at  timestamptz  not null default now(),
    primary key (lat_q, lng_q)
);
```

- `lat_q`, `lng_q` — input lat/lng rounded to 2 decimal places (`round(34.0205, 2) = 34.02`); a 0.01° grid is ~1.1 km at this latitude — fine for irrigation-context weather. Multiple parcels in the same village share a row.
- `data` — full OWM `/data/2.5/forecast` JSON (current + 5-day at 3 h granularity).
- `fetched_at` — TTL anchor. The client treats `fetched_at < now() - interval '3 hours'` as stale (BR-K3).
- **No RLS on this table** — it is system-internal cache, never queried by authenticated users. The `service_role` only ACL plus the `force row level security` event-trigger combination (from AUTH-04) means any authenticated SELECT returns 0 rows even without an explicit policy. D-12 cell verifies.

### 4.3 NDVI cache — `m1_katara_ndvi_cache`

```sql
create table public.m1_katara_ndvi_cache (
    parcel_id         uuid       primary key
        references public.m1_katara_parcels(id) on delete cascade,
    mean_ndvi         numeric(4,3) not null,
    acquisition_date  date       not null,
    fetched_at        timestamptz not null default now()
);
```

- One row per parcel. Sentinel-2 revisit is ~5 days, so the 12 h TTL (BR-K7) is a generous freshness budget.
- `mean_ndvi` — float in [-1, 1]; we clamp to `numeric(4,3)` (so e.g. `0.742`).
- `acquisition_date` — the Sentinel granule date the NDVI was computed from. Exposed to Gemini so the prompt can say *"NDVI on 2026-05-14: 0.74 (healthy)"* rather than *"NDVI: 0.74"*.
- RLS: owner-read via a SELECT policy joining `m1_katara_parcels.farmer_id = auth.uid()`. This exists so a future "show the last NDVI on the parcel card" feature does not need a service-role API; the worker writes via service_role regardless. D-13 cell verifies.

### 4.4 Status state machine (KAT-08's slice)

```
   PENDING  ──[KAT-08 claim_pending UPDATE]──►  PROCESSING
                                                      │
                                          ┌───────────┴───────────┐
                              (all OK)    │                       │  (any failure)
                                          ▼                       ▼
                                     COMPLETED                FAILED
                                  result_text +              error_detail +
                                  completed_at               completed_at
```

The claim UPDATE is the only transition out of PENDING. If two workers race on the same row (single replica today, but the contract has to support N), exactly one UPDATE returns a row; the loser's `claim_pending` returns `None` and silently exits — idempotent.

### 4.5 BR-K3 and BR-K7 enforcement

| Rule | Enforced where | Detection |
|---|---|---|
| BR-K3 (OWM cache ≥ 3 h) | `OwmClient.fetch_weather` reads from `m1_katara_owm_cache` first; only fetches HTTP if `fetched_at < now() - 3 h` | Sentry breadcrumb `owm_cache_hit` / `owm_cache_miss`; staging Locust assertion that 50 sequential diagnostics on the same centroid produce ≤ 1 OWM HTTP call |
| BR-K7 (NDVI cache ≥ 12 h) | `SentinelClient.fetch_ndvi` reads from `m1_katara_ndvi_cache` first | Sentry breadcrumb `ndvi_cache_hit` / `ndvi_cache_miss`; same staging drill |

Both rules live in the client layer, not the DB. The reason mirrors KAT-07 §6.1: a single-row TTL check is trivially expressible in application code and clutters less than a partial index + cron purge.

---

## 5. Step-by-Step Implementation

### 5.1 DB migration `0023_kat08_diagnostic_notify_and_caches.sql`

Create `db/migrations/0023_kat08_diagnostic_notify_and_caches.sql`:

```sql
-- =============================================================================
-- 0023 — M1 Katara: KAT-08 diagnostic NOTIFY + OWM/NDVI caches.
-- Story: KAT-08 (docs/stories/KAT-08-diagnostic-owm-sentinel-gemini-worker.md)
--
-- Adds:
--   1. AFTER INSERT trigger on m1_katara_diagnostics emitting NOTIFY
--      katara_diagnostic_requested with the new row id as payload.
--   2. m1_katara_owm_cache — service-role-only, BR-K3 3h TTL.
--   3. m1_katara_ndvi_cache — owner-read via parcel join (RLS), service-role
--      write only, BR-K7 12h TTL.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ─── (1) NOTIFY trigger ──────────────────────────────────────────────────────

create or replace function public.m1_katara_diagnostics_notify_requested()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform pg_notify(
        'katara_diagnostic_requested',
        new.id::text
    );
    return new;
end;
$$;

drop trigger if exists m1_katara_diagnostics_notify_requested
    on public.m1_katara_diagnostics;
create trigger m1_katara_diagnostics_notify_requested
    after insert on public.m1_katara_diagnostics
    for each row execute function public.m1_katara_diagnostics_notify_requested();

-- ─── (2) OWM cache ──────────────────────────────────────────────────────────

create table if not exists public.m1_katara_owm_cache (
    lat_q       numeric(5,2) not null,
    lng_q       numeric(6,2) not null,
    data        jsonb        not null,
    fetched_at  timestamptz  not null default now(),
    primary key (lat_q, lng_q)
);

alter table public.m1_katara_owm_cache enable row level security;
alter table public.m1_katara_owm_cache force row level security;
-- Intentionally no policies — system-internal cache, only service_role writes
-- and reads. authenticated SELECT returns 0 rows by RLS default.

comment on table public.m1_katara_owm_cache is
    'KAT-08 — OpenWeatherMap forecast cache keyed on quantised lat/lng (0.01° grid). '
    'BR-K3 — 3h TTL on fetched_at. System-internal — no authenticated access.';

-- ─── (3) NDVI cache ─────────────────────────────────────────────────────────

create table if not exists public.m1_katara_ndvi_cache (
    parcel_id         uuid       primary key
        references public.m1_katara_parcels(id) on delete cascade,
    mean_ndvi         numeric(4,3) not null,
    acquisition_date  date       not null,
    fetched_at        timestamptz not null default now()
);

alter table public.m1_katara_ndvi_cache enable row level security;
alter table public.m1_katara_ndvi_cache force row level security;

comment on table public.m1_katara_ndvi_cache is
    'KAT-08 — Sentinel-2 NDVI cache per parcel. BR-K7 — 12h TTL. Owner-read RLS.';

alter event trigger trg_enforce_rls_on_public_tables enable;

drop policy if exists "kat_ndvi_select_owner" on public.m1_katara_ndvi_cache;
create policy "kat_ndvi_select_owner"
    on public.m1_katara_ndvi_cache for select to authenticated
    using (
        exists (
            select 1
              from public.m1_katara_parcels p
             where p.id = m1_katara_ndvi_cache.parcel_id
               and p.farmer_id = auth.uid()
        )
    );

-- No INSERT / UPDATE / DELETE policy for authenticated — service_role only.
```

---

### 5.2 Worker package layout

```
backend/app/workers/katara_diagnostic/
    __init__.py
    __main__.py             # entrypoint
    listener.py             # LISTEN/NOTIFY + 60s backstop
    claimer.py              # atomic PENDING → PROCESSING UPDATE
    orchestrator.py         # OWM → Sentinel → 7d → Gemini → COMPLETED/FAILED
    owm_client.py           # cached OWM forecast fetcher (BR-K3)
    sentinel_client.py      # cached Sentinel NDVI fetcher (BR-K7)
    telemetry_aggregator.py # 7-day per-parcel AVG query
    prompts.py              # Jinja2 templates + locale dispatch
    gemini_client.py        # google-generativeai SDK wrapper
    updater.py              # mark_completed / mark_failed
```

The shape mirrors `katara_threshold/` from KAT-06 deliberately — same `__main__` boot, same listener LISTEN/NOTIFY + backstop pattern, same `mailer.py` reuse pattern (though here for Gemini, the equivalent neutral wrapper is `gemini_client.py`).

### 5.3 `__main__.py` — entrypoint

Create `backend/app/workers/katara_diagnostic/__main__.py`:

```python
"""KAT-08 — Katara AI diagnostic worker entrypoint.

Boots Sentry, configures JSON logging, installs signal handlers,
then runs the LISTEN/NOTIFY listener loop. Mirrors the
katara_threshold __main__ from KAT-06.
"""
from __future__ import annotations

import asyncio
import os
import signal
import sys

import sentry_sdk

from app.core.logging import configure_json_logging
from app.workers.katara_diagnostic.listener import run_listener

_log = configure_json_logging("katara_diagnostic")


def _init_sentry() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        _log.info("sentry_dsn_unset_skipping_init")
        return
    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=0.1,
        environment=os.getenv("VITACHAIN_ENV", "staging"),
        release=os.getenv("VITACHAIN_RELEASE", "unset"),
    )


def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    stop = asyncio.Event()
    def _on_signal(signame: str) -> None:
        _log.info("signal_received", extra={"signal": signame})
        stop.set()

    if sys.platform == "win32":
        # Windows event loop does not support add_signal_handler.
        signal.signal(signal.SIGINT, lambda *_: _on_signal("SIGINT"))
        signal.signal(signal.SIGTERM, lambda *_: _on_signal("SIGTERM"))
    else:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _on_signal, sig.name)
    loop.create_task(_supervise(stop))


async def _supervise(stop: asyncio.Event) -> None:
    await stop.wait()
    for task in asyncio.all_tasks():
        if task is not asyncio.current_task():
            task.cancel()


def main() -> None:
    _init_sentry()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _install_signal_handlers(loop)
    try:
        loop.run_until_complete(run_listener())
    except asyncio.CancelledError:
        _log.info("worker_shutdown_clean")
    finally:
        loop.close()


if __name__ == "__main__":
    main()
```

### 5.4 `listener.py` — LISTEN/NOTIFY + backstop

```python
"""KAT-08 listener — LISTEN on katara_diagnostic_requested + 60s backstop.

The backstop runs a single SELECT for the oldest PENDING row — BR-K6 caps
inbound rate at 3/parcel/24h so backstop volume is bounded.
"""
from __future__ import annotations

import asyncio
import os
from uuid import UUID

import asyncpg
import sentry_sdk

from app.core.logging import get_logger
from app.workers.katara_diagnostic.orchestrator import run_diagnostic
from app.workers.katara_diagnostic.claimer import claim_pending

_log = get_logger(__name__)

_CHANNEL = "katara_diagnostic_requested"
_BACKSTOP_INTERVAL_S = 60
_QUEUE_MAXSIZE = 256
_RECONNECT_BACKOFF_S = (1, 2, 4, 8, 30, 60)


async def run_listener() -> None:
    queue: asyncio.Queue[UUID] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
    asyncio.create_task(_consumer(queue))
    asyncio.create_task(_backstop_loop(queue))
    backoff_idx = 0
    while True:
        try:
            conn = await asyncpg.connect(os.environ["DATABASE_URL"])
            await conn.add_listener(_CHANNEL, _on_notify(queue))
            _log.info("listener_connected", extra={"channel": _CHANNEL})
            await _backstop_once(queue)  # catch any rows missed during reconnect
            backoff_idx = 0
            await _stay_alive(conn)
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            delay = _RECONNECT_BACKOFF_S[
                min(backoff_idx, len(_RECONNECT_BACKOFF_S) - 1)
            ]
            backoff_idx += 1
            _log.warning(
                "listener_reconnect",
                extra={"delay_s": delay, "error": repr(exc)},
            )
            await asyncio.sleep(delay)


def _on_notify(queue: asyncio.Queue[UUID]):
    def _handler(_conn, _pid, _channel, payload: str) -> None:
        try:
            uid = UUID(payload)
        except ValueError as exc:
            sentry_sdk.capture_exception(exc)
            _log.warning("listener_bad_payload", extra={"payload": payload})
            return
        try:
            queue.put_nowait(uid)
        except asyncio.QueueFull:
            _log.warning("listener_queue_full_dropping", extra={"id": str(uid)})
    return _handler


async def _stay_alive(conn: asyncpg.Connection) -> None:
    while not conn.is_closed():
        await asyncio.sleep(30)


async def _consumer(queue: asyncio.Queue[UUID]) -> None:
    while True:
        diag_id = await queue.get()
        try:
            row = await claim_pending(diag_id)
            if row is None:
                continue  # already claimed or already terminal
            await run_diagnostic(row)
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            _log.exception("orchestrator_unhandled", extra={"id": str(diag_id)})


async def _backstop_loop(queue: asyncio.Queue[UUID]) -> None:
    while True:
        await asyncio.sleep(_BACKSTOP_INTERVAL_S)
        await _backstop_once(queue)


async def _backstop_once(queue: asyncio.Queue[UUID]) -> None:
    """Scan for the oldest PENDING and re-enqueue.

    BR-K6 caps inbound at 3/parcel/24h, so the working set is tiny.
    """
    from app.db import service_client
    db = service_client()
    res = (
        db.table("m1_katara_diagnostics")
        .select("id")
        .eq("status", "PENDING")
        .order("requested_at", desc=False)
        .limit(8)
        .execute()
    )
    for row in (res.data or []):
        try:
            queue.put_nowait(UUID(row["id"]))
        except asyncio.QueueFull:
            break
```

### 5.5 `claimer.py` — atomic transition

```python
"""KAT-08 claimer — atomic PENDING → PROCESSING using the audit-guard's
service-role write privilege."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from app.core.logging import get_logger
from app.db import service_client

_log = get_logger(__name__)


async def claim_pending(diagnostic_id: UUID) -> dict | None:
    """Try to claim a PENDING row. Returns the post-claim row or None.

    The UPDATE is filtered on status='PENDING', so a row already claimed
    by a sibling worker returns no rows — we exit silently.
    """
    db = service_client()
    res = (
        db.table("m1_katara_diagnostics")
        .update({
            "status": "PROCESSING",
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", str(diagnostic_id))
        .eq("status", "PENDING")
        .execute()
    )
    rows = res.data or []
    if not rows:
        _log.info("claim_lost_or_terminal", extra={"id": str(diagnostic_id)})
        return None
    return rows[0]
```

> **Note on `select=*` on Supabase UPDATE**: the Python supabase-py client returns the affected row(s) in `data` by default with `Prefer: return=representation`. KAT-06's evaluator relies on the same behaviour for `last_alert_at` writes. No code change needed.

### 5.6 `telemetry_aggregator.py`

```python
"""KAT-08 — 7-day per-parcel sensor aggregate.

The payload schema (per the project memory) is:
  soil_moisture, soil_temperature, soil_pH, soil_conductivity, battery_level.
NOT air_humidity / air_temperature (the spec text is stale; the migration is correct).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from app.db import service_client


def fetch_7d_average(parcel_id: UUID) -> dict:
    db = service_client()
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    res = db.rpc(
        "m1_katara_telemetry_7d_avg",
        {"p_parcel_id": str(parcel_id), "p_since": since},
    ).execute()
    rows = res.data or []
    if not rows or (rows[0].get("sample_count") or 0) == 0:
        return {"no_sensor_data": True}
    r = rows[0]
    return {
        "no_sensor_data": False,
        "sample_count":    r["sample_count"],
        "avg_moisture":    r["avg_moisture"],
        "avg_temperature": r["avg_temperature"],
        "avg_ph":          r["avg_ph"],
        "avg_ec":          r["avg_ec"],
        "avg_battery":     r["avg_battery"],
    }
```

The RPC `public.m1_katara_telemetry_7d_avg(p_parcel_id uuid, p_since timestamptz)` is a `SECURITY DEFINER` function added in migration 0023 — it runs as service_role so it can read every row, scoped to the input parcel:

```sql
create or replace function public.m1_katara_telemetry_7d_avg(
    p_parcel_id uuid,
    p_since     timestamptz
) returns table (
    sample_count    bigint,
    avg_moisture    numeric,
    avg_temperature numeric,
    avg_ph          numeric,
    avg_ec          numeric,
    avg_battery     numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
    select
        count(*)::bigint                 as sample_count,
        avg(soil_moisture)::numeric      as avg_moisture,
        avg(soil_temperature)::numeric   as avg_temperature,
        avg(soil_pH)::numeric            as avg_ph,
        avg(soil_conductivity)::numeric  as avg_ec,
        avg(battery_level)::numeric      as avg_battery
      from public.m1_katara_telemetry
     where parcel_id = p_parcel_id
       and recorded_at >= p_since;
$$;

revoke all on function public.m1_katara_telemetry_7d_avg(uuid, timestamptz) from public;
grant  execute on function public.m1_katara_telemetry_7d_avg(uuid, timestamptz)
    to service_role;
```

`EXPLAIN ANALYZE` over a parcel with 672 telemetry rows (1 reading / 15 min × 7 days): index-only scan on `kat_telemetry_parcel_recorded_idx`, p50 < 4 ms — well within the 30 s end-to-end budget.

### 5.7 `owm_client.py` — cached OWM fetcher

```python
"""KAT-08 OpenWeatherMap client with BR-K3 3-hour cache.

Lat/lng are quantised to 0.01° (~1.1km) so neighbouring parcels share a row.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import httpx
import sentry_sdk

from app.core.logging import get_logger
from app.db import service_client

_log = get_logger(__name__)

_OWM_URL = "https://api.openweathermap.org/data/2.5/forecast"
_CACHE_TTL = timedelta(hours=3)


def _quantise(coord: float) -> float:
    return round(coord, 2)


def fetch_weather(lat: float, lng: float) -> dict:
    lat_q, lng_q = _quantise(lat), _quantise(lng)
    db = service_client()
    cached = (
        db.table("m1_katara_owm_cache")
        .select("data,fetched_at")
        .eq("lat_q", lat_q)
        .eq("lng_q", lng_q)
        .limit(1)
        .execute()
    )
    row = (cached.data or [None])[0]
    if row:
        fetched_at = datetime.fromisoformat(row["fetched_at"].replace("Z", "+00:00"))
        if fetched_at > datetime.now(timezone.utc) - _CACHE_TTL:
            sentry_sdk.add_breadcrumb(category="owm", message="cache_hit")
            return row["data"]

    sentry_sdk.add_breadcrumb(category="owm", message="cache_miss")
    api_key = os.environ["OPENWEATHERMAP_API_KEY"]
    resp = httpx.get(
        _OWM_URL,
        params={"lat": lat, "lon": lng, "appid": api_key, "units": "metric"},
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json()

    db.table("m1_katara_owm_cache").upsert({
        "lat_q":      lat_q,
        "lng_q":      lng_q,
        "data":       data,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    return data
```

### 5.8 `sentinel_client.py` — cached NDVI fetcher

```python
"""KAT-08 Sentinel Hub NDVI client with BR-K7 12-hour cache.

OAuth client-credentials flow; token cached in-process for its 1-hour TTL.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
import sentry_sdk

from app.core.logging import get_logger
from app.db import service_client

_log = get_logger(__name__)

_TOKEN_URL   = "https://services.sentinel-hub.com/oauth/token"
_PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process"
_CACHE_TTL   = timedelta(hours=12)

_NDVI_EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "dataMask"],
    output: { bands: 1, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  return [ndvi * s.dataMask];
}
"""

_token_cache: dict = {"token": None, "expires_at": 0}


def _get_token() -> str:
    if _token_cache["token"] and time.time() < _token_cache["expires_at"]:
        return _token_cache["token"]
    resp = httpx.post(
        _TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id":     os.environ["SENTINEL_HUB_CLIENT_ID"],
            "client_secret": os.environ["SENTINEL_HUB_CLIENT_SECRET"],
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    payload = resp.json()
    _token_cache["token"]      = payload["access_token"]
    _token_cache["expires_at"] = time.time() + payload["expires_in"] - 60
    return _token_cache["token"]


def fetch_ndvi(parcel_id: UUID, polygon_geojson: dict) -> dict:
    db = service_client()
    cached = (
        db.table("m1_katara_ndvi_cache")
        .select("mean_ndvi,acquisition_date,fetched_at")
        .eq("parcel_id", str(parcel_id))
        .limit(1)
        .execute()
    )
    row = (cached.data or [None])[0]
    if row:
        fetched_at = datetime.fromisoformat(row["fetched_at"].replace("Z", "+00:00"))
        if fetched_at > datetime.now(timezone.utc) - _CACHE_TTL:
            sentry_sdk.add_breadcrumb(category="ndvi", message="cache_hit")
            return {
                "mean_ndvi":        float(row["mean_ndvi"]),
                "acquisition_date": row["acquisition_date"],
            }

    sentry_sdk.add_breadcrumb(category="ndvi", message="cache_miss")
    today = datetime.now(timezone.utc).date()
    window_from = today - timedelta(days=14)  # widen for cloud cover
    body = {
        "input": {
            "bounds": {
                "geometry":   polygon_geojson,
                "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"},
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {
                        "from": f"{window_from}T00:00:00Z",
                        "to":   f"{today}T23:59:59Z",
                    },
                    "mosaickingOrder": "leastCC",
                },
            }],
        },
        "evalscript": _NDVI_EVALSCRIPT,
        "output": {"width": 64, "height": 64, "responses": [
            {"identifier": "default", "format": {"type": "image/tiff"}},
        ]},
    }
    resp = httpx.post(
        _PROCESS_URL,
        json=body,
        headers={
            "Authorization": f"Bearer {_get_token()}",
            "Accept":        "image/tiff",
        },
        timeout=20.0,
    )
    resp.raise_for_status()
    mean = _mean_ndvi_from_tiff(resp.content)
    acquisition_date = today.isoformat()  # mosaickingOrder=leastCC clamps; we approximate

    db.table("m1_katara_ndvi_cache").upsert({
        "parcel_id":        str(parcel_id),
        "mean_ndvi":        round(mean, 3),
        "acquisition_date": acquisition_date,
        "fetched_at":       datetime.now(timezone.utc).isoformat(),
    }).execute()
    return {"mean_ndvi": mean, "acquisition_date": acquisition_date}


def _mean_ndvi_from_tiff(tiff_bytes: bytes) -> float:
    """Compute mean NDVI from the single-band float32 TIFF response.

    `tifffile` is already in requirements for INF-04's image-handling baseline.
    """
    import io
    import tifffile
    import numpy as np
    arr = tifffile.imread(io.BytesIO(tiff_bytes))
    valid = arr[~np.isnan(arr)]
    if valid.size == 0:
        return 0.0
    return float(valid.mean())
```

### 5.9 `prompts.py` — Jinja2 prompt builder

```python
"""KAT-08 — locale-aware Gemini prompt builder.

FR is the P0 baseline. AR + EN templates ship in I18N-06; this module
already dispatches on locale and falls back to FR per PRD §7.2.
"""
from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_env = Environment(
    loader=FileSystemLoader(_TEMPLATE_DIR),
    autoescape=select_autoescape(),
    trim_blocks=True,
    lstrip_blocks=True,
)

_FALLBACK_LOCALE = "fr"
_SUPPORTED = {"fr", "ar", "en"}  # ar/en land in I18N-06; fr ships in KAT-08


def build_prompt(
    *,
    parcel: dict,
    owm: dict,
    ndvi: dict,
    sensor_7d: dict,
    locale: str,
) -> str:
    resolved = locale if locale in _SUPPORTED else _FALLBACK_LOCALE
    tpl_name = f"diagnostic_{resolved}.j2"
    if not (_TEMPLATE_DIR / tpl_name).exists():
        tpl_name = f"diagnostic_{_FALLBACK_LOCALE}.j2"
    template = _env.get_template(tpl_name)
    return template.render(
        parcel=parcel,
        owm=owm,
        ndvi=ndvi,
        sensor_7d=sensor_7d,
    )
```

Template `backend/app/workers/katara_diagnostic/templates/diagnostic_fr.j2`:

```jinja2
Tu es un agronome marocain expert en cultures maraîchères et céréalières.
Analyse les données suivantes pour la parcelle "{{ parcel.name }}" ({{ parcel.crop_type }}, {{ parcel.area_ha }} ha) et fournis un diagnostic en Markdown comportant :

1. **Diagnostic** (3-5 phrases) — état général de la parcelle.
2. **Recommandations d'irrigation** (puces) — quand et combien arroser dans les 5 prochains jours.
3. **Risques détectés** (puces) — stress hydrique, salinité, pH, maladies probables compte tenu de la météo.
4. **Action prioritaire** — une seule action à mener dans les 48 h.

## Données capteurs (moyenne 7 jours)
{% if sensor_7d.no_sensor_data %}
Aucune donnée capteur disponible — base ton analyse sur la météo et le NDVI uniquement et précise cette limite dans le diagnostic.
{% else %}
- Humidité du sol moyenne : {{ "%.1f"|format(sensor_7d.avg_moisture) }} %
- Température du sol moyenne : {{ "%.1f"|format(sensor_7d.avg_temperature) }} °C
- pH du sol moyen : {{ "%.2f"|format(sensor_7d.avg_ph) }}
- Conductivité (EC) moyenne : {{ "%.0f"|format(sensor_7d.avg_ec) }} µS/cm
- Niveau de batterie capteur : {{ sensor_7d.avg_battery|round(0) }} %
- Échantillons sur 7 jours : {{ sensor_7d.sample_count }}
{% endif %}

## Météo (OpenWeatherMap, 5 jours)
- Température actuelle : {{ owm.list[0].main.temp }} °C
- Précipitations cumulées 5j : {{ owm.list | sum(attribute='rain.3h', default=0) | round(1) }} mm
- Humidité moyenne air : {{ (owm.list | map(attribute='main.humidity') | sum / owm.list|length) | round(0) }} %

## NDVI satellite (Sentinel-2)
- NDVI moyen : {{ "%.2f"|format(ndvi.mean_ndvi) }} (acquis le {{ ndvi.acquisition_date }})

Réponds uniquement en français, en Markdown, et reste concret et actionnable. Pas de disclaimers.
```

### 5.10 `gemini_client.py`

```python
"""KAT-08 Gemini wrapper — gemini-1.5-flash via google-generativeai SDK."""
from __future__ import annotations

import asyncio
import os

import google.generativeai as genai
from google.api_core import exceptions as gax

from app.core.logging import get_logger

_log = get_logger(__name__)
_MODEL = "gemini-1.5-flash"
_MAX_RETRIES = 2


def _configure_once() -> None:
    if not getattr(_configure_once, "_done", False):
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        _configure_once._done = True  # type: ignore[attr-defined]


async def call_gemini(prompt: str) -> str:
    _configure_once()
    model = genai.GenerativeModel(_MODEL)
    backoff = 1.0
    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = await asyncio.wait_for(
                asyncio.to_thread(model.generate_content, prompt),
                timeout=30.0,
            )
            return (resp.text or "").strip()
        except gax.ResourceExhausted as exc:
            if attempt == _MAX_RETRIES:
                raise
            _log.warning("gemini_rate_limited_retrying",
                         extra={"attempt": attempt, "backoff_s": backoff})
            await asyncio.sleep(backoff)
            backoff *= 2
    raise RuntimeError("unreachable")
```

### 5.11 `updater.py`

```python
"""KAT-08 — terminal-state UPDATE helpers.

Both filter on status='PROCESSING' so a row already terminated by an
admin override (e.g. manual COMPLETED to unstick a stuck demo) is not
overwritten.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from app.db import service_client


def mark_completed(diagnostic_id: UUID, result_text: str) -> None:
    db = service_client()
    db.table("m1_katara_diagnostics").update({
        "status":       "COMPLETED",
        "result_text":  result_text,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", str(diagnostic_id)).eq("status", "PROCESSING").execute()


def mark_failed(diagnostic_id: UUID, error_detail: str) -> None:
    db = service_client()
    db.table("m1_katara_diagnostics").update({
        "status":       "FAILED",
        "error_detail": error_detail[:1000],  # cap for DB sanity
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", str(diagnostic_id)).eq("status", "PROCESSING").execute()
```

### 5.12 `orchestrator.py`

```python
"""KAT-08 — Sequential gather + Gemini call + terminal state UPDATE.

Strict failure semantics: every exception lands the row in FAILED;
nothing leaves a row stuck in PROCESSING. No exceptions escape this function.
"""
from __future__ import annotations

from uuid import UUID

import sentry_sdk

from app.core.logging import get_logger
from app.db import service_client
from app.workers.katara_diagnostic.gemini_client import call_gemini
from app.workers.katara_diagnostic.owm_client import fetch_weather
from app.workers.katara_diagnostic.prompts import build_prompt
from app.workers.katara_diagnostic.sentinel_client import fetch_ndvi
from app.workers.katara_diagnostic.telemetry_aggregator import fetch_7d_average
from app.workers.katara_diagnostic.updater import mark_completed, mark_failed

_log = get_logger(__name__)


async def run_diagnostic(claimed_row: dict) -> None:
    diag_id  = UUID(claimed_row["id"])
    parcel_id = UUID(claimed_row["parcel_id"])
    farmer_id = UUID(claimed_row["farmer_id"])
    try:
        parcel = _fetch_parcel(parcel_id)
        if parcel.get("centroid_lat") is None or parcel.get("centroid_lng") is None:
            mark_failed(diag_id, "parcel_missing_centroid")
            return

        locale = _fetch_locale(farmer_id)

        try:
            owm = fetch_weather(parcel["centroid_lat"], parcel["centroid_lng"])
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            mark_failed(diag_id, f"owm_unavailable: {exc!r}")
            return

        try:
            ndvi = fetch_ndvi(parcel_id, parcel["geojson"])
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            mark_failed(diag_id, f"ndvi_unavailable: {exc!r}")
            return

        sensor_7d = fetch_7d_average(parcel_id)

        try:
            prompt = build_prompt(
                parcel=parcel, owm=owm, ndvi=ndvi,
                sensor_7d=sensor_7d, locale=locale,
            )
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            mark_failed(diag_id, f"prompt_build_failed: {exc!r}")
            return

        try:
            result_text = await call_gemini(prompt)
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            tag = "gemini_rate_limited" if "ResourceExhausted" in repr(exc) else "gemini_failed"
            mark_failed(diag_id, f"{tag}: {exc!r}")
            return

        if not result_text:
            mark_failed(diag_id, "gemini_empty_response")
            return

        mark_completed(diag_id, result_text)
        _log.info("diagnostic_completed", extra={"id": str(diag_id)})

    except Exception as exc:  # last-resort guard
        sentry_sdk.capture_exception(exc)
        mark_failed(diag_id, f"orchestrator_unexpected: {exc!r}")


def _fetch_parcel(parcel_id: UUID) -> dict:
    db = service_client()
    res = (
        db.table("m1_katara_parcels")
        .select("id,name,crop_type,area_ha,centroid_lat,centroid_lng,geojson")
        .eq("id", str(parcel_id))
        .limit(1)
        .execute()
    )
    return (res.data or [{}])[0]


def _fetch_locale(farmer_id: UUID) -> str:
    db = service_client()
    res = (
        db.table("profiles")
        .select("locale")
        .eq("id", str(farmer_id))
        .limit(1)
        .execute()
    )
    row = (res.data or [{}])[0]
    return row.get("locale") or "fr"
```

### 5.13 Docker Compose service

Append to `infra/docker-compose.yml`:

```yaml
  katara_diagnostic_worker:
    image: vitachain/backend:latest
    command: ["python", "-m", "app.workers.katara_diagnostic"]
    restart: unless-stopped
    depends_on:
      - backend
    environment:
      DATABASE_URL:                              ${DATABASE_URL}
      SUPABASE_URL:                              ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY:                      ${SUPABASE_SERVICE_KEY}
      OPENWEATHERMAP_API_KEY:                    ${OPENWEATHERMAP_API_KEY}
      SENTINEL_HUB_CLIENT_ID:                    ${SENTINEL_HUB_CLIENT_ID}
      SENTINEL_HUB_CLIENT_SECRET:                ${SENTINEL_HUB_CLIENT_SECRET}
      GEMINI_API_KEY:                            ${GEMINI_API_KEY}
      SENTRY_DSN:                                ${SENTRY_DSN}
      HEALTHCHECKS_KAT_DIAGNOSTIC_PING_URL:      ${HEALTHCHECKS_KAT_DIAGNOSTIC_PING_URL}
      VITACHAIN_ENV:                             ${VITACHAIN_ENV}
    healthcheck:
      test: ["CMD-SHELL", "pgrep -f 'app.workers.katara_diagnostic' > /dev/null"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Append to `infra/.env.example`:

```
OPENWEATHERMAP_API_KEY=
SENTINEL_HUB_CLIENT_ID=
SENTINEL_HUB_CLIENT_SECRET=
GEMINI_API_KEY=
HEALTHCHECKS_KAT_DIAGNOSTIC_PING_URL=
```

### 5.14 AUTH-05 callsite allow-list

In `backend/tests/test_service_client_callsite_allowlist.py`, extend `_ALLOWED_PREFIXES`:

```python
_ALLOWED_PREFIXES = (
    "app/workers/katara_threshold/",
    "app/workers/katara_diagnostic/",   # ← KAT-08
    "app/workers/mailer.py",
    # ...existing entries...
)
```

---

## 6. Design Decisions & Risks

### 6.1 Why a NOTIFY trigger and not the worker polling alone?

KAT-06 set the precedent: LISTEN on a NOTIFY channel for the hot path, plus a periodic backstop poll for missed events (worker restart, asyncpg reconnect gap, payload parse failure). The cost is one trivial `pg_notify` per diagnostic INSERT — and BR-K6 caps inbound at 3/parcel/24 h, so volume is negligible. The benefit is a sub-second pickup latency for the demo path. Pure polling at 60 s would mean a worst-case 59 s wait before any work starts — visible to the farmer.

### 6.2 Why is the OWM cache key quantised to 0.01° and not parcel-id?

Two parcels in the same village receive the same weather. Keying the cache on parcel-id would multiply storage and HTTP load N-fold for no agronomic benefit. 0.01° (~1.1 km grid) is finer than OWM's own model resolution (~30 km for ECMWF) so we lose no signal. The slight coarsening also defeats a fingerprinting concern (per-parcel cache rows would leak parcel locations into a system-internal table).

### 6.3 Why is NDVI keyed on parcel-id and not on polygon?

NDVI is computed *over the polygon* — the result is parcel-specific. We could hash the polygon to a stable key, but parcels are rarely edited, the row count is bounded (one per parcel), and ON DELETE CASCADE keeps the cache clean. A future "parcel polygon updated" event invalidates the row by simply being a new INSERT — the existing row is replaced via `upsert`.

### 6.4 Why is the orchestrator sequential, not concurrent?

The three external fetches (OWM, Sentinel, telemetry) are *not* expensive — OWM is sub-second cached, NDVI is sub-second cached after warm-up, telemetry is an index-only scan. The Gemini call dominates total latency (5-15 s). Concurrent fetches would shave ~50-200 ms at the cost of harder failure-mode reasoning ("which fetch raised first if two failed?"). For MVD, sequential is correct. If post-MVD profiling shows it matters, swap to `asyncio.gather` and surface the first exception.

### 6.5 Failure-mode taxonomy

Every external call lands a specific `error_detail` prefix so admin/Sentry can triage without reading code:

| Tag | Cause | Likely fix |
|---|---|---|
| `parcel_missing_centroid` | KAT-01 trigger regressed; parcel row has null centroid | Re-run `update m1_katara_parcels set geojson = geojson` to retrigger; file a KAT-01 bug |
| `owm_unavailable` | OWM 5xx, network, DNS, quota | Check Sentry; OWM quota monitor; usually transient |
| `ndvi_unavailable` | Sentinel auth failure, polygon error, processing-unit quota | Check Sentinel dashboard; rotate OAuth credentials |
| `gemini_rate_limited` | 1.5 K/day exceeded | Drop to `gemini-1.5-flash-8b` (smaller free quota partner) or wait for daily reset |
| `gemini_failed` | Gemini 5xx, safety filter triggered | Inspect `error_detail`; for safety filters, prompt-engineer the template |
| `gemini_empty_response` | Gemini returned no text (rare; safety) | Same as `gemini_failed` |
| `prompt_build_failed` | Jinja2 render error (e.g. missing OWM field) | Likely an OWM schema drift; widen template defaults |
| `orchestrator_unexpected` | Unhandled exception | Treat as a Sev-2 — should not happen, code path is fully wrapped |

### 6.6 Why filter the COMPLETED/FAILED UPDATE on `status='PROCESSING'`?

A manual admin row override (`update m1_katara_diagnostics set status='COMPLETED', result_text='Démonstration pré-enregistrée' where id=...`) is part of the Risk Register R5 "Smoke & Mirrors" fallback. Without the status guard, the worker would happily overwrite the manual entry. The filter pins the worker to legitimate work and lets demo-day fallbacks stick.

### 6.7 Single-replica deployment

The atomic-claim pattern supports N replicas, but a single replica is correct for MVD. Two replicas would burn double the Gemini quota on every contended row (one wins the claim, the other no-ops — quota is unaffected, but cost framing matters). If demand grows, raise `replicas` in compose and the contract holds.

### 6.8 Why no DB-side cron-purge of stale OWM rows?

The cache is upsert-only; a stale row is overwritten on the next fetch in the same coordinate cell. Disk growth is bounded by the number of distinct 0.01° cells served, which for Morocco at MVD scale is < 200 rows ever. A nightly `DELETE WHERE fetched_at < now() - interval '7 days'` is post-MVD if storage becomes a concern.

### 6.9 Spec drift acknowledgement (memory note)

The Technical Specifications doc (L922–926) still describes a Gemini prompt feeding `air_humidity` and `air_temperature`. The actual payload — and therefore this story's prompt — uses `soil_pH` and `soil_conductivity`. Per the standing project memory: the code in KAT-08 is the source of truth; the spec text update is a separate doc PR queued behind the KAT-DONE chain. The pgTAP / unit tests guard against any regression back to the air-metric columns.

---

## 7. Tests

### 7.1 `test_kat08_claimer.py`

| # | Scenario | Expected |
|---|---|---|
| C1 | `claim_pending(id)` on a PENDING row | Returns row with `status='PROCESSING'`, `started_at` set |
| C2 | `claim_pending(id)` called twice in quick succession (simulated race) | First call returns row; second returns `None` |
| C3 | `claim_pending(id)` on a row already in `PROCESSING` | Returns `None` |
| C4 | `claim_pending(id)` on a row in `COMPLETED` | Returns `None` |

### 7.2 `test_kat08_owm_cache.py`

| # | Scenario | Expected |
|---|---|---|
| O1 | Cache hit < 3 h (fixture row 1 h old) | Returns cached data; `httpx.get` not called (monkey-patched to raise) |
| O2 | Cache stale > 3 h (fixture row 5 h old) | `httpx.get` called once; cache row upserted; new `fetched_at` |
| O3 | Two requests at (33.589, -7.612) and (33.592, -7.615) | One cache row keyed (33.59, -7.61); second call is a cache hit |
| O4 | OWM returns 503 | Exception propagates out (orchestrator handles → FAILED) |

### 7.3 `test_kat08_ndvi_cache.py`

| # | Scenario | Expected |
|---|---|---|
| N1 | Cache hit < 12 h | Returns cached mean_ndvi + acquisition_date; no HTTP call |
| N2 | Cache stale > 12 h | Full flow: token → Process API → tifffile.imread → cache upsert |
| N3 | Token cached for its TTL | Second call within token TTL skips the `_TOKEN_URL` request |
| N4 | Empty TIFF (all-NaN due to full cloud cover) | Returns `mean_ndvi=0.0`; no crash |

### 7.4 `test_kat08_aggregator.py`

| # | Scenario | Expected |
|---|---|---|
| A1 | Parcel with 10 telemetry rows in last 7 days | `sample_count=10`, all 5 avgs present, `no_sensor_data=False` |
| A2 | Parcel with 0 telemetry rows | `no_sensor_data=True` |
| A3 | Parcel with rows older than 7 days only | `no_sensor_data=True` (the 7-day window excludes them) |
| A4 | Memory drift guard | The RPC's `RETURNS TABLE` columns include `avg_ph` + `avg_ec`; *no* `avg_air_humidity` / `avg_air_temperature` columns exist |

### 7.5 `test_kat08_prompt.py`

| # | Scenario | Expected |
|---|---|---|
| P1 | All inputs present, locale=`fr` | Template renders all 5 sensor metrics + OWM + NDVI; result is non-empty Markdown |
| P2 | `no_sensor_data=True` | Template branches to "Aucune donnée capteur disponible" copy |
| P3 | Unsupported locale (`zgh`) | Falls back to FR template (PRD §7.2) |
| P4 | Missing AR template file at fixture-time, locale=`ar` | Falls back to FR (defensive — I18N-06 lands the AR file) |

### 7.6 `test_kat08_orchestrator.py`

| # | Scenario | Expected |
|---|---|---|
| Or1 | Happy path — all calls mocked to succeed | Row lands COMPLETED, `result_text` set, `completed_at` not null |
| Or2 | OWM raises `httpx.HTTPStatusError(503)` | Row lands FAILED, `error_detail` starts with `owm_unavailable` |
| Or3 | Sentinel raises | Row lands FAILED, `error_detail` starts with `ndvi_unavailable` |
| Or4 | Gemini raises `ResourceExhausted` after `_MAX_RETRIES+1` attempts | Row lands FAILED, `error_detail` starts with `gemini_rate_limited` |
| Or5 | Gemini returns empty string | Row lands FAILED with `gemini_empty_response` |
| Or6 | Parcel has null centroid | Row lands FAILED with `parcel_missing_centroid`; no external call attempted |
| Or7 | Row already COMPLETED before mark_completed runs (admin override mid-flight) | `mark_completed` UPDATE no-ops (`status='PROCESSING'` filter); row stays COMPLETED with the admin-supplied `result_text` |

### 7.7 `test_kat08_listener_e2e.py` (`--run-e2e` gated)

| # | Scenario | Expected |
|---|---|---|
| E1 | Live POST as verified FARMER on staging | Within 30 s, `GET /diagnostics/latest` returns `status=COMPLETED` with non-empty `result_text`; Sentry shows `owm_cache_miss` then `owm_cache_hit` on the second back-to-back run |
| E2 | Same farmer, second diagnostic on the same parcel within the 24h window | Returns 429 (KAT-07 BR-K6); worker not invoked |
| E3 | OWM key intentionally unset for the duration of the test | First diagnostic lands FAILED with `owm_unavailable`; subsequent diagnostic with the key restored lands COMPLETED |

### 7.8 pgTAP cells — `db/tests/auth07_business_rules.sql`

Append a `KAT-08 — m1_katara_diagnostics (worker writes) + caches` block:

| Cell | Role | Operation | Expected |
|---|---|---|---|
| D-9 | service_role | UPDATE `status='COMPLETED', result_text='ok', completed_at=now()` on a PROCESSING row | Succeeds |
| D-10 | service_role | UPDATE `status='FAILED', error_detail='owm', completed_at=now()` on a PROCESSING row | Succeeds |
| D-11 | service_role | UPDATE filtered on `status='PROCESSING'` against a row already COMPLETED | 0 rows affected (worker can't clobber admin override) |
| D-12 | authenticated FARMER-A | SELECT from `m1_katara_owm_cache` | 0 rows (system-internal, no read policy) |
| D-13 | authenticated FARMER-A | SELECT NDVI cache row for own parcel | Sees own row; FARMER-B sees 0 rows |

---

## 8. Observability

| Signal | Where | Detail |
|---|---|---|
| Sentry traces | `katara_diagnostic` Sentry project (shared with backend, distinguished by `release.transaction_op = 'orchestrator.run_diagnostic'`) | Each diagnostic produces one transaction; OWM / Sentinel / Gemini are child spans via `sentry_sdk.start_span` (add inside each client) |
| Sentry breadcrumbs | `owm_cache_hit` / `owm_cache_miss` / `ndvi_cache_hit` / `ndvi_cache_miss` / `gemini_rate_limited_retrying` | Visible in any error event's breadcrumb trail for debugging cache-vs-fresh paths |
| Healthchecks.io | One new check `KAT_DIAGNOSTIC_WORKER_HEARTBEAT`; period 5 min, grace 2 min | The listener pings it inside `_stay_alive`; if the worker hangs in the consumer, Healthchecks alerts via Telegram per INF-08 |
| Logs (JSON to stdout, scraped by Docker) | `diagnostic_completed`, `claim_lost_or_terminal`, `listener_reconnect`, `gemini_rate_limited_retrying`, `listener_queue_full_dropping` | Each carries `id` field so a single `grep '"id":"7c1f..."'` reconstructs one diagnostic's lifecycle |
| Quota dashboards | OWM usage page (manual), Sentinel Hub dashboard (manual), Gemini Cloud Console (manual) | Demo-day pre-flight checklist item; no API integration |

No new endpoint, so no new NGINX zone (AUTH-08's "only four declared zones exist" cell stays green).

---

## 9. Acceptance Verification Checklist

Run on staging before flipping `spring-status.yml` to `IN_REVIEW`:

- [ ] `make -C db push` applies `0023_kat08_diagnostic_notify_and_caches.sql` cleanly
- [ ] `docker compose up -d katara_diagnostic_worker` boots; logs show `listener_connected channel=katara_diagnostic_requested` within 5 s
- [ ] Verified FARMER POSTs `/api/v1/katara/parcels/{id}/diagnostics` (KAT-07 surface) → row PENDING → row PROCESSING within 5 s → row COMPLETED within 30 s; `GET /diagnostics/latest` reflects each transition
- [ ] Sentry breadcrumb timeline shows `owm_cache_miss → ndvi_cache_miss → gemini call` for the cold first run; second diagnostic on a parcel in the same village shows `owm_cache_hit`
- [ ] Forge a parcel with `centroid_lat=NULL` → POST → row lands FAILED with `error_detail='parcel_missing_centroid'`; no OWM / Sentinel / Gemini HTTP request recorded in Sentry
- [ ] Temporarily unset `OPENWEATHERMAP_API_KEY` → POST → row lands FAILED with `error_detail` starting `owm_unavailable`; restore key + re-POST → COMPLETED
- [ ] Admin manually sets `status='COMPLETED', result_text='manual override'` on a fresh PENDING (Supabase dashboard) → worker picks it up, `claim_pending` no-ops (status no longer PENDING when claim runs), row stays at the manual values
- [ ] `pytest backend/tests/test_kat08_*.py -v` — all 7 files green
- [ ] `make -C db test-auth07` — D-1..D-13 cells green (D-9..D-13 are new)
- [ ] `test_service_client_callsite_allowlist.py` green (allow-list extended)
- [ ] Healthchecks.io `KAT_DIAGNOSTIC_WORKER_HEARTBEAT` showing green pings every 30-60 s
- [ ] Result text from a real diagnostic reviewed by the team — confirms the FR template renders the soil_pH and soil_conductivity values (memory-drift guard)

---

## 10. Hand-off Notes for KAT-09

KAT-09 (Brevo email on COMPLETED) builds on the following contracts shipped here:

1. **State transition is the event** — KAT-09 should add a small `AFTER UPDATE` trigger on `m1_katara_diagnostics` that fires `pg_notify('katara_diagnostic_completed', new.id::text)` only when `old.status <> 'COMPLETED' and new.status = 'COMPLETED'`. KAT-08 deliberately does not ship that trigger so KAT-09 owns the schema for its own concern and the AUTH-07 matrix entry for that trigger is unambiguous.
2. **The row carries everything the email needs**: `farmer_id` (→ `profiles.email` join), `parcel_id` (→ `m1_katara_parcels.name` join), `result_text` (Markdown body), and the farmer's `locale` (→ template variant). KAT-09 needs no new columns.
3. **Worker package layout** — copy `backend/app/workers/katara_diagnostic/` and slim it down: listener on the new channel + one orchestrator step (`send_completion_email`) reusing `backend/app/workers/mailer.py` from NOT-01. The Healthchecks heartbeat and Sentry init are copy-paste.
4. **Brevo templates** — `BREVO_TEMPLATE_KAT_DIAGNOSTIC_{FR,AR,EN}` env keys, three HTML files under `infra/brevo-templates/kat09_diagnostic_completion/`. The Markdown in `result_text` should be rendered as `<pre>` or via a tiny Markdown→HTML pass in the worker — Brevo templates do not interpret Markdown.
5. **No need to gate on FAILED** — the farmer is not emailed on failure (low value; the next diagnostic-request retry surfaces it). The dashboard chip + admin Sentry triage are the failure UX.
6. **Re-entrancy** — if KAT-09's worker restarts mid-send, the trigger has already fired; a backstop poll for `status='COMPLETED' AND completed_at > now() - interval '5 minutes' AND notified_at IS NULL` (KAT-09 will add `notified_at`) catches the gap. Mirror the KAT-06 listener's reconnect-then-`_backstop_once` pattern.
7. **End-to-end SLA** — PRD §10.1 sets "Brevo email delivered < 2 min after trigger". KAT-08's COMPLETED-to-trigger latency is < 100 ms (one trigger fire); Brevo's own send latency dominates. KAT-09's SLO is therefore "trigger → Brevo `send_template` 2xx in < 5 s on staging", measured by the new Healthchecks `KAT_DIAGNOSTIC_EMAIL_WORKER_HEARTBEAT`.
