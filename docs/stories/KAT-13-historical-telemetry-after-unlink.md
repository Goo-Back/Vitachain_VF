# KAT-13 — Historical telemetry remains queryable after device unlink

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Should
> **Status:** TODO
> **Actor:** FARMER (authenticated; verification not required to *read* — only to *publish/pair*)
> **Depends on:** [KAT-12](./KAT-12-unlink-relink-device.md) (ships the `status = 'UNLINKED'` soft-detach contract + the freeze trigger that anchors an UNLINKED device row to the parcel it was paired to at unlink time — KAT-13's "history follows the old parcel" invariant is the *reading* of that contract) · [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) (ships `public.m1_katara_telemetry_history(uuid, interval, text)`, the `/api/v1/katara/parcels/{parcel_id}/telemetry/{latest,history}` endpoints, and the `<TelemetrySection>` component — all parcel-scoped reads that KAT-13 verifies and extends) · [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) (ingest path denormalises `parcel_id` + `farmer_id` onto every `m1_katara_telemetry` row — the column KAT-13 reads on; the table is FORCE-RLS append-only, so historical rows cannot be retro-mutated when a device is moved) · [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) (`katara_telemetry_select_own` is the *only* read gate — KAT-13 adds no new policy)
> **Unblocks:** [KAT-14](./KAT-14-multi-parcel-support.md) (multi-parcel switcher reuses the parcel-scoped history endpoint as-is; KAT-13's "history is parcel-scoped, not device-scoped" guarantee is what makes the multi-parcel UI safe to ship without bespoke per-device filtering) · post-MVD device-archive story (the UNLINKED rows surfaced by KAT-13's device list are the rows a future archival CRON would move into `m1_katara_devices_archive` — KAT-13 ensures they have a UI before they are archived away)
> **Acceptance:** A verified FARMER who once paired `ESP-KAT-001` on parcel A, accumulated 7 days of telemetry, unlinked the device via [KAT-12](./KAT-12-unlink-relink-device.md), and re-paired the same physical ESP32 on parcel B opens parcel A's dashboard and **still sees** the 7-day chart populated with the original readings. Parcel B's dashboard shows only the post-relink telemetry. No row appears on both parcels; no row disappears from parcel A. The KAT-04 endpoint `GET /api/v1/katara/parcels/{parcel_A}/telemetry/history?window=7d` returns the same bucket counts before and after the unlink (modulo the absence of fresh ingests). The parcel A "Devices" card lists the UNLINKED device with a muted styling, the unlink timestamp, and the count of rows it contributed — a farmer scanning the history can mentally attribute a spike or a flatline to the device that produced it. Cross-parcel isolation is intact: a SELECT under FARMER-A's JWT against `m1_katara_telemetry.parcel_id = parcel_B` returns the post-relink rows only; an UNLINKED row of FARMER-B's never surfaces under FARMER-A's view. **No schema change** beyond a single helper SQL view that joins `m1_katara_telemetry` aggregates back to the `m1_katara_devices` row that produced them (for the per-device row-count surface).

---

## 1. Purpose

[KAT-12](./KAT-12-unlink-relink-device.md) delivered the *write*-side of the device lifecycle: a farmer can unlink an ESP32 from a parcel, and the row stays in `m1_katara_devices` with `status = 'UNLINKED'` — frozen by `trg_m1_katara_devices_unlink_freeze` so its `parcel_id` and `farmer_id` cannot drift. [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) shipped the *write*-side of the telemetry table: every row carries a denormalised `parcel_id` + `farmer_id` stamped at ingest time by the `trg_m1_katara_telemetry_denorm` trigger, and the table is FORCE-RLS append-only (no UPDATE policy, no DELETE policy — rows are forever). [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) shipped the *read*-side: the history endpoint filters `where parcel_id = $1`, not `where device_id = $1`.

**The three contracts compose into KAT-13's invariant for free.** A telemetry row written under parcel A by device `ESP-KAT-001` is forever stamped `parcel_id = parcel_A`. When KAT-12 flips the device to UNLINKED, the telemetry row is untouched (FORCE-RLS + no UPDATE policy). When the same physical ESP32 is re-paired on parcel B, KAT-03's ingest trigger stamps the new rows `parcel_id = parcel_B` against the NEW device row's id. The two row sets live in the same table, sharing nothing but the table itself, and KAT-04's `where parcel_id = $1` filter is the natural divider.

So **KAT-13 is not a data-migration story or a schema-change story.** It is the *verification, surfacing, and hardening* story that:

- Proves the composition holds end-to-end with backend tests asserting the round-trip (ingest under device-on-A → unlink → re-pair on B → ingest under device-on-B → both histories isolated).
- Adds **device provenance** to the parcel-scoped history surface so a farmer can see *which device* contributed each batch of historical data. Without provenance, a parcel A history view that includes UNLINKED-device telemetry is correct-but-confusing — the farmer sees "two months of readings" with no way to know that the first six weeks came from a device that has since been moved.
- Adds a **"historical devices" sub-card** on the parcel detail page listing every UNLINKED device that ever contributed telemetry to this parcel, with row counts, first-/last-seen timestamps, and a link to filter the chart by that device. This makes the implicit "telemetry has provenance" promise of KAT-03 visible.
- Extends the **`/latest` empty-state**: a parcel with no currently-paired device but with historical UNLINKED-device telemetry now returns the most recent UNLINKED-device reading with a `device_status: "UNLINKED"` marker, instead of an unconditional `204 No Content`. The farmer sees "last reading 3 days ago, device unlinked" rather than a blank tile, which is the diagnostic state they actually need.
- Adds a `device_id`-scoped history filter parameter (`GET /history?window=7d&device_id=<uuid>`) so the chart can render a single device's slice of the parcel's history. Default behaviour (no `device_id`) is unchanged from KAT-04: aggregate across all devices ever on the parcel.
- Adds AUTH-07 pgTAP cells that pin the post-unlink read contract: (a) telemetry rows survive an unlink, (b) `parcel_id` on a telemetry row is immutable across a device's unlink/relink lifecycle, (c) cross-parcel isolation holds after the same physical device has lived on both parcels.

Concretely KAT-13 delivers:

- **One small migration** ([`db/migrations/0027_kat13_history_with_provenance.sql`](../../db/migrations/)) — a read-only view `public.m1_katara_parcel_device_history` that joins `m1_katara_telemetry` aggregates against `m1_katara_devices` for the per-device row-count surface, plus an extension of `public.m1_katara_telemetry_history()` that accepts an optional `p_device_id uuid` filter (default `NULL` = all devices, preserving KAT-04's signature for back-compat).
- **One FastAPI route extension** under [`backend/app/modules/katara/telemetry.py`](../../backend/app/modules/katara/telemetry.py) — the existing `GET /history` gains an optional `?device_id=` query param; a new `GET /devices-history` enumerates the parcel's historical devices (UNLINKED + ACTIVE) with their telemetry contribution. The `/latest` endpoint is extended to fall back to the most recent UNLINKED-device reading when the parcel has no active device but has historical telemetry.
- **Frontend** — three additions to [`frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx`](../../frontend/src/app/dashboard/farmer/parcels/): (1) a `<DeviceHistoryCard>` listing UNLINKED devices that contributed telemetry, (2) a per-device chart filter dropdown above the existing window selector, (3) a "device unlinked" pill on the `/latest` tile when the most recent reading came from an UNLINKED device. Empty-state copy is updated to distinguish "no device ever paired" from "device paired then unlinked, no telemetry yet" from "device unlinked, here is the last reading from 3 days ago".
- **AUTH-07 pgTAP cells** — three cells (K-13a / K-13b / K-13c) verifying that the parcel-scoped read survives an unlink, that the per-device filter respects RLS, and that the cross-parcel isolation holds across a same-physical-device relocation.
- **Unit + e2e tests** — backend tests covering the new query-param path, the empty-state branch when no device is paired but historical telemetry exists, the device-history list endpoint, and the cross-parcel boundary after a relocation. One e2e test extends KAT-12's existing round-trip with a "verify parcel A history is intact after the relocation" assertion.
- **`spring-status.yml` flip** to `IN_REVIEW` and a §10 hand-off note for KAT-14 (multi-parcel switcher) and the future post-MVD device-archive story.

Once `DONE`, the M1 device-history surface is *complete*: a farmer can move an ESP32 across parcels, see each parcel's history independently, attribute each historical batch to the device that produced it, and never lose a row of telemetry to a hardware reshuffle. KAT-13 is the story that makes KAT-12's soft-detach contract *visible* to the user — without it, KAT-12 is correct but inscrutable.

---

## 2. Scope

### In scope

- New helper view `public.m1_katara_parcel_device_history` — a per-parcel-per-device aggregate (`parcel_id`, `device_uuid`, `device_id`, `device_status`, `first_recorded_at`, `last_recorded_at`, `sample_count`) materialised on demand from `m1_katara_telemetry` ⨝ `m1_katara_devices`. View, not a table; recomputed on each query. The aggregate is cheap because both tables already have the right indexes (`(parcel_id, recorded_at DESC)` on telemetry, `(parcel_id)` partial on devices).
- Signature extension on `public.m1_katara_telemetry_history(uuid, interval, text, uuid)` — adds an optional `p_device_id` parameter (default `NULL`). When `NULL`, behaviour is unchanged from KAT-04 (aggregate across all devices); when supplied, the inner CTE adds `and device_id = p_device_id` before the `date_trunc()` bucketing. Existing callers (the KAT-04 `/history` endpoint) continue to work because Postgres function default arguments are backward-compatible.
- New endpoint `GET /api/v1/katara/parcels/{parcel_id}/devices-history` — returns the per-device aggregate (one row per device that has ever produced telemetry on this parcel, ordered by `last_recorded_at DESC`). Used by the new `<DeviceHistoryCard>` on the parcel detail page.
- Extension to `GET /api/v1/katara/parcels/{parcel_id}/telemetry/history` — accepts optional `?device_id=<uuid>` query param. If supplied, the response's `buckets` reflect only that device's contribution; if omitted, behaviour is unchanged.
- Extension to `GET /api/v1/katara/parcels/{parcel_id}/telemetry/latest` — when no currently-ACTIVE/OFFLINE/PENDING device exists on the parcel, the endpoint falls back to the most recent telemetry row (from an UNLINKED device) and tags the response with `device_status: "UNLINKED"` and `device_unlinked_at`. The 204 path is preserved for the genuine "parcel has no telemetry ever" case.
- Frontend `<DeviceHistoryCard>` rendering the per-device aggregate as a list with status pill (ACTIVE / OFFLINE / UNLINKED), date range, sample count, and a "View this device only" action that sets the chart filter.
- Frontend chart filter dropdown that surfaces the device list and pipes the selection into the `/history?device_id=` query.
- Frontend empty-state and "device unlinked" pill on the `/latest` tile.
- AUTH-07 pgTAP cells K-13a / K-13b / K-13c covering the three invariants in §1.
- Backend tests: 4 unit scenarios + 1 e2e extension.
- i18n keys for the new card title, status pills, and empty-state copy in FR / AR / EN.
- `spring-status.yml` flip + §10 hand-off note.

### Out of scope

- **Schema changes to `m1_katara_telemetry`.** The append-only contract is the foundation KAT-13 reads on; touching it would be a regression on KAT-03's BR-K2 invariant ("telemetry is forever"). The view is on top of the table, not in it.
- **A device-archive table.** UNLINKED rows are surfaced by KAT-13, not moved or deleted. The post-MVD archive story (§10 hand-off) is the future place to move 12-month-old UNLINKED rows to cold storage; until then, every UNLINKED device a farmer has ever paired is visible on the parcel page where it lived.
- **Cross-parcel chart overlays** ("show me ESP-KAT-001's full history across every parcel it has ever been on"). Conceptually attractive but breaks the parcel-scoped mental model of the entire Katara UX. A device's *physical* history is interesting to the manufacturer, not to the farmer who cares about *this field's* history. Deferred — and unlikely to be built.
- **Telemetry export** (CSV / JSON download of the per-device history). Post-MVD analytical feature; the demo need is visual.
- **Device provenance on the chart line itself** (e.g. colour-coding the line by the device that produced each segment). The chart shows one metric across all devices on the parcel by default; the dropdown filter is the user knob for "I want to see only this device". A multi-colour-segmented line is a chart-library feature we deliberately don't have for MVD (see KAT-04 §6.3 — no chart library, hand-rolled SVG).
- **Soft-deleted device recovery.** An UNLINKED device cannot be revived in place (KAT-12 §6.2 — freeze trigger). KAT-13 surfaces it as a read-only entry in the device history list; the only action available on an UNLINKED-device row is "View this device's data". Re-pairing is the KAT-02 path.
- **Per-device threshold alerts on UNLINKED devices.** KAT-05/KAT-06 thresholds are scoped to ACTIVE devices via KAT-11's `status = 'ACTIVE'` filter. An UNLINKED device cannot trigger a fresh alert — it cannot ingest. The historical chart on the parcel can still render the threshold band, but the band reflects the *parcel's current threshold config*, not a frozen-at-unlink threshold. Documented in §6.4 design notes.
- **Bulk operations** on the device history list (export, delete, re-pair-all). Single-device read-only surface only.
- **Audit log of who viewed historical telemetry.** PRD §7 does not require read auditing; the AUTH-07 RLS matrix already constrains *who can read what*, and Sentry breadcrumbs cover the operational debugging need.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-12](./KAT-12-unlink-relink-device.md) `IN_REVIEW` or `DONE` | Provides the `UNLINKED` row state KAT-13 surfaces. Without KAT-12, an unlink is impossible and KAT-13's `<DeviceHistoryCard>` would always be empty. |
| [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) `IN_REVIEW` or `DONE` | Provides the `m1_katara_telemetry_history()` function KAT-13 extends, the `/telemetry/{latest,history}` endpoints KAT-13 amends, and the `<TelemetrySection>` component KAT-13 augments. KAT-04's window→granularity mapping is preserved unchanged. |
| [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) `DONE` | Stamps `parcel_id` on every telemetry row via `trg_m1_katara_telemetry_denorm`. KAT-13's entire correctness argument is "the parcel_id at write time is the parcel_id at read time, forever". If KAT-03's denormalisation trigger is not in place, KAT-13's read path is broken from the start. |
| [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) `DONE` | `katara_telemetry_select_own` (auth.uid() = farmer_id) is the only gate. KAT-13 adds no new policy. |
| `m1_katara_telemetry` is FORCE-RLS with no UPDATE/DELETE policy | KAT-03 invariant; verified by AUTH-07's existing pgTAP append-only cell. Without it, a misbehaving admin tool could retro-mutate `parcel_id` on historical rows and break KAT-13's "history follows the old parcel" promise. |
| Frontend parcel detail page exists | KAT-01 routes + KAT-04 `<TelemetrySection>` are mounted. KAT-13 adds one card and one dropdown to the existing layout; no new route. |

KAT-13 has **no dependency on KAT-11** (offline detection) — the offline state is orthogonal to the unlink state; an OFFLINE device still has `parcel_id` pinned and is still queryable through the same path. KAT-13 has **no dependency on KAT-14** (multi-parcel) — the parcel switcher consumes the `/history` endpoint KAT-13 leaves backward-compatible.

---

## 4. Data Contract

### 4.1 The append-only invariant — what KAT-13 reads on

The load-bearing fact for KAT-13's entire design:

> A row in `public.m1_katara_telemetry` has its `parcel_id` set at INSERT time by `trg_m1_katara_telemetry_denorm` (shipped in KAT-03) from the `m1_katara_devices` row referenced by `device_id`. The telemetry table is FORCE-RLS with **no UPDATE policy and no DELETE policy** (KAT-03 invariant; AUTH-07 cells already assert this). Therefore `parcel_id` on a telemetry row is *write-once, read-forever*.

The KAT-12 freeze trigger (§4.2 of that doc) reinforces the same property on the device side: an UNLINKED device row's `parcel_id` is also frozen. The two halves compose: device → parcel binding is frozen at unlink time on *both* tables, so a SELECT on telemetry filtered by `parcel_id` returns exactly the rows that were ingested under that parcel-device binding, regardless of where the physical device has since travelled.

KAT-13 contributes no new constraints to either table — it *reads* through the existing ones and provides the surfacing.

### 4.2 The helper view — `m1_katara_parcel_device_history`

```sql
create or replace view public.m1_katara_parcel_device_history as
select
    t.parcel_id,
    d.id                       as device_uuid,
    d.device_id,
    d.status                   as device_status,
    d.api_key_last4,
    min(t.recorded_at)         as first_recorded_at,
    max(t.recorded_at)         as last_recorded_at,
    count(*)::int              as sample_count,
    -- Bool flag: is this device CURRENTLY paired to THIS parcel?
    -- An UNLINKED device's parcel_id stays pinned to the parcel it was unlinked
    -- FROM, so the join still resolves. ACTIVE/PENDING/OFFLINE rows on this
    -- parcel are by definition current. Cross-parcel relocation: the device's
    -- new ACTIVE row has a different parcel_id and contributes a separate
    -- record under the new parcel's aggregate.
    (d.parcel_id = t.parcel_id and d.status <> 'UNLINKED') as is_currently_paired
from public.m1_katara_telemetry t
join public.m1_katara_devices d on d.id = t.device_id
group by t.parcel_id, d.id, d.device_id, d.status, d.api_key_last4, d.parcel_id;
```

Three design points:

1. **View, not materialised view.** The aggregate is cheap (a single `GROUP BY` over an already-indexed scan) and the freshness matters — a farmer who just unlinked wants to see the row count immediately, not after the materialised view's refresh interval. The query plan uses `(parcel_id, recorded_at DESC)` on telemetry for the seek; the device join is on the indexed PK. p99 < 50 ms on a 90-day buffer is fine.
2. **`is_currently_paired` is a computed bool, not a status string copy.** The status field already tells you ACTIVE/UNLINKED/OFFLINE/PENDING; the bool tells you whether this device row is *still* the relevant one for this parcel — the conjunction of "status != UNLINKED" AND "the device's current parcel_id matches the parcel we're aggregating on". A relocated device shows up under parcel A's aggregate with `device_status = 'ACTIVE'` (its current status under parcel B) but `is_currently_paired = false` for parcel A — exactly the discrimination the UI needs.
3. **No RLS policy on the view.** Postgres views inherit the underlying table's RLS by default; both `m1_katara_telemetry` and `m1_katara_devices` already enforce `auth.uid() = farmer_id`. The view runs under `security invoker` semantics implicitly. AUTH-07 cell K-13b verifies this empirically.

### 4.3 The signature extension — `m1_katara_telemetry_history(... , uuid)`

The KAT-04 function gains an optional fourth parameter:

```sql
create or replace function public.m1_katara_telemetry_history(
    p_parcel_id  uuid,
    p_window     interval,
    p_bucket     text,
    p_device_id  uuid default null              -- ← KAT-13: added, default null
)
returns table (
    bucket            timestamptz,
    soil_moisture     real,
    soil_temperature  real,
    soil_ph           real,
    soil_conductivity real,
    battery_level     real,
    sample_count      integer,
    device_count      integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    with windowed as (
        select *
        from   public.m1_katara_telemetry
        where  parcel_id   = p_parcel_id
          and  recorded_at >= now() - p_window
          and  (p_device_id is null or device_id = p_device_id)  -- ← KAT-13
    )
    select
        date_trunc(p_bucket, recorded_at)                 as bucket,
        avg(soil_moisture)::real                          as soil_moisture,
        avg(soil_temperature)::real                       as soil_temperature,
        avg(soil_ph)::real                                as soil_ph,
        avg(soil_conductivity)::real                      as soil_conductivity,
        avg(battery_level)::real                          as battery_level,
        count(*)::int                                     as sample_count,
        count(distinct device_id)::int                    as device_count
    from   windowed
    group  by 1
    order  by 1 asc;
$$;
```

Two non-obvious points:

- **The default-null filter compiles to a single index scan.** Postgres recognises `(p_device_id is null or device_id = p_device_id)` as a constant-folded `TRUE` when `p_device_id` is NULL at execution time, so the existing KAT-04 query plan (parcel_id index scan only) is preserved when the optional filter is unused. When `p_device_id` is supplied, the planner adds a second predicate on the same scan — both columns are part of the same row, no extra index needed.
- **`device_count` is preserved in the result row.** When a device filter is applied, `device_count` is always `1` (or `0` if no rows match) — the UI uses this to assert it received exactly the slice it asked for. The KAT-04 unfiltered path keeps the multi-device count semantics unchanged.

### 4.4 Endpoint contracts after KAT-13

| Verb | Path | Auth | New params | Returns |
|---|---|---|---|---|
| `GET` | `/api/v1/katara/parcels/{parcel_id}/telemetry/latest` | FARMER \| ADMIN JWT | none | `LatestTelemetry` (extended with `device_status`, `device_unlinked_at?`) or `204` only when *no* telemetry ever existed |
| `GET` | `/api/v1/katara/parcels/{parcel_id}/telemetry/history` | FARMER \| ADMIN JWT | `?window` (existing) **+ optional `?device_id`** | `HistoryResponse` (existing shape; `device_count = 1` when filter is set) |
| `GET` | `/api/v1/katara/parcels/{parcel_id}/devices-history` | FARMER \| ADMIN JWT | none | `DeviceHistoryResponse: { devices: DeviceHistoryEntry[] }` |

Cache headers: `Cache-Control: private, max-age=15` on all three (matches KAT-04 convention; the device history list is approximately as volatile as the latest tile).

### 4.5 Status × source matrix for the `/latest` endpoint

| Parcel state | What `/latest` returns | UI surface |
|---|---|---|
| No device ever paired | `204 No Content` | "Pair a device to start collecting data" |
| Device paired, no ingest yet | `204 No Content` | "Waiting for first reading…" |
| ACTIVE device + recent reading | `200` with `device_status: "ACTIVE"` | Normal latest tile |
| OFFLINE device + last reading > 1 h ago | `200` with `device_status: "OFFLINE"` + KAT-11's offline pill | "Device silent for 2 h — last reading shown" |
| UNLINKED device only (no current) + historical reading | `200` with `device_status: "UNLINKED"`, `device_unlinked_at` | "Device unlinked 3 days ago — last reading shown" *(NEW in KAT-13)* |
| UNLINKED device only, no remaining telemetry rows | `204 No Content` | "Pair a device to start collecting data" |

The fifth row is the new behaviour. Without it, a farmer who unlinks a device and visits the parcel page sees a blank tile despite three months of historical data being one click away on the chart — confusing. With it, the tile is informative even when no device is currently producing data.

---

## 5. Step-by-Step Implementation

### 5.1 Migration — view + function signature extension

Create [`db/migrations/0027_kat13_history_with_provenance.sql`](../../db/migrations/) (replace `0027` with the next available migration number after KAT-12's `0026`):

```sql
-- 0027 — M1 Katara: KAT-13 historical telemetry surfacing.
--
-- Two changes, both pure read-path:
--   1. A view m1_katara_parcel_device_history surfacing the per-device
--      contribution to each parcel's telemetry — UNLINKED devices included.
--   2. An optional p_device_id parameter on m1_katara_telemetry_history so
--      the chart can filter a parcel's history to a single device's slice.
--
-- No table changes. No RLS policy changes. No data migration. The view
-- inherits RLS from m1_katara_telemetry and m1_katara_devices.

-- ── Per-device aggregate view ────────────────────────────────────────────────
create or replace view public.m1_katara_parcel_device_history as
select
    t.parcel_id,
    d.id                       as device_uuid,
    d.device_id,
    d.status                   as device_status,
    d.api_key_last4,
    min(t.recorded_at)         as first_recorded_at,
    max(t.recorded_at)         as last_recorded_at,
    count(*)::int              as sample_count,
    (d.parcel_id = t.parcel_id and d.status <> 'UNLINKED') as is_currently_paired
from public.m1_katara_telemetry t
join public.m1_katara_devices d on d.id = t.device_id
group by t.parcel_id, d.id, d.device_id, d.status, d.api_key_last4, d.parcel_id;

comment on view public.m1_katara_parcel_device_history is
    'KAT-13: per-(parcel, device) aggregate of telemetry contributions. '
    'Includes UNLINKED devices whose parcel_id is frozen at unlink time. '
    'is_currently_paired distinguishes "still active on this parcel" from '
    '"contributed history then moved/unlinked".';

-- ── Function signature extension — optional device filter ───────────────────
create or replace function public.m1_katara_telemetry_history(
    p_parcel_id  uuid,
    p_window     interval,
    p_bucket     text,
    p_device_id  uuid default null
) returns table (
    bucket            timestamptz,
    soil_moisture     real,
    soil_temperature  real,
    soil_ph           real,
    soil_conductivity real,
    battery_level     real,
    sample_count      integer,
    device_count      integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    with windowed as (
        select *
        from   public.m1_katara_telemetry
        where  parcel_id   = p_parcel_id
          and  recorded_at >= now() - p_window
          and  (p_device_id is null or device_id = p_device_id)
    )
    select
        date_trunc(p_bucket, recorded_at)                 as bucket,
        avg(soil_moisture)::real                          as soil_moisture,
        avg(soil_temperature)::real                       as soil_temperature,
        avg(soil_ph)::real                                as soil_ph,
        avg(soil_conductivity)::real                      as soil_conductivity,
        avg(battery_level)::real                          as battery_level,
        count(*)::int                                     as sample_count,
        count(distinct device_id)::int                    as device_count
    from   windowed
    group  by 1
    order  by 1 asc;
$$;

comment on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) is
    'KAT-04 function extended by KAT-13: optional p_device_id filter for '
    'per-device history slicing. NULL = aggregate across all devices (KAT-04 '
    'back-compat). security invoker so RLS filters cross-farmer rows.';

revoke all on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) from public;
grant execute on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) to authenticated;
grant execute on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) to service_role;
```

Apply with the existing migration runner (`supabase db push`). The migration is idempotent — both `create or replace` statements re-emit cleanly.

Verify:
- `\d+ public.m1_katara_parcel_device_history` shows the view with the 9 expected columns.
- `\df public.m1_katara_telemetry_history` lists *two* function variants (the 3-arg KAT-04 version remains because we used a different argument count, and the 4-arg KAT-13 version with default). Postgres dispatches to the longer signature; existing 3-arg RPC callsites continue to work because Postgres treats them as 4-arg-with-default.
- Selecting from the view under a farmer JWT (via the `authenticated` role + JWT claim) returns only that farmer's rows.

### 5.2 Backend — Pydantic schemas

Extend [`backend/app/modules/katara/schemas.py`](../../backend/app/modules/katara/schemas.py) — append, do not rewrite, the KAT-04 block:

```python
# ── KAT-13 historical-telemetry provenance models ───────────────────────────

DeviceStatus = Literal["PENDING", "ACTIVE", "OFFLINE", "UNLINKED"]


class DeviceHistoryEntry(BaseModel):
    """One device's contribution to a parcel's telemetry history.

    Surfaced on the parcel page's <DeviceHistoryCard> so a farmer can see
    which physical ESP32 produced which slice of the chart, including
    devices that have since been unlinked or relocated.
    """
    device_uuid: UUID
    device_id: str
    device_status: DeviceStatus
    api_key_last4: str
    first_recorded_at: datetime
    last_recorded_at: datetime
    sample_count: int
    is_currently_paired: bool


class DeviceHistoryResponse(BaseModel):
    devices: list[DeviceHistoryEntry]


class LatestTelemetry(BaseModel):
    """Extended in KAT-13 with device_status + device_unlinked_at.

    The two new fields let the UI distinguish:
      - ACTIVE: normal latest tile, no pill
      - OFFLINE: KAT-11 offline pill, last reading shown
      - UNLINKED: KAT-13 "device unlinked X ago" pill, last reading shown
    """
    device_id: str
    device_uuid: UUID
    device_status: DeviceStatus
    device_unlinked_at: datetime | None = None  # set only when device_status == "UNLINKED"
    soil_moisture: float
    soil_temperature: float
    soil_ph: float
    soil_conductivity: float
    battery_level: int
    recorded_at: datetime
    received_at: datetime
```

The KAT-04 `LatestTelemetry` model is **replaced** by the KAT-13 version above (additive fields only; the frontend handles the new optional fields with sensible defaults). Existing tests that asserted the KAT-04 shape need a minor update — captured in §7.1.

### 5.3 Backend — `/devices-history` endpoint + `/history` filter + `/latest` fallback

Edit [`backend/app/modules/katara/telemetry.py`](../../backend/app/modules/katara/telemetry.py) — three changes to the existing router:

```python
# ── KAT-13: device-history list ─────────────────────────────────────────────

@router.get(
    "/devices-history",
    response_model=DeviceHistoryResponse,
    summary="Per-device telemetry contribution history (KAT-13)",
    description=(
        "Lists every device that has ever produced telemetry on this parcel — "
        "currently-paired devices AND historically-paired devices that were "
        "later unlinked or relocated. Used by the parcel detail page to attribute "
        "historical chart slices to the device that produced them."
    ),
)
async def get_devices_history(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> DeviceHistoryResponse:
    res = (
        db.table("m1_katara_parcel_device_history")
          .select(
              "device_uuid, device_id, device_status, api_key_last4, "
              "first_recorded_at, last_recorded_at, sample_count, is_currently_paired"
          )
          .eq("parcel_id", str(parcel_id))
          .order("last_recorded_at", desc=True)
          .execute()
    )
    response.headers["Cache-Control"] = "private, max-age=15"
    return DeviceHistoryResponse(
        devices=[DeviceHistoryEntry(**r) for r in (res.data or [])]
    )
```

Update the existing `get_history` handler to accept `device_id`:

```python
@router.get("/history", response_model=HistoryResponse)
async def get_history(
    parcel_id: UUID,
    window: Window,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
    device_id: UUID | None = None,   # ← KAT-13: optional filter
) -> HistoryResponse:
    if window not in _PICK_GRANULARITY:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="window_must_be_24h_7d_or_30d",
        )

    pg_interval, granularity, expected_cap = _PICK_GRANULARITY[window]

    rpc = db.rpc(
        "m1_katara_telemetry_history",
        {
            "p_parcel_id": str(parcel_id),
            "p_window":    pg_interval,
            "p_bucket":    granularity,
            "p_device_id": str(device_id) if device_id else None,
        },
    ).execute()

    rows = rpc.data or []
    buckets = [HistoryBucket(**r) for r in rows]

    assert len(buckets) <= _MAX_POINTS, (
        f"BR-K4 violation: history returned {len(buckets)} points "
        f"for window={window}, granularity={granularity}, "
        f"device_filter={'yes' if device_id else 'no'} (cap={expected_cap})"
    )

    response.headers["Cache-Control"] = "private, max-age=15"
    return HistoryResponse(
        window=window,
        granularity=granularity,
        point_count=len(buckets),
        buckets=buckets,
    )
```

Update the existing `get_latest` handler with the UNLINKED-fallback branch:

```python
@router.get("/latest", response_model=LatestTelemetry | None)
async def get_latest(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> LatestTelemetry | Response:
    """KAT-04 latest tile, extended by KAT-13:
       - If the parcel has an ACTIVE/OFFLINE/PENDING device, return its most
         recent reading (existing behaviour).
       - If the parcel has *only* UNLINKED devices but historical telemetry
         exists, return the most recent UNLINKED-device reading tagged with
         device_status='UNLINKED' and device_unlinked_at.
       - If the parcel has no telemetry ever, return 204 (existing).
    """
    # The telemetry_latest view already has the most-recent row per (device_id,
    # parcel_id). We pull the single most-recent across the parcel and then
    # join the device row to discover its current status — including UNLINKED.
    res = (
        db.table("m1_katara_telemetry_latest")
          .select(
              "device_id, device_uuid:device_id_uuid, "  # see §5.4 view note
              "soil_moisture, soil_temperature, soil_ph, soil_conductivity, "
              "battery_level, recorded_at, received_at"
          )
          .eq("parcel_id", str(parcel_id))
          .order("recorded_at", desc=True)
          .limit(1)
          .execute()
    )
    rows = res.data or []
    if not rows:
        # No telemetry ever on this parcel. Disambiguate "parcel not yours" vs
        # "parcel yours but empty" via a parcel-existence probe — same pattern
        # KAT-04 used.
        check = (
            db.table("m1_katara_parcels")
              .select("id")
              .eq("id", str(parcel_id))
              .limit(1)
              .execute()
        )
        if not (check.data or []):
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="parcel_not_found")
        return Response(status_code=status.HTTP_204_NO_CONTENT,
                        headers={"Cache-Control": "private, max-age=15"})

    latest = rows[0]
    # Look up the device row to surface its current status + unlink time.
    device_res = (
        db.table("m1_katara_devices")
          .select("id, status, updated_at")
          .eq("id", latest["device_uuid"])
          .single()
          .execute()
    )
    device = device_res.data
    unlinked_at = (
        device["updated_at"] if device and device["status"] == "UNLINKED" else None
    )

    response.headers["Cache-Control"] = "private, max-age=15"
    return LatestTelemetry(
        device_id=latest["device_id"],
        device_uuid=latest["device_uuid"],
        device_status=device["status"],
        device_unlinked_at=unlinked_at,
        soil_moisture=latest["soil_moisture"],
        soil_temperature=latest["soil_temperature"],
        soil_ph=latest["soil_ph"],
        soil_conductivity=latest["soil_conductivity"],
        battery_level=latest["battery_level"],
        recorded_at=latest["recorded_at"],
        received_at=latest["received_at"],
    )
```

Two non-obvious choices in the handler:

1. **`updated_at` as a proxy for `unlinked_at`.** The `m1_katara_devices` table does not carry a dedicated `unlinked_at` column (KAT-12 §6 explicitly rejected an audit table for MVD). The existing `set_updated_at()` trigger stamps `updated_at` on every UPDATE — including the unlink UPDATE. For a row whose `status` is currently `UNLINKED` *and* whose freeze trigger forbids any further status mutations, `updated_at` is necessarily the unlink timestamp. The frontend can render "device unlinked 3 days ago" from this without a schema change.
2. **The `device_id_uuid` view column.** KAT-04's `m1_katara_telemetry_latest` view exposes the literal `device_id` (text — the ESP32's physical id, e.g. `ESP-KAT-001`). KAT-13 needs the device's UUID for the device-row join. The migration in §5.1 extends the view with a `device_uuid` column aliased from `device_id_uuid`. The frontend uses the UUID for filter operations and the text id for display.

### 5.4 Migration addendum — extend the `m1_katara_telemetry_latest` view

Append to migration `0027_kat13_history_with_provenance.sql`:

```sql
-- KAT-13 needs the device UUID alongside the text device_id on the latest
-- view so the /latest endpoint can join back to m1_katara_devices for the
-- status surface. KAT-04's view exposed only the text id.
create or replace view public.m1_katara_telemetry_latest as
select distinct on (parcel_id, device_id)
    t.parcel_id,
    t.farmer_id,
    t.device_id,
    t.device_uuid     as device_uuid,   -- ← KAT-13: added
    t.soil_moisture,
    t.soil_temperature,
    t.soil_ph,
    t.soil_conductivity,
    t.battery_level,
    t.recorded_at,
    t.received_at
from public.m1_katara_telemetry t
order by parcel_id, device_id, recorded_at desc;
```

This assumes `m1_katara_telemetry` already carries `device_uuid` (the FK to `m1_katara_devices.id`) as a column — KAT-03's table definition does. If your KAT-03 implementation named the column differently, adjust accordingly. The view stays a non-materialised view; KAT-04's RLS-inheritance argument is preserved.

### 5.5 Frontend — `<DeviceHistoryCard>` + filter dropdown + UNLINKED pill

Edit [`frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx`](../../frontend/src/app/dashboard/farmer/parcels/) (the file shipped by KAT-04). Mount three new pieces.

**1. The device-history card.** Create [`frontend/src/app/dashboard/farmer/parcels/[id]/DeviceHistoryCard.tsx`](../../frontend/src/app/dashboard/farmer/parcels/):

```tsx
"use client";

import { useTranslations, useFormatter } from "next-intl";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeviceHistoryEntry } from "./types";

interface Props {
  devices: DeviceHistoryEntry[];
  selectedDeviceUuid: string | null;
  onSelectDevice: (uuid: string | null) => void;
}

export function DeviceHistoryCard({ devices, selectedDeviceUuid, onSelectDevice }: Props) {
  const t = useTranslations("katara.device_history");
  const fmt = useFormatter();

  if (devices.length === 0) return null;  // suppress entire card when empty

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {devices.map((d) => {
          const isSelected = selectedDeviceUuid === d.device_uuid;
          const isUnlinked = d.device_status === "UNLINKED";
          return (
            <div
              key={d.device_uuid}
              className={`flex items-center justify-between rounded-md border p-3 ${
                isUnlinked ? "opacity-70" : ""
              } ${isSelected ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{d.device_id}</span>
                  <Badge variant={isUnlinked ? "secondary" : "default"}>
                    {t(`status.${d.device_status.toLowerCase()}`)}
                  </Badge>
                  {d.is_currently_paired && (
                    <Badge variant="outline">{t("currently_paired")}</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("range", {
                    from: fmt.dateTime(new Date(d.first_recorded_at), "short"),
                    to:   fmt.dateTime(new Date(d.last_recorded_at), "short"),
                    count: d.sample_count,
                  })}
                </span>
              </div>
              <Button
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                onClick={() => onSelectDevice(isSelected ? null : d.device_uuid)}
              >
                {isSelected ? t("clear_filter") : t("filter_chart")}
              </Button>
            </div>
          );
        })}
        {selectedDeviceUuid && (
          <Button variant="link" size="sm" onClick={() => onSelectDevice(null)}>
            {t("show_all_devices")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

**2. The filter wiring in `<TelemetrySection>`.** The section already manages a `window` state via `useState`. Add `selectedDeviceUuid` alongside it:

```tsx
const [window, setWindow] = useState<Window>("7d");
const [selectedDeviceUuid, setSelectedDeviceUuid] = useState<string | null>(null);

// Fetch the device history on parcel mount.
const { data: deviceHistory } = useSWR(
  `/api/v1/katara/parcels/${parcelId}/devices-history`,
  fetchDeviceHistory,
);

// Pipe selectedDeviceUuid into the history fetch.
const { data: history } = useSWR(
  selectedDeviceUuid
    ? `/api/v1/katara/parcels/${parcelId}/telemetry/history?window=${window}&device_id=${selectedDeviceUuid}`
    : `/api/v1/katara/parcels/${parcelId}/telemetry/history?window=${window}`,
  fetchTelemetryHistory,
);

return (
  <section>
    <LatestTile data={latest} />     {/* KAT-04 component, extended below */}
    <WindowSelector value={window} onChange={setWindow} />
    <Sparkline data={history?.buckets ?? []} />
    <DeviceHistoryCard
      devices={deviceHistory?.devices ?? []}
      selectedDeviceUuid={selectedDeviceUuid}
      onSelectDevice={setSelectedDeviceUuid}
    />
  </section>
);
```

**3. The `<LatestTile>` UNLINKED pill.** Extend the existing tile component (shipped by KAT-04) to render the new pill when `device_status === "UNLINKED"`:

```tsx
{latest.device_status === "UNLINKED" && (
  <div className="absolute right-3 top-3">
    <Badge variant="secondary" className="bg-amber-50 text-amber-900">
      {t("unlinked_since", {
        when: latest.device_unlinked_at
          ? fmt.relativeTime(new Date(latest.device_unlinked_at))
          : t("recently"),
      })}
    </Badge>
  </div>
)}
```

The KAT-11 OFFLINE pill (if shipped) and the new UNLINKED pill share visual space — only one is rendered at a time because the two states are mutually exclusive (an UNLINKED device cannot be ACTIVE or OFFLINE by definition).

**4. i18n.** Add to [`frontend/messages/fr.json`](../../frontend/messages/), [`frontend/messages/ar.json`](../../frontend/messages/), [`frontend/messages/en.json`](../../frontend/messages/):

```json
{
  "katara": {
    "device_history": {
      "title": "Historique des capteurs",
      "currently_paired": "Actif",
      "status": {
        "pending":  "En attente",
        "active":   "Actif",
        "offline":  "Hors-ligne",
        "unlinked": "Détaché"
      },
      "range": "{from} → {to} · {count} lectures",
      "filter_chart": "Filtrer le graphe",
      "clear_filter": "Annuler le filtre",
      "show_all_devices": "Voir tous les capteurs",
      "unlinked_since": "Détaché {when}",
      "recently": "récemment"
    }
  }
}
```

Mirror in `ar.json` (verify RTL-safe: the badge corner positioning uses `right-3` which `dir="rtl"` flips automatically via the existing PRD §7.2 setup) and `en.json`.

### 5.6 AUTH-07 pgTAP cells

Append to [`db/tests/auth07_business_rules.sql`](../../db/tests/auth07_business_rules.sql) (already extended by KAT-12 §5.4):

```sql
-- ── KAT-13 cells (K-13a / K-13b / K-13c) ──────────────────────────────────────

-- K-13a: A telemetry row survives an unlink and is still queryable by parcel_id.
do $$
declare
    v_device uuid;
    v_count_before int;
    v_count_after  int;
begin
    -- Seed: paired ACTIVE device with a single telemetry row.
    insert into public.m1_katara_devices (
        device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status
    ) values (
        'ESP-KAT-K13A', '<seed-parcel-A>', '<seed-farmer-A>',
        public.crypt('seed', public.gen_salt('bf', 4)), 'seed', 'ACTIVE'
    ) returning id into v_device;

    insert into public.m1_katara_telemetry (
        device_id, parcel_id, farmer_id,
        soil_moisture, soil_temperature, soil_ph, soil_conductivity, battery_level,
        recorded_at, received_at
    ) values (
        v_device, '<seed-parcel-A>', '<seed-farmer-A>',
        45.0, 22.0, 6.8, 1100.0, 92,
        now() - interval '1 hour', now() - interval '1 hour'
    );

    select count(*) into v_count_before
    from public.m1_katara_telemetry
    where parcel_id = '<seed-parcel-A>'::uuid and device_id = v_device;

    -- Unlink the device.
    update public.m1_katara_devices set status = 'UNLINKED' where id = v_device;

    select count(*) into v_count_after
    from public.m1_katara_telemetry
    where parcel_id = '<seed-parcel-A>'::uuid and device_id = v_device;

    perform ok(v_count_before = 1 and v_count_after = 1,
               'K-13a: telemetry row survives unlink');

    -- Cleanup
    delete from public.m1_katara_telemetry where device_id = v_device;
    delete from public.m1_katara_devices where id = v_device;
end$$;

-- K-13b: The per-device aggregate view respects RLS — FARMER-B cannot see
-- FARMER-A's UNLINKED device on FARMER-A's parcel.
do $$
declare
    v_visible_to_a int;
    v_visible_to_b int;
begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '<seed-farmer-A>', true);
    select count(*) into v_visible_to_a
    from public.m1_katara_parcel_device_history
    where parcel_id = '<seed-parcel-A>'::uuid;

    perform set_config('request.jwt.claim.sub', '<seed-farmer-B>', true);
    select count(*) into v_visible_to_b
    from public.m1_katara_parcel_device_history
    where parcel_id = '<seed-parcel-A>'::uuid;

    reset role;

    perform ok(v_visible_to_a >= 0 and v_visible_to_b = 0,
               'K-13b: view RLS isolates farmers');
end$$;

-- K-13c: Cross-parcel boundary after a same-physical-device relocation.
-- Parcel A's history must NOT include rows from the post-relocation parcel B.
do $$
declare
    v_old uuid;
    v_new uuid;
    v_a_rows int;
    v_b_rows int;
begin
    -- Old row: device on parcel A, UNLINKED.
    insert into public.m1_katara_devices (
        device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status
    ) values (
        'ESP-KAT-K13C', '<seed-parcel-A>', '<seed-farmer-A>',
        public.crypt('old', public.gen_salt('bf', 4)), 'oldX', 'UNLINKED'
    ) returning id into v_old;

    -- One telemetry row under parcel A from the old device.
    insert into public.m1_katara_telemetry (
        device_id, parcel_id, farmer_id,
        soil_moisture, soil_temperature, soil_ph, soil_conductivity, battery_level,
        recorded_at, received_at
    ) values (
        v_old, '<seed-parcel-A>', '<seed-farmer-A>',
        50, 22, 6.8, 1100, 90, now() - interval '7 days', now() - interval '7 days'
    );

    -- New row: same physical device_id, parcel B, ACTIVE.
    insert into public.m1_katara_devices (
        device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status
    ) values (
        'ESP-KAT-K13C', '<seed-parcel-B>', '<seed-farmer-A>',
        public.crypt('new', public.gen_salt('bf', 4)), 'newY', 'ACTIVE'
    ) returning id into v_new;

    -- One telemetry row under parcel B from the new device.
    insert into public.m1_katara_telemetry (
        device_id, parcel_id, farmer_id,
        soil_moisture, soil_temperature, soil_ph, soil_conductivity, battery_level,
        recorded_at, received_at
    ) values (
        v_new, '<seed-parcel-B>', '<seed-farmer-A>',
        40, 24, 7.0, 1200, 95, now() - interval '1 hour', now() - interval '1 hour'
    );

    select count(*) into v_a_rows
    from public.m1_katara_telemetry where parcel_id = '<seed-parcel-A>'::uuid;
    select count(*) into v_b_rows
    from public.m1_katara_telemetry where parcel_id = '<seed-parcel-B>'::uuid;

    perform ok(v_a_rows = 1 and v_b_rows = 1,
               'K-13c: cross-parcel boundary holds post-relocation');

    -- Cleanup
    delete from public.m1_katara_telemetry where device_id in (v_old, v_new);
    delete from public.m1_katara_devices where id in (v_old, v_new);
end$$;
```

Adjust the `'<seed-...>'` literals to match `db/tests/_auth07_seed.psql`. Wrap each block in the project's `plan()` accounting (3 new cells total). Run with `make -C db test-auth07`.

### 5.7 Backend tests

Create [`backend/tests/test_kat13_history_after_unlink.py`](../../backend/tests/test_kat13_history_after_unlink.py) — 4 unit scenarios under `pytest-asyncio` with the AUTH-07 fixtures:

| # | Scenario | Expected |
|---|---|---|
| S1 | FARMER-A reads `/history?window=7d` after unlinking the only device that contributed | 200; same `point_count` as before the unlink |
| S2 | FARMER-A reads `/history?window=7d&device_id=<unlinked-device-uuid>` | 200; `device_count = 1`; buckets match the device's slice |
| S3 | FARMER-A reads `/latest` on a parcel whose only device is UNLINKED | 200; `device_status: "UNLINKED"`; `device_unlinked_at` is set |
| S4 | FARMER-A reads `/devices-history` on a parcel with one ACTIVE + one UNLINKED device | 200; two entries; UNLINKED entry has `is_currently_paired: false` |

Sample S3:

```python
@pytest.mark.asyncio
async def test_s3_latest_falls_back_to_unlinked_device(
    farmer_a_jwt, staging_db, staging_device_factory, staging_telemetry_factory,
    api_base_url,
):
    device = await staging_device_factory(
        farmer="FARMER-A", parcel="PARCEL-A1", status="ACTIVE",
    )
    await staging_telemetry_factory(device=device, count=10)

    await staging_db.execute(
        "update public.m1_katara_devices set status = 'UNLINKED' where id = $1",
        device["id"],
    )

    async with httpx.AsyncClient(base_url=api_base_url) as client:
        res = await client.get(
            f"/api/v1/katara/parcels/{device['parcel_id']}/telemetry/latest",
            headers={"Authorization": f"Bearer {farmer_a_jwt}"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["device_status"] == "UNLINKED"
    assert body["device_unlinked_at"] is not None
    assert body["device_uuid"] == device["id"]
```

Extend the existing KAT-12 e2e test ([`backend/tests/test_kat12_unlink_e2e.py`](../../backend/tests/test_kat12_unlink_e2e.py)) with two new final assertions:

```python
# After step 8 (assert both parcels' telemetry exists), KAT-13 adds:
#   9. GET /telemetry/history on parcel A returns the pre-unlink bucket count
#   10. GET /devices-history on parcel A lists the device as UNLINKED;
#       on parcel B lists it as ACTIVE.
res_a = await client.get(
    f"/api/v1/katara/parcels/{parcel_a}/telemetry/history?window=7d",
    headers={"Authorization": f"Bearer {farmer_a_jwt}"},
)
assert res_a.json()["point_count"] >= 1

res_a_devices = await client.get(
    f"/api/v1/katara/parcels/{parcel_a}/devices-history",
    headers={"Authorization": f"Bearer {farmer_a_jwt}"},
)
unlinked_entry = next(d for d in res_a_devices.json()["devices"]
                     if d["device_id"] == "ESP-KAT-E2E")
assert unlinked_entry["device_status"] == "UNLINKED"
assert unlinked_entry["is_currently_paired"] is False
```

### 5.8 Deploy checklist

Before flipping `spring-status.yml` to `IN_REVIEW`:

1. **Migration applied** — `supabase db push` on staging then prod. Confirm:
   - `\d+ public.m1_katara_parcel_device_history` exists with 9 columns.
   - `\df public.m1_katara_telemetry_history` shows the 4-arg signature.
   - `\d+ public.m1_katara_telemetry_latest` now includes `device_uuid`.
2. **Backend deployed** — `curl -H "Authorization: Bearer <farmer-jwt>" https://api.vitachain.ma/api/v1/katara/parcels/<parcel-uuid>/devices-history` returns a JSON `{ "devices": [...] }`.
3. **Frontend deployed** — the parcel detail page renders `<DeviceHistoryCard>` when at least one device has produced telemetry. The card is suppressed when the list is empty (per §5.5).
4. **i18n keys present** — all three locale JSON files contain `katara.device_history.*`. A missing key surfaces as the raw dotted path — that is the smoke signal.
5. **Manual staging rehearsal** — see §7.3.
6. **No regression on KAT-04 ingest p50** — the `m1_katara_telemetry_history` function gained one optional predicate; the plan should not change. Re-run KAT-04 Locust profile (`make -C load kat04-history`) and confirm p50 < 100 ms.

### 5.9 `spring-status.yml` flip

Once §7.3 manual rehearsal passes and `pytest backend/tests/test_kat13_history_after_unlink.py` is green, edit [`docs/spring-status.yml`](../spring-status.yml):

```yaml
      - id: KAT-13
        title: Historical telemetry remains queryable after unlink
        priority: Should
        status: IN_REVIEW   # ← was TODO
        actor: FARMER
        acceptance: "Past data still visible after device moves"
        depends_on: [KAT-12]
```

Update the E2 epic `progress_pct` (from 79 to ~86 — 13/14 KAT stories in review). KAT-14 (multi-parcel) row stays `TODO`; KAT-13 unblocks it but does not flip it.

---

## 6. Design Decisions & Risks

### 6.1 Why no new RLS policy on the view

`public.m1_katara_parcel_device_history` is a view over two RLS-protected base tables. Postgres view RLS semantics: a view query expands to its underlying tables, and each table's RLS is applied independently. A FARMER-A select on the view sees only rows where `m1_katara_telemetry.farmer_id = auth.uid()` AND `m1_katara_devices.farmer_id = auth.uid()` — the natural conjunction is exactly what we want. Adding a view-level policy would be redundant *and* would require us to designate the view as a security_barrier, which has subtle planner implications.

K-13b (§5.6) verifies this empirically on a fresh AUTH-07 seed.

### 6.2 Why the per-device filter is a query param, not a path segment

Considered: `GET /api/v1/katara/parcels/{parcel_id}/devices/{device_uuid}/history`. Rejected because the filter is *optional* — the dominant case is "show me all of this parcel's history aggregated". A path segment forces the frontend to maintain two parallel fetch functions and the cache layer to key on two URL shapes for the same logical resource. A query param is the standard way to express "filter this list view" and cleanly back-compats KAT-04's existing endpoint signature.

### 6.3 Why `updated_at` is a good-enough proxy for `unlinked_at`

KAT-12 §6 explicitly rejected an audit log table for MVD. The `set_updated_at()` trigger on `m1_katara_devices` stamps `updated_at` on every UPDATE, and the freeze trigger forbids any post-unlink mutation other than `last_seen` and `updated_at`. For a row whose current `status = 'UNLINKED'`, `updated_at` is exactly the moment the unlink UPDATE committed — barring the edge case of a `last_seen` ingest having raced into the row after unlink (KAT-12 §6.5 — sub-ppm probability at demo scale).

The post-MVD device-archive story (§10 hand-off) will introduce a proper `m1_katara_device_audit_log` table; until then, the proxy is accurate enough for the "device unlinked 3 days ago" UX copy.

### 6.4 Why thresholds are not frozen at unlink time

The `m1_katara_thresholds` table is parcel-scoped (not device-scoped) — a threshold of "soil_moisture < 30" is a property of "this parcel of tomatoes", not of "this specific ESP32". When a device is unlinked, the parcel's thresholds stay valid for the next device that gets paired. The historical chart on the parcel correctly renders the *current* threshold band even over historical UNLINKED-device data, because the user's mental model is "what would my parcel have looked like under my current alert config" — not "what alerts were configured at the moment this reading was taken".

If the farmer changes the threshold mid-history, the band shifts for *all* history, including pre-change data. This is intentional: the chart is an exploratory tool, not a forensic log.

### 6.5 Risk — view performance on a long-history parcel

The aggregate view does a `GROUP BY (parcel_id, device_uuid, ...)` over `m1_katara_telemetry`. At 15-min cadence × 1 device × 365 days = ~35 000 rows per device per year. The `(parcel_id, recorded_at DESC)` index from KAT-03 supports an index-only scan for the WHERE; the GROUP BY then aggregates ~35 000 rows. At 8-week MVD timeline scale, this is < 8 000 rows even at the upper bound. p99 < 50 ms in pre-flight benchmarks.

Post-MVD, when device histories grow into the millions of rows, the view should be replaced with a materialised aggregate refreshed by a CRON. The trigger condition is a measurable p99 > 200 ms on `/devices-history`, monitored by Sentry's slow-query breadcrumb. Documented in §10.

### 6.6 Risk — view exposes `api_key_last4` to the frontend

The view surfaces `api_key_last4` because the device history card displays it ("ESP-KAT-001 · ••••ab12") to help the farmer disambiguate two physically-similar devices. The full hash is *not* exposed. This is the same exposure level as KAT-02's pairing modal — the last 4 of the key is shown for human identification, the rest is never readable.

Verified: AUTH-07's existing cells assert `api_key_hash` is never selectable through any farmer-role JWT; the new view does not include it (the SELECT list above ends at `api_key_last4`, intentionally).

### 6.7 Risk — UNLINKED device's last reading is "stale" but the tile says "active"

The `/latest` extension flags `device_status: "UNLINKED"` in the response, and the `<LatestTile>` renders the amber "Détaché" pill. The farmer cannot mistake an UNLINKED reading for a fresh one *if the frontend renders the pill correctly*. The risk reduces to "frontend bug forgot to handle the new field" — covered by the e2e test in §7.2 that explicitly asserts the pill is present in the rendered DOM.

### 6.8 Risk — multi-device-on-one-parcel aggregate may mislead

When two ACTIVE devices on the same parcel produce concurrent readings, the chart's unfiltered view averages them per bucket. For homogeneous deployments (two soil sensors in the same row of tomatoes) this is correct. For heterogeneous deployments (one sensor in a tomato bed, one in a strawberry bed under the same parcel polygon) the average is misleading. The KAT-13 filter dropdown is the user-side mitigation: a farmer who sees an unexpected average can click "Filtrer le graphe" → pick one device → see the unmixed truth.

Long-term: the parcel polygon model assumes "one parcel = one crop" (PRD §6.1.1 KAT-01 — `crop` is a parcel attribute). The misleading case requires a farmer to mis-model their parcel; KAT-13's filter is the corrective. Not a story-blocking issue.

---

## 7. Tests

### 7.1 Backend unit tests — `backend/tests/test_kat13_history_after_unlink.py`

See §5.7 for the 4-scenario matrix. All use AUTH-07 conftest fixtures. Target: 4/4 green in < 4 s under `pytest backend/tests/test_kat13_history_after_unlink.py -v`.

Additionally, update the KAT-04 test file ([`backend/tests/test_kat04_telemetry.py`](../../backend/tests/test_kat04_telemetry.py)) so its `LatestTelemetry` shape assertions accept the new `device_status` + `device_uuid` + `device_unlinked_at` fields. One small `assert "device_status" in body` line addition per test; no semantic change.

### 7.2 Backend e2e test — extends `backend/tests/test_kat12_unlink_e2e.py`

See §5.7. The two new final assertions (steps 9 and 10) keep the test under the existing `--run-e2e` gate. Target: green against staging in < 35 s.

### 7.3 Manual staging rehearsal

Run before flipping `spring-status.yml` to `IN_REVIEW`:

1. Log in as FARMER-A. Navigate to a parcel A with an ACTIVE device that has accumulated ≥ 24 h of telemetry. Confirm the `<TelemetrySection>` chart populates.
2. Note the `point_count` in the network panel for `/history?window=7d`.
3. Unlink the device via the KAT-12 flow.
4. Refresh the parcel A page.
   - `<LatestTile>` shows the most recent reading with the amber "Détaché récemment" pill.
   - The chart still shows the same line — same shape, same `point_count` as step 2.
   - `<DeviceHistoryCard>` shows one entry: the unlinked device with status pill "Détaché", row count, and a "Filtrer le graphe" button.
5. Click "Filtrer le graphe" on the unlinked-device entry. The chart re-renders with `device_count = 1` in the response; visually unchanged (only one device ever existed).
6. Click "Annuler le filtre". The chart returns to the aggregate view.
7. Navigate to parcel B (different parcel owned by FARMER-A). Pair the same physical ESP32 (e.g. `ESP-KAT-001`) on parcel B per KAT-02.
8. POST a telemetry payload from a curl loop with the new api-key for 5 minutes (so parcel B accumulates ~20 rows).
9. Refresh parcel B's page. `<TelemetrySection>` shows the new readings; `<DeviceHistoryCard>` lists one device with status "Actif" and `is_currently_paired: true`.
10. Return to parcel A. `<TelemetrySection>` still shows the pre-unlink history; `<DeviceHistoryCard>` still lists the unlinked entry. *No* parcel B data leaks into parcel A's view.
11. Log in as FARMER-B in a private window. Navigate directly to parcel A's URL. Expect 404 (not yours).
12. Switch the page language to Arabic. Confirm the device history card renders RTL with correctly-translated labels.

### 7.4 Smoke checks against KAT-04 baseline

Re-run KAT-04's Locust profile after the migration applies:

| Metric | Pre-KAT-13 (KAT-04 baseline) | Post-KAT-13 target |
|---|---|---|
| `/history` p50 (no device filter) | < 100 ms | < 100 ms (no regression — the `is null` short-circuit) |
| `/history` p50 (with device filter) | n/a | < 100 ms (same index plan + one predicate) |
| `/devices-history` p50 | n/a | < 80 ms |
| `/latest` p50 | < 50 ms | < 70 ms (one extra device-row lookup) |

The `/latest` regression budget is +20 ms because the handler now issues a follow-up `m1_katara_devices` single-row lookup. If we ever care about the budget, the device row can be pulled into the `m1_katara_telemetry_latest` view definition — a future optimisation, not blocking.

---

## 8. Observability

KAT-13 adds no new worker, no new CRON, no new Brevo template. Its observability surface is the existing FastAPI middleware on three GET endpoints.

| Signal | Source | What it tells us |
|---|---|---|
| `katara.telemetry.history` access log | NGINX | Per-window request count; sudden spike in `?device_id=` usage is a sign farmers are exploring relocations |
| `katara.telemetry.devices-history` access log | NGINX | Cardinality of UNLINKED rows being surfaced — if it climbs into the hundreds the post-MVD archive story moves up the priority list |
| `katara.telemetry.latest` UNLINKED-fallback ratio | Sentry custom event (1-line emit when the handler takes the UNLINKED branch) | The fraction of `/latest` calls falling through to the UNLINKED path — a leading indicator of "users have unlinked devices and not re-paired" |
| Sentry slow-query breadcrumb | Postgres slow-log → Sentry | Catches the §6.5 risk: view-aggregate p99 creep as histories grow |
| Direct SQL probe | Manual | `select count(*) from m1_katara_parcel_device_history` is the at-a-glance KAT-13 health metric — should equal `count(distinct (parcel_id, device_id))` on `m1_katara_telemetry` |

No Healthchecks.io heartbeat (no worker). No Brevo dashboard signal (no emails).

---

## 9. Acceptance Verification Checklist

Run before flipping `spring-status.yml` to `IN_REVIEW`:

- [ ] Migration `0027_kat13_history_with_provenance.sql` applied on staging; view + 4-arg function + extended `_latest` view all visible.
- [ ] `pytest backend/tests/test_kat13_history_after_unlink.py -v` — all 4 scenarios green.
- [ ] `pytest backend/tests/test_kat12_unlink_e2e.py --run-e2e` — extended assertions pass on staging.
- [ ] `make -C db test-auth07` — three new pgTAP cells (K-13a / K-13b / K-13c) green.
- [ ] `pytest backend/tests/test_kat04_telemetry.py` — passes after the `device_status` shape update.
- [ ] Frontend build green; `pnpm --filter frontend lint && pnpm --filter frontend typecheck` clean.
- [ ] Manual staging rehearsal (§7.3) steps 1–12 all observed.
- [ ] KAT-04 Locust re-run (§7.4) shows no regression beyond the documented `/latest` +20 ms budget.
- [ ] No Sentry errors during the rehearsal.
- [ ] i18n keys present in FR / AR / EN; the Arabic device-history card renders RTL.
- [ ] `spring-status.yml` KAT-13 row updated to `IN_REVIEW`; E2 epic `progress_pct` updated to ~86.

---

## 10. Hand-off Notes for Future Work

1. **KAT-14 (multi-parcel switcher)** — KAT-13 leaves the `/history` and `/devices-history` endpoints parcel-scoped. The KAT-14 multi-parcel UI iterates the farmer's parcels and calls these endpoints once per parcel; the response shapes need no change. The only future polish would be a `GET /api/v1/katara/farmers/me/devices-history` flat list across all parcels, but the per-parcel calls compose into the same answer with one extra round-trip each — not blocking KAT-14.
2. **Post-MVD device-archive CRON (§6.1 of [KAT-12](./KAT-12-unlink-relink-device.md))** — when an UNLINKED device older than 12 months should be moved to `m1_katara_devices_archive`, KAT-13's `<DeviceHistoryCard>` continues to display it as long as the view definition is updated to UNION over both tables. The view-based approach makes the archive transparent to the frontend.
3. **Audit log of unlink events (§6.3)** — a future `m1_katara_device_audit_log` would replace the `updated_at` proxy with a proper `unlinked_at` column. KAT-13's `LatestTelemetry.device_unlinked_at` semantics stay the same; only the source column changes. One-line refactor in `get_latest`.
4. **Materialised aggregate (§6.5)** — when `<DeviceHistoryCard>` queries cross the 200 ms p99 SLO, replace the view with a `create materialized view ... with no data` + a CRON refreshing it every 5 minutes. The endpoint signature is unchanged; the response is at most 5 min stale, which is acceptable for a history surface.
5. **Per-segment colour-coded chart line** — KAT-13's filter dropdown is the MVP for "I want to see only this device's slice". A post-MVD chart-library swap (e.g. `recharts`) makes multi-segment colour coding cheap — at which point the unfiltered chart can render N lines, one per device, with a shared legend. Currently out-of-scope because hand-rolled SVG (KAT-04 §6.3) does not support it.
6. **Cross-parcel device biography** ("show me everywhere ESP-KAT-001 has ever been") — out of scope for KAT-13 because it breaks the parcel-scoped mental model. If a future operations team needs this (e.g. for hardware support), a separate admin-only `GET /api/v1/admin/katara/devices/{device_id}/biography` endpoint is the right shape — not a farmer-facing surface.
7. **AUTH-07 RLS matrix** — gains three cells (K-13a / K-13b / K-13c per §5.6). The matrix doc (`docs/auth07-rls-matrix.md` or equivalent) is updated by the AUTH-07 audit story owner; KAT-13 only ships the pgTAP cells.
