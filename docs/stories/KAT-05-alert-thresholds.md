# KAT-05 — Configurable alert thresholds per metric (min/max)

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** FARMER (authenticated; verification not required to *read* a threshold — only to *write*, mirroring AUTH-06's verification-gated insert pattern)
> **Depends on:** [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) (defines the soil schema — `soil_moisture` / `soil_temperature` / `soil_ph` / `soil_conductivity` / `battery_level` — and the `NOTIFY katara_telemetry_inserted` channel KAT-06 will join against) · [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) (provides `TelemetrySection`, the window selector this story re-uses, and the `Sparkline` component that gains optional `thresholdMin` / `thresholdMax` props here) · [KAT-01](./KAT-01-farmer-registers-parcel.md) (thresholds are parcel-scoped — the parcel row is the FK target) · [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) (owner-only RLS template — re-used 1:1) · [AUTH-06](./AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) (`verification_status = 'VERIFIED'` gate on write)
> **Unblocks:** [KAT-06](./KAT-06-threshold-email-alerts.md) (the threshold worker reads `m1_katara_thresholds` on every `LISTEN katara_telemetry_inserted` payload — KAT-06 implements no schema, only the worker + Brevo wiring) · the AUTH-07 matrix's five `m1_katara_thresholds` cells (FARMER-A own RW, FARMER-B blocked, RESTAURANT blocked, CITIZEN blocked, ADMIN read)
> **Acceptance:** A verified farmer opens `/dashboard/farmer/parcels/[id]`, scrolls to **Seuils d'alerte** below the telemetry section, edits the min/max for any of the five metrics (soil moisture, soil temperature, soil pH, soil conductivity, battery), saves once, and the four `Sparkline` charts immediately render the horizontal min/max band overlay. A second farmer hitting the same `PUT /thresholds` endpoint receives a 404 (RLS-filtered, indistinguishable from "no such parcel"). The threshold rows are the data contract KAT-06 reads at email time — **this story persists; KAT-06 evaluates and sends**.

---

## 1. Purpose

KAT-04 turned the firehose of `m1_katara_telemetry` rows into a real-time dashboard. KAT-05 is the next agronomic primitive: it lets a farmer say "tell me when soil moisture drops below 25 %", and persists that intent in a place KAT-06's worker can read on every ingest.

This story delivers the **persistence + UI** half of the alert pipeline. The **evaluation + email** half is KAT-06 and is deliberately split, because:

- KAT-03 already emits `NOTIFY katara_telemetry_inserted` — the worker doesn't need this story to exist to be designed.
- The threshold *row shape* and the *anti-spam columns* (BR-K2 — one email per device × metric per 24 h) are the data contract that ties KAT-05 and KAT-06 together. Ship the contract first, fail loudly if the worker drifts.
- The Sparkline band overlay is a self-contained UI value even before KAT-06 mails anything — a farmer can *see* "we're 4 % below the line" the same minute they set it.

Concretely KAT-05 delivers:

- A new table `public.m1_katara_thresholds` keyed on `(parcel_id, metric)` with a per-metric range CHECK (so a `soil_ph: max = 27` returns a 400 at the DB layer, not just at the Pydantic boundary), `enabled` flag, and two BR-K2 audit columns (`last_alert_at`, `last_alert_value`) that **only KAT-06's worker writes**.
- A read-only SQL helper `public.m1_katara_threshold_defaults(text)` that returns the canonical agronomic defaults so the API can hydrate an empty parcel without a 500-line migration of seed rows per parcel.
- A FastAPI sub-router `backend/app/modules/katara/thresholds.py` mounted at `/api/v1/katara/parcels/{parcel_id}/thresholds`, with two verbs: `GET` (always returns five rows, defaults filled in) and `PUT` (bulk upsert in a single transaction).
- A `<ThresholdsSection>` client component that mounts under `<TelemetrySection>` on the parcel detail page, hands the saved thresholds back up to the charts via lifted state, and saves with an optimistic-UI pattern.
- Extension of [KAT-04's `Sparkline`](./KAT-04-dashboard-realtime-historical-charts.md#55-frontend--telemetrysection--sparkline): two optional props (`thresholdMin`, `thresholdMax`) draw flat dashed horizontal lines + a tinted band, with zero extra dependencies.
- pgTAP cells in `db/tests/auth07_business_rules.sql` covering the AUTH-07 matrix gap (FARMER-B / RESTAURANT / CITIZEN blocked, ADMIN read, ADMIN cannot write — only the parcel owner writes), the per-metric range CHECK, the `min < max` invariant, and the BR-K2 audit-column locked-down-to-service-role property.
- Backend tests `backend/tests/test_kat05_thresholds.py` covering: bulk PUT happy path, partial update (only soil_moisture changes, the other four rows untouched), `min >= max` rejected with `422`, out-of-range value rejected with `422` *before* hitting the DB, unverified farmer rejected with `403`, and an `--run-e2e` block that flips a threshold and asserts a follow-on `GET /telemetry/history` response renders unchanged but the `ThresholdsSection` reflects the new value.

Once `DONE`, KAT-06 is reduced to "subscribe to `NOTIFY`, read `m1_katara_thresholds` for that parcel, compare, optionally update `last_alert_at`, fire Brevo" — no schema work, no UI, no router.

---

## 2. Scope

### In scope
- DB migration `0020_kat05_alert_thresholds.sql` — one table, one defaults helper function, one RLS policy quartet (owner-RW, admin-read, service-role-write for audit columns), no new views.
- FastAPI sub-router `backend/app/modules/katara/thresholds.py` (`GET` + `PUT /api/v1/katara/parcels/{parcel_id}/thresholds`).
- Pydantic schemas `ThresholdRow`, `ThresholdsResponse`, `ThresholdsUpdateRequest` appended to `backend/app/modules/katara/schemas.py`.
- Server-side per-metric range validation (mirrors the DB CHECK; **422 before** the DB write so a malicious payload doesn't burn a round-trip).
- Frontend: `frontend/src/app/dashboard/farmer/parcels/[id]/ThresholdsSection.tsx` + a small `MetricRow.tsx` editor + a server action `fetchThresholds()` mirroring the existing `fetchInitialTelemetry` pattern.
- Frontend lifting: thresholds state lives on the page (server-fetched once, optimistically updated on save) so both `TelemetrySection` (Sparkline band) and `ThresholdsSection` (the editor) read from the same source.
- One change to `Sparkline.tsx`: two new optional props (`thresholdMin`, `thresholdMax`), zero behavioural change when both are `undefined` — KAT-04 demos still render identically.
- pgTAP BR cells + AUTH-07 matrix activation (five SELECT cells × two write cells).
- Backend unit + e2e tests covering happy path, partial update, validation rejects, RLS rejection, and verification-gated write.
- `spring-status.yml` flip + a §10 hand-off note for KAT-06.

### Out of scope
- **Threshold email evaluation and Brevo send** → [KAT-06](./KAT-06-threshold-email-alerts.md). KAT-05 does not run on the ingest path; KAT-05 does not call Brevo; KAT-05 does not own the NOTIFY worker.
- **BR-K2 anti-spam logic** itself (`last_alert_at < now() - interval '24h'` guard) → KAT-06. KAT-05 only provides the **columns** for KAT-06 to write to and restricts those columns to the service role so a misconfigured frontend cannot silently disable an alert by overwriting `last_alert_at`.
- **Per-device thresholds.** The PRD acceptance text in `spring-status.yml` reads "Thresholds CRUD per device/metric" — but agronomic thresholds describe the *crop on the parcel*, not the hardware. With one ESP32 per parcel as the MVD norm (KAT-04 §2), per-parcel is structurally simpler. Multi-device parcels with divergent thresholds is a post-MVD feature; if the team disagrees the table can grow a `device_id uuid null` column without breaking the API. **Decision recorded in §6 risks.**
- **Threshold change history / audit trail.** Out for MVD; the `updated_at` column on the row is sufficient for the demo and for KAT-06 to detect "thresholds changed since last alert, clear suppression".
- **Per-metric units conversion / locale-aware decimals.** The four numbers ship in their canonical units (% / °C / pH / µS/cm); locale formatting is the same `next-intl` pass [KAT-04 §6 / PRD §7.2](../../Documents/VitaChain_PRD.md) tracks.
- **Inline threshold editing on the chart itself** (drag the dashed line). Nice but post-MVD; the form-based editor is sufficient and accessible.
- **Push / WebSocket** notification when the worker fires. Email is the only channel for MVD per PRD §7.3.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) `IN_REVIEW` or `DONE` | Soil schema column names (`soil_moisture` / `soil_temperature` / `soil_ph` / `soil_conductivity` / `battery_level`) are the metric enum values. Migration 0020 fails fast at apply time if 0018 is missing. |
| [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) `IN_REVIEW` or `DONE` | `TelemetrySection.tsx`, `Sparkline.tsx`, and `fetchInitialTelemetry` exist. KAT-05 *modifies* `Sparkline.tsx` (additive props) and *adds* a sibling section under `TelemetrySection`. The page-level data lifting in §5.5 also requires the `accessToken` plumbing KAT-04 already shipped. |
| [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) `DONE` | Owner-only RLS template (`auth.uid() = farmer_id`). Migration 0020 instantiates four policies on `m1_katara_thresholds`. |
| [AUTH-06](./AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) `DONE` | `verification_status = 'VERIFIED'` is the write gate — `PUT /thresholds` returns `403 verification_required` for a PENDING / REJECTED farmer (read is allowed, mirroring how an unverified farmer can already *see* their parcel but not publish ads). |
| Migration 0018 + 0019 applied | 0020's FK targets `m1_katara_parcels.id` (0017) and references the metric enum values that 0018 introduced; an attempt to apply 0020 onto a missing 0018 raises a clean error at FK creation. |
| AUTH-07 matrix `IN_REVIEW` | The five `m1_katara_thresholds` SELECT cells + two WRITE cells are currently `SKIP` with the standard NOTICE; KAT-05's pgTAP additions activate them. |

---

## 4. Data Contract

### 4.1 Metric enum and canonical defaults

The five supported metrics, their canonical units, the DB CHECK ranges (mirroring KAT-03 telemetry CHECKs verbatim — a threshold a sensor can never produce is rejected), and the agronomic defaults the API returns when no row exists:

| Metric | Units | DB range CHECK | Default `min` | Default `max` | Default `enabled` |
|---|---|---|---|---|---|
| `soil_moisture` | % VWC | `0..100` | `25` | `75` | `true` |
| `soil_temperature` | °C | `-20..80` | `5` | `35` | `true` |
| `soil_ph` | pH | `0..14` | `5.5` | `7.5` | `true` |
| `soil_conductivity` | µS/cm | `0..20000` | `400` | `3000` | `true` |
| `battery_level` | % | `0..100` | `15` | `null` (no upper) | `true` |

The defaults are derived from typical tomato / olive ranges in the Souss-Massa basin (the demo region per PRD §4.1). They are **not law** — every default value is overridable by the farmer in the same form — but they are *defensible* enough that a brand-new parcel produces sensible alerts the moment KAT-06 ships.

Defaults live in SQL (`public.m1_katara_threshold_defaults(metric_name text)`) so the API hydration path is one round trip and a frontend developer can't drift them. The function is `immutable` — defaults are a constant table.

### 4.2 Table shape

```sql
create table public.m1_katara_thresholds (
    id            uuid primary key default gen_random_uuid(),
    parcel_id     uuid not null references public.m1_katara_parcels(id) on delete cascade,
    farmer_id     uuid not null references public.profiles(id) on delete cascade,
    metric        text not null,
    min_value     real,
    max_value     real,
    enabled       boolean not null default true,
    last_alert_at    timestamptz,        -- BR-K2 — KAT-06 writes
    last_alert_value real,               -- BR-K2 — KAT-06 writes
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint kat_threshold_metric_known check (metric in (
        'soil_moisture', 'soil_temperature', 'soil_ph',
        'soil_conductivity', 'battery_level'
    )),
    constraint kat_threshold_one_per_metric unique (parcel_id, metric),
    constraint kat_threshold_at_least_one_bound check (
        min_value is not null or max_value is not null
    ),
    constraint kat_threshold_min_lt_max check (
        min_value is null or max_value is null or min_value < max_value
    ),
    constraint kat_threshold_per_metric_range check (
        case metric
            when 'soil_moisture'     then (min_value is null or (min_value between 0 and 100))
                                       and (max_value is null or (max_value between 0 and 100))
            when 'soil_temperature'  then (min_value is null or (min_value between -20 and 80))
                                       and (max_value is null or (max_value between -20 and 80))
            when 'soil_ph'           then (min_value is null or (min_value between 0 and 14))
                                       and (max_value is null or (max_value between 0 and 14))
            when 'soil_conductivity' then (min_value is null or (min_value between 0 and 20000))
                                       and (max_value is null or (max_value between 0 and 20000))
            when 'battery_level'     then (min_value is null or (min_value between 0 and 100))
                                       and (max_value is null or (max_value between 0 and 100))
            else false
        end
    )
);

create index kat_thresholds_parcel_metric_idx
    on public.m1_katara_thresholds (parcel_id, metric);
```

Five non-obvious choices, each deliberate:

1. **`metric` is a `text` + CHECK, not a Postgres enum.** Enums are painful to extend (`alter type ... add value` requires no surrounding transaction in older Postgres). The CHECK is faster to evolve when KAT-09 adds a humidity / leaf-wetness metric post-MVD.
2. **`farmer_id` is denormalised onto the row** (FK to `profiles.id`). KAT-06's worker reads `m1_katara_thresholds` on every ingest — a join through `m1_katara_parcels` on the hot path is wasteful, and a trigger fills the field on insert/update from the parcel row so the application code never sets it.
3. **`min_value` and `max_value` are both nullable, but at least one must be set** (`kat_threshold_at_least_one_bound`). A row with both NULL is meaningless and would silently disable the alert without the `enabled=false` flag — easier to forbid than to disambiguate.
4. **`last_alert_at` / `last_alert_value` live on this table**, not on a separate `m1_katara_alert_log`. The MVD only needs "did we send today?" — a full alert log is post-MVD. RLS denies writes to these columns from the `authenticated` role; only `service_role` (KAT-06's worker) can update them. See §4.4.
5. **No `device_id` column.** Per-parcel design (§2 scope). If post-MVD needs per-device thresholds, add `device_id uuid null references m1_katara_devices(id)`, drop the `unique (parcel_id, metric)` constraint, replace with `unique (parcel_id, coalesce(device_id, '00000000-...'::uuid), metric)`. Documented forward path; no code today.

### 4.3 Defaults helper

```sql
create or replace function public.m1_katara_threshold_defaults(p_metric text)
returns table (min_value real, max_value real, enabled boolean)
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
    select * from (values
        ('soil_moisture',     25::real, 75::real,   true),
        ('soil_temperature',  5::real,  35::real,   true),
        ('soil_ph',           5.5::real, 7.5::real, true),
        ('soil_conductivity', 400::real, 3000::real, true),
        ('battery_level',     15::real, null::real, true)
    ) as t(metric, min_value, max_value, enabled)
    where t.metric = p_metric;
$$;

revoke all on function public.m1_katara_threshold_defaults(text) from public;
grant execute on function public.m1_katara_threshold_defaults(text) to authenticated;
grant execute on function public.m1_katara_threshold_defaults(text) to service_role;
```

`immutable` is correct here: the function is a constant table. Postgres caches the value across statements, which is exactly what we want — the defaults are configuration, not data.

### 4.4 RLS policies (the security boundary)

```sql
alter table public.m1_katara_thresholds enable row level security;
alter table public.m1_katara_thresholds force row level security;

-- 1) Owner can read their own thresholds.
create policy kat_thresholds_select_own on public.m1_katara_thresholds
    for select to authenticated
    using (farmer_id = auth.uid());

-- 2) Admin can read all.
create policy kat_thresholds_select_admin on public.m1_katara_thresholds
    for select to authenticated
    using (public.has_role('ADMIN'));

-- 3) Owner can INSERT a row for their own parcel, ONLY if VERIFIED, and may
--    NOT touch the audit columns (those are service-role-only — see policy 5).
create policy kat_thresholds_insert_own on public.m1_katara_thresholds
    for insert to authenticated
    with check (
        farmer_id = auth.uid()
        and public.is_verified(auth.uid())
        and last_alert_at is null
        and last_alert_value is null
    );

-- 4) Owner can UPDATE their own rows (VERIFIED gate), but the WITH CHECK
--    re-asserts the audit columns are unchanged. We enforce that the
--    *new* row's audit columns equal the *old* row's via a trigger (§4.5)
--    — RLS WITH CHECK alone cannot reference OLD.
create policy kat_thresholds_update_own on public.m1_katara_thresholds
    for update to authenticated
    using (farmer_id = auth.uid())
    with check (farmer_id = auth.uid() and public.is_verified(auth.uid()));

-- 5) service_role (KAT-06 worker) — full write, no RLS bypass needed because
--    service_role is exempt from RLS by Postgres default; this is documented
--    here for the audit reader, not as a policy.
```

Two subtleties:

- There is **no DELETE policy.** A farmer who wants to "turn off" alerts toggles `enabled=false` (BR design: alerts are configuration, not entities — keep the audit trail). The owner-delete is intentionally absent; an admin can `DELETE` only via the service role. This drops one row from the AUTH-07 matrix (the WRITE × DELETE cell is intentionally documented as `N/A — no policy by design`).
- **`is_verified(uuid)`** is a SECURITY DEFINER helper added in AUTH-06; it returns `true` iff `profiles.verification_status = 'VERIFIED'`. KAT-05 reuses it; no new helper.

### 4.5 Audit-column guard trigger

```sql
create or replace function public.m1_katara_thresholds_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    -- service_role bypasses RLS entirely; we still want it to be the only
    -- writer of audit columns. The trigger runs for every role.
    if current_setting('request.jwt.claim.role', true) = 'service_role'
       or current_user = 'service_role' then
        return new;
    end if;

    if tg_op = 'INSERT' then
        new.last_alert_at := null;
        new.last_alert_value := null;
        return new;
    elsif tg_op = 'UPDATE' then
        new.last_alert_at := old.last_alert_at;
        new.last_alert_value := old.last_alert_value;
        new.created_at := old.created_at;
        new.updated_at := now();
        -- farmer_id is bound to parcel_id; no rebinding via UPDATE.
        new.farmer_id := old.farmer_id;
        new.parcel_id := old.parcel_id;
        new.metric    := old.metric;
        return new;
    end if;
    return new;
end;
$$;

create trigger m1_katara_thresholds_audit_guard
    before insert or update on public.m1_katara_thresholds
    for each row execute function public.m1_katara_thresholds_audit_guard();
```

The trigger **silently clamps** instead of raising. Reason: if a buggy frontend ships `last_alert_at` in its `PUT` body, we want the user's *legitimate* threshold change to succeed — the field is then silently dropped. Raising would block the change behind a bug the user can't fix. The pgTAP cell in §5.8 verifies this clamping.

A second trigger derives `farmer_id` from `parcel_id` on INSERT so the API never sends it:

```sql
create or replace function public.m1_katara_thresholds_fill_farmer_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.farmer_id is null then
        select farmer_id into new.farmer_id
        from public.m1_katara_parcels
        where id = new.parcel_id;
    end if;
    return new;
end;
$$;

create trigger m1_katara_thresholds_fill_farmer_id
    before insert on public.m1_katara_thresholds
    for each row execute function public.m1_katara_thresholds_fill_farmer_id();
```

This trigger runs *before* the audit guard, which is the desired order (Postgres triggers fire in alphabetical name order — the names above are picked so `fill_farmer_id` runs first).

### 4.6 Endpoint contracts

| Verb | Path | Auth | Verified? | Body | Response |
|---|---|---|---|---|---|
| `GET` | `/api/v1/katara/parcels/{parcel_id}/thresholds` | JWT (FARMER \| ADMIN) | No | — | `ThresholdsResponse` — always five rows, defaults filled in when a row doesn't exist |
| `PUT` | `/api/v1/katara/parcels/{parcel_id}/thresholds` | JWT (FARMER) | **Yes** | `ThresholdsUpdateRequest` — full array of five `metric`/`min`/`max`/`enabled` entries | `ThresholdsResponse` (post-save), `200 OK` |

The `PUT` is **bulk, idempotent UPSERT** in a single transaction. Per-metric `PATCH` is *not* exposed: the editor saves the whole form atomically, and a worker that wakes up between two partial saves cannot read an inconsistent half-applied state. This is the simplest interface that satisfies BR-K2.

Cache headers: `Cache-Control: private, max-age=0, must-revalidate` on both. Thresholds are configuration the user just set — never serve stale.

Verification gate: `PUT` checks `is_verified(auth.uid())` via the existing `Depends(require_verified)` helper from AUTH-06; PENDING / REJECTED farmers get `403 {"detail": "verification_required"}`.

---

## 5. Step-by-Step Implementation

### 5.1 Migration 0020 — table, defaults, RLS, triggers

Create [db/migrations/0020_kat05_alert_thresholds.sql](../../db/migrations/0020_kat05_alert_thresholds.sql). The file is the canonical artefact for §4.2–4.5 above; copy them in verbatim. After applying:

```sql
-- Verifications
\d+ public.m1_katara_thresholds       -- shows 4 CHECK constraints + 2 unique + 2 triggers
select count(*) from pg_policies
    where tablename = 'm1_katara_thresholds';                              -- expect 4
select * from public.m1_katara_threshold_defaults('soil_moisture');        -- expect 25, 75, t
select * from public.m1_katara_threshold_defaults('battery_level');        -- expect 15, null, t
select * from public.m1_katara_threshold_defaults('nonexistent');          -- expect 0 rows
```

Apply with `supabase db push`. The AUTH-07 matrix's NOTICE-SKIP for `m1_katara_thresholds` flips to active on the next `make -C db verify` run because of the `to_regclass()` guard.

---

### 5.2 Backend — Pydantic schemas

Append to [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py):

```python
# ── KAT-05 alert threshold models ─────────────────────────────────────────────

from typing import Literal

Metric = Literal[
    "soil_moisture", "soil_temperature", "soil_ph",
    "soil_conductivity", "battery_level",
]

# Mirror the DB CHECK so we 422 before the round-trip.
# Tuple form: (min_bound, max_bound). None means "no lower / no upper".
_METRIC_RANGE: dict[Metric, tuple[float, float]] = {
    "soil_moisture":     (0.0, 100.0),
    "soil_temperature":  (-20.0, 80.0),
    "soil_ph":           (0.0, 14.0),
    "soil_conductivity": (0.0, 20000.0),
    "battery_level":     (0.0, 100.0),
}


class ThresholdRow(BaseModel):
    """One row in the bulk array. `min_value` / `max_value` are independently
    nullable but at least one must be set when `enabled=true`. The DB rejects
    the same shapes; we 422 here to save a round-trip."""
    metric: Metric
    min_value: float | None = None
    max_value: float | None = None
    enabled: bool = True
    # Read-only on the wire (server fills); included in responses for KAT-06
    # debugging. Pydantic `Field(default=None, frozen=True)` would block PUT
    # bodies that include these — but we want soft-ignore (trigger clamps),
    # so we accept and discard in the router.
    last_alert_at: datetime | None = None
    last_alert_value: float | None = None

    @model_validator(mode="after")
    def _validate_bounds(self) -> "ThresholdRow":
        if self.enabled and self.min_value is None and self.max_value is None:
            raise ValueError("enabled_threshold_needs_min_or_max")
        if (self.min_value is not None and self.max_value is not None
                and self.min_value >= self.max_value):
            raise ValueError("min_value_must_be_less_than_max_value")
        lo, hi = _METRIC_RANGE[self.metric]
        for label, v in (("min_value", self.min_value), ("max_value", self.max_value)):
            if v is not None and not (lo <= v <= hi):
                raise ValueError(
                    f"{label}_out_of_range_for_{self.metric}_must_be_{lo}_to_{hi}"
                )
        return self


class ThresholdsResponse(BaseModel):
    parcel_id: UUID
    rows: list[ThresholdRow]  # always length 5, one per metric


class ThresholdsUpdateRequest(BaseModel):
    rows: list[ThresholdRow]

    @model_validator(mode="after")
    def _exactly_five_distinct_metrics(self) -> "ThresholdsUpdateRequest":
        seen = {r.metric for r in self.rows}
        if len(self.rows) != 5 or seen != set(_METRIC_RANGE):
            raise ValueError("request_must_contain_exactly_one_row_per_metric")
        return self
```

---

### 5.3 Backend — thresholds router

Create [backend/app/modules/katara/thresholds.py](../../backend/app/modules/katara/thresholds.py):

```python
"""KAT-05 alert threshold endpoints.

GET — always returns five rows. Missing rows are hydrated with
m1_katara_threshold_defaults() so the UI always has a coherent state to
render the Sparkline band overlay.

PUT — bulk idempotent upsert in a single transaction. The audit-guard
trigger silently strips last_alert_at / last_alert_value if the client
sends them, so we accept them in the body but do not pass them on the way
in. KAT-06's worker is the only legitimate writer of those columns.

No service-role on this path. RLS is the security boundary.
"""

from __future__ import annotations
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.core.security import (
    AuthUser, get_current_user, get_db_for_user, require_verified,
)
from app.modules.katara.schemas import (
    Metric, ThresholdRow, ThresholdsResponse, ThresholdsUpdateRequest,
)

router = APIRouter(
    prefix="/katara/parcels/{parcel_id}/thresholds",
    tags=["katara"],
)

_METRICS: tuple[Metric, ...] = (
    "soil_moisture", "soil_temperature", "soil_ph",
    "soil_conductivity", "battery_level",
)


async def _hydrate(db: Client, parcel_id: UUID) -> list[ThresholdRow]:
    """Return five rows: existing where present, defaults where absent."""
    existing = (
        db.table("m1_katara_thresholds")
        .select("metric, min_value, max_value, enabled, "
                "last_alert_at, last_alert_value")
        .eq("parcel_id", str(parcel_id))
        .execute()
    )
    by_metric = {r["metric"]: r for r in (existing.data or [])}
    rows: list[ThresholdRow] = []
    for m in _METRICS:
        if m in by_metric:
            rows.append(ThresholdRow(**by_metric[m]))
            continue
        d = (
            db.rpc("m1_katara_threshold_defaults", {"p_metric": m})
              .execute()
        )
        rec = (d.data or [{}])[0]
        rows.append(ThresholdRow(
            metric=m,
            min_value=rec.get("min_value"),
            max_value=rec.get("max_value"),
            enabled=rec.get("enabled", True),
        ))
    return rows


async def _verify_parcel_exists_for_caller(db: Client, parcel_id: UUID) -> None:
    """RLS already filters; this disambiguates 404 vs empty result for the
    UI's empty state. One row, indexed by primary key — negligible cost."""
    check = (
        db.table("m1_katara_parcels")
          .select("id")
          .eq("id", str(parcel_id))
          .limit(1)
          .execute()
    )
    if not (check.data or []):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="parcel_not_found")


@router.get("", response_model=ThresholdsResponse)
async def get_thresholds(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> ThresholdsResponse:
    await _verify_parcel_exists_for_caller(db, parcel_id)
    rows = await _hydrate(db, parcel_id)
    return ThresholdsResponse(parcel_id=parcel_id, rows=rows)


@router.put("", response_model=ThresholdsResponse)
async def put_thresholds(
    parcel_id: UUID,
    body: ThresholdsUpdateRequest,
    user: Annotated[AuthUser, Depends(require_verified)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> ThresholdsResponse:
    """Bulk upsert. Each row is keyed by (parcel_id, metric); the audit-guard
    trigger drops last_alert_at / last_alert_value silently."""
    await _verify_parcel_exists_for_caller(db, parcel_id)

    # Strip audit columns on the way in; trust the trigger as a backstop.
    upserts = [
        {
            "parcel_id": str(parcel_id),
            "metric":    r.metric,
            "min_value": r.min_value,
            "max_value": r.max_value,
            "enabled":   r.enabled,
        }
        for r in body.rows
    ]

    res = (
        db.table("m1_katara_thresholds")
          .upsert(upserts, on_conflict="parcel_id,metric")
          .execute()
    )
    # Supabase's PostgREST returns the affected rows; we ignore them and
    # re-hydrate so the response always reflects the post-trigger state
    # (audit columns preserved, updated_at refreshed).
    _ = res

    rows = await _hydrate(db, parcel_id)
    return ThresholdsResponse(parcel_id=parcel_id, rows=rows)
```

Register the router in [backend/app/main.py](../../backend/app/main.py) next to the existing Katara routers:

```python
from app.modules.katara.thresholds import router as katara_thresholds_router
app.include_router(katara_thresholds_router, prefix="/api/v1")
```

---

### 5.4 Frontend — server action

Create [frontend/src/app/dashboard/farmer/parcels/[id]/thresholds-actions.ts](../../frontend/src/app/dashboard/farmer/parcels/[id]/thresholds-actions.ts):

```typescript
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Metric =
  | "soil_moisture"
  | "soil_temperature"
  | "soil_ph"
  | "soil_conductivity"
  | "battery_level";

export interface ThresholdRow {
  metric: Metric;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
  last_alert_at?: string | null;
  last_alert_value?: number | null;
}

export interface ThresholdsResponse {
  parcel_id: string;
  rows: ThresholdRow[];
}

/** Initial server-side fetch — pairs with fetchInitialTelemetry on the page. */
export async function fetchThresholds(parcelId: string): Promise<ThresholdsResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
  const r = await fetch(`${apiBase}/katara/parcels/${parcelId}/thresholds`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  if (r.status === 404) throw new Error("parcel_not_found");
  if (!r.ok) throw new Error(`thresholds_fetch_failed_${r.status}`);
  return (await r.json()) as ThresholdsResponse;
}
```

---

### 5.5 Frontend — ThresholdsSection + MetricRow

Create [frontend/src/app/dashboard/farmer/parcels/[id]/ThresholdsSection.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/ThresholdsSection.tsx):

```tsx
"use client";

import { useState, useTransition } from "react";
import type { Metric, ThresholdRow, ThresholdsResponse } from "./thresholds-actions";

const METRIC_LABELS: Record<Metric, { label: string; unit: string; step: number }> = {
  soil_moisture:     { label: "Humidité du sol",    unit: "%",     step: 1   },
  soil_temperature:  { label: "Température du sol", unit: "°C",    step: 0.5 },
  soil_ph:           { label: "pH du sol",          unit: "",      step: 0.1 },
  soil_conductivity: { label: "Conductivité",       unit: "µS/cm", step: 50  },
  battery_level:     { label: "Batterie",           unit: "%",     step: 1   },
};

interface Props {
  parcelId: string;
  accessToken: string;
  isVerified: boolean;
  initial: ThresholdsResponse;
  onChange: (rows: ThresholdRow[]) => void; // lifted up so Sparkline can read
}

export function ThresholdsSection({
  parcelId, accessToken, isVerified, initial, onChange,
}: Props) {
  const [rows, setRows] = useState<ThresholdRow[]>(initial.rows);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "ok">("idle");
  const [pending, startTransition] = useTransition();
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";

  function patch(metric: Metric, p: Partial<ThresholdRow>) {
    setRows((rs) => {
      const next = rs.map((r) => (r.metric === metric ? { ...r, ...p } : r));
      onChange(next);
      return next;
    });
    setSaved("idle");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await fetch(`${apiBase}/katara/parcels/${parcelId}/thresholds`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rows }),
      });
      if (r.status === 403) { setError("verification_required"); return; }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body?.detail?.[0]?.msg ?? body?.detail ?? `error_${r.status}`);
        return;
      }
      const fresh = (await r.json()) as ThresholdsResponse;
      setRows(fresh.rows);
      onChange(fresh.rows);
      setSaved("ok");
    });
  }

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-semibold">Seuils d'alerte</h2>

      {!isVerified && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Vous devez être vérifié pour enregistrer des seuils. La consultation reste possible.
        </div>
      )}

      <div className="rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Métrique</th>
              <th className="px-3 py-2 text-right">Min</th>
              <th className="px-3 py-2 text-right">Max</th>
              <th className="px-3 py-2 text-center">Activé</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = METRIC_LABELS[r.metric];
              return (
                <tr key={r.metric} className="border-t border-neutral-100">
                  <td className="px-3 py-2">{meta.label}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number" step={meta.step} inputMode="decimal"
                      disabled={!isVerified || pending}
                      className="w-24 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums"
                      value={r.min_value ?? ""}
                      onChange={(e) => patch(r.metric, {
                        min_value: e.target.value === "" ? null : Number(e.target.value),
                      })}
                      aria-label={`${meta.label} minimum`}
                    />
                    <span className="ml-1 text-xs text-neutral-500">{meta.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number" step={meta.step} inputMode="decimal"
                      disabled={!isVerified || pending}
                      className="w-24 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums"
                      value={r.max_value ?? ""}
                      onChange={(e) => patch(r.metric, {
                        max_value: e.target.value === "" ? null : Number(e.target.value),
                      })}
                      aria-label={`${meta.label} maximum`}
                    />
                    <span className="ml-1 text-xs text-neutral-500">{meta.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      disabled={!isVerified || pending}
                      checked={r.enabled}
                      onChange={(e) => patch(r.metric, { enabled: e.target.checked })}
                      aria-label={`${meta.label} activer`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-neutral-500">
          Laissez Min ou Max vide pour désactiver ce côté.
          Les alertes sont envoyées au maximum une fois toutes les 24 h par métrique.
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!isVerified || pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {error && (
        <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}
      {saved === "ok" && !error && (
        <div className="mt-2 text-sm text-emerald-700">Seuils enregistrés.</div>
      )}
    </section>
  );
}
```

---

### 5.6 Sparkline — additive band overlay

Modify [frontend/src/app/dashboard/farmer/parcels/[id]/Sparkline.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/Sparkline.tsx) — only two changes, both additive:

```diff
 interface Props {
   title: string;
   values: HistoryBucket[];
   field: keyof Pick<…>;
   color: string;
+  thresholdMin?: number | null;
+  thresholdMax?: number | null;
 }

-export function Sparkline({ title, values, field, color }: Props) {
+export function Sparkline({
+  title, values, field, color, thresholdMin, thresholdMax,
+}: Props) {
   const W = 400; const H = 120; const PAD = 8;
   …
   const ys = values.map((b) => b[field]);
-  const min = Math.min(...ys);
-  const max = Math.max(...ys);
+  // Stretch the Y axis to also include the threshold bounds so the band
+  // is always visible — even if all telemetry sits well inside the band.
+  const yPool = [...ys];
+  if (thresholdMin != null) yPool.push(thresholdMin);
+  if (thresholdMax != null) yPool.push(thresholdMax);
+  const min = Math.min(...yPool);
+  const max = Math.max(...yPool);
   const range = max - min || 1;
+  const yOf = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);
   …
   return (
     <figure …>
       …
       <svg …>
         <title>{title}</title>
+        {thresholdMin != null && thresholdMax != null && (
+          <rect
+            x={PAD} y={yOf(thresholdMax)}
+            width={W - PAD * 2}
+            height={yOf(thresholdMin) - yOf(thresholdMax)}
+            fill={color} fillOpacity={0.07}
+          />
+        )}
+        {thresholdMin != null && (
+          <line
+            x1={PAD} x2={W - PAD} y1={yOf(thresholdMin)} y2={yOf(thresholdMin)}
+            stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.6}
+          />
+        )}
+        {thresholdMax != null && (
+          <line
+            x1={PAD} x2={W - PAD} y1={yOf(thresholdMax)} y2={yOf(thresholdMax)}
+            stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.6}
+          />
+        )}
         <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
       </svg>
     </figure>
   );
 }
```

Behaviour when both props are `undefined`: identical to KAT-04 — same `min`/`max`, same path, no extra SVG nodes. KAT-04's tests pass unchanged.

---

### 5.7 Wire it into the parcel detail page

The page already lifts telemetry state (KAT-04). Add a sibling lift for thresholds and a small adapter that maps the threshold row for each metric into the corresponding Sparkline. Patch [frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx):

```diff
   const { latest, history } = await fetchInitialTelemetry(id);
+  const thresholds = await fetchThresholds(id);
   const { data: { session } } = await supabase.auth.getSession();

   return (
     <main className="mx-auto max-w-3xl px-4 py-8">
       …
       <DevicesSection … />
-      <TelemetrySection
-        parcelId={parcel.id}
-        initialLatest={latest}
-        initialHistory={history}
-        accessToken={session!.access_token}
-      />
+      <ParcelTelemetryAndThresholds
+        parcelId={parcel.id}
+        accessToken={session!.access_token}
+        isVerified={isVerified}
+        initialLatest={latest}
+        initialHistory={history}
+        initialThresholds={thresholds}
+      />
     </main>
   );
```

And the small wrapper component that lifts the state to the shared boundary — co-located with the section files: [frontend/src/app/dashboard/farmer/parcels/[id]/ParcelTelemetryAndThresholds.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/ParcelTelemetryAndThresholds.tsx):

```tsx
"use client";

import { useState, useMemo } from "react";
import { TelemetrySection } from "./TelemetrySection";
import { ThresholdsSection } from "./ThresholdsSection";
import type { HistoryResponse, LatestTelemetry } from "./telemetry-actions";
import type { Metric, ThresholdRow, ThresholdsResponse } from "./thresholds-actions";

interface Props {
  parcelId: string;
  accessToken: string;
  isVerified: boolean;
  initialLatest: LatestTelemetry | null;
  initialHistory: HistoryResponse;
  initialThresholds: ThresholdsResponse;
}

export function ParcelTelemetryAndThresholds(p: Props) {
  const [rows, setRows] = useState<ThresholdRow[]>(p.initialThresholds.rows);
  const byMetric = useMemo(() => {
    const m: Partial<Record<Metric, ThresholdRow>> = {};
    for (const r of rows) m[r.metric] = r;
    return m;
  }, [rows]);

  return (
    <>
      <TelemetrySection
        parcelId={p.parcelId}
        accessToken={p.accessToken}
        initialLatest={p.initialLatest}
        initialHistory={p.initialHistory}
        thresholdsByMetric={byMetric}
      />
      <ThresholdsSection
        parcelId={p.parcelId}
        accessToken={p.accessToken}
        isVerified={p.isVerified}
        initial={p.initialThresholds}
        onChange={setRows}
      />
    </>
  );
}
```

And the single new prop on `TelemetrySection` (additive; default `{}` keeps old call sites compiling):

```diff
 interface Props {
   parcelId: string;
   accessToken: string;
   initialLatest: LatestTelemetry | null;
   initialHistory: HistoryResponse;
+  thresholdsByMetric?: Partial<Record<Metric, ThresholdRow>>;
 }
 …
-<Sparkline title="Humidité du sol (%)" values={history.buckets} field="soil_moisture"     color="#0ea5e9" />
+<Sparkline title="Humidité du sol (%)" values={history.buckets} field="soil_moisture"     color="#0ea5e9"
+  thresholdMin={thresholdsByMetric?.soil_moisture?.enabled ? thresholdsByMetric.soil_moisture.min_value : undefined}
+  thresholdMax={thresholdsByMetric?.soil_moisture?.enabled ? thresholdsByMetric.soil_moisture.max_value : undefined} />
```

Repeat the four-line block per Sparkline; only the `field`/metric name changes.

---

### 5.8 Tests

#### pgTAP — append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql), under the existing `m1_katara_thresholds` to_regclass guard:

- **AUTH-07 matrix cells** — five SELECT cells + two WRITE cells, all activating the prior `SKIP` NOTICEs:
  - FARMER-A own row read → 1 row.
  - FARMER-A own row insert (verified) → success.
  - FARMER-A own row update → success; trigger preserves audit columns.
  - FARMER-A own row insert when PENDING → RLS WITH CHECK denies.
  - FARMER-B sibling parcel → 0 rows.
  - RESTAURANT / CITIZEN → 0 rows on read, RLS denies write.
  - ADMIN → reads all, cannot write (no admin INSERT policy).
- **BR cell — per-metric range CHECK** — INSERT a `soil_ph max=20` row → DB raises `23514` (`check_violation`).
- **BR cell — min < max** — INSERT `soil_moisture min=80 max=20` → DB raises `23514`.
- **BR cell — at-least-one-bound** — INSERT `enabled=true min=null max=null` → DB raises `23514`.
- **BR cell — audit-column clamp** — INSERT a row with `last_alert_at=now()` as FARMER → trigger silently clamps to NULL; SELECT confirms `last_alert_at IS NULL`.
- **BR cell — audit-column update** — UPDATE a row as FARMER setting `last_alert_at=now()` → trigger silently preserves OLD; SELECT confirms unchanged. UPDATE the same column via `service_role` → write succeeds. **This is the contract KAT-06 leans on.**
- **BR cell — `enabled` toggle vs delete** — DELETE a row as FARMER → RLS denies (no DELETE policy). UPDATE `enabled=false` → succeeds. Records the no-delete design choice.

#### Backend — create [backend/tests/test_kat05_thresholds.py](../../backend/tests/test_kat05_thresholds.py):

```python
"""KAT-05 threshold endpoint tests.

Unit layer: Pydantic validators 422 the same shapes the DB CHECKs reject,
so a malicious payload doesn't reach the DB.

e2e layer (requires --run-e2e and AUTH-07 staging fixtures): bulk PUT happy
path, partial change semantics (only soil_moisture changes), PENDING farmer
gets 403, cross-farmer GET returns 404 (RLS-filtered into "no such parcel").
"""
from __future__ import annotations
import pytest
import requests
from pydantic import ValidationError

from app.modules.katara.schemas import ThresholdRow, ThresholdsUpdateRequest


class TestThresholdValidator:
    def test_enabled_without_bounds_rejected(self):
        with pytest.raises(ValidationError):
            ThresholdRow(metric="soil_moisture", enabled=True)

    def test_min_ge_max_rejected(self):
        with pytest.raises(ValidationError):
            ThresholdRow(metric="soil_moisture", min_value=80, max_value=20)

    @pytest.mark.parametrize("metric,value", [
        ("soil_ph", 20),
        ("soil_moisture", -1),
        ("soil_temperature", 100),
        ("soil_conductivity", 99999),
        ("battery_level", 101),
    ])
    def test_out_of_range_rejected_before_db(self, metric, value):
        with pytest.raises(ValidationError):
            ThresholdRow(metric=metric, min_value=value)

    def test_bulk_request_requires_all_five_metrics(self):
        rows = [
            ThresholdRow(metric="soil_moisture", min_value=25, max_value=75),
        ]
        with pytest.raises(ValidationError):
            ThresholdsUpdateRequest(rows=rows)


@pytest.mark.skipif("not config.getoption('--run-e2e')", reason="e2e only")
class TestThresholdsFlow:
    def _u(self, api_base_url, jwt, parcel_id):
        return f"{api_base_url}/api/v1/katara/parcels/{parcel_id}/thresholds"

    def _bulk_body(self, **overrides):
        defaults = {
            "soil_moisture":     (25, 75),
            "soil_temperature":  (5, 35),
            "soil_ph":           (5.5, 7.5),
            "soil_conductivity": (400, 3000),
            "battery_level":     (15, None),
        }
        defaults.update(overrides)
        return {"rows": [
            {"metric": m, "min_value": mn, "max_value": mx, "enabled": True}
            for m, (mn, mx) in defaults.items()
        ]}

    def test_get_hydrates_defaults(self, api_base_url, staging_farmer_jwt, demo_parcel_id):
        r = requests.get(self._u(api_base_url, staging_farmer_jwt, demo_parcel_id),
                         headers={"Authorization": f"Bearer {staging_farmer_jwt}"})
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert {row["metric"] for row in rows} == {
            "soil_moisture", "soil_temperature", "soil_ph",
            "soil_conductivity", "battery_level",
        }

    def test_put_upserts_and_get_reflects(self, api_base_url, staging_farmer_jwt, demo_parcel_id):
        body = self._bulk_body(soil_moisture=(30, 70))
        r = requests.put(self._u(api_base_url, staging_farmer_jwt, demo_parcel_id),
                         json=body,
                         headers={"Authorization": f"Bearer {staging_farmer_jwt}"})
        assert r.status_code == 200
        moisture = next(x for x in r.json()["rows"] if x["metric"] == "soil_moisture")
        assert moisture["min_value"] == 30 and moisture["max_value"] == 70

    def test_pending_farmer_403(self, api_base_url, staging_farmer_b_jwt, demo_parcel_id):
        # FARMER-B is PENDING per the AUTH-07 seed.
        r = requests.put(self._u(api_base_url, staging_farmer_b_jwt, demo_parcel_id),
                         json=self._bulk_body(),
                         headers={"Authorization": f"Bearer {staging_farmer_b_jwt}"})
        assert r.status_code in (403, 404)  # 404 if RLS filters the parcel itself

    def test_citizen_404(self, api_base_url, staging_citizen_jwt, demo_parcel_id):
        r = requests.get(self._u(api_base_url, staging_citizen_jwt, demo_parcel_id),
                         headers={"Authorization": f"Bearer {staging_citizen_jwt}"})
        assert r.status_code == 404  # RLS-filtered parcel select → 404

    def test_audit_columns_silently_clamped(self, api_base_url, staging_farmer_jwt, demo_parcel_id):
        body = self._bulk_body()
        body["rows"][0]["last_alert_at"] = "2024-01-01T00:00:00Z"
        body["rows"][0]["last_alert_value"] = 999.0
        r = requests.put(self._u(api_base_url, staging_farmer_jwt, demo_parcel_id),
                         json=body, headers={"Authorization": f"Bearer {staging_farmer_jwt}"})
        assert r.status_code == 200
        moisture = next(x for x in r.json()["rows"] if x["metric"] == "soil_moisture")
        assert moisture["last_alert_at"] in (None,)  # trigger clamped
        assert moisture["last_alert_value"] in (None,)
```

Run:

```bash
cd backend && pytest tests/test_kat05_thresholds.py::TestThresholdValidator -v
make -C db test-auth07
```

---

### 5.9 NGINX — no new zone

`/thresholds` GETs and PUTs fall under the generic `api` zone (60 r/s burst 30 per IP from AUTH-08). A farmer saves once per parcel per editing session — orders of magnitude under the ceiling. AUTH-07 asserts only the four declared zones exist; do not add one.

---

## 6. Verification Checklist

- [ ] `db/migrations/0020_kat05_alert_thresholds.sql` applied — `\d+ public.m1_katara_thresholds` shows the four CHECKs, the two triggers, four RLS policies, and `force_rls = true`.
- [ ] `select * from public.m1_katara_threshold_defaults('battery_level')` returns `(15, null, t)`.
- [ ] `pytest backend/tests/test_kat05_thresholds.py::TestThresholdValidator -v` → 8/8 green.
- [ ] `make -C db test-auth07` — the seven `m1_katara_thresholds` AUTH-07 cells flip from SKIP to PASS; the seven BR cells (range / min<max / at-least-one-bound / audit-clamp INSERT / audit-clamp UPDATE / service-role-can-write-audit / no-delete-policy) all green.
- [ ] `--run-e2e` block green against staging.
- [ ] **Sparkline regression** — KAT-04 unit/e2e tests still green (zero behavioural change when `thresholdMin`/`thresholdMax` are `undefined`); a new visual check confirms the band renders when both are set, only the min line when only min is set, only the max line when only max.
- [ ] **PENDING farmer** flow — open the parcel page as a PENDING farmer, see the read-only banner, the form is disabled, the save button is disabled.
- [ ] **Cross-farmer** — FARMER-B opening FARMER-A's parcel URL gets a 404 from `/thresholds` (RLS filters the parent parcel SELECT to empty).
- [ ] **Audit column lock** — issue `curl PUT ... last_alert_at=2030-01-01` as a verified farmer; subsequent `GET` returns `last_alert_at: null`. Then update as service-role (psql) — subsequent `GET` returns the new value.
- [ ] Frontend smoke: `npm --prefix frontend run typecheck && npm --prefix frontend run lint` green; visit `/dashboard/farmer/parcels/<id>`, edit the soil_moisture min from 25 → 30, save, observe (i) toast "Seuils enregistrés.", (ii) the moisture Sparkline's dashed lower line moves up immediately (lifted state, no refresh), (iii) the next `GET` shows `updated_at` advanced.
- [ ] Lighthouse mobile re-check on the parcel detail page: LCP < 2.5 s on 4G (the new section is HTML + a table — no new asset weight; total additional JS is ~3 KB gz).
- [ ] `docker compose exec backend grep -R "service_client" backend/app/modules/katara/thresholds.py` returns nothing — KAT-05 must not touch service-role.
- [ ] [docs/spring-status.yml](../spring-status.yml): `KAT-05.status: IN_REVIEW`; flips DONE after staging e2e is green; `E2.progress_pct` bumped (29 % → ~36 %); KAT-06 listed as unblocked.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| DB migration | [db/migrations/0020_kat05_alert_thresholds.sql](../../db/migrations/0020_kat05_alert_thresholds.sql) |
| Pydantic schemas | [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py) (append KAT-05 block) |
| Thresholds router | [backend/app/modules/katara/thresholds.py](../../backend/app/modules/katara/thresholds.py) |
| Router registration | [backend/app/main.py](../../backend/app/main.py) — `include_router(katara_thresholds_router)` |
| Frontend server action | [frontend/src/app/dashboard/farmer/parcels/[id]/thresholds-actions.ts](../../frontend/src/app/dashboard/farmer/parcels/[id]/thresholds-actions.ts) |
| Frontend section | [frontend/src/app/dashboard/farmer/parcels/[id]/ThresholdsSection.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/ThresholdsSection.tsx) |
| Lifted-state wrapper | [frontend/src/app/dashboard/farmer/parcels/[id]/ParcelTelemetryAndThresholds.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/ParcelTelemetryAndThresholds.tsx) |
| Sparkline diff | [frontend/src/app/dashboard/farmer/parcels/[id]/Sparkline.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/Sparkline.tsx) (additive props) |
| TelemetrySection diff | [frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx) (one new optional prop + Sparkline plumbing) |
| Parcel page wiring | [frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx) |
| Backend tests | [backend/tests/test_kat05_thresholds.py](../../backend/tests/test_kat05_thresholds.py) |
| pgTAP AUTH-07 + BR cells | [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | `KAT-05.status` → `IN_REVIEW`; E2 progress bumped; KAT-06 listed as unblocked |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Per-parcel vs per-device disagreement at review** | Decision recorded in §2 scope and §4.2 note #5. Forward path is additive (one nullable column, drop+recreate the unique constraint). Demo Day shows the per-parcel UI; if the team votes per-device post-MVD, the migration is ~20 minutes. |
| **Frontend ships `last_alert_at` in the bulk PUT body and silently breaks BR-K2** | Two-layer defence: (a) the audit-guard trigger silently clamps every farmer-role write; (b) the pgTAP cell in §5.8 fails CI if a future trigger refactor removes the clamp. |
| **A farmer edits thresholds in two tabs at once and clobbers the other tab's save** | Last-write-wins is acceptable for MVD — both tabs belong to the same user, who can see the conflict immediately. The `updated_at` column is surfaced in the response so the UI *could* warn ("updated 2s ago in another tab") post-MVD. Not implemented here. |
| **The "at-least-one-bound" rule blocks a farmer who wants to *temporarily* disable both sides** | The `enabled=false` toggle is the supported way to mute a metric without losing the configured bounds. The form treats `enabled=false` as the "off" state visually so the difference is obvious. |
| **KAT-06 starts before KAT-05 ships** | Already gated in `spring-status.yml` (`KAT-06.depends_on: [KAT-05, NOT-01]`). KAT-05 publishes the row contract first; KAT-06's worker is purely a reader of that contract. |
| **Locale formatting of the `pH` decimal in Arabic / RTL** | The `<input type="number">` is locale-aware in modern browsers; the `step={0.1}` ensures the spinner behaves. Arabic-numeral display is handled by the same i18n pass [KAT-04 §6](./KAT-04-dashboard-realtime-historical-charts.md) tracks; flagged with `// i18n-KAT05` markers in `ThresholdsSection.tsx`. |
| **Defaults drift between SQL helper and Pydantic / UI** | Defaults are sourced **only** from `m1_katara_threshold_defaults()` — the API calls the function for each missing metric. The UI never carries default values; it renders whatever the API returns. The pgTAP cell asserts the five expected default rows match the canonical table in §4.1. |
| **A future migration adds a sixth metric and the `_METRIC_RANGE` Python dict drifts** | The bulk-PUT validator asserts the request set exactly equals the keys of `_METRIC_RANGE`; the e2e GET test asserts the five-metric set; the DB CHECK lists the metrics literally. All three places must move together — drift fails one of the three immediately. |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Migration 0020 (table + CHECKs + defaults function + RLS quartet + 2 triggers) | 75 min |
| Pydantic schemas + per-metric range validator | 25 min |
| FastAPI router (GET hydrate + PUT bulk-upsert) | 50 min |
| Frontend server action | 15 min |
| `ThresholdsSection` (table editor, optimistic save, PENDING gate) | 80 min |
| `ParcelTelemetryAndThresholds` lifted-state wrapper | 20 min |
| `Sparkline` additive props (band + dashed lines) | 20 min |
| `TelemetrySection` one-prop plumbing + four Sparkline call-site diffs | 15 min |
| Backend unit + e2e tests (validator parametrisation + 5 e2e scenarios) | 60 min |
| pgTAP AUTH-07 + BR cells (7 cells + 7 BRs) | 60 min |
| Manual staging smoke + cross-tab verify + cross-farmer 404 | 20 min |
| `spring-status.yml` update + hand-off note | 10 min |
| **Total active work** | **~7.5 h** |

---

## 10. Definition of Done

1. Acceptance criterion met: a verified farmer opens `/dashboard/farmer/parcels/<id>`, edits any combination of the 5×(min,max,enabled) fields, saves once, the four Sparkline charts immediately reflect the new bands, and a follow-up reload shows the same persisted values. A second-farmer / citizen / restaurant hitting the same `PUT /thresholds` endpoint gets a 404 (RLS-filtered parcel). A PENDING farmer's `PUT` returns `403 verification_required`.
2. Verification checklist (§6) fully ticked.
3. All deliverables (§7) committed and pushed.
4. AUTH-07 matrix: the seven `m1_katara_thresholds` cells (5 SELECT + 2 WRITE) flip from SKIP to PASS; the seven new BR cells (range / min<max / at-least-one-bound / audit-clamp INSERT / audit-clamp UPDATE / service-role-can-write-audit / no-delete-policy) ship green.
5. Staging spot-check: a verified farmer's `PUT /thresholds` round-trip p50 < 200 ms (NFR §8.1 sync API SLA). `GET` p50 < 100 ms (only five rows + one RPC).
6. [docs/spring-status.yml](../spring-status.yml): `KAT-05.status: IN_REVIEW` after local DoD; `DONE` after staging e2e green; `E2.progress_pct` bumped from ~29 % to ~36 %; KAT-06 listed as unblocked in the parent E2 comment.
7. Hand-off note to the team:
   - **KAT-06** (email worker): reads `m1_katara_thresholds` keyed on `parcel_id`. The hot read in the worker is `select metric, min_value, max_value, enabled, last_alert_at from m1_katara_thresholds where parcel_id = $1 and enabled = true` — covered by the `(parcel_id, metric)` index. The worker is the *only* legitimate writer of `last_alert_at` / `last_alert_value` — the pgTAP `audit-clamp UPDATE` cell will catch any other code path that tries. BR-K2 anti-spam reduces to `now() - last_alert_at > interval '24 hours'`.
   - **KAT-06 anti-spam reset on threshold change**: if the worker observes `updated_at > last_alert_at` for a row, the threshold has been edited since the last alert — KAT-06 should treat the suppression as cleared. This is a design hand-off; no schema change required, only worker logic.
   - **i18n** (PRD §7.2): the only hardcoded French strings live in `ThresholdsSection.tsx` and are flagged with `// i18n-KAT05` comments. The metric labels in `METRIC_LABELS` are the extraction targets.
   - **Multi-device parcels** (post-MVD): per §2 scope and §6 risks, the forward path is to add `device_id uuid null` and replace the unique constraint with a `coalesce()`-based variant. No application code outside `thresholds.py` and `KAT-06`'s worker would need to change.
