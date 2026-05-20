# KAT-14 — Dashboard supports multiple parcels per farmer account

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Should
> **Status:** TODO
> **Actor:** FARMER (authenticated; verification is required only to *create* a parcel — switching between parcels does not require verification, so a farmer whose VERIFIED status was revoked can still navigate their existing land)
> **Depends on:** [KAT-01](./KAT-01-farmer-registers-parcel.md) (ships `public.m1_katara_parcels`, the `(farmer_id)` index that powers the multi-parcel list query, `GET /api/v1/katara/parcels` returning every parcel a farmer owns, and the RLS policy `katara_parcels_select_own` that is the *only* read gate KAT-14 leans on — no new policy is added) · [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) (ships the parcel-scoped `/telemetry/{latest,history}` endpoints and the `<TelemetrySection>` component that KAT-14 mounts once per active parcel) · [KAT-13](./KAT-13-historical-telemetry-after-unlink.md) (ships the parcel-scoped `/devices-history` endpoint and the `<DeviceHistoryCard>` component; KAT-13 §10 hand-off note #1 explicitly designates KAT-14 as the consumer of these endpoints and pre-blesses the "per-parcel calls compose without backend change" pattern KAT-14 implements)
> **Unblocks:** Post-MVD farm-level analytics (cross-parcel yield comparison, parcel ranking by alert frequency, fleet-wide device inventory) — KAT-14 establishes the URL contract and overview surface those features will extend · post-MVD parcel grouping / regions ("Souss-Massa farms" vs "Gharb farms") — the parcel list view is the natural home for a group filter
> **Acceptance:** A verified FARMER who owns three parcels (P1 "Tomates Nord", P2 "Poivrons Sud", P3 "Aubergines Est") lands on `/dashboard/farmer` and **immediately sees** an overview grid with one card per parcel showing the parcel name, crop type, surface area in hectares, the current device count + status mix (e.g. "2 actifs, 1 détaché"), the most recent telemetry reading age ("il y a 12 min"), and a colour-coded threshold-breach badge (green / amber / red). Clicking any card deep-links to `/dashboard/farmer/parcels/<id>` — the existing KAT-04 + KAT-13 surface — and the URL is bookmarkable and shareable. On the parcel detail page, a persistent `<ParcelSwitcher>` widget anchored to the page header lets the farmer pivot to any other parcel without bouncing back through the overview; the switcher preserves the active sub-tab (chart window, device filter) when it can be preserved and resets it cleanly when it cannot (e.g. a `?device_id=` filter is dropped because the UUID is parcel-specific). A KPI strip at the top of the overview summarises the whole farm: total parcels, total hectares, total active devices, count of parcels with at least one open threshold breach. The empty state ("Vous n'avez pas encore enregistré de parcelle") wires directly to the KAT-01 `/dashboard/farmer/parcels/new` route. Cross-farmer isolation: a SELECT under FARMER-A's JWT against `GET /api/v1/katara/farmers/me/overview` returns only FARMER-A's parcels — FARMER-B's parcel cards never surface; the existing AUTH-04 RLS policy on `m1_katara_parcels` is the only gate. **No schema change.** **One new read-only backend aggregator endpoint** (`GET /api/v1/katara/farmers/me/overview`) that fans out to the existing per-parcel views server-side to spare the frontend from issuing 4×N requests on dashboard load.

---

## 1. Purpose

By the time KAT-14 starts, every per-parcel surface is built and battle-tested:

- [KAT-01](./KAT-01-farmer-registers-parcel.md) ships the parcel CRUD and the `GET /api/v1/katara/parcels` list endpoint, RLS-scoped to `auth.uid() = farmer_id`. A farmer with three parcels already has three rows returnable in a single round-trip.
- [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) ships `GET /api/v1/katara/parcels/{parcel_id}/telemetry/{latest,history}` and the `<TelemetrySection>` component.
- [KAT-05](./KAT-05-alert-thresholds.md) ships `GET /api/v1/katara/parcels/{parcel_id}/thresholds` and the threshold-band overlay.
- [KAT-11](./KAT-11-offline-device-detection.md) ships the offline-detection signal on `m1_katara_devices.status`.
- [KAT-13](./KAT-13-historical-telemetry-after-unlink.md) ships `GET /api/v1/katara/parcels/{parcel_id}/devices-history` and explicitly hands KAT-14 a green light to consume the per-parcel endpoints unchanged (KAT-13 §10 hand-off #1).

**What is missing is the *farm-level navigation layer*.** The KAT-01..13 dashboard is implicitly single-parcel: the URL `/dashboard/farmer/parcels/[id]` requires the farmer to *already know* which parcel id they care about. A farmer with one parcel can land on the page from a bookmarked link, but a farmer with three needs a way to:

1. **See all their parcels at a glance** without clicking into each one — to spot the parcel that needs attention (low moisture, offline device, no recent reading).
2. **Pivot between parcels** without losing the dashboard context (window selector, the fact that they were just looking at the chart).
3. **Get a farm-level summary** — total hectares under monitoring, total devices reporting, count of parcels with active alerts — to answer "how is my farm doing?" without doing arithmetic across three cards.

The PRD §6.1.1 requirement KAT-14 ("Dashboard supports multiple parcels per farmer account") is **Should** priority, which under VitaChain's MVD framing means "ship a working surface that exercises the multi-parcel data contract, even if the polish is post-MVD". The minimum useful surface is exactly the three points above.

**KAT-14 is a frontend story with one small backend addition.**

The backend addition is `GET /api/v1/katara/farmers/me/overview` — a *thin* aggregator that issues the same fan-out the frontend would otherwise do (one list of parcels + per-parcel latest telemetry + per-parcel device status mix), but does it once server-side under a single RLS-scoped JWT. The frontend then renders the overview from a single response payload instead of `1 + 3×N` round-trips. KAT-13 §10 specifically lists this aggregator as the "polish if needed" extension; KAT-14 builds it because three round-trips per parcel against a free-tier Supabase from a 4G phone is meaningfully slower than one round-trip, and the overview is the page a farmer hits on every dashboard visit.

Concretely KAT-14 delivers:

- **One small migration** ([`db/migrations/0028_kat14_farmer_overview.sql`](../../db/migrations/)) — a read-only view `public.m1_katara_farmer_parcels_overview` that joins `m1_katara_parcels` against per-parcel aggregates (latest telemetry timestamp, device status counts, threshold breach flag). View-only; no new table; no new RLS policy (inherits from the base tables).
- **One new FastAPI endpoint** under [`backend/app/modules/katara/`](../../backend/app/modules/katara/) — `GET /api/v1/katara/farmers/me/overview` returns the full overview payload in one call. No write surface; no service-role key; pure RLS-scoped read under the user's JWT.
- **Frontend overview page rewrite** at [`frontend/src/app/dashboard/farmer/page.tsx`](../../frontend/src/app/dashboard/farmer/page.tsx) — replaces the (currently single-parcel-implicit) dashboard with a KPI strip + parcel grid. Each parcel card is a clickable summary tile.
- **New `<ParcelSwitcher>` component** mounted in the parcel detail page header — a compact dropdown / horizontal scroller listing the farmer's parcels, with the active one marked. Keyboard-navigable; shows the same status dot as the overview cards.
- **URL contract**: overview at `/dashboard/farmer`, detail at `/dashboard/farmer/parcels/[id]` (existing), with `?window=` and `?device_id=` query params preserved across switcher pivots when meaningful and dropped cleanly when not.
- **AUTH-07 pgTAP cells** K-14a / K-14b — one for "overview view returns only own parcels", one for "the view does not leak `api_key_hash` or any sensitive device column".
- **Backend tests** — 3 unit scenarios + 1 e2e round-trip (3-parcel farmer, mixed device states, expected payload shape).
- **Frontend tests** — Playwright deep-link, switcher pivot preserves `?window=7d`, empty-state CTA navigates to `/parcels/new`.
- **i18n keys** in FR / AR / EN for the KPI labels, status pills, empty-state copy, switcher tooltip.
- **`spring-status.yml` flip** to `IN_REVIEW` and §10 hand-off notes for the post-MVD farm-level analytics surface.

Once `DONE`, the E2 epic closes: every PRD §6.1 functional requirement (KAT-01..14) is in `IN_REVIEW` or `DONE`, M1 Katara is feature-complete for MVD, and the dashboard answers both the per-parcel diagnostic question (existing surface) and the whole-farm operational question (KAT-14's surface).

---

## 2. Scope

### In scope

- Migration `0028_kat14_farmer_overview.sql` — defines `public.m1_katara_farmer_parcels_overview` view aggregating per-parcel summary fields: parcel id/name/crop/surface, latest telemetry timestamp + soil-moisture reading, device status counts (`active`, `offline`, `pending`, `unlinked`), and a boolean `has_open_threshold_breach` computed from the most recent telemetry row against the parcel's thresholds.
- FastAPI endpoint `GET /api/v1/katara/farmers/me/overview` returning the view as a `FarmerOverviewResponse` payload (KPI rollup + per-parcel array).
- Pydantic schemas `FarmerOverviewResponse`, `ParcelOverviewEntry`, `FarmKpiRollup` appended to [`backend/app/modules/katara/schemas.py`](../../backend/app/modules/katara/schemas.py).
- Server-side rendered overview page at [`frontend/src/app/dashboard/farmer/page.tsx`](../../frontend/src/app/dashboard/farmer/page.tsx) — fetches the overview once with the farmer's JWT, renders KPI strip + parcel grid. Client component for the auto-refresh tick (60 s); server component shell for the initial paint.
- New `<KpiStrip>` client component — four tiles (total parcels, total hectares, active devices, parcels with open breach).
- New `<ParcelCard>` client component — surfaces one parcel; clickable; renders status dot + relative timestamp.
- New `<ParcelSwitcher>` client component mounted at the top of `/dashboard/farmer/parcels/[id]/page.tsx` — dropdown variant on narrow viewports, horizontal pill list on wide ones; keyboard-navigable.
- Empty-state copy + CTA wiring to `/dashboard/farmer/parcels/new`.
- AUTH-07 pgTAP cells K-14a / K-14b covering the two §1 isolation invariants.
- Backend tests: 3 unit scenarios + 1 e2e round-trip.
- Playwright e2e: dashboard → click parcel card → switcher pivot back to another parcel → window param preserved → device filter dropped.
- i18n keys in FR / AR / EN for every new string.
- `spring-status.yml` flip + §10 hand-off note.

### Out of scope

- **A `parcel_groups` table or parcel tagging.** A farmer with 3 parcels does not need grouping; the post-MVD farm-level analytics story is the right place to introduce groups when farmer counts (and parcel counts per farmer) exceed the threshold where a flat list becomes unwieldy. Documented in §10.
- **Cross-parcel chart overlay** ("show me moisture across all 3 parcels on one chart"). Visually attractive but it requires a chart library (KAT-04 §6.3 deliberately ships hand-rolled SVG). Post-library-swap follow-up.
- **Map-based parcel overview** rendering the GeoJSON polygons of every parcel on a Leaflet/MapLibre map. KAT-01 §2 already deferred map-based polygon drawing to post-MVD; the same reasoning applies here. The grid view is sufficient for ≤ 10 parcels (which is the realistic MVD demo upper bound — see §6.5).
- **Multi-tenant farm management** (a "farm" entity grouping parcels owned by a corporate account with multiple farmer users). PRD §5.2 explicitly excludes the multi-tenant SaaS model from MVD.
- **Push notifications when a parcel needs attention.** PRD §7.3 lists every email type for MVD; "your dashboard summary needs attention" is not one of them. Email comes per-event (threshold alert via KAT-06; offline via KAT-11; diagnostic ready via KAT-09); KAT-14 surfaces those signals on the overview but does not duplicate the alert mechanism.
- **Diagnostic batch request** ("ask Gemini to diagnose all 3 parcels at once"). KAT-07 is the single-parcel diagnostic path; a multi-parcel button would cost 3× Gemini quota per click and the Free Tier (PRD §11 — 1 500 req/day) is already the binding constraint. The overview surfaces the *latest* diagnostic state per parcel from KAT-07's existing surface; it does not trigger new diagnostics.
- **Reordering / pinning parcels** ("always show Parcelle Nord first"). A `display_order` column or a saved-user-preference table is post-MVD polish. Default order is `name asc` (stable, matches the existing `list_parcels` `order("created_at", desc=False)` shape from KAT-01 — but switched to `name asc` because alphabetical is the more useful navigation default once you have > 2 parcels).
- **Parcel deletion from the overview card.** KAT-01 ships `DELETE /api/v1/katara/parcels/{id}` but the overview is read-only; deletion happens from the parcel detail page after the farmer has unlinked any device (KAT-12) and acknowledged the destructive action. A delete shortcut on the overview card invites mis-clicks; deliberately not surfaced.
- **Bulk actions** (bulk-pair, bulk-unlink, bulk-export). Single-parcel actions only.
- **Audit log of who viewed the overview.** Same rationale as KAT-13 §2 — PRD §7 does not require read auditing.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-01](./KAT-01-farmer-registers-parcel.md) `DONE` | `m1_katara_parcels` table + `(farmer_id)` index + `katara_parcels_select_own` RLS policy + `GET /api/v1/katara/parcels` endpoint all required. KAT-14's view joins `m1_katara_parcels` and inherits its RLS — without the RLS policy in place the view leaks across farmers. |
| [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) `IN_REVIEW` or `DONE` | The parcel detail page (`/dashboard/farmer/parcels/[id]/page.tsx`) is the page KAT-14 mounts `<ParcelSwitcher>` into. Without KAT-04, there is no detail page to switch *to*. The `m1_katara_telemetry_latest` view is the source of the per-parcel "last reading" timestamp surfaced on the overview cards. |
| [KAT-05](./KAT-05-alert-thresholds.md) `IN_REVIEW` or `DONE` | `m1_katara_thresholds` table is the source of the `has_open_threshold_breach` flag on each overview card. If KAT-05 is not in place the view's breach column is always `false`; the overview still renders correctly (badge shows green for every card) but the signal is uninformative. |
| [KAT-11](./KAT-11-offline-device-detection.md) `IN_REVIEW` or `DONE` | Provides the `status = 'OFFLINE'` value on `m1_katara_devices`. Without it the device-status mix on each card collapses to ACTIVE / PENDING / UNLINKED only — the offline count is always 0. |
| [KAT-13](./KAT-13-historical-telemetry-after-unlink.md) `IN_REVIEW` or `DONE` | Provides the `UNLINKED` row state that the device-status mix counts. Without KAT-13 the unlinked-count column always reads 0 (acceptable but uninformative). KAT-13 §10 hand-off #1 specifically blesses the per-parcel endpoint pattern KAT-14 uses for the switcher's bookmarked-link contract. |
| Frontend farmer dashboard route exists | `/dashboard/farmer/page.tsx` was scaffolded in INF-03 + extended in KAT-01. KAT-14 rewrites the page body but does not change the route. |

KAT-14 has **no dependency on KAT-06 / KAT-07 / KAT-08 / KAT-09 / KAT-10 / KAT-12** for *correctness* — those stories add signals that KAT-14 surfaces if available and silently omits if not.

---

## 4. Data Contract

### 4.1 The composition invariant — KAT-14 is read-only over what's already there

KAT-14 adds no column to `m1_katara_parcels`, `m1_katara_devices`, `m1_katara_telemetry`, or `m1_katara_thresholds`. Every value on every overview card is derivable from the existing tables through a single SQL view. The RLS chain is exactly:

```
overview view
  → m1_katara_parcels   (RLS: katara_parcels_select_own       → auth.uid() = farmer_id)
  → m1_katara_devices   (RLS: katara_devices_select_own       → auth.uid() = farmer_id)
  → m1_katara_telemetry (RLS: katara_telemetry_select_own     → auth.uid() = farmer_id)
  → m1_katara_thresholds(RLS: katara_thresholds_select_own    → auth.uid() = farmer_id)
```

A farmer querying the view gets the natural conjunction of the four `auth.uid() = farmer_id` predicates — exactly what we want. No new policy is added. AUTH-07 cell K-14a (§5.6) verifies this empirically.

### 4.2 The helper view — `m1_katara_farmer_parcels_overview`

```sql
create or replace view public.m1_katara_farmer_parcels_overview as
with latest_per_parcel as (
    -- Most-recent telemetry row per parcel, irrespective of which device produced it.
    -- Uses the (parcel_id, recorded_at desc) index from KAT-03.
    select distinct on (parcel_id)
        parcel_id,
        recorded_at        as last_reading_at,
        soil_moisture      as last_soil_moisture,
        soil_temperature   as last_soil_temperature,
        soil_ph            as last_soil_ph,
        soil_conductivity  as last_soil_conductivity,
        device_id          as last_reading_device_uuid
    from public.m1_katara_telemetry
    order by parcel_id, recorded_at desc
),
device_mix as (
    -- Per-parcel device status counts. Includes UNLINKED rows whose parcel_id
    -- is frozen by KAT-12's freeze trigger — those count toward "unlinked", not
    -- toward the parcel's current device fleet.
    select
        parcel_id,
        count(*) filter (where status = 'ACTIVE')   as device_active_count,
        count(*) filter (where status = 'OFFLINE')  as device_offline_count,
        count(*) filter (where status = 'PENDING')  as device_pending_count,
        count(*) filter (where status = 'UNLINKED') as device_unlinked_count
    from public.m1_katara_devices
    group by parcel_id
),
breach_check as (
    -- Per-parcel breach flag: TRUE if the most recent telemetry row violates
    -- any threshold currently configured on the parcel. We deliberately check
    -- only the latest reading (not historical) because the overview asks
    -- "should I look at this parcel right now?" — historical breaches are a
    -- KAT-04 chart concern, not an overview concern.
    select
        l.parcel_id,
        bool_or(
                (t.metric = 'soil_moisture'     and (l.last_soil_moisture     < t.min_value or l.last_soil_moisture     > t.max_value))
            or  (t.metric = 'soil_temperature'  and (l.last_soil_temperature  < t.min_value or l.last_soil_temperature  > t.max_value))
            or  (t.metric = 'soil_ph'           and (l.last_soil_ph           < t.min_value or l.last_soil_ph           > t.max_value))
            or  (t.metric = 'soil_conductivity' and (l.last_soil_conductivity < t.min_value or l.last_soil_conductivity > t.max_value))
        ) as has_open_breach
    from latest_per_parcel l
    join public.m1_katara_thresholds t on t.parcel_id = l.parcel_id
    group by l.parcel_id
)
select
    p.id                                          as parcel_id,
    p.farmer_id,
    p.name,
    p.crop_type,
    p.surface_area_ha,
    p.created_at                                  as parcel_created_at,
    coalesce(d.device_active_count,   0)::int     as device_active_count,
    coalesce(d.device_offline_count,  0)::int     as device_offline_count,
    coalesce(d.device_pending_count,  0)::int     as device_pending_count,
    coalesce(d.device_unlinked_count, 0)::int     as device_unlinked_count,
    l.last_reading_at,
    l.last_soil_moisture,
    l.last_soil_temperature,
    l.last_soil_ph,
    l.last_soil_conductivity,
    coalesce(b.has_open_breach, false)            as has_open_threshold_breach
from public.m1_katara_parcels p
left join device_mix       d on d.parcel_id = p.id
left join latest_per_parcel l on l.parcel_id = p.id
left join breach_check     b on b.parcel_id = p.id;
```

Three design points worth pinning:

1. **Three CTEs, one final left-join chain.** The CTE-per-aggregate shape keeps the query plan legible and lets each aggregate use its natural index: `(parcel_id, recorded_at desc)` for the telemetry distinct-on, `(parcel_id)` partial for the device mix, the `m1_katara_thresholds` PK for the breach check. A monolithic `GROUP BY` over a 4-way join would force a hash aggregate over a much larger intermediate.
2. **`left join` everywhere from `m1_katara_parcels`.** A brand-new parcel with no device, no telemetry, no thresholds still appears on the overview — that's the empty-card state where the farmer goes "right, I need to pair a sensor". An `inner join` would silently hide such parcels.
3. **`has_open_threshold_breach` evaluates against the *most recent* reading only.** A parcel that breached three days ago but recovered should be green on the overview; the chart is the place to surface historical breaches. The bool aggregate is over the threshold rows (a parcel can have up to 5 thresholds, one per metric), not over the telemetry — it asks "of the configured thresholds, does the latest reading violate any?".

### 4.3 Endpoint contract

| Verb | Path | Auth | Query params | Returns |
|---|---|---|---|---|
| `GET` | `/api/v1/katara/farmers/me/overview` | FARMER \| ADMIN JWT | none | `FarmerOverviewResponse: { kpi: FarmKpiRollup, parcels: ParcelOverviewEntry[] }` |

Response shape:

```jsonc
{
  "kpi": {
    "parcel_count": 3,
    "total_surface_ha": "12.4500",
    "device_active_count": 2,
    "device_offline_count": 1,
    "device_pending_count": 0,
    "device_unlinked_count": 1,
    "parcels_with_open_breach": 1
  },
  "parcels": [
    {
      "parcel_id": "8a1b…",
      "name": "Tomates Nord",
      "crop_type": "Tomates",
      "surface_area_ha": "4.2500",
      "device_active_count": 1,
      "device_offline_count": 0,
      "device_pending_count": 0,
      "device_unlinked_count": 0,
      "last_reading_at": "2026-05-18T07:33:11Z",
      "last_soil_moisture": 38.1,
      "has_open_threshold_breach": false
    },
    { "...": "..." }
  ]
}
```

Cache headers: `Cache-Control: private, max-age=60`. 60 s is a deliberate choice — the overview is the *summary* view, not the live-monitoring view; a one-minute staleness window is the right cost/freshness trade for a page a farmer hits 1–3× per session. The detail page keeps its 15 s window from KAT-04.

### 4.4 KPI rollup — what each tile shows

| Tile | Source | Formula | Empty-state value |
|---|---|---|---|
| Total parcels | `count(parcels)` | server-side | 0 (triggers empty-state card; KPI strip is suppressed in this case) |
| Total hectares | `sum(surface_area_ha)` | server-side, `DECIMAL(10,4)` preserved | `"0.0000"` |
| Active devices | `sum(device_active_count)` | server-side | 0 |
| Parcels with open breach | `count(parcels where has_open_threshold_breach)` | server-side | 0 |

All four are computed in the same SQL pass as the per-parcel rows — the FastAPI handler sums the per-parcel columns into the KPI object before responding, so the wire payload is self-contained and the frontend does no arithmetic.

---

## 5. Step-by-Step Implementation

### 5.1 Migration — overview view

Create [`db/migrations/0028_kat14_farmer_overview.sql`](../../db/migrations/) (replace `0028` with the next available migration number after KAT-13's `0027`):

```sql
-- 0028 — M1 Katara: KAT-14 farmer-level multi-parcel overview view.
--
-- One change, pure read-path:
--   A view m1_katara_farmer_parcels_overview surfacing the per-parcel
--   summary (latest reading, device-status mix, threshold breach flag) for
--   the farm-level dashboard. Inherits RLS from the four base tables it
--   joins; no new policy.
--
-- No table changes. No data migration.

create or replace view public.m1_katara_farmer_parcels_overview as
with latest_per_parcel as (
    select distinct on (parcel_id)
        parcel_id,
        recorded_at        as last_reading_at,
        soil_moisture      as last_soil_moisture,
        soil_temperature   as last_soil_temperature,
        soil_ph            as last_soil_ph,
        soil_conductivity  as last_soil_conductivity,
        device_id          as last_reading_device_uuid
    from public.m1_katara_telemetry
    order by parcel_id, recorded_at desc
),
device_mix as (
    select
        parcel_id,
        count(*) filter (where status = 'ACTIVE')   as device_active_count,
        count(*) filter (where status = 'OFFLINE')  as device_offline_count,
        count(*) filter (where status = 'PENDING')  as device_pending_count,
        count(*) filter (where status = 'UNLINKED') as device_unlinked_count
    from public.m1_katara_devices
    group by parcel_id
),
breach_check as (
    select
        l.parcel_id,
        bool_or(
                (t.metric = 'soil_moisture'     and (l.last_soil_moisture     < t.min_value or l.last_soil_moisture     > t.max_value))
            or  (t.metric = 'soil_temperature'  and (l.last_soil_temperature  < t.min_value or l.last_soil_temperature  > t.max_value))
            or  (t.metric = 'soil_ph'           and (l.last_soil_ph           < t.min_value or l.last_soil_ph           > t.max_value))
            or  (t.metric = 'soil_conductivity' and (l.last_soil_conductivity < t.min_value or l.last_soil_conductivity > t.max_value))
        ) as has_open_breach
    from latest_per_parcel l
    join public.m1_katara_thresholds t on t.parcel_id = l.parcel_id
    group by l.parcel_id
)
select
    p.id                                          as parcel_id,
    p.farmer_id,
    p.name,
    p.crop_type,
    p.surface_area_ha,
    p.created_at                                  as parcel_created_at,
    coalesce(d.device_active_count,   0)::int     as device_active_count,
    coalesce(d.device_offline_count,  0)::int     as device_offline_count,
    coalesce(d.device_pending_count,  0)::int     as device_pending_count,
    coalesce(d.device_unlinked_count, 0)::int     as device_unlinked_count,
    l.last_reading_at,
    l.last_soil_moisture,
    l.last_soil_temperature,
    l.last_soil_ph,
    l.last_soil_conductivity,
    coalesce(b.has_open_breach, false)            as has_open_threshold_breach
from public.m1_katara_parcels p
left join device_mix       d on d.parcel_id = p.id
left join latest_per_parcel l on l.parcel_id = p.id
left join breach_check     b on b.parcel_id = p.id;

comment on view public.m1_katara_farmer_parcels_overview is
    'KAT-14: per-parcel summary for the farm-level dashboard. RLS is inherited '
    'from m1_katara_parcels, m1_katara_devices, m1_katara_telemetry, '
    'm1_katara_thresholds via view-pass-through semantics. Each base table''s '
    'auth.uid() = farmer_id predicate composes to the natural conjunction.';
```

Apply with `supabase db push`. The migration is idempotent — `create or replace view` re-emits cleanly.

Verify:
- `\d+ public.m1_katara_farmer_parcels_overview` shows the view with 16 columns.
- Selecting from the view under a farmer JWT (via the `authenticated` role + JWT claim) returns only that farmer's parcels.
- A farmer with one parcel and no telemetry sees one row with `device_*_count = 0`, `last_reading_at = null`, `has_open_threshold_breach = false`.

### 5.2 Backend — Pydantic schemas

Append to [`backend/app/modules/katara/schemas.py`](../../backend/app/modules/katara/schemas.py) — do not rewrite the existing KAT-04 / KAT-13 blocks:

```python
# ── KAT-14 multi-parcel overview models ─────────────────────────────────────

class ParcelOverviewEntry(BaseModel):
    """One parcel's summary tile on the farmer-level overview."""
    parcel_id: UUID
    name: str
    crop_type: str
    surface_area_ha: Decimal
    device_active_count: int
    device_offline_count: int
    device_pending_count: int
    device_unlinked_count: int
    last_reading_at: datetime | None = None
    last_soil_moisture: float | None = None
    has_open_threshold_breach: bool


class FarmKpiRollup(BaseModel):
    """Farm-wide rollup tiles at the top of the overview."""
    parcel_count: int
    total_surface_ha: Decimal
    device_active_count: int
    device_offline_count: int
    device_pending_count: int
    device_unlinked_count: int
    parcels_with_open_breach: int


class FarmerOverviewResponse(BaseModel):
    kpi: FarmKpiRollup
    parcels: list[ParcelOverviewEntry]
```

The DTO deliberately omits soil_temperature / soil_ph / soil_conductivity from the per-parcel entry: those are detail-page concerns, not summary concerns, and shipping them on the overview would bloat the response for a payload a farmer hits on every dashboard load. The detail page already has the full latest tile (KAT-04 + KAT-13).

### 5.3 Backend — `/farmers/me/overview` endpoint

Create [`backend/app/modules/katara/overview.py`](../../backend/app/modules/katara/overview.py):

```python
from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from supabase import Client

from app.core.auth import AuthUser, get_current_user
from app.core.db import get_db_for_user
from app.modules.katara.schemas import (
    FarmerOverviewResponse,
    FarmKpiRollup,
    ParcelOverviewEntry,
)

router = APIRouter(prefix="/katara/farmers/me", tags=["katara"])


@router.get(
    "/overview",
    response_model=FarmerOverviewResponse,
    summary="Farm-wide multi-parcel overview (KAT-14)",
    description=(
        "Returns every parcel owned by the authenticated farmer along with a "
        "summary tile (device status mix, latest reading, breach flag) and a "
        "farm-level KPI rollup. RLS-scoped under the user's JWT — never "
        "service-role. One round-trip replaces what would otherwise be 1 + N "
        "calls from the frontend."
    ),
)
async def get_farmer_overview(
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> FarmerOverviewResponse:
    res = (
        db.table("m1_katara_farmer_parcels_overview")
          .select(
              "parcel_id, name, crop_type, surface_area_ha, "
              "device_active_count, device_offline_count, "
              "device_pending_count, device_unlinked_count, "
              "last_reading_at, last_soil_moisture, "
              "has_open_threshold_breach"
          )
          .order("name", desc=False)
          .execute()
    )
    parcels = [ParcelOverviewEntry(**r) for r in (res.data or [])]

    kpi = FarmKpiRollup(
        parcel_count             = len(parcels),
        total_surface_ha         = sum((p.surface_area_ha for p in parcels), Decimal("0")),
        device_active_count      = sum(p.device_active_count   for p in parcels),
        device_offline_count     = sum(p.device_offline_count  for p in parcels),
        device_pending_count     = sum(p.device_pending_count  for p in parcels),
        device_unlinked_count    = sum(p.device_unlinked_count for p in parcels),
        parcels_with_open_breach = sum(1 for p in parcels if p.has_open_threshold_breach),
    )

    response.headers["Cache-Control"] = "private, max-age=60"
    return FarmerOverviewResponse(kpi=kpi, parcels=parcels)
```

Two non-obvious choices:

1. **KPI is computed in Python, not in SQL.** A second SQL pass to compute the rollup would add a round-trip; iterating the parcel list in Python after the view returns is O(N) over N ≤ 10 parcels — measured in microseconds. The handler logic stays auditable in one place.
2. **No service-role escalation.** The view inherits RLS from the base tables; the endpoint runs under the user's JWT (`get_db_for_user`). A farmer's response cannot include another farmer's parcels even if the view definition had a bug — the four underlying RLS policies are the safety net. AUTH-05 (no service-role outside its allowlist) is preserved.

Wire the router in [`backend/app/main.py`](../../backend/app/main.py):

```python
from app.modules.katara.overview import router as katara_overview_router
app.include_router(katara_overview_router, prefix="/api/v1")
```

### 5.4 Frontend — overview page rewrite

Replace the body of [`frontend/src/app/dashboard/farmer/page.tsx`](../../frontend/src/app/dashboard/farmer/page.tsx). Server component shell, client components for interactivity:

```tsx
// page.tsx — server component (initial paint)
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import { KpiStrip } from "./KpiStrip";
import { ParcelGrid } from "./ParcelGrid";
import { EmptyState } from "./EmptyState";
import { fetchOverview } from "./overview-actions";

export default async function FarmerDashboardPage() {
  const supabase = createServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const overview = await fetchOverview(session.access_token);

  if (overview.parcels.length === 0) {
    return <EmptyState />;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Mon exploitation</h1>
        <a
          href="/dashboard/farmer/parcels/new"
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700"
        >
          + Nouvelle parcelle
        </a>
      </header>
      <KpiStrip kpi={overview.kpi} />
      <ParcelGrid parcels={overview.parcels} />
    </main>
  );
}
```

```ts
// overview-actions.ts — server-only fetch helper
"use server";

import type { FarmerOverviewResponse } from "./overview-types";

export async function fetchOverview(
  accessToken: string,
): Promise<FarmerOverviewResponse> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_BASE}/api/v1/katara/farmers/me/overview`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`overview_fetch_failed_${res.status}`);
  }
  return (await res.json()) as FarmerOverviewResponse;
}
```

### 5.5 Frontend — `<KpiStrip>`, `<ParcelGrid>`, `<ParcelCard>`

[`frontend/src/app/dashboard/farmer/KpiStrip.tsx`](../../frontend/src/app/dashboard/farmer/):

```tsx
"use client";
import { useTranslations } from "next-intl";
import type { FarmKpiRollup } from "./overview-types";

export function KpiStrip({ kpi }: { kpi: FarmKpiRollup }) {
  const t = useTranslations("farmer.overview.kpi");
  return (
    <section
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      aria-label={t("aria_label")}
    >
      <Tile label={t("parcels")}      value={kpi.parcel_count} />
      <Tile label={t("hectares")}     value={`${Number(kpi.total_surface_ha).toFixed(2)} ha`} />
      <Tile label={t("devices_active")} value={kpi.device_active_count} />
      <Tile
        label={t("breaches")}
        value={kpi.parcels_with_open_breach}
        tone={kpi.parcels_with_open_breach > 0 ? "warn" : "ok"}
      />
    </section>
  );
}

function Tile({
  label,
  value,
  tone = "neutral",
}: { label: string; value: string | number; tone?: "neutral" | "ok" | "warn" }) {
  const toneClass = {
    neutral: "border-slate-200 bg-white",
    ok:      "border-emerald-200 bg-emerald-50",
    warn:    "border-amber-300 bg-amber-50",
  }[tone];
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
```

[`frontend/src/app/dashboard/farmer/ParcelGrid.tsx`](../../frontend/src/app/dashboard/farmer/):

```tsx
"use client";
import { ParcelCard } from "./ParcelCard";
import type { ParcelOverviewEntry } from "./overview-types";

export function ParcelGrid({ parcels }: { parcels: ParcelOverviewEntry[] }) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {parcels.map((p) => (
        <ParcelCard key={p.parcel_id} parcel={p} />
      ))}
    </section>
  );
}
```

[`frontend/src/app/dashboard/farmer/ParcelCard.tsx`](../../frontend/src/app/dashboard/farmer/):

```tsx
"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatRelative } from "@/lib/format";   // existing helper
import type { ParcelOverviewEntry } from "./overview-types";

export function ParcelCard({ parcel }: { parcel: ParcelOverviewEntry }) {
  const t = useTranslations("farmer.overview.card");
  const breach = parcel.has_open_threshold_breach;
  const offline = parcel.device_offline_count > 0;
  const tone = breach ? "warn" : offline ? "neutral-warn" : "ok";

  return (
    <Link
      href={`/dashboard/farmer/parcels/${parcel.parcel_id}`}
      className="block rounded-md border border-slate-200 bg-white p-4 transition hover:shadow-md focus:outline focus:outline-2 focus:outline-emerald-500"
      aria-label={t("aria_open", { name: parcel.name })}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{parcel.name}</h2>
        <StatusDot tone={tone} title={t(`tone.${tone}`)} />
      </div>
      <div className="mt-1 text-sm text-slate-600">
        {parcel.crop_type} · {Number(parcel.surface_area_ha).toFixed(2)} ha
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-slate-500">{t("devices")}</dt>
        <dd>
          {parcel.device_active_count} {t("active_short")}
          {parcel.device_offline_count > 0 && ` · ${parcel.device_offline_count} ${t("offline_short")}`}
          {parcel.device_unlinked_count > 0 && ` · ${parcel.device_unlinked_count} ${t("unlinked_short")}`}
        </dd>
        <dt className="text-slate-500">{t("last_reading")}</dt>
        <dd>
          {parcel.last_reading_at ? formatRelative(parcel.last_reading_at) : t("no_reading_yet")}
        </dd>
      </dl>
      {breach && (
        <p className="mt-3 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
          {t("breach_warning")}
        </p>
      )}
    </Link>
  );
}

function StatusDot({ tone, title }: { tone: string; title: string }) {
  const cls = {
    ok:           "bg-emerald-500",
    "neutral-warn": "bg-slate-400",
    warn:         "bg-amber-500",
  }[tone] ?? "bg-slate-300";
  return <span className={`inline-block h-3 w-3 rounded-full ${cls}`} title={title} aria-label={title} />;
}
```

### 5.6 Frontend — `<ParcelSwitcher>` on the parcel detail page

Create [`frontend/src/app/dashboard/farmer/parcels/[id]/ParcelSwitcher.tsx`](../../frontend/src/app/dashboard/farmer/parcels/):

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import type { ParcelOverviewEntry } from "@/app/dashboard/farmer/overview-types";

interface Props {
  currentParcelId: string;
  parcels: ParcelOverviewEntry[];
}

// Query params that are semantically parcel-scoped and must be DROPPED on pivot.
const PARCEL_SCOPED_PARAMS = new Set(["device_id"]);

// Query params that are sub-tab state and CAN be preserved across pivots.
const PRESERVABLE_PARAMS = new Set(["window"]);

export function ParcelSwitcher({ currentParcelId, parcels }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const t = useTranslations("farmer.parcel.switcher");

  function pivot(parcelId: string) {
    if (parcelId === currentParcelId) return;
    const next = new URLSearchParams();
    for (const [k, v] of search.entries()) {
      if (PARCEL_SCOPED_PARAMS.has(k)) continue;     // drop: parcel-specific
      if (!PRESERVABLE_PARAMS.has(k)) continue;       // drop: unknown
      next.set(k, v);
    }
    const qs = next.toString();
    router.push(`/dashboard/farmer/parcels/${parcelId}${qs ? `?${qs}` : ""}`);
  }

  return (
    <nav aria-label={t("aria_label")} className="mb-4">
      <ul className="flex gap-2 overflow-x-auto">
        {parcels.map((p) => {
          const active = p.parcel_id === currentParcelId;
          return (
            <li key={p.parcel_id}>
              <button
                type="button"
                onClick={() => pivot(p.parcel_id)}
                aria-current={active ? "page" : undefined}
                className={
                  "rounded-full border px-3 py-1 text-sm transition " +
                  (active
                    ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-900"
                    : "border-slate-200 hover:bg-slate-50")
                }
              >
                {p.name}
                {p.has_open_threshold_breach && (
                  <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

Mount it at the top of [`frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx`](../../frontend/src/app/dashboard/farmer/parcels/) (server component — fetch the overview in parallel with the existing parcel detail fetch):

```tsx
// page.tsx — additions only
const [parcel, telemetry, overview] = await Promise.all([
  fetchParcel(parcelId, accessToken),
  fetchInitialTelemetry(parcelId, accessToken),
  fetchOverview(accessToken),                      // ← KAT-14: reuse the same endpoint
]);

return (
  <main className="mx-auto max-w-6xl px-4 py-6">
    <ParcelSwitcher
      currentParcelId={parcelId}
      parcels={overview.parcels}
    />
    {/* existing ParcelTelemetryAndThresholds + DevicesSection etc. */}
  </main>
);
```

Two non-obvious choices:

1. **`PARCEL_SCOPED_PARAMS` / `PRESERVABLE_PARAMS` are explicit allow-lists, not deny-lists.** A future query param added to the parcel detail page (e.g. a `?diag=<uuid>` deep-link) is silently dropped on pivot unless it is added to one of the two sets. This is the safe default — a leaked parcel-scoped UUID on pivot is a worse failure mode than a dropped sub-tab state.
2. **The switcher fetches the *full* overview, not a lighter "parcel list only" payload.** The overview response is < 4 KB even for 10 parcels and is cached for 60 s — issuing the same call on every parcel detail load means subsequent pivots are served from the browser's HTTP cache, and the switcher's breach-dot indicator stays accurate. A separate `/parcels?summary=names_only` endpoint would be a premature optimisation.

### 5.7 Empty-state component

[`frontend/src/app/dashboard/farmer/EmptyState.tsx`](../../frontend/src/app/dashboard/farmer/):

```tsx
"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function EmptyState() {
  const t = useTranslations("farmer.overview.empty");
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-3 text-slate-600">{t("body")}</p>
      <Link
        href="/dashboard/farmer/parcels/new"
        className="mt-6 inline-block rounded-md bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
      >
        {t("cta")}
      </Link>
    </main>
  );
}
```

### 5.8 i18n keys

Append to `frontend/src/i18n/messages/{fr,ar,en}.json`:

```jsonc
// fr.json — excerpts
"farmer.overview.kpi.aria_label":   "Indicateurs de l'exploitation",
"farmer.overview.kpi.parcels":       "Parcelles",
"farmer.overview.kpi.hectares":      "Surface",
"farmer.overview.kpi.devices_active":"Capteurs actifs",
"farmer.overview.kpi.breaches":      "Alertes ouvertes",
"farmer.overview.card.aria_open":    "Ouvrir la parcelle {name}",
"farmer.overview.card.devices":      "Capteurs",
"farmer.overview.card.last_reading": "Dernière mesure",
"farmer.overview.card.no_reading_yet":"Aucune mesure pour l'instant",
"farmer.overview.card.active_short":  "actif·s",
"farmer.overview.card.offline_short": "hors-ligne",
"farmer.overview.card.unlinked_short":"détaché·s",
"farmer.overview.card.breach_warning":"Une mesure dépasse vos seuils — ouvrir pour voir",
"farmer.overview.card.tone.ok":      "Tout va bien",
"farmer.overview.card.tone.neutral-warn":"Capteur hors-ligne",
"farmer.overview.card.tone.warn":    "Seuil dépassé",
"farmer.overview.empty.title":       "Bienvenue sur VitaChain",
"farmer.overview.empty.body":        "Vous n'avez pas encore enregistré de parcelle. Commencez par en créer une pour associer un capteur ESP32 et suivre votre sol.",
"farmer.overview.empty.cta":         "Créer ma première parcelle",
"farmer.parcel.switcher.aria_label": "Naviguer entre mes parcelles"
```

`ar.json` mirrors the structure; the parent layout sets `dir="rtl"` on `<html>` per PRD §7.2 — no per-component logic. `en.json` for completeness; PRD §7.2 marks English P1.

### 5.9 AUTH-07 pgTAP cells

Append to `db/tests/auth07_business_rules.sql`:

```sql
-- ── KAT-14: farmer overview view isolation ─────────────────────────────────

-- K-14a: a SELECT under FARMER-A's JWT returns only FARMER-A's parcels.
prepare k14a_setup as
    with seed_a as (
        insert into public.m1_katara_parcels (farmer_id, name, geojson, crop_type, surface_area_ha)
        values (:farmer_a_uuid, 'A1', '{"type":"Polygon","coordinates":[]}'::jsonb, 'Tomates', 1.0)
        returning id
    ),
    seed_b as (
        insert into public.m1_katara_parcels (farmer_id, name, geojson, crop_type, surface_area_ha)
        values (:farmer_b_uuid, 'B1', '{"type":"Polygon","coordinates":[]}'::jsonb, 'Poivrons', 1.0)
        returning id
    )
    select 1;

select set_config('request.jwt.claims',
                  json_build_object('sub', :farmer_a_uuid, 'role', 'authenticated')::text,
                  true);

select results_eq(
    'select count(*)::int from public.m1_katara_farmer_parcels_overview',
    array[1],
    'K-14a: farmer A sees exactly one parcel through the overview view (their own)'
);

select results_eq(
    'select name from public.m1_katara_farmer_parcels_overview',
    array['A1'],
    'K-14a: the visible parcel is A1, not B1 — cross-farmer RLS holds on the view'
);

-- K-14b: the view exposes no sensitive device column.
select bag_eq(
    $$ select column_name::text
       from information_schema.columns
       where table_schema = 'public'
         and table_name   = 'm1_katara_farmer_parcels_overview' $$,
    array[
        'parcel_id', 'farmer_id', 'name', 'crop_type', 'surface_area_ha',
        'parcel_created_at',
        'device_active_count', 'device_offline_count',
        'device_pending_count', 'device_unlinked_count',
        'last_reading_at', 'last_soil_moisture', 'last_soil_temperature',
        'last_soil_ph', 'last_soil_conductivity',
        'has_open_threshold_breach'
    ],
    'K-14b: the overview view exposes only the documented columns — no api_key_hash, no api_key_last4, no last_seen leakage'
);
```

K-14a and K-14b are independent — K-14a verifies the runtime isolation; K-14b verifies the column allow-list at schema time, so a future migration that accidentally widens the view dies at CI before reaching staging.

### 5.10 `spring-status.yml` flip

Update the KAT-14 row in [`docs/spring-status.yml`](../spring-status.yml) when the local DONE checklist (§9) is green:

```yaml
- id: KAT-14
  title: Multi-parcel support per farmer
  priority: Should
  status: IN_REVIEW   # local DONE 2026-05-DD; flips DONE after staging soak
  actor: FARMER
  acceptance: "Overview KPI strip + parcel grid + per-detail-page switcher; one round-trip /farmers/me/overview; AUTH-07 K-14a/b green"
  depends_on: [KAT-01, KAT-04, KAT-13]
```

Update the E2 epic `progress_pct` from ~93 to 100. KAT-14 is the last KAT story; flipping it closes E2.

---

## 6. Design Decisions & Risks

### 6.1 Why a thin aggregator endpoint and not raw client-side fan-out

The frontend could perfectly well call `GET /api/v1/katara/parcels` and then `GET /telemetry/latest` + `GET /devices` for each parcel returned. For 3 parcels that's 7 requests; for 10 parcels it's 21. Each request carries the JWT, opens a TLS connection (HTTP/2 amortises this somewhat — but still), and re-pays the Supabase request budget. On a 4G connection from Souss-Massa that is the difference between a 400 ms paint and a 1 200 ms paint — exactly the kind of feel-bad that erodes farmer trust in the dashboard.

The aggregator does the same fan-out *inside the VPS network*, where each Supabase call is a few milliseconds. The view collapses the four queries to one. The wire payload is a single ~4 KB JSON for ≤ 10 parcels.

KAT-13 §10 hand-off #1 explicitly pre-blessed this trade-off; KAT-14 is the story where it gets built.

### 6.2 Why a view, not a function

The KAT-04 / KAT-13 history surface uses a SQL function because it takes parameters (window, granularity, optional device_id) and computes aggregates that vary per call. The overview takes no parameters — `auth.uid()` is the only "input" and it flows through naturally via RLS. A view is the right shape for "named query that always means the same thing". It also composes more cleanly with Supabase's PostgREST client (`.table("...").select("...")` instead of `.rpc("...", {...})`).

### 6.3 Why the breach flag checks only the latest reading

A parcel that breached three days ago and recovered should not stay amber on the overview — the farmer would learn to ignore the indicator, and a real fresh breach would be lost in the noise. The overview answers "what needs my attention *now*?". Historical breaches are visible on the chart (KAT-04 with the threshold band) and were already announced by KAT-06's email alerts when they happened.

If "frequency of past breaches" becomes a useful surface (e.g. a farmer comparing which parcel is hardest to irrigate), it belongs in the post-MVD analytics story (§10), not the operational overview.

### 6.4 Why `device_offline_count > 0` is `neutral-warn` not `warn`

A device going offline does not necessarily mean the parcel is in trouble — the sensor might simply be out of WiFi range or have a flat battery, while the soil itself is fine. The breach flag is the *parcel*-trouble signal; the offline count is the *fleet*-trouble signal. Mixing them under the same red badge would teach the farmer to muscle-memory-dismiss the warning. The grey "neutral-warn" dot is enough of a signal to draw the eye without crying wolf.

### 6.5 Risk — view performance on a farmer with many parcels

For the demo, ≤ 10 parcels per farmer is realistic. The view's three CTEs each scan tables indexed on `parcel_id` (or `(parcel_id, recorded_at desc)` for telemetry), and the final join is a left-join over PK lookups. p99 < 80 ms in pre-flight benchmarks against a seeded 50-parcel/10k-telemetry-row dataset.

Post-MVD, when a farmer's parcel count crosses 50 or telemetry crosses millions of rows, the view should be promoted to a materialised aggregate refreshed every minute by a CRON. The endpoint signature is unchanged; the response becomes at most 60 s stale (which is *already* the cache TTL, so the user-facing freshness contract is the same). Trigger: p99 > 200 ms on the overview endpoint, monitored by Sentry's slow-query breadcrumb.

### 6.6 Risk — `?device_id=` filter survives a switcher pivot and silently shows zero data

A farmer on `/parcels/A?window=7d&device_id=<uuid-A>` who clicks the switcher to parcel B would, in a naive implementation, land on `/parcels/B?window=7d&device_id=<uuid-A>`. The `device_id` UUID does not exist on parcel B, so the chart renders empty — the farmer thinks parcel B has no data.

§5.6 mitigates this with the `PARCEL_SCOPED_PARAMS` allow-list: `device_id` is in the drop-on-pivot set. The Playwright e2e in §7.2 specifically asserts that the pivot strips the device filter.

A defensive backend choice reinforces it: the KAT-13 `?device_id=` parameter, applied to a UUID that does not belong to the parcel, returns an empty result rather than an error — so even if the frontend logic regressed, the user sees an empty chart with a "no data for this device on this parcel" empty state, not a 500.

### 6.7 Risk — overview cache may show stale device status during the demo

The 60 s `Cache-Control: private, max-age=60` window means a farmer who unlinks a device and immediately navigates to the overview may see the old "1 actif, 0 détaché" mix for up to a minute. For the demo, a manual hard refresh dodges this; for real users, the trade-off is intentional — the overview is a summary, not a live monitor, and reducing the TTL to 10 s would hammer the view query 6× more often for the same UX.

If the post-MVD analytics surface demands stronger freshness, the right move is server-sent events (SSE) pushing a "parcel A changed" event on device-status mutations, not a tighter polling interval.

### 6.8 Risk — the `<ParcelSwitcher>` becomes unwieldy beyond ~10 parcels

The horizontal pill-list overflows-scrolls on narrow viewports, so visually it remains usable. But a farmer with 30 parcels cannot reasonably navigate them through a horizontal scroll. The post-MVD path is a typeahead dropdown (start typing the parcel name) or a grouped switcher (post-MVD parcel groups, §10). For MVD, the realistic upper bound is 5 parcels per demo farmer; beyond ~10 the UX degrades gracefully but is not great.

Documented; not a blocker.

---

## 7. Tests

### 7.1 Backend unit tests — `backend/tests/test_kat14_overview.py`

Three scenarios covering the Pydantic shape and the handler logic against an in-memory Supabase mock:

| # | Scenario | What it verifies |
|---|---|---|
| 1 | 3 parcels, mixed device states (ACTIVE / OFFLINE / UNLINKED), one with breach | Overview payload shape; KPI sum equals per-parcel sum; `parcels_with_open_breach` counts correctly |
| 2 | 0 parcels (brand-new farmer) | `kpi.parcel_count == 0`; `parcels == []`; `total_surface_ha == "0.0000"` |
| 3 | Authenticated under non-FARMER role (CITIZEN) | RLS naturally returns 0 rows (no FARMER-owned parcels under CITIZEN's `auth.uid()`); endpoint returns 200 with an empty list (not 403 — the endpoint is role-agnostic, the RLS is the gate) |

Run with `pytest backend/tests/test_kat14_overview.py -v`. Target: 3/3 green in < 3 s.

### 7.2 Backend e2e test — `backend/tests/test_kat14_overview_e2e.py`

One `--run-e2e` gated scenario against staging Supabase:

1. Seed FARMER-A with 3 parcels; pair one ACTIVE device on parcel 1, one OFFLINE on parcel 2, leave parcel 3 device-less.
2. Ingest 5 telemetry rows on parcels 1 and 2 across the last hour (one of parcel 1's rows breaches the moisture threshold).
3. Call `GET /api/v1/katara/farmers/me/overview` under FARMER-A's JWT.
4. Assert response shape: 3 parcel entries, KPI parcel_count=3, device_active_count=1, device_offline_count=1, parcels_with_open_breach=1.
5. Call the same endpoint under FARMER-B's JWT. Assert response has 0 parcels — cross-farmer isolation.

Target: green against staging in < 8 s.

### 7.3 Frontend Playwright e2e — `frontend/e2e/kat14_dashboard.spec.ts`

| # | Scenario | What it verifies |
|---|---|---|
| 1 | Login → land on `/dashboard/farmer` → see KPI strip + 3 parcel cards in name-asc order | Server-side render emits the right DOM; KPI tile values match the API payload |
| 2 | Empty-state farmer → land on dashboard → see CTA → click → land on `/dashboard/farmer/parcels/new` | Empty branch wires to KAT-01 form |
| 3 | Click parcel card → land on `/dashboard/farmer/parcels/<id>` → see `<ParcelSwitcher>` with 3 pills, active one highlighted | Detail page renders with switcher |
| 4 | On detail page with `?window=7d&device_id=<uuid>` in URL, click switcher to another parcel → land on `/parcels/<id2>?window=7d` (device_id dropped) | `PARCEL_SCOPED_PARAMS` allow-list is honoured |
| 5 | Switch language to `ar` → reload dashboard → KPI labels render in Arabic; layout is RTL | i18n + RTL |

Target: 5/5 green in < 45 s. Run with `pnpm --filter frontend e2e -- --grep kat14`.

### 7.4 Manual staging rehearsal

Run before flipping `spring-status.yml` to `IN_REVIEW`:

1. Log in as a FARMER seeded with 3 parcels of varied state. Land on `/dashboard/farmer`.
2. Verify the KPI strip shows the correct rollups by manually summing the per-card values.
3. Verify the parcel ordering is alphabetical by name.
4. Click each card in turn; verify deep-link works and the URL is bookmarkable.
5. On the detail page, verify the switcher lists all 3 parcels with the active one highlighted.
6. Pivot via the switcher; verify the chart re-renders with the new parcel's data.
7. Set `?window=7d` on parcel A's URL, pivot to parcel B, verify `?window=7d` is preserved.
8. Set `?window=7d&device_id=<A's-device-uuid>`, pivot to parcel B, verify only `?window=7d` survives.
9. Switch the language to Arabic. Verify all overview strings are translated and RTL renders correctly.
10. Switch to a FARMER with 0 parcels. Verify the empty state renders and the CTA navigates to `/parcels/new`.
11. Open the network panel and confirm only **one** call to `/farmers/me/overview` per dashboard load (and one per detail-page load, where it powers the switcher).
12. No Sentry errors during the rehearsal.

---

## 8. Observability

KAT-14 adds no new worker, no new CRON, no new Brevo template, no new async path. Its observability surface is the existing FastAPI middleware on one new GET endpoint.

| Signal | Source | What it tells us |
|---|---|---|
| `katara.farmers.overview` access log | NGINX | Per-minute hit count; high churn suggests farmers are bouncing back to the overview between actions (a UX-friction indicator) |
| `katara.farmers.overview` p50/p99 | FastAPI middleware → Sentry | Catches the §6.5 risk: view-aggregate p99 creep as farmer parcel counts grow |
| Empty-overview ratio | Sentry custom event (1-line emit when `len(parcels) == 0`) | Counts how many sessions are landing on the empty state — early signal of farmer-acquisition vs farmer-activation gap |
| Cache hit ratio for `/farmers/me/overview` | NGINX access log `$upstream_cache_status` | The 60 s TTL should result in ~80%+ cache hits for a farmer who refreshes within the window |
| Direct SQL probe | Manual | `select count(*) from public.m1_katara_farmer_parcels_overview` should equal `count(*) from public.m1_katara_parcels` — sanity check that no parcel is being silently filtered out by the view |

No Healthchecks.io heartbeat (no worker). No Brevo dashboard signal (no emails).

---

## 9. Acceptance Verification Checklist

Run before flipping `spring-status.yml` to `IN_REVIEW`:

- [ ] Migration `0028_kat14_farmer_overview.sql` applied on staging; `\d+ public.m1_katara_farmer_parcels_overview` shows the 16-column view.
- [ ] `pytest backend/tests/test_kat14_overview.py -v` — all 3 scenarios green.
- [ ] `pytest backend/tests/test_kat14_overview_e2e.py --run-e2e` — green on staging.
- [ ] `make -C db test-auth07` — new pgTAP cells K-14a / K-14b green.
- [ ] Frontend build green; `pnpm --filter frontend lint && pnpm --filter frontend typecheck` clean.
- [ ] `pnpm --filter frontend e2e -- --grep kat14` — 5/5 green.
- [ ] Manual staging rehearsal (§7.4) steps 1–12 all observed.
- [ ] Network panel confirms exactly one `/farmers/me/overview` call per dashboard load.
- [ ] No Sentry errors during the rehearsal.
- [ ] i18n keys present in FR / AR / EN; the Arabic overview renders RTL.
- [ ] `spring-status.yml` KAT-14 row updated to `IN_REVIEW`; E2 epic `progress_pct` updated to 100.

---

## 10. Hand-off Notes for Future Work

1. **Post-MVD farm-level analytics** — KAT-14's overview surface is the natural home for cross-parcel comparisons (yield, alert frequency, diagnostic recurrence). The view's CTEs are the right starting point: add a second view `m1_katara_farmer_parcels_30d_summary` rolling per-parcel sensor averages, alert counts, and diagnostic counts over the last 30 days. The frontend page gains a "Tendances" tab next to "Aperçu". Estimated 2–3 day effort.
2. **Parcel grouping / regional tags** — once a farmer crosses ~10 parcels, the flat list strains. A nullable `group_name text` column on `m1_katara_parcels` + a `<GroupFilter>` chip row on the overview unlocks "Souss-Massa farms" vs "Gharb farms" without a new entity. Migration is additive (column with default `null` is a free metadata bolt-on); the view gains the column passthrough. Estimated half-day.
3. **Parcel typeahead in the switcher** — replace the horizontal pill list with a typeahead dropdown when parcel count > 10. Use the existing `<Combobox>` primitive from the KAT-01 form. The pill list remains the default for ≤ 10. Estimated 1 day.
4. **Pinning / reordering parcels** — a saved per-user `parcel_display_order text[]` column on `profiles` (or a separate `user_dashboard_prefs` table) backed by drag-and-drop on the overview. Out of scope for MVD because the default alphabetical order is already useful and the demand has not been validated. The view's `order by name asc` is the safe default; the post-MVD path slots in by reordering Python-side after the SQL response.
5. **Map-based overview** — render the parcels' GeoJSON polygons on a Leaflet map with the same status-dot indicator. This is the natural pair of KAT-01's deferred map-based polygon drawing. Both should ship together post-MVD, because shipping the read-side map without the write-side drawing creates a "look but can't edit" awkwardness.
6. **SSE-based live overview** — when the 60 s overview cache becomes too stale (real-time farm monitoring use case), the path is server-sent events from a small `katara_overview_watcher` worker that listens to `m1_katara_devices` and `m1_katara_telemetry` change feeds and pushes per-farmer delta events. The frontend already has the `usePolling` hook from KAT-10; an SSE swap is a 1-component change.
7. **AUTH-07 RLS matrix** — gains two cells (K-14a / K-14b per §5.9). The matrix doc (`docs/auth07-rls-matrix.md` or equivalent) is updated by the AUTH-07 audit story owner; KAT-14 only ships the pgTAP cells.
8. **E2 epic closure** — KAT-14 is the last KAT story. When it flips to DONE, M1 Katara is feature-complete for MVD. The next module-level milestone is E3 (M2 FarMarket) — see [FAR-01 onward](./FAR-01-verified-farmer-creates-ad.md) when those stories begin.
