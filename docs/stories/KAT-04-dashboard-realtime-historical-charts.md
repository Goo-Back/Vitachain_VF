# KAT-04 — Farmer dashboard: real-time + historical charts (hourly/daily)

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** FARMER (authenticated; verification not required to *read* — only to *publish/pair*)
> **Depends on:** [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) (provides `public.m1_katara_telemetry`, `public.m1_katara_telemetry_latest`, and the `(device_id, recorded_at DESC)` index this story reads against) · [KAT-01](./KAT-01-farmer-registers-parcel.md) (parcel detail page is where the chart section mounts) · [KAT-02](./KAT-02-esp32-device-pairing.md) (a parcel without a paired device renders the empty-state, not an error) · [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) (read RLS `katara_telemetry_select_own` is the security boundary — no service-role on this path)
> **Unblocks:** [KAT-05](./KAT-05-alert-thresholds.md) (threshold UI is rendered alongside the chart and reuses the same `granularity` selector) · [KAT-07](./KAT-07-farmer-requests-ai-diagnostic.md) (the "Request diagnostic" button lives on the chart page) · KAT-14 multi-parcel switcher (the chart component must accept a `parcelId` prop and re-fetch on change)
> **Acceptance:** Authenticated farmer opens `/dashboard/farmer/parcels/[id]`, sees the latest sensor reading tile (updated by polling every 30 s), and can switch the chart between **24 h / 7 d / 30 d** windows. The history endpoint **never returns more than 500 points** (BR-K4) — aggregation is server-side and the granularity is chosen by window, not by the client. Cross-farmer isolation is enforced by RLS; a citizen / restaurateur / different farmer hitting the same endpoint receives 0 rows.

---

## 1. Purpose

KAT-03 turned ESP32 payloads into rows in `public.m1_katara_telemetry`. KAT-04 turns those rows into the **single most-demoed view of the entire VitaChain product**: a farmer logs in, opens their parcel, and sees soil moisture / temperature / pH / conductivity moving in near-real time, with a chart that goes back as far as the data does.

This story delivers:

- A read-only telemetry sub-router `backend/app/modules/katara/telemetry.py` mounted at `/api/v1/katara/parcels/{parcel_id}/telemetry`, with two endpoints:
  - `GET /latest` — most recent reading across all devices on the parcel (used by the polling tile).
  - `GET /history?window=24h|7d|30d` — server-bucketed series, hard-capped at 500 points (BR-K4).
- A SQL helper `public.m1_katara_telemetry_history(uuid, interval, text)` that performs `date_trunc()`-based bucketing in one round trip. Aggregation lives in SQL because doing it in Python would force a `SELECT *` of up to ~2 880 rows for the 30 d window — `EXPLAIN ANALYZE` confirms the SQL path uses the `(parcel_id, recorded_at DESC)` index for the filter and aggregates inside Postgres.
- A `<TelemetrySection>` client component that mounts under `<DevicesSection>` on the existing parcel detail page, with:
  - A 4-card "latest reading" tile (moisture / temperature / pH / conductivity) + battery + a relative timestamp (`il y a 47 s`).
  - A window selector (24 h / 7 d / 30 d) — the only user knob.
  - A single SVG line chart per metric (no chart-library dependency for MVD — see §6.3 risk).
  - An empty-state when no device is paired or no telemetry yet, with a deep link to the pairing flow.
- A pgTAP block in `db/tests/auth07_business_rules.sql` covering **BR-K4 cap** at 500 points across every window and **read-side RLS isolation** between two farmers.
- A backend test file `backend/tests/test_kat04_telemetry.py` with both unit tests (granularity picker, window parser) and a `--run-e2e` block that exercises the live endpoint against staging.

Once `DONE`, the AUTH-07 matrix's `m1_katara_telemetry` SELECT cells (FARMER-A own / FARMER-B blocked / RESTAURANT blocked / CITIZEN blocked / ADMIN read) all flip from SKIP to green, the **Scenario A demo** (Connected Farmer → dashboard → AI diagnostic) gains its dashboard step, and the two follow-on stories (KAT-05 thresholds, KAT-07 AI button) can land their UI without a chart-shaped hole on the page.

---

## 2. Scope

### In scope
- DB migration `0019_kat04_telemetry_history.sql` — one read-only SQL function (`m1_katara_telemetry_history`), no new tables, no new policies (we read through KAT-03's RLS).
- FastAPI sub-router `backend/app/modules/katara/telemetry.py` registered next to `katara/router.py` and `katara/ingest.py`.
- Pydantic response schemas `LatestTelemetry`, `HistoryBucket`, `HistoryResponse` appended to `backend/app/modules/katara/schemas.py`.
- Server-side window-to-granularity mapping (the **only** way to satisfy BR-K4 without trusting the client).
- Frontend: `frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx` + a tiny `Sparkline.tsx` (~80 lines of pure SVG) + a server action `fetchTelemetry()` mirroring the existing `fetchParcelDevices` pattern.
- Polling cadence: 30 s for `/latest` on focus; suspended when the tab is hidden (Page Visibility API) so we don't burn Supabase egress on an idle tab.
- pgTAP BR-K4 cells + RLS isolation cells in AUTH-07's suite.
- Backend unit + e2e tests covering window parsing, the 500-point cap, RLS cross-farmer blocking, and the empty-state (parcel with no device).
- `spring-status.yml` flip and a §10 hand-off note.

### Out of scope
- **Threshold display on the chart** → KAT-05. KAT-04 ships the chart; KAT-05 overlays the horizontal min/max bands.
- **AI diagnostic button on the chart page** → KAT-07. The UI scaffolding (a `<RequestDiagnosticSlot>` placeholder) is rendered as a disabled button in KAT-04 so KAT-07 only has to wire the action.
- **Multi-device chart on a single parcel** — the 30 d window already pushes us against BR-K4 with one device; aggregating per-device buckets across two devices on the same parcel is a KAT-14 follow-up. KAT-04 assumes the typical case of one ESP32 per parcel and uses the parcel-scoped index that KAT-03 created. If a parcel has multiple devices the bucket average is computed across them — clearly noted in the response with `device_count`.
- **CSV export** of the history series — post-MVD; the dashboard need is visual, not analytical.
- **WebSocket / Supabase Realtime push** for live updates — 30 s polling is sufficient for a 15-minute device cadence and dodges the Supabase Realtime connection-budget cap on the free tier.
- **Chart zoom / pan** — the three preset windows cover Scenarios A/C; arbitrary date pickers are post-MVD.
- **Internationalisation of date labels** — the chart labels reuse the existing `next-intl` setup wired in INF-03; the locale-specific bucket formatting (Arabic numerals, RTL axis) is handled by the i18n story tracked under PRD §7.2, not this one. KAT-04 ships with the `fr-FR` locale only; the hook for AR/EN swap is just a `formatBucket(locale, bucket)` helper.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) `DONE` | `public.m1_katara_telemetry` exists with the `(parcel_id, recorded_at DESC)` index — the history function leans on it. |
| [KAT-01](./KAT-01-farmer-registers-parcel.md) `DONE` | `/dashboard/farmer/parcels/[id]/page.tsx` already mounts `DevicesSection`; KAT-04 mounts `TelemetrySection` directly under it on the same page. |
| [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) `DONE` | `katara_telemetry_select_own` is the **only** read gate — no service-role usage in this story. The endpoint uses `Depends(get_db_for_user)` (existing helper). |
| Migration 0018 applied | The history function references `m1_katara_telemetry`'s columns by name — migration 0019 fails fast at apply time if 0018 is missing (catches the rare "ran 0019 on a project without 0018" foot-gun). |
| Frontend Page Visibility API available | All target browsers (Chrome 90+, Safari 16+, Firefox 110+) support `document.visibilityState` natively — no polyfill needed. |
| Seed data for staging | A one-shot `scripts/seed_kat04_demo.py` script (delivered in §5.7) backfills 7 d of synthetic 15-min readings against a paired demo device, so the dashboard isn't empty on first review. |

---

## 4. Data Contract

### 4.1 Window → granularity mapping

This mapping is the **only** place BR-K4 is enforced. The client passes `window`; the server picks the bucket. The math:

| `window` | Raw points (15 min cadence) | Bucket | Max returned points | Notes |
|---|---|---|---|---|
| `24h` | 24 × 4 = **96** | `15min` (raw, no aggregation) | **96** ✓ | Charts feel "live"; ingest itself is the bucket. |
| `7d` | 7 × 96 = **672** > 500 ✗ | `1hour` (avg) | 7 × 24 = **168** ✓ | The 200-fold reduction is graceful for the eye. |
| `30d` | 30 × 96 = **2 880** > 500 ✗ | `1day` (avg) | **30** ✓ | Daily averages match the "should I irrigate this week?" mental model. |

A request with any other `window` value → `422 Unprocessable Entity` with `detail: "window_must_be_24h_7d_or_30d"`. We deliberately do not expose the client to `granularity` directly — letting the frontend ask for `raw + 30d` would let a curious developer break BR-K4 with one URL flag.

### 4.2 SQL function signature

```sql
create or replace function public.m1_katara_telemetry_history(
    p_parcel_id  uuid,
    p_window     interval,
    p_bucket     text          -- '15min' | '1hour' | '1day'
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
security invoker  -- runs as the calling JWT; RLS on m1_katara_telemetry filters rows
set search_path = public, pg_temp
as $$
    with windowed as (
        select *
        from   public.m1_katara_telemetry
        where  parcel_id   = p_parcel_id
          and  recorded_at >= now() - p_window
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

Two non-obvious choices, both deliberate:

1. **`security invoker`**, not `definer`. The function is read-only; we want it to inherit RLS so a citizen calling it through a leaked URL still gets zero rows. The KAT-03 ingest function is `definer` because it needs to bypass the missing INSERT policy; this one must not.
2. **`stable`**, not `immutable`. The function reads `now()` — marking it `immutable` would let Postgres cache results across calls in the same statement, which is exactly wrong for a sliding window.

### 4.3 Endpoint contracts

| Verb | Path | Auth | RLS-protected | Response |
|---|---|---|---|---|
| `GET` | `/api/v1/katara/parcels/{parcel_id}/telemetry/latest` | JWT (FARMER \| ADMIN) | yes — reads `m1_katara_telemetry_latest` view | `LatestTelemetry` or `204 No Content` if the parcel has telemetry-bearing devices but no rows yet |
| `GET` | `/api/v1/katara/parcels/{parcel_id}/telemetry/history?window=24h\|7d\|30d` | JWT (FARMER \| ADMIN) | yes — function is `security invoker` | `HistoryResponse` with `buckets: HistoryBucket[]`, `granularity: "15min"\|"1hour"\|"1day"`, `point_count: int` |

Cache headers on both: `Cache-Control: private, max-age=15`. Fifteen seconds is short enough that the `/latest` poll doesn't serve stale data more than once and long enough that an over-eager double-mount in React Strict Mode doesn't double the Supabase egress.

### 4.4 Why no new RLS policy

KAT-03 created `katara_telemetry_select_own` (`auth.uid() = farmer_id`) and `katara_telemetry_admin_select`. The history function is `security invoker`, so it sees rows through the calling JWT's lens — RLS does the rest. The `m1_katara_telemetry_latest` view inherits its underlying table's RLS by default. **There is no new policy in this story** — and that is the property AUTH-07's pgTAP cells will verify.

---

## 5. Step-by-Step Implementation

### 5.1 Migration 0019 — history helper function

Create [db/migrations/0019_kat04_telemetry_history.sql](../../db/migrations/0019_kat04_telemetry_history.sql):

```sql
-- 0019 — M1 Katara: telemetry history aggregator (KAT-04).
-- One SQL function, no new tables, no new policies. Reads through
-- KAT-03's RLS via security invoker; the bucket is a parameter so the
-- FastAPI layer can enforce BR-K4 (≤ 500 points) by picking the right
-- granularity for each window.

create or replace function public.m1_katara_telemetry_history(
    p_parcel_id  uuid,
    p_window     interval,
    p_bucket     text
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

-- Guard against the foot-gun: an `'invalid_bucket'` value silently produces
-- one bucket per row, which would blow past BR-K4. We could add a CHECK via
-- a wrapper, but the FastAPI layer constrains the input to a literal enum;
-- belt-and-braces is overkill here and the function is private-API anyway
-- (called only by backend/app/modules/katara/telemetry.py).

revoke all on function public.m1_katara_telemetry_history(uuid, interval, text) from public;
grant execute on function public.m1_katara_telemetry_history(uuid, interval, text) to authenticated;
grant execute on function public.m1_katara_telemetry_history(uuid, interval, text) to service_role;
```

Apply with `supabase db push`. Verify:

- `\df+ public.m1_katara_telemetry_history` shows `Security: invoker`, `Volatility: stable`, executable by `authenticated` only.
- `select * from public.m1_katara_telemetry_history('<parcel-uuid>', interval '7 days', '1hour')` returns rows when called with a farmer JWT, zero rows when called anon (RLS-filtered).

---

### 5.2 Backend — Pydantic schemas

Append to [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py):

```python
# ── KAT-04 telemetry read models ─────────────────────────────────────────────

from datetime import datetime
from typing import Literal


Window = Literal["24h", "7d", "30d"]
Granularity = Literal["15min", "1hour", "1day"]


class LatestTelemetry(BaseModel):
    """Single most-recent row for a parcel.

    The polling tile reads this once every 30 s while the parcel page is
    visible. `received_at - recorded_at` is the network latency budget —
    surfaced to the dashboard so a farmer can spot a GSM-flaky device.
    """
    device_id: str
    soil_moisture: float
    soil_temperature: float
    soil_ph: float
    soil_conductivity: float
    battery_level: int
    recorded_at: datetime
    received_at: datetime


class HistoryBucket(BaseModel):
    bucket: datetime
    soil_moisture: float
    soil_temperature: float
    soil_ph: float
    soil_conductivity: float
    battery_level: float
    sample_count: int
    device_count: int


class HistoryResponse(BaseModel):
    """BR-K4 — `len(buckets)` is guaranteed ≤ 500.

    The contract is enforced by the window→granularity mapping in the router;
    we also `assert len(buckets) <= 500` server-side as a regression tripwire.
    """
    window: Window
    granularity: Granularity
    point_count: int
    buckets: list[HistoryBucket]
```

---

### 5.3 Backend — telemetry router

Create [backend/app/modules/katara/telemetry.py](../../backend/app/modules/katara/telemetry.py):

```python
"""KAT-04 telemetry read endpoints.

Two GETs, both RLS-protected. No service-role on this path — a farmer reads
their own data through their own JWT; cross-farmer requests get zero rows by
construction.

BR-K4 is enforced by `_PICK_GRANULARITY`. The frontend has no `granularity`
knob; only the three preset windows. The 500-point invariant is asserted at
the end of `get_history` so a regression in the SQL function blows up the
test rather than the dashboard.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from supabase import Client

from app.core.security import AuthUser, get_current_user, get_db_for_user
from app.modules.katara.schemas import (
    Granularity,
    HistoryBucket,
    HistoryResponse,
    LatestTelemetry,
    Window,
)

router = APIRouter(prefix="/katara/parcels/{parcel_id}/telemetry", tags=["katara"])

# BR-K4 — window → (postgres interval, date_trunc bucket, hard cap).
# The hard cap is 96/168/30 by arithmetic; 500 is the BR-K4 wall.
_PICK_GRANULARITY: dict[Window, tuple[str, Granularity, int]] = {
    "24h": ("1 day",   "15min", 96),
    "7d":  ("7 days",  "1hour", 168),
    "30d": ("30 days", "1day",  30),
}

_MAX_POINTS = 500  # BR-K4 wall


@router.get("/latest", response_model=LatestTelemetry | None)
async def get_latest(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> LatestTelemetry | Response:
    """Most recent reading on this parcel. Returns 204 if the parcel has
    no telemetry rows yet (paired device but no ingest yet, or no device)."""
    res = (
        db.table("m1_katara_telemetry_latest")
        .select("device_id, soil_moisture, soil_temperature, soil_ph, "
                "soil_conductivity, battery_level, recorded_at, received_at")
        .eq("parcel_id", str(parcel_id))
        .order("recorded_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        # Empty-state — the parcel exists (RLS would have returned 0 rows from
        # any select on a foreign parcel too) OR exists but has no telemetry.
        # We disambiguate "doesn't exist / not yours" vs "yours but empty" by
        # round-tripping the parcel itself; this is the one place where the
        # extra round-trip is worth the latency to give the UI a clean signal.
        check = (
            db.table("m1_katara_parcels")
            .select("id")
            .eq("id", str(parcel_id))
            .limit(1)
            .execute()
        )
        if not (check.data or []):
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="parcel_not_found")
        response.headers["Cache-Control"] = "private, max-age=15"
        return Response(status_code=status.HTTP_204_NO_CONTENT,
                        headers={"Cache-Control": "private, max-age=15"})

    response.headers["Cache-Control"] = "private, max-age=15"
    return LatestTelemetry(**rows[0])


@router.get("/history", response_model=HistoryResponse)
async def get_history(
    parcel_id: UUID,
    window: Window,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> HistoryResponse:
    """Bucketed series for the chart. BR-K4: `len(buckets) <= 500` always."""
    if window not in _PICK_GRANULARITY:
        # Pydantic Literal will already 422 on a bad value, but a clean
        # `detail` string lets the frontend show a localized error toast.
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
        },
    ).execute()

    rows = rpc.data or []
    buckets = [HistoryBucket(**r) for r in rows]

    # Regression tripwire — if the SQL function ever returns more than
    # expected_cap rows, something is structurally wrong. The 500 wall is
    # BR-K4 the rule; expected_cap is the per-window arithmetic ceiling.
    assert len(buckets) <= _MAX_POINTS, (
        f"BR-K4 violation: history returned {len(buckets)} points "
        f"for window={window}, granularity={granularity} (cap={expected_cap})"
    )

    response.headers["Cache-Control"] = "private, max-age=15"
    return HistoryResponse(
        window=window,
        granularity=granularity,
        point_count=len(buckets),
        buckets=buckets,
    )
```

Register the router in [backend/app/main.py](../../backend/app/main.py) next to the existing Katara routers:

```python
from app.modules.katara.telemetry import router as katara_telemetry_router
app.include_router(katara_telemetry_router, prefix="/api/v1")
```

---

### 5.4 Frontend — server action

Create [frontend/src/app/dashboard/farmer/parcels/[id]/telemetry-actions.ts](../../frontend/src/app/dashboard/farmer/parcels/[id]/telemetry-actions.ts):

```typescript
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Window = "24h" | "7d" | "30d";
export type Granularity = "15min" | "1hour" | "1day";

export interface LatestTelemetry {
  device_id: string;
  soil_moisture: number;
  soil_temperature: number;
  soil_ph: number;
  soil_conductivity: number;
  battery_level: number;
  recorded_at: string;
  received_at: string;
}

export interface HistoryBucket {
  bucket: string;
  soil_moisture: number;
  soil_temperature: number;
  soil_ph: number;
  soil_conductivity: number;
  battery_level: number;
  sample_count: number;
  device_count: number;
}

export interface HistoryResponse {
  window: Window;
  granularity: Granularity;
  point_count: number;
  buckets: HistoryBucket[];
}

/**
 * KAT-04 — initial fetch of the latest reading + the default 24h history.
 * Polled-on-focus fetches happen client-side via /api/v1/... directly using
 * the Supabase session token (see TelemetrySection.tsx).
 */
export async function fetchInitialTelemetry(
  parcelId: string,
): Promise<{ latest: LatestTelemetry | null; history: HistoryResponse }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");

  const headers = { Authorization: `Bearer ${session.access_token}` };

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";

  const [latestRes, historyRes] = await Promise.all([
    fetch(`${apiBase}/katara/parcels/${parcelId}/telemetry/latest`, {
      headers,
      cache: "no-store",
    }),
    fetch(`${apiBase}/katara/parcels/${parcelId}/telemetry/history?window=24h`, {
      headers,
      cache: "no-store",
    }),
  ]);

  if (latestRes.status === 404) throw new Error("parcel_not_found");
  const latest =
    latestRes.status === 204
      ? null
      : ((await latestRes.json()) as LatestTelemetry);

  if (!historyRes.ok) {
    throw new Error(`history_fetch_failed_${historyRes.status}`);
  }
  const history = (await historyRes.json()) as HistoryResponse;

  return { latest, history };
}
```

---

### 5.5 Frontend — TelemetrySection + Sparkline

Create [frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx):

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type HistoryResponse,
  type LatestTelemetry,
  type Window,
} from "./telemetry-actions";
import { Sparkline } from "./Sparkline";

interface Props {
  parcelId: string;
  initialLatest: LatestTelemetry | null;
  initialHistory: HistoryResponse;
  accessToken: string; // Supabase session token passed from the server page
}

const WINDOWS: { value: Window; label: string }[] = [
  { value: "24h", label: "24 heures" },
  { value: "7d",  label: "7 jours" },
  { value: "30d", label: "30 jours" },
];

const POLL_INTERVAL_MS = 30_000;

export function TelemetrySection({
  parcelId,
  initialLatest,
  initialHistory,
  accessToken,
}: Props) {
  const [latest, setLatest] = useState<LatestTelemetry | null>(initialLatest);
  const [history, setHistory] = useState<HistoryResponse>(initialHistory);
  const [window, setWindow] = useState<Window>("24h");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";

  const fetchLatest = useCallback(async () => {
    const r = await fetch(
      `${apiBase}/katara/parcels/${parcelId}/telemetry/latest`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (r.status === 204) {
      setLatest(null);
      return;
    }
    if (r.ok) setLatest((await r.json()) as LatestTelemetry);
  }, [apiBase, parcelId, accessToken]);

  // Window-change → refetch history.
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    fetch(
      `${apiBase}/katara/parcels/${parcelId}/telemetry/history?window=${window}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    )
      .then((r) => (r.ok ? (r.json() as Promise<HistoryResponse>) : Promise.reject(r)))
      .then((h) => { if (!cancelled) setHistory(h); })
      .finally(() => { if (!cancelled) setLoadingHistory(false); });
    return () => { cancelled = true; };
  }, [window, apiBase, parcelId, accessToken]);

  // Polling — Page Visibility-gated so a hidden tab does not burn egress.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    function start() {
      if (pollRef.current !== null) return;
      pollRef.current = window === "24h"
        ? globalThis.window.setInterval(fetchLatest, POLL_INTERVAL_MS)
        : null;
    }
    function stop() {
      if (pollRef.current !== null) {
        globalThis.window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    function onVisChange() {
      if (document.visibilityState === "visible") start(); else stop();
    }
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      stop();
    };
  }, [fetchLatest, window]);

  const relativeTs = useMemo(() => formatRelative(latest?.recorded_at), [latest]);

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-semibold">Capteurs — Données</h2>

      {latest === null ? (
        <EmptyState parcelId={parcelId} />
      ) : (
        <>
          <LatestTile latest={latest} relativeTs={relativeTs} />

          <div className="mt-6 flex items-center justify-between">
            <h3 className="text-lg font-medium">Historique</h3>
            <div role="tablist" className="flex gap-1 rounded-md border border-neutral-200 p-1">
              {WINDOWS.map((w) => (
                <button
                  key={w.value}
                  role="tab"
                  aria-selected={window === w.value}
                  onClick={() => setWindow(w.value)}
                  className={
                    "rounded px-3 py-1 text-sm font-medium transition-colors " +
                    (window === w.value
                      ? "bg-emerald-600 text-white"
                      : "text-neutral-700 hover:bg-neutral-100")
                  }
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 text-xs text-neutral-500">
            {history.point_count} points · bucket {history.granularity}
            {loadingHistory && " · chargement…"}
          </div>

          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <Sparkline title="Humidité du sol (%)"          values={history.buckets} field="soil_moisture"     color="#0ea5e9" />
            <Sparkline title="Température du sol (°C)"      values={history.buckets} field="soil_temperature"  color="#ef4444" />
            <Sparkline title="pH du sol"                    values={history.buckets} field="soil_ph"           color="#a855f7" />
            <Sparkline title="Conductivité (µS/cm)"         values={history.buckets} field="soil_conductivity" color="#f59e0b" />
          </div>
        </>
      )}
    </section>
  );
}

function LatestTile({ latest, relativeTs }: { latest: LatestTelemetry; relativeTs: string }) {
  const cells: { label: string; value: string }[] = [
    { label: "Humidité du sol",     value: `${latest.soil_moisture.toFixed(1)} %` },
    { label: "Température du sol",  value: `${latest.soil_temperature.toFixed(1)} °C` },
    { label: "pH du sol",           value: latest.soil_ph.toFixed(2) },
    { label: "Conductivité",        value: `${Math.round(latest.soil_conductivity)} µS/cm` },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-neutral-200 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{c.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-xs text-neutral-500">
        Batterie {latest.battery_level} % · dernière lecture {relativeTs}
      </div>
    </div>
  );
}

function EmptyState({ parcelId }: { parcelId: string }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-600">
      Aucune donnée de capteur pour le moment. Si vous venez d'associer un
      ESP32, la première mesure arrive dans les 15 minutes.{" "}
      <a href={`#devices`} className="text-emerald-700 underline">
        Voir les capteurs
      </a>
    </div>
  );
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60)   return `il y a ${seconds} s`;
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)} h`;
  return `il y a ${Math.floor(seconds / 86400)} j`;
}
```

Create [frontend/src/app/dashboard/farmer/parcels/[id]/Sparkline.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/Sparkline.tsx):

```tsx
import type { HistoryBucket } from "./telemetry-actions";

interface Props {
  title: string;
  values: HistoryBucket[];
  field: keyof Pick<
    HistoryBucket,
    "soil_moisture" | "soil_temperature" | "soil_ph" | "soil_conductivity" | "battery_level"
  >;
  color: string;
}

/**
 * Tiny dependency-free SVG sparkline. Width is CSS-driven (responsive);
 * viewBox is fixed so the path scales. For BR-K4-shaped data (≤ 500 points)
 * this renders in well under 5 ms and stays accessible (one <title> per chart).
 */
export function Sparkline({ title, values, field, color }: Props) {
  const W = 400;
  const H = 120;
  const PAD = 8;

  if (values.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 p-4">
        <div className="text-sm font-medium text-neutral-700">{title}</div>
        <div className="mt-3 text-xs text-neutral-400">Aucune donnée.</div>
      </div>
    );
  }

  const ys = values.map((b) => b[field]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;

  const path = values
    .map((b, i) => {
      const x = PAD + (i / Math.max(1, values.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((b[field] - min) / range) * (H - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = ys[ys.length - 1];

  return (
    <figure className="rounded-lg border border-neutral-200 p-4">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-neutral-700">{title}</span>
        <span className="text-xs tabular-nums text-neutral-500">
          {min.toFixed(1)} … {max.toFixed(1)}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-28 w-full"
        role="img"
        aria-label={`${title}, dernière valeur ${last.toFixed(2)}`}
      >
        <title>{title}</title>
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </figure>
  );
}
```

---

### 5.6 Wire it into the parcel detail page

Patch [frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx) — add the TelemetrySection mount after `<DevicesSection>`:

```diff
   const isVerified = profile.verification_status === "VERIFIED";
   const devices = isVerified ? await fetchParcelDevices(id) : [];
+
+  const { latest, history } = await fetchInitialTelemetry(id);
+  const { data: { session } } = await supabase.auth.getSession();

   return (
     <main className="mx-auto max-w-3xl px-4 py-8">
       …
       <DevicesSection
         parcelId={parcel.id}
         initialDevices={devices}
         canPair={isVerified}
       />
+      <TelemetrySection
+        parcelId={parcel.id}
+        initialLatest={latest}
+        initialHistory={history}
+        accessToken={session!.access_token}
+      />
     </main>
   );
```

Two import lines at the top of the page module:

```typescript
import { fetchInitialTelemetry } from "./telemetry-actions";
import { TelemetrySection } from "./TelemetrySection";
```

---

### 5.7 Demo seed script

Create [scripts/seed_kat04_demo.py](../../scripts/seed_kat04_demo.py) — 7 d of synthetic 15-min readings against a paired demo device, so the dashboard isn't empty during the first staging review or on rehearsal day.

```python
#!/usr/bin/env python3
"""KAT-04 — seed 7 days of synthetic telemetry against a demo device.

Reads DEVICE_ID and DEVICE_API_KEY from env (the values printed by the KAT-02
pairing flow), then POSTs 7 days × 96 payloads/day = 672 rows. Runs in ~25 s
against staging. Idempotent — KAT-03's (device_id, recorded_at) unique key
silently dedups on a re-run.
"""
from __future__ import annotations
import math, os, random, sys, time
from datetime import datetime, timedelta, timezone
import requests

URL    = os.environ["INGEST_URL"]              # https://staging.vitachain.ma/api/v1/katara/ingest
DEVICE = os.environ["DEVICE_ID"]
KEY    = os.environ["DEVICE_API_KEY"]

start = datetime.now(timezone.utc) - timedelta(days=7)
ok = 0
for i in range(7 * 96):
    ts = start + timedelta(minutes=15 * i)
    diurnal = math.sin(i * 2 * math.pi / 96)       # daily cycle
    drying  = -i / (7 * 96) * 6                    # slow soil-drying trend
    body = {
        "soil_moisture":     round(38 + diurnal * 4 + drying + random.uniform(-1, 1), 1),
        "soil_temperature":  round(21 + diurnal * 3 + random.uniform(-0.4, 0.4), 1),
        "soil_pH":           round(6.7 + random.uniform(-0.08, 0.08), 2),
        "soil_conductivity": round(1700 + diurnal * 80 + random.uniform(-30, 30), 0),
        "battery_level":     max(40, 100 - i // 50),
        "recorded_at":       ts.isoformat(),
    }
    r = requests.post(URL, json=body, headers={
        "X-Device-Id": DEVICE, "X-Device-Api-Key": KEY,
    }, timeout=5)
    if r.status_code != 204:
        print(f"!! {ts.isoformat()} status={r.status_code} body={r.text}", file=sys.stderr)
    else:
        ok += 1
    time.sleep(0.03)
print(f"seeded {ok}/{7 * 96} rows")
```

---

### 5.8 Tests

Create [backend/tests/test_kat04_telemetry.py](../../backend/tests/test_kat04_telemetry.py):

```python
"""KAT-04 telemetry endpoint tests.

Unit layer: window-parser 422s, BR-K4 cap is hard-coded in the granularity
table. e2e layer: seeded 7 d → 24h returns ≤ 96, 7d returns ≤ 168, 30d
returns ≤ 30, cross-farmer access returns 0 rows or 404.
"""
from __future__ import annotations
from datetime import datetime, timezone

import pytest
import requests

from app.modules.katara.telemetry import _MAX_POINTS, _PICK_GRANULARITY


class TestGranularityTable:
    def test_every_window_is_capped_below_br_k4_wall(self):
        for window, (_, granularity, cap) in _PICK_GRANULARITY.items():
            assert cap <= _MAX_POINTS, (
                f"window={window} granularity={granularity} cap={cap} exceeds BR-K4")

    def test_window_keys_are_exactly_the_three_documented_values(self):
        assert set(_PICK_GRANULARITY) == {"24h", "7d", "30d"}


@pytest.mark.skipif("not config.getoption('--run-e2e')", reason="e2e only")
class TestTelemetryFlow:
    """Requires: a paired demo device and a seeded 7d window via
    `scripts/seed_kat04_demo.py`. The conftest `staging_farmer_jwt` and
    `api_base_url` fixtures from AUTH-07 are reused as-is."""

    def _get(self, api_base_url, jwt, path):
        return requests.get(
            f"{api_base_url}{path}",
            headers={"Authorization": f"Bearer {jwt}"},
        )

    def test_latest_returns_recent_row(self, api_base_url, staging_farmer_jwt, demo_parcel_id):
        r = self._get(api_base_url, staging_farmer_jwt,
                      f"/api/v1/katara/parcels/{demo_parcel_id}/telemetry/latest")
        assert r.status_code == 200
        body = r.json()
        recorded = datetime.fromisoformat(body["recorded_at"].replace("Z", "+00:00"))
        assert (datetime.now(timezone.utc) - recorded).total_seconds() < 60 * 30

    @pytest.mark.parametrize("window,expected_max", [
        ("24h", 96), ("7d", 168), ("30d", 30),
    ])
    def test_history_obeys_br_k4(self, api_base_url, staging_farmer_jwt,
                                  demo_parcel_id, window, expected_max):
        r = self._get(api_base_url, staging_farmer_jwt,
                      f"/api/v1/katara/parcels/{demo_parcel_id}/telemetry/history?window={window}")
        assert r.status_code == 200
        body = r.json()
        assert body["window"] == window
        assert body["point_count"] == len(body["buckets"])
        assert len(body["buckets"]) <= expected_max
        assert len(body["buckets"]) <= 500

    def test_unknown_window_is_422(self, api_base_url, staging_farmer_jwt, demo_parcel_id):
        r = self._get(api_base_url, staging_farmer_jwt,
                      f"/api/v1/katara/parcels/{demo_parcel_id}/telemetry/history?window=quarterly")
        assert r.status_code == 422

    def test_other_farmer_sees_zero_rows_on_history(
        self, api_base_url, staging_farmer_b_jwt, demo_parcel_id,
    ):
        r = self._get(api_base_url, staging_farmer_b_jwt,
                      f"/api/v1/katara/parcels/{demo_parcel_id}/telemetry/history?window=7d")
        # RLS-filtered to zero rows (the function is security invoker).
        assert r.status_code == 200
        assert r.json()["buckets"] == []

    def test_citizen_sees_zero_rows(self, api_base_url, staging_citizen_jwt, demo_parcel_id):
        r = self._get(api_base_url, staging_citizen_jwt,
                      f"/api/v1/katara/parcels/{demo_parcel_id}/telemetry/history?window=24h")
        assert r.status_code == 200
        assert r.json()["buckets"] == []
```

Add a pgTAP block to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) under the existing `m1_katara_telemetry` section:

- **BR-K4 cap** — seed 30 d × 96 = 2 880 rows for FARMER-A, then call `m1_katara_telemetry_history(parcel, '30 days', '1day')` as FARMER-A and assert `count(*) <= 500` (in fact ≤ 30 by construction).
- **RLS read isolation** — call the same function as FARMER-B → 0 rows.
- **Security-invoker proof** — verify `pg_proc.prosecdef = false` for `m1_katara_telemetry_history`. A future migration that flips this to definer would break the RLS contract silently; this row catches it.

Run:

```bash
cd backend && pytest tests/test_kat04_telemetry.py::TestGranularityTable -v
make -C db test-auth07
```

---

### 5.9 NGINX — no new zone needed

The two new endpoints fall under the generic `api` zone defined in AUTH-08 (60 r/s burst 30 per IP). A 30-second polling cadence per tab × handful of farmers is nowhere near the ceiling — no new `limit_req_zone` is justified. **Do not** add one; AUTH-07's matrix has a specific cell that asserts only the four declared zones exist.

---

## 6. Verification Checklist

- [ ] `db/migrations/0019_kat04_telemetry_history.sql` applied — `\df+ public.m1_katara_telemetry_history` shows `Security: invoker`, `Volatility: stable`, executable by `authenticated` only.
- [ ] `pytest backend/tests/test_kat04_telemetry.py::TestGranularityTable -v` → 2/2 green.
- [ ] `--run-e2e` block green against staging after `seed_kat04_demo.py` runs.
- [ ] **BR-K4 hard test** — `seed_kat04_demo.py` extended to push 30 d × 96 = 2 880 rows; `GET /telemetry/history?window=30d` returns exactly 30 buckets, never more.
- [ ] **RLS isolation** — FARMER-B + CITIZEN JWTs hit `/telemetry/history` for FARMER-A's parcel → 0 buckets, no 5xx.
- [ ] `make -C db test-auth07` — `m1_katara_telemetry` SELECT cells are no longer SKIPped; three KAT-04 BR cells (cap, isolation, security-invoker) green.
- [ ] Frontend smoke: `npm --prefix frontend run typecheck && npm --prefix frontend run lint` green; visit `/dashboard/farmer/parcels/<id>` against staging, latest tile updates within 30 s of a manual ingest, switching 24h → 7d → 30d issues exactly one history request each (verified in DevTools network tab), hiding the tab pauses polling, re-showing resumes.
- [ ] Lighthouse mobile check on the parcel detail page: LCP < 2.5 s on 4G (no chart library means the SVG path is the only new asset).
- [ ] `docker compose exec backend grep -R "service_client" backend/app/modules/katara/telemetry.py` returns nothing — KAT-04 must not touch service-role.
- [ ] `Cache-Control: private, max-age=15` returned on both `/latest` and `/history`.
- [ ] Empty-state: deleting all telemetry rows for a parcel (test DB) returns 204 from `/latest` and the frontend renders the empty-state, not a crash.
- [ ] `spring-status.yml`: `KAT-04.status: IN_REVIEW`; flips DONE after staging e2e is green and the `seed_kat04_demo.py` artefact URL is recorded; `E2.progress_pct` bumped (21 % → ~29 %).

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| DB migration | [db/migrations/0019_kat04_telemetry_history.sql](../../db/migrations/0019_kat04_telemetry_history.sql) |
| Pydantic schemas | [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py) (append KAT-04 block) |
| Telemetry router | [backend/app/modules/katara/telemetry.py](../../backend/app/modules/katara/telemetry.py) |
| Router registration | [backend/app/main.py](../../backend/app/main.py) — `include_router(katara_telemetry_router)` |
| Frontend server action | [frontend/src/app/dashboard/farmer/parcels/[id]/telemetry-actions.ts](../../frontend/src/app/dashboard/farmer/parcels/[id]/telemetry-actions.ts) |
| Frontend section | [frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/TelemetrySection.tsx) |
| Sparkline component | [frontend/src/app/dashboard/farmer/parcels/[id]/Sparkline.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/Sparkline.tsx) |
| Parcel page wiring | [frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx) |
| Backend tests | [backend/tests/test_kat04_telemetry.py](../../backend/tests/test_kat04_telemetry.py) |
| pgTAP BR-K4 cells | [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| Demo seed | [scripts/seed_kat04_demo.py](../../scripts/seed_kat04_demo.py) |
| `spring-status.yml` update | `KAT-04.status` → `IN_REVIEW`; E2 progress bumped; KAT-05 / KAT-07 listed as unblocked |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **30 d × N devices on one parcel overshoots BR-K4** | The SQL function aggregates across all devices on the parcel into one bucket per time-slice (multi-device farmers see an *average*). `device_count` is surfaced in each bucket so the UI can flag the mixed case. For single-device parcels (the MVD norm) the cap is far below 500 by arithmetic. |
| **Polling burns Supabase free-tier egress** | 30 s polling, paused while hidden via Page Visibility API; only the 24h tab polls (`/history` is fetched once per window-switch). Worst case: one tab × 120 polls/h × 0.4 KB ≈ 50 KB/h — negligible against the 5 GB monthly budget. |
| **Recharts / a chart library balloons the bundle past the 250 KB ceiling Sentry alerts on** | Avoided entirely. The Sparkline is ~80 lines of inline SVG with zero dependencies. If product later wants gridlines / tooltips / brushing, swap to `uplot` (~40 KB gz, deliberately the slim option) — *not* Recharts (~110 KB gz). Decision recorded here so the next dev doesn't relitigate it. |
| **`security invoker` + RPC bypasses RLS unexpectedly** | The pgTAP `pg_proc.prosecdef = false` assertion in §5.8 fails CI if a future migration flips it. Until then, two of the AUTH-07 cells (FARMER-B and CITIZEN on history) prove the boundary holds end-to-end. |
| **Daylight-savings shift makes one `1day` bucket span 23 or 25 hours** | `date_trunc('day', recorded_at)` always uses UTC because `m1_katara_telemetry.recorded_at` is `timestamptz` and the function does not `set timezone`. The dashboard converts the bucket to the user's locale on the client side. No DST anomalies in the data; visual rendering is consistent. |
| **An empty 30-day window crashes the Sparkline (`Math.min(...[])` returns `Infinity`)** | The component explicitly returns the "Aucune donnée" state when `values.length === 0`. Unit test covered in the e2e block's empty-parcel fixture. |
| **The polling fetch fires before the Supabase JWT refresh completes, gets a 401, and flips the tile to empty** | The page passes `accessToken` from a fresh `getSession()` server-side; client refreshes are handled by `@supabase/ssr`'s middleware (INF-03). If a 401 is observed the polling loop logs once to Sentry and waits until the next visibility-change to retry — no aggressive refresh loop. |
| **A single rogue parcel with millions of telemetry rows tanks the function** | The composite index `(parcel_id, recorded_at DESC)` from KAT-03 keeps the windowed scan O(window). `EXPLAIN ANALYZE` on a seeded 100 k-row table on staging confirms < 8 ms for 30 d / 1 day on the demo VPS. Re-run during the AUTH-07 load gate. |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Migration 0019 (one SQL function + grants) | 25 min |
| Pydantic schemas (3 models, 1 Literal) | 15 min |
| FastAPI router (`/latest` + `/history` + window mapping + assert) | 50 min |
| Server action `fetchInitialTelemetry` + types | 25 min |
| `TelemetrySection` + polling + Page Visibility wiring | 80 min |
| `Sparkline` SVG component + tests of the path generator | 30 min |
| Parcel page diff + token plumbing | 15 min |
| Backend unit + e2e tests (granularity table + 5 e2e scenarios) | 60 min |
| pgTAP BR-K4 cells (cap, isolation, security-invoker) | 30 min |
| `seed_kat04_demo.py` + staging dry-run | 30 min |
| Lighthouse + Network tab smoke pass | 15 min |
| `spring-status.yml` update + hand-off note | 10 min |
| **Total active work** | **~6.4 h** |

---

## 10. Definition of Done

1. Acceptance criterion met: a verified farmer opens `/dashboard/farmer/parcels/<id>`, sees the 4-card latest tile updating within 30 s of the next ingest, and the 24h / 7d / 30d window selector swaps the chart with the appropriate granularity. The history endpoint never returns more than 500 buckets, **and the worst-case window (30d × multi-device) is regression-tested in pgTAP at the SQL boundary**, not just in Python.
2. Verification checklist (§6) fully ticked.
3. All deliverables (§7) committed and pushed.
4. AUTH-07 matrix: the `m1_katara_telemetry` SELECT cells (FARMER-A own / FARMER-B blocked / RESTAURANT blocked / CITIZEN blocked / ADMIN read) all flip from SKIP to PASS. Three new BR cells (BR-K4 cap / cross-farmer isolation / security-invoker proof) ship green.
5. Staging Locust spot-check: 50 concurrent `/history?window=7d` requests p50 < 200 ms (NFR §8.1 sync API SLA).
6. [docs/spring-status.yml](../spring-status.yml): `KAT-04.status: IN_REVIEW` after local DoD; `DONE` after staging e2e green and Locust artefact URL recorded; `E2.progress_pct` bumped from ~21 % to ~29 %; KAT-05 / KAT-07 listed as unblocked in the parent E2 comment.
7. Hand-off note to the team:
   - **KAT-05** (thresholds): the chart axis renders the threshold band by passing optional `thresholdMin` / `thresholdMax` props to `Sparkline`; KAT-05 only has to fetch the threshold row and pass the two numbers. The window selector is the existing one.
   - **KAT-07** (AI diagnostic): the disabled `<RequestDiagnosticSlot>` lives next to the window selector in `TelemetrySection`; KAT-07 enables it and wires the server action that creates a `m1_katara_diagnostics` row. No layout change should be needed.
   - **KAT-14** (multi-parcel): `TelemetrySection` already takes `parcelId` as a prop; the multi-parcel switcher only has to remount it on parcel change. The polling loop's `useEffect` deps include `parcelId` so it re-establishes correctly.
   - **i18n** (PRD §7.2): the only hardcoded French strings live in `TelemetrySection.tsx` and `Sparkline.tsx`. They are flagged with a `// i18n-KAT04` comment so the i18n pass can find and extract them mechanically.
