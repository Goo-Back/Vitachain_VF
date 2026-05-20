# KAT-03 — ESP32 telemetry ingestion endpoint (15-min cadence, < 50 ms SLA)

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** ESP32 (machine; no user JWT)
> **Depends on:** [KAT-02](./KAT-02-esp32-device-pairing.md) (provides `public.verify_device_api_key()` and the `m1_katara_devices` row the payload must match) · [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) (service-role isolation — the ingest path is the second legitimate service-role callsite) · [AUTH-08](./AUTH-08-nginx-rate-limiting-public-endpoints.md) (a dedicated `limit_req_zone` for `/api/v1/katara/ingest` lives here)
> **Unblocks:** [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) (charts read from `m1_katara_telemetry`) · [KAT-05](./KAT-05-alert-thresholds.md) / [KAT-06](./KAT-06-threshold-email-alerts.md) (threshold checks fire on each insert) · [KAT-11](./KAT-11-offline-device-detection.md) (`last_seen` written here) · [KAT-08](./KAT-08-ai-diagnostic-weather-ndvi-7d-avg.md) (Gemini consumes a 7-day average derived from this table)
> **Acceptance:** `POST /api/v1/katara/ingest` responds in **< 50 ms (p50)** with a valid bcrypt-verified `device_id` + `api_key`; payload persisted; `m1_katara_devices.status` flipped to `ACTIVE`; `last_seen` updated. Constant-time key check via `public.verify_device_api_key()`. No AI / no Brevo / no synchronous side-effects on the ingest path.

---

## ⚠️ Pre-flight — Spec drift to reconcile before any code

The current [Documents/VitaChain_Technical_Specifications.md](../../Documents/VitaChain_Technical_Specifications.md) and [Documents/VitaChain_PRD.md](../../Documents/VitaChain_PRD.md) §6.1.1 KAT-03 still describe the **legacy** telemetry payload (`air_humidity`, `air_temperature`). The actual sensor hardware sends **soil-focused** metrics, confirmed by the user on 2026-05-16:

| Legacy spec field | KAT-03 replacement | Why |
|---|---|---|
| `air_humidity` | `soil_pH` | pH drives fertilisation + crop-suitability advice — far more actionable for Katara's "soil-focused diagnostic" positioning than ambient humidity. |
| `air_temperature` | `soil_conductivity` (EC) | Soil EC is the proxy for salinity / nutrient load; weather APIs already cover ambient air temp better than an ESP32 ever could. |

**Action before writing migration 0018:** open a short documentation PR that updates the four spec locations listed in `~/.claude/.../memory/project_katara_iot_payload.md` so the spec and code ship together. The migration, Pydantic model, history aggregation columns, and AI diagnostic prompt in later stories all assume the soil schema below. **Do not start coding until the spec is in flight** — the discrepancy is non-trivial and confused KAT-02 reviewers.

---

## 1. Purpose

KAT-02 paired the ESP32 to a parcel and gave the device a one-shot `vk_…` API key. KAT-03 is the hot path that turns that key into useful data: a ~96-payloads-per-day-per-device firehose that lands in `public.m1_katara_telemetry` and powers every downstream Katara feature.

This story delivers:

- The `public.m1_katara_telemetry` time-series table with composite `(device_id, recorded_at DESC)` index, a deferred-write status update, and **RLS in force-mode** (the service role bypasses by design — every other actor is denied).
- A FastAPI ingest endpoint `POST /api/v1/katara/ingest` that:
  - Authenticates the request via `device_id` + `api_key` headers — **never a JWT**.
  - Calls `public.verify_device_api_key()` (delivered in KAT-02) inside a single round-trip prepared statement.
  - Inserts the telemetry row, updates `last_seen`, and flips `PENDING → ACTIVE` (or `OFFLINE → ACTIVE`) on the device row.
  - Returns `204 No Content` in < 50 ms (p50) — no AI, no Brevo, no thresholds, no logging-to-Sentry on the happy path.
- A dedicated NGINX `limit_req_zone=katara_ingest:10m rate=10r/s` extending AUTH-08's rate-limit grid — a single device cadence is 1 req / 15 min, so 10 req/s leaves three orders of magnitude of headroom and still kills a stolen-key flood quickly.
- A backend-only `latest_telemetry` view (`public.m1_katara_telemetry_latest`) that KAT-04's dashboard will read against to dodge the full-scan pattern.
- A pgTAP block in AUTH-07's BR matrix covering: **BR-K1 leak-back** (ingest with a key from an `UNLINKED` device → 401), constant-time floor (bcrypt cost-10 verify ≤ 25 ms p99 on the demo VPS), and ingest insert with a forged `device_id` (key mismatch → 401).
- Backend tests under `backend/tests/test_kat03_ingest.py`: unit tests for the header parser + payload validator, plus a `--run-e2e` block that pairs a device via KAT-02 and then ingests through the real endpoint.

Once `DONE`, the rest of the Katara module is unblocked: KAT-04 can render charts, KAT-05/06 can wire thresholds against the freshly written rows, KAT-11 can read `last_seen`, and KAT-08 can compute the 7-day soil-moisture average that Gemini needs.

---

## 2. Scope

### In scope
- Migration `0018_kat03_katara_telemetry.sql` — table + composite index + RLS (service-role-only writes, FARMER-owned-via-parcel selects) + `m1_katara_telemetry_latest` view + a small `m1_katara_ingest_stats` row-counter helper.
- FastAPI sub-router `backend/app/modules/katara/ingest.py` mounted at `/api/v1/katara/ingest` (note: **no parcel scope in the URL** — the device identifies its parcel).
- Pydantic schema `TelemetryPayload` (the corrected soil schema) appended to `backend/app/modules/katara/schemas.py`.
- A single new service-role callsite `app.core.db.get_service_client_for_ingest()` whose allowlist entry is added to AUTH-05's `test_service_client_callsite_allowlist.py`.
- NGINX zone + `location /api/v1/katara/ingest` block in `nginx/conf.d/api.conf` extending AUTH-08's grid.
- Performance gate: a `locustfile.py` scenario `kat03_ingest.py` that fires 100 req/s against the staging endpoint and asserts p50 < 50 ms / p99 < 150 ms.
- Tests as listed in §1.

### Out of scope
- Dashboard charts / history endpoint with aggregation (BR-K4 — `≤ 500 points`) → **KAT-04**.
- Threshold evaluation + Brevo email → **KAT-05 / KAT-06**. The ingest path **must not** call Brevo or run threshold logic — those run on a separate worker triggered by a Postgres `NOTIFY` we emit from the ingest insert (see §5.4).
- Offline detection CRON → **KAT-11** (reads `last_seen` updated here, but the CRON itself is its own story).
- AI diagnostic / 7-day average / Gemini prompt → **KAT-07 / KAT-08**.
- Multi-payload batch ingest (`[{}, {}, ...]`) — the ESP32 firmware buffers locally on outage and replays one-by-one; batch ingestion is a post-MVD optimisation. Single-payload `POST` only.
- Idempotency keys on `/ingest` — the `(device_id, recorded_at)` composite is treated as the dedup key via a partial unique index (§4); we accept that a malicious replay within the same 15-min slot is silently dropped, which is the desired property.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-02](./KAT-02-esp32-device-pairing.md) `DONE` | `public.m1_katara_devices` and `public.verify_device_api_key(text, text)` must exist; the ingest endpoint calls the helper on every request. |
| [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) `DONE` | `app.core.db.get_service_client()` exists; the new wrapper `get_service_client_for_ingest()` reuses the singleton and adds itself to the allowlist. |
| [AUTH-08](./AUTH-08-nginx-rate-limiting-public-endpoints.md) `DONE` | The `nginx/conf.d/api.conf` grid is in place; KAT-03 appends a `katara_ingest` zone next to the `auth_token` zone. |
| Supabase service role key available on the VPS | Already injected via `.env` in INF-01; verify with `docker compose exec backend env | grep SUPABASE_SERVICE_ROLE_KEY`. |
| Healthchecks.io ping URL for ingest heartbeat | Optional — added in INF-08; if absent, the ingest path silently no-ops the heartbeat. |
| Demo ESP32 firmware sending the corrected payload | Coordinated with the hardware sub-team — the firmware must be flashing the new keys (`soil_pH`, `soil_conductivity`) before staging acceptance; a mock payload generator (`scripts/fake_ingest.py`) is delivered in §5.7 as a fallback. |

---

## 4. Data Model

### Table: `public.m1_katara_telemetry`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Internal PK; not exposed to the device. |
| `device_id` | `uuid` | NOT NULL, FK → `public.m1_katara_devices(id)` ON DELETE RESTRICT | Internal device row UUID — **not** the printed `ESP-KAT-NNN` string. The ingest endpoint resolves the string → UUID via `verify_device_api_key()`. |
| `parcel_id` | `uuid` | NOT NULL, FK → `public.m1_katara_parcels(id)` ON DELETE RESTRICT | Denormalised from the device row to skip a join on every dashboard read. Filled by trigger. |
| `farmer_id` | `uuid` | NOT NULL, FK → `public.profiles(id)` ON DELETE CASCADE | Same rationale — keeps RLS predicates on the read side free of sub-selects. Filled by trigger. |
| `soil_moisture` | `real` | NOT NULL, CHECK `0 <= soil_moisture <= 100` | Volumetric water content, percent. |
| `soil_temperature` | `real` | NOT NULL, CHECK `-20 <= soil_temperature <= 80` | Degrees Celsius. |
| `soil_ph` | `real` | NOT NULL, CHECK `0 <= soil_ph <= 14` | pH units. **Replaces the legacy `air_humidity` column from the spec.** |
| `soil_conductivity` | `real` | NOT NULL, CHECK `0 <= soil_conductivity <= 20000` | µS/cm. **Replaces the legacy `air_temperature` column from the spec.** |
| `battery_level` | `smallint` | NOT NULL, CHECK `0 <= battery_level <= 100` | Percent. |
| `recorded_at` | `timestamptz` | NOT NULL | The device-supplied timestamp (UTC; ESP32 obtains it from the GSM module). |
| `received_at` | `timestamptz` | NOT NULL, default `now()` | Server-side receive time; the gap `received_at - recorded_at` is the network latency budget for KAT-11's stale-device heuristic. |

**Indexes**

```sql
-- Hot read path: charts query "last N rows for one device" — covering index is essential
-- to stay under 200 ms with 100k+ rows.
create index m1_katara_telemetry_device_recorded_at_idx
    on public.m1_katara_telemetry (device_id, recorded_at desc);

-- KAT-08's 7-day average is "all rows for one parcel in a window".
create index m1_katara_telemetry_parcel_recorded_at_idx
    on public.m1_katara_telemetry (parcel_id, recorded_at desc);

-- Dedup: refuse a second insert for the same (device, recorded_at) — the ESP32's 15-min
-- cadence makes natural collisions impossible, so any hit is either a replay attack or a
-- firmware bug. We choose to silently 204 on conflict (see §5.3) rather than 409, so the
-- field device does not retry-loop on a clock-skew echo.
create unique index m1_katara_telemetry_device_recorded_at_uniq
    on public.m1_katara_telemetry (device_id, recorded_at);
```

### View: `public.m1_katara_telemetry_latest`

A lateral-join lookup of the most recent row per device. KAT-04's dashboard tile reads against this view to dodge the `SELECT … ORDER BY recorded_at DESC LIMIT 1` full-scan trap on cold partitions.

```sql
create or replace view public.m1_katara_telemetry_latest as
select t.*
from   public.m1_katara_devices d
cross join lateral (
    select *
    from   public.m1_katara_telemetry tt
    where  tt.device_id = d.id
    order  by tt.recorded_at desc
    limit  1
) t
where  d.status <> 'UNLINKED';
```

The view inherits the underlying RLS — no policies needed.

### RLS matrix for `m1_katara_telemetry`

| Operation | Policy | Condition |
|---|---|---|
| SELECT | `katara_telemetry_select_own` | `auth.uid() = farmer_id` |
| SELECT | `katara_telemetry_admin_select` | `public.is_admin()` |
| INSERT | *(no policy)* | Service role bypasses RLS — that is the **only** intended write path. A missing INSERT policy + `force row level security` means a leaked anon/JWT cannot write even by accident. |
| UPDATE / DELETE | *(no policy)* | Telemetry is append-only; the demo VPS will never UPDATE or DELETE these rows. KAT-13's "history after unlink" leans on this invariant. |

> Note: `alter table … force row level security` is critical here — without it, the table owner (the `postgres` superuser used by migrations) can still write through the RLS gate, which would muddy the AUTH-07 audit. We want exactly one writer: the service role.

### Postgres NOTIFY channel

Every successful insert emits `NOTIFY katara_telemetry_inserted, '<device_id>|<telemetry_row_id>'`. KAT-06's threshold worker subscribes via `LISTEN`. Keeps the ingest path off the threshold logic entirely.

---

## 5. Step-by-Step Implementation

### 5.1 Migration 0018 — telemetry table + view + NOTIFY trigger

Create [db/migrations/0018_kat03_katara_telemetry.sql](../../db/migrations/0018_kat03_katara_telemetry.sql):

```sql
-- 0018 — M1 Katara: append-only telemetry stream (KAT-03).
-- The ingest endpoint writes via the service role; RLS forbids every other actor
-- from inserting. Reads are scoped to the row's owning farmer (or admin).
-- Soil-focused payload (pH + conductivity) — supersedes the legacy air_humidity /
-- air_temperature spec text; see project_katara_iot_payload.md for the rationale.

create table if not exists public.m1_katara_telemetry (
    id                  uuid        primary key default gen_random_uuid(),
    device_id           uuid        not null
                            references public.m1_katara_devices(id) on delete restrict,
    parcel_id           uuid        not null
                            references public.m1_katara_parcels(id) on delete restrict,
    farmer_id           uuid        not null
                            references public.profiles(id) on delete cascade,
    soil_moisture       real        not null check (soil_moisture between 0 and 100),
    soil_temperature    real        not null check (soil_temperature between -20 and 80),
    soil_ph             real        not null check (soil_ph between 0 and 14),
    soil_conductivity   real        not null check (soil_conductivity between 0 and 20000),
    battery_level       smallint    not null check (battery_level between 0 and 100),
    recorded_at         timestamptz not null,
    received_at         timestamptz not null default now()
);

create index m1_katara_telemetry_device_recorded_at_idx
    on public.m1_katara_telemetry (device_id, recorded_at desc);

create index m1_katara_telemetry_parcel_recorded_at_idx
    on public.m1_katara_telemetry (parcel_id, recorded_at desc);

create unique index m1_katara_telemetry_device_recorded_at_uniq
    on public.m1_katara_telemetry (device_id, recorded_at);

-- ── Denormalisation trigger ───────────────────────────────────────────────────
-- parcel_id and farmer_id are filled from the device row so the ingest endpoint
-- only has to pass device_id + the metrics. Cheaper than asking the FastAPI
-- handler to do the lookup separately — one DB round trip instead of two.
create or replace function public.m1_katara_telemetry_fill_owners()
returns trigger
language plpgsql
as $$
begin
    select d.parcel_id, d.farmer_id
      into new.parcel_id, new.farmer_id
    from   public.m1_katara_devices d
    where  d.id = new.device_id;

    if new.farmer_id is null then
        raise exception 'device % not found or unlinked', new.device_id;
    end if;
    return new;
end$$;

create trigger trg_m1_katara_telemetry_fill_owners
    before insert on public.m1_katara_telemetry
    for each row execute function public.m1_katara_telemetry_fill_owners();

-- ── Device status + last_seen sync ────────────────────────────────────────────
-- Flip PENDING/OFFLINE → ACTIVE and stamp last_seen on every insert. Bundled
-- into the same statement to keep the ingest path's DB round-trips down to one
-- call to the wrapper function (see §5.3).
create or replace function public.m1_katara_devices_touch_after_ingest(p_device_id uuid)
returns void
language sql
as $$
    update public.m1_katara_devices
       set status    = case
                         when status in ('PENDING','OFFLINE') then 'ACTIVE'::public.device_status
                         else status
                       end,
           last_seen = now()
     where id = p_device_id
       and status <> 'UNLINKED';
$$;

-- ── NOTIFY trigger for KAT-06's threshold worker ──────────────────────────────
create or replace function public.m1_katara_telemetry_notify()
returns trigger
language plpgsql
as $$
begin
    perform pg_notify(
        'katara_telemetry_inserted',
        new.device_id::text || '|' || new.id::text
    );
    return new;
end$$;

create trigger trg_m1_katara_telemetry_notify
    after insert on public.m1_katara_telemetry
    for each row execute function public.m1_katara_telemetry_notify();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.m1_katara_telemetry enable row level security;
-- FORCE — the migrations role cannot bypass either; only the service_role does.
alter table public.m1_katara_telemetry force row level security;

create policy "katara_telemetry_select_own"
    on public.m1_katara_telemetry for select
    using (auth.uid() = farmer_id);

create policy "katara_telemetry_admin_select"
    on public.m1_katara_telemetry for select
    using (public.is_admin());

-- Note: no INSERT / UPDATE / DELETE policy by design (service role only).

-- ── Latest-per-device view ────────────────────────────────────────────────────
create or replace view public.m1_katara_telemetry_latest as
select t.*
from   public.m1_katara_devices d
cross join lateral (
    select *
    from   public.m1_katara_telemetry tt
    where  tt.device_id = d.id
    order  by tt.recorded_at desc
    limit  1
) t
where  d.status <> 'UNLINKED';

-- ── One-shot ingest wrapper used by the FastAPI endpoint ──────────────────────
-- Single function call → one DB round trip. The function does:
--   1) Verify api_key (calls KAT-02's verify_device_api_key()).
--   2) Insert the telemetry row (trigger fills parcel_id/farmer_id).
--   3) Touch the device row (status + last_seen).
-- Returns the inserted row's id, or NULL on bad credentials so the FastAPI
-- handler can answer 401 without leaking which of (device_id, api_key) was wrong.
create or replace function public.m1_katara_ingest(
    p_device_id_str     text,
    p_api_key           text,
    p_soil_moisture     real,
    p_soil_temperature  real,
    p_soil_ph           real,
    p_soil_conductivity real,
    p_battery_level     smallint,
    p_recorded_at       timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_device_row_id uuid;
    v_telemetry_id  uuid;
begin
    -- 1) constant-time api_key verify
    select device_row_id
      into v_device_row_id
      from public.verify_device_api_key(p_device_id_str, p_api_key);

    if v_device_row_id is null then
        return null;  -- caller returns 401
    end if;

    -- 2) insert telemetry; on (device_id, recorded_at) conflict, return existing id
    insert into public.m1_katara_telemetry (
        device_id, parcel_id, farmer_id,
        soil_moisture, soil_temperature, soil_ph, soil_conductivity,
        battery_level, recorded_at
    )
    values (
        v_device_row_id,
        '00000000-0000-0000-0000-000000000000'::uuid,  -- placeholder; trigger overwrites
        '00000000-0000-0000-0000-000000000000'::uuid,  -- placeholder; trigger overwrites
        p_soil_moisture, p_soil_temperature, p_soil_ph, p_soil_conductivity,
        p_battery_level, p_recorded_at
    )
    on conflict (device_id, recorded_at) do update
        set recorded_at = excluded.recorded_at  -- no-op write so RETURNING fires
    returning id into v_telemetry_id;

    -- 3) touch device row (last_seen + status PENDING/OFFLINE → ACTIVE)
    perform public.m1_katara_devices_touch_after_ingest(v_device_row_id);

    return v_telemetry_id;
end$$;

revoke all on function public.m1_katara_ingest(text, text, real, real, real, real, smallint, timestamptz) from public;
grant execute on function public.m1_katara_ingest(text, text, real, real, real, real, smallint, timestamptz) to service_role;
```

Apply with `supabase db push`. Verify:
- Table + view + three indexes + four triggers/functions exist.
- RLS is **forced** (`relrowsecurity = t` and `relforcerowsecurity = t` in `pg_class`).
- `\df+ public.m1_katara_ingest` shows `service_role` execute grant only.

---

### 5.2 Backend — Pydantic schema

Append to [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py):

```python
# ── KAT-03 ingest ────────────────────────────────────────────────────────────

from datetime import datetime, timezone


class TelemetryPayload(BaseModel):
    """ESP32 → backend payload, sent every 15 minutes (BR-K3 cadence in the PRD).

    The device authenticates via two headers (X-Device-Id + X-Device-Api-Key),
    NOT via a JWT. The fields below are the body. Note the soil-focused schema
    — pH and conductivity replace the legacy air_humidity / air_temperature.
    """
    soil_moisture: float = Field(..., ge=0, le=100)
    soil_temperature: float = Field(..., ge=-20, le=80)
    soil_ph: float = Field(..., ge=0, le=14, alias="soil_pH")
    soil_conductivity: float = Field(..., ge=0, le=20000)
    battery_level: int = Field(..., ge=0, le=100)
    recorded_at: datetime  # UTC; the device sends an ISO-8601 string

    model_config = {"populate_by_name": True}

    @field_validator("recorded_at")
    @classmethod
    def reject_future_timestamps(cls, v: datetime) -> datetime:
        # A 60 s skew tolerance is enough for GSM clock drift; anything beyond
        # is rejected as a likely replay / firmware-clock bug.
        now = datetime.now(timezone.utc)
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        if (v - now).total_seconds() > 60:
            raise ValueError("recorded_at is more than 60 s in the future")
        return v
```

The `soil_pH` alias preserves the literal field name in the ESP32 firmware's JSON while keeping the Python attribute snake_case.

---

### 5.3 Backend — ingest endpoint

Create [backend/app/modules/katara/ingest.py](../../backend/app/modules/katara/ingest.py):

```python
"""KAT-03 telemetry ingest endpoint.

Hot path. Strict SLA: < 50 ms p50, < 150 ms p99. The handler does the bare
minimum:

  - parse two headers + the body
  - call public.m1_katara_ingest() (one DB round trip)
  - return 204 on success, 401 on bad credentials

Anything that does not fit in that loop (threshold checks, Brevo emails,
Sentry breadcrumbs on the happy path) is deferred to a NOTIFY-driven worker
or to the request's log line.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from supabase import Client

from app.core.db import get_service_client_for_ingest
from app.modules.katara.schemas import TelemetryPayload

router = APIRouter(prefix="/katara/ingest", tags=["katara"])

log = logging.getLogger("katara.ingest")

# Header names — match the ESP32 firmware contract documented in the hardware repo.
_HDR_DEVICE = "X-Device-Id"      # e.g. "ESP-KAT-001"
_HDR_KEY    = "X-Device-Api-Key" # e.g. "vk_…"


@router.post("", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=True)
async def ingest_telemetry(
    payload: TelemetryPayload,
    response: Response,
    db: Annotated[Client, Depends(get_service_client_for_ingest)],
    x_device_id: Annotated[str | None, Header(alias=_HDR_DEVICE)] = None,
    x_device_api_key: Annotated[str | None, Header(alias=_HDR_KEY)] = None,
) -> Response:
    if not x_device_id or not x_device_api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="missing_device_credentials")

    # Single DB call. The SQL function does verify + insert + touch atomically.
    res = db.rpc(
        "m1_katara_ingest",
        {
            "p_device_id_str":     x_device_id,
            "p_api_key":           x_device_api_key,
            "p_soil_moisture":     payload.soil_moisture,
            "p_soil_temperature":  payload.soil_temperature,
            "p_soil_ph":           payload.soil_ph,
            "p_soil_conductivity": payload.soil_conductivity,
            "p_battery_level":     payload.battery_level,
            "p_recorded_at":       payload.recorded_at.isoformat(),
        },
    ).execute()

    telemetry_id = res.data
    if telemetry_id is None:
        # Constant-time path: the SQL function returns NULL when EITHER the
        # device_id is unknown OR the api_key does not match. Never disclose
        # which one was wrong — the bcrypt verify ran in both cases.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid_device_credentials")

    # 204 No Content. No body. The ESP32 firmware only checks the status code.
    response.headers["X-Telemetry-Id"] = str(telemetry_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers=response.headers)
```

Register the router in [backend/app/main.py](../../backend/app/main.py):

```python
from app.modules.katara.ingest import router as katara_ingest_router
app.include_router(katara_ingest_router, prefix="/api/v1")
```

> **Why not a Pydantic `Header` dependency object?** The two-argument `Header(alias=…)` pattern keeps the OpenAPI docs honest (the headers show up in the generated spec without a separate model) and saves one `__init__` frame per request — measured ~0.3 ms on the demo VPS.

---

### 5.4 Backend — service-role wrapper + AUTH-05 allowlist

Extend [backend/app/core/db.py](../../backend/app/core/db.py):

```python
def get_service_client_for_ingest() -> Client:
    """Service-role Supabase client scoped to the KAT-03 ingest endpoint.

    AUTH-05 isolates the SUPABASE_SERVICE_ROLE_KEY to specific callsites; the
    ingest endpoint is the second legitimate consumer after the admin shell.
    The function exists as a named wrapper so the AUTH-05 callsite allowlist
    has a single grep target.
    """
    return get_service_client()
```

Append to [backend/tests/test_service_client_callsite_allowlist.py](../../backend/tests/test_service_client_callsite_allowlist.py):

```python
ALLOWED_CALLSITES = {
    # ...existing entries...
    "app/core/db.py:get_service_client_for_ingest",
    "app/modules/katara/ingest.py",  # references get_service_client_for_ingest only
}
```

---

### 5.5 NGINX — rate limit zone for ingest

Append to [nginx/conf.d/api.conf](../../nginx/conf.d/api.conf) (next to AUTH-08's `auth_token` zone):

```nginx
# KAT-03: dedicated rate-limit zone for ESP32 ingest.
# Sized for 10 req/s per source IP — well above the legitimate 1 req / 15 min
# cadence, well below what a stolen-key flood would push.
limit_req_zone $binary_remote_addr zone=katara_ingest:10m rate=10r/s;

location = /api/v1/katara/ingest {
    limit_req zone=katara_ingest burst=5 nodelay;
    limit_req_status 429;

    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Short timeouts — the SLA is 50 ms; anything past 2 s is already failed.
    proxy_connect_timeout 2s;
    proxy_send_timeout    2s;
    proxy_read_timeout    2s;
}
```

Reload NGINX: `docker compose exec nginx nginx -s reload`.

---

### 5.6 Backend tests

Create [backend/tests/test_kat03_ingest.py](../../backend/tests/test_kat03_ingest.py):

```python
"""KAT-03 telemetry ingest tests.

Unit tests cover the Pydantic validator (soil_pH alias, future-timestamp
rejection). The --run-e2e block walks a full pair → ingest → row-exists loop
against the staging stack, asserting the < 50 ms SLA on a warm endpoint.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

from app.modules.katara.schemas import TelemetryPayload


class TestTelemetryPayload:
    def test_accepts_soil_pH_alias(self):
        body = {
            "soil_moisture": 38.4,
            "soil_temperature": 21.2,
            "soil_pH": 6.7,
            "soil_conductivity": 1850.0,
            "battery_level": 87,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
        p = TelemetryPayload(**body)
        assert p.soil_ph == 6.7

    def test_rejects_future_timestamp(self):
        body = {
            "soil_moisture": 30, "soil_temperature": 20, "soil_pH": 7,
            "soil_conductivity": 1000, "battery_level": 90,
            "recorded_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        }
        with pytest.raises(ValueError, match="future"):
            TelemetryPayload(**body)

    @pytest.mark.parametrize("field,value", [
        ("soil_moisture", -1), ("soil_moisture", 101),
        ("soil_pH", -0.1),     ("soil_pH", 14.5),
        ("battery_level", 200),
    ])
    def test_range_checks(self, field, value):
        body = {
            "soil_moisture": 30, "soil_temperature": 20, "soil_pH": 7,
            "soil_conductivity": 1000, "battery_level": 90,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
        body[field] = value
        with pytest.raises(ValueError):
            TelemetryPayload(**body)


@pytest.mark.skipif("not config.getoption('--run-e2e')", reason="e2e only")
class TestIngestFlow:
    """Requires the KAT-02 conftest fixtures (paired_device returns a dict with
    `device_id` (ESP-KAT-NNN) and the plaintext api_key returned at pairing)."""

    def _ingest(self, api_base_url, device_id, api_key, **overrides):
        body = {
            "soil_moisture": 38.4,
            "soil_temperature": 21.2,
            "soil_pH": 6.7,
            "soil_conductivity": 1850.0,
            "battery_level": 87,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
        body.update(overrides)
        return requests.post(
            f"{api_base_url}/api/v1/katara/ingest",
            json=body,
            headers={
                "X-Device-Id":      device_id,
                "X-Device-Api-Key": api_key,
            },
        )

    def test_happy_path_returns_204(self, api_base_url, paired_device):
        r = self._ingest(api_base_url, paired_device["device_id"], paired_device["api_key"])
        assert r.status_code == 204
        assert "X-Telemetry-Id" in r.headers

    def test_p50_under_50ms(self, api_base_url, paired_device):
        # Warm the path, then sample 30 requests.
        for _ in range(3):
            self._ingest(api_base_url, paired_device["device_id"], paired_device["api_key"])
        latencies_ms = []
        for i in range(30):
            t0 = time.perf_counter()
            r = self._ingest(api_base_url, paired_device["device_id"], paired_device["api_key"],
                             recorded_at=(datetime.now(timezone.utc) + timedelta(seconds=i)).isoformat())
            latencies_ms.append((time.perf_counter() - t0) * 1000)
            assert r.status_code == 204
        latencies_ms.sort()
        p50 = latencies_ms[len(latencies_ms) // 2]
        assert p50 < 50, f"p50={p50:.1f}ms exceeds 50 ms SLA; sample={latencies_ms}"

    def test_wrong_key_returns_401(self, api_base_url, paired_device):
        r = self._ingest(api_base_url, paired_device["device_id"], "vk_" + "0" * 32)
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_device_credentials"

    def test_unknown_device_returns_401_same_message(self, api_base_url):
        r = self._ingest(api_base_url, "ESP-KAT-999", "vk_" + "0" * 32)
        assert r.status_code == 401
        # SAME error string as wrong-key case — constant-error contract.
        assert r.json()["detail"] == "invalid_device_credentials"

    def test_missing_headers_returns_401(self, api_base_url):
        r = requests.post(
            f"{api_base_url}/api/v1/katara/ingest",
            json={"soil_moisture": 30, "soil_temperature": 20, "soil_pH": 7,
                  "soil_conductivity": 1000, "battery_level": 90,
                  "recorded_at": datetime.now(timezone.utc).isoformat()},
        )
        assert r.status_code == 401

    def test_replay_same_recorded_at_is_idempotent(self, api_base_url, paired_device):
        ts = datetime.now(timezone.utc).isoformat()
        r1 = self._ingest(api_base_url, paired_device["device_id"], paired_device["api_key"], recorded_at=ts)
        r2 = self._ingest(api_base_url, paired_device["device_id"], paired_device["api_key"], recorded_at=ts)
        assert r1.status_code == 204
        assert r2.status_code == 204
        assert r1.headers["X-Telemetry-Id"] == r2.headers["X-Telemetry-Id"]
```

Add pgTAP blocks to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

- **`m1_katara_telemetry` RLS leak check** — service-role insert OK; FARMER-A select-own OK; FARMER-B sees zero rows for FARMER-A's device; anon client gets 0 rows.
- **`UNLINKED` device cannot ingest** — set `m1_katara_devices.status = 'UNLINKED'`, call `verify_device_api_key()` → returns 0 rows.
- **Future-timestamp guard at the DB layer** — confirm there is **no** future-ts CHECK on `recorded_at` (the guard intentionally lives in Pydantic so backfills can break the rule when needed).

Run:

```bash
cd backend && pytest tests/test_kat03_ingest.py::TestTelemetryPayload -v
make -C db test-auth07
```

---

### 5.7 Mock ESP32 firmware (fallback for demo day)

Create [scripts/fake_ingest.py](../../scripts/fake_ingest.py) — a 30-line script that pushes a plausible payload every 15 seconds (not minutes, so the demo dashboard updates in real time). Used only if the physical ESP32 fails in the field during the Day-1 rehearsal. The script reads `DEVICE_ID` and `DEVICE_API_KEY` from the env and hits the staging URL.

```python
#!/usr/bin/env python3
"""Demo-day fallback: fake ESP32 telemetry generator."""
import os, random, time
from datetime import datetime, timezone
import requests

URL    = os.environ["INGEST_URL"]                # e.g. https://vitachain.ma/api/v1/katara/ingest
DEVICE = os.environ["DEVICE_ID"]
KEY    = os.environ["DEVICE_API_KEY"]

while True:
    body = {
        "soil_moisture":     round(random.uniform(28, 42), 1),
        "soil_temperature":  round(random.uniform(18, 24), 1),
        "soil_pH":           round(random.uniform(6.2, 7.4), 2),
        "soil_conductivity": round(random.uniform(1200, 2200), 0),
        "battery_level":     random.randint(70, 100),
        "recorded_at":       datetime.now(timezone.utc).isoformat(),
    }
    r = requests.post(URL, json=body, headers={
        "X-Device-Id": DEVICE, "X-Device-Api-Key": KEY,
    }, timeout=5)
    print(datetime.utcnow().isoformat(), r.status_code, r.headers.get("X-Telemetry-Id"))
    time.sleep(15)
```

---

### 5.8 Locust performance gate

Create [load/kat03_ingest.py](../../load/kat03_ingest.py):

```python
from locust import HttpUser, task, between
import os, random
from datetime import datetime, timezone


class IngestUser(HttpUser):
    wait_time = between(0.05, 0.2)
    host = os.environ["LOAD_TARGET"]  # e.g. https://staging.vitachain.ma

    @task
    def ingest(self):
        self.client.post(
            "/api/v1/katara/ingest",
            json={
                "soil_moisture":     round(random.uniform(28, 42), 1),
                "soil_temperature":  round(random.uniform(18, 24), 1),
                "soil_pH":           round(random.uniform(6.2, 7.4), 2),
                "soil_conductivity": round(random.uniform(1200, 2200), 0),
                "battery_level":     random.randint(70, 100),
                "recorded_at":       datetime.now(timezone.utc).isoformat(),
            },
            headers={
                "X-Device-Id":      os.environ["DEVICE_ID"],
                "X-Device-Api-Key": os.environ["DEVICE_API_KEY"],
            },
            name="POST /katara/ingest",
        )
```

Pass criteria, run on staging for 60 s with 50 concurrent users:

```bash
LOAD_TARGET=https://staging.vitachain.ma \
DEVICE_ID=ESP-KAT-001 \
DEVICE_API_KEY=vk_<paired-from-kat02> \
locust -f load/kat03_ingest.py --headless -u 50 -r 10 -t 60s --csv=ingest
```

Reject the story if `ingest_stats.csv` shows:
- median > 50 ms, or
- 99% > 150 ms, or
- any `Failures` row > 0.

---

## 6. Verification Checklist

- [ ] Spec PR merged: `Documents/VitaChain_PRD.md §6.1.1 KAT-03` and `Documents/VitaChain_Technical_Specifications.md` updated to the soil schema (`soil_pH`, `soil_conductivity`) — discrepancy noted in the memory file.
- [ ] `db/migrations/0018_kat03_katara_telemetry.sql` applied — table, three indexes, view, four trigger/helper functions, `m1_katara_ingest` SECURITY DEFINER function with `service_role` execute grant only.
- [ ] `pg_class.relforcerowsecurity = true` on `m1_katara_telemetry`.
- [ ] `pytest backend/tests/test_kat03_ingest.py::TestTelemetryPayload -v` → 5/5 green.
- [ ] `--run-e2e` block green against staging.
- [ ] Locust run: p50 < 50 ms, p99 < 150 ms, 0 failures.
- [ ] `make -C db test-auth07` — `m1_katara_telemetry` SKIP notices replaced; the three new BR pgTAP cells green (RLS leak, UNLINKED ingest blocked, no future-ts DB CHECK).
- [ ] NGINX: hitting `/api/v1/katara/ingest` 15+ times/second from one IP returns 429 from the 11th request onward.
- [ ] `docker compose exec backend grep -R "X-Device-Api-Key" backend/app/` — only the two intended files (`ingest.py` + the schema docstring) match. No accidental logging of the key.
- [ ] AUTH-05 callsite allowlist test passes with the new entries (`get_service_client_for_ingest` + `katara/ingest.py`).
- [ ] After one ingest the linked device's `status` is `ACTIVE` and `last_seen` is within the last 5 s (verified via `select status, last_seen from m1_katara_devices where id=…`).
- [ ] `select id from m1_katara_telemetry_latest where device_id = '…'` returns exactly one row per active device.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| DB migration | [db/migrations/0018_kat03_katara_telemetry.sql](../../db/migrations/0018_kat03_katara_telemetry.sql) |
| Pydantic schema | [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py) (append KAT-03 block) |
| Ingest router | [backend/app/modules/katara/ingest.py](../../backend/app/modules/katara/ingest.py) |
| Service-role wrapper | [backend/app/core/db.py](../../backend/app/core/db.py) (`get_service_client_for_ingest`) |
| AUTH-05 allowlist | [backend/tests/test_service_client_callsite_allowlist.py](../../backend/tests/test_service_client_callsite_allowlist.py) (two new entries) |
| Router registration | [backend/app/main.py](../../backend/app/main.py) — `include_router(katara_ingest_router)` |
| NGINX rate-limit zone | [nginx/conf.d/api.conf](../../nginx/conf.d/api.conf) |
| Unit + e2e tests | [backend/tests/test_kat03_ingest.py](../../backend/tests/test_kat03_ingest.py) |
| pgTAP BR additions | [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| Load scenario | [load/kat03_ingest.py](../../load/kat03_ingest.py) |
| Fallback generator | [scripts/fake_ingest.py](../../scripts/fake_ingest.py) |
| Spec reconciliation | [Documents/VitaChain_PRD.md](../../Documents/VitaChain_PRD.md), [Documents/VitaChain_Technical_Specifications.md](../../Documents/VitaChain_Technical_Specifications.md) |
| `spring-status.yml` update | `KAT-03.status` → `IN_REVIEW` (then `DONE` after staging Locust run); `E2.progress_pct` 14 → 21; KAT-04 / KAT-11 unblocked |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **bcrypt cost-10 + RPC overhead breaks the 50 ms SLA** | The KAT-02 acceptance gate already measured cost-10 at ~8 ms p99 on the demo VPS; the RPC round-trip adds ~3 ms over a warm pool. Headroom is comfortable. If staging Locust shows p99 > 25 ms on the bcrypt step alone, drop to cost 8 (re-run KAT-02's pgTAP to confirm `verify_device_api_key` still passes). |
| **Service-role bypass leaks to a non-ingest route** | The AUTH-05 allowlist test fails CI if `get_service_client_for_ingest` is imported anywhere other than `app/modules/katara/ingest.py`. |
| **Spec drift confuses reviewers (legacy air_humidity / air_temperature)** | Reconciled in the pre-flight section + Documents PR; the memory file `project_katara_iot_payload.md` will be deleted in the same PR once the spec is updated, so there is one source of truth. |
| **A leaked api_key becomes a write firehose** | NGINX `katara_ingest` zone caps any single source IP at 10 r/s burst 5. Per-device rate limiting (in addition to per-IP) is a KAT-11 follow-up — out of scope here. The farmer's recourse is `rotate-key` on the KAT-02 endpoint. |
| **Postgres NOTIFY queue overflow if the KAT-06 worker dies** | `NOTIFY` payloads are dropped silently after 8 GB of unconsumed messages. The threshold worker (KAT-06) will use `LISTEN` with a connection that runs `pg_notification_queue_usage()` and pages Uptime-Kuma if the queue exceeds 50 %. KAT-03 itself is not affected by a queue-full condition — `pg_notify` never blocks the insert. |
| **The ESP32 firmware sends Unix epoch seconds instead of ISO-8601** | Pydantic's `datetime` accepts integers as epoch; document explicitly in the firmware contract (hardware repo `README.md`). Add a unit test in `test_kat03_ingest.py::TestTelemetryPayload::test_accepts_epoch_int` once the firmware author confirms the wire format. |
| **A burst of 20 devices reconnecting after a regional WiFi outage hits the SLA** | 20 devices × 1 payload ≪ NGINX zone 10 r/s burst 5 — the burst window absorbs it. If the cohort grows past ~50 devices, raise `rate=` to `30r/s` and re-test. |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Spec reconciliation PR (PRD + Tech Spec + memory cleanup) | 30 min |
| Migration 0018 (table + indexes + view + 4 helper functions) | 75 min |
| Pydantic schema + unit tests | 25 min |
| FastAPI ingest endpoint + main.py wiring | 30 min |
| Service-role wrapper + AUTH-05 allowlist update | 15 min |
| NGINX zone + reload + smoke check | 15 min |
| e2e pytest block (6 scenarios) | 45 min |
| pgTAP BR additions (3 cells) | 25 min |
| Locust scenario + staging run + tuning | 40 min |
| `scripts/fake_ingest.py` fallback | 10 min |
| `spring-status.yml` update + hand-off note | 10 min |
| **Total active work** | **~5.3 h** |

---

## 10. Definition of Done

1. Acceptance criterion met: a paired ESP32 (real or `scripts/fake_ingest.py`) can `POST /api/v1/katara/ingest` and observe a row in `m1_katara_telemetry`, with the device row's `status` flipped to `ACTIVE` and `last_seen` updated. Latency budget: p50 < 50 ms on the staging Locust run.
2. Verification checklist (§6) fully ticked.
3. All deliverables (§7) committed and pushed; spec PR merged before code PR.
4. AUTH-05 callsite allowlist CI test passes.
5. AUTH-07 pgTAP matrix: `m1_katara_telemetry` rows are no longer SKIPed; three new BR cells green.
6. [docs/spring-status.yml](../spring-status.yml): `KAT-03.status: IN_REVIEW` after local DoD; `DONE` after the staging Locust artefact URL is recorded; `E2.progress_pct` bumped to ≈ 21 %; `KAT-04`, `KAT-11` (and indirectly `KAT-05`, `KAT-06`, `KAT-08`) marked unblocked in the parent E2 comment.
7. Hand-off note to the team:
   - **KAT-04** (dashboard charts) reads from `public.m1_katara_telemetry_latest` for the live tile and from `m1_katara_telemetry` directly for the history chart — BR-K4's ≤ 500-point cap belongs to KAT-04, not here.
   - **KAT-06** (threshold email) subscribes to the `katara_telemetry_inserted` NOTIFY channel; payload format is `'<device_uuid>|<telemetry_row_uuid>'`.
   - **KAT-11** (offline detection) reads `m1_katara_devices.last_seen` updated by every ingest.
   - **KAT-08** (AI diagnostic) reads the 7-day per-parcel average from `m1_katara_telemetry`; the parcel-scoped index in §4 covers that query.
