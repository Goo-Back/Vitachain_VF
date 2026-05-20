"""KAT-04 + KAT-13 — telemetry read endpoints.

Three GETs, all RLS-protected. No service-role on this path — a farmer reads
their own data through their own JWT; cross-farmer requests get zero rows by
construction (KAT-03's ``katara_telemetry_select_own`` policy + the SQL
function's ``security invoker`` marker).

BR-K4 is enforced by :data:`_PICK_GRANULARITY`. The frontend has no
``granularity`` knob — only the three preset windows. The 500-point invariant
is asserted at the end of :func:`get_history` so a regression in the SQL
function blows up the test rather than the dashboard.

KAT-13 additions:

* ``/latest`` returns a tile even when the parcel's only device is UNLINKED —
  it includes ``device_status`` and ``device_unlinked_at`` so the UI can
  render the amber "Détaché" pill instead of a blank state. 204 is preserved
  for the "no telemetry ever" case.
* ``/history`` accepts an optional ``?device_id=<uuid>`` filter so the chart
  can render a single device's slice. Default behaviour is unchanged
  (aggregate across all devices ever on the parcel).
* ``/devices-history`` enumerates every device that ever produced telemetry
  on the parcel — currently-paired AND historically-paired (UNLINKED) — with
  per-device sample counts and date ranges.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from supabase import Client

from app.core.security import AuthUser, get_current_user, get_db_for_user
from app.modules.katara.schemas import (
    DeviceHistoryEntry,
    DeviceHistoryResponse,
    Granularity,
    HistoryBucket,
    HistoryResponse,
    LatestTelemetry,
    Window,
)

router = APIRouter(
    prefix="/katara/parcels/{parcel_id}/telemetry",
    tags=["katara"],
)

# KAT-13 — the device-history endpoint sits on the parcel prefix because the
# aggregate is parcel-scoped (the entire premise of KAT-13 is that history
# follows the parcel, not the physical device). Separate router so the URL
# reads as `/parcels/{id}/devices-history` instead of being lumped under the
# `/telemetry/` namespace.
devices_history_router = APIRouter(
    prefix="/katara/parcels/{parcel_id}",
    tags=["katara"],
)

_LATEST_VIEW = "m1_katara_telemetry_latest"
_PARCELS_TABLE = "m1_katara_parcels"
_DEVICE_HISTORY_VIEW = "m1_katara_parcel_device_history"

# BR-K4 — window → (postgres interval literal, date_trunc bucket, arithmetic cap).
# The wall is 500 (`_MAX_POINTS`); the per-window cap is the *exact* number of
# buckets that fit in the window at the chosen granularity, so the assert in
# get_history can act as a tight regression tripwire instead of a loose one.
_PICK_GRANULARITY: dict[Window, tuple[str, Granularity, int]] = {
    "24h": ("1 day",   "15min", 96),
    "7d":  ("7 days",  "1hour", 168),
    "30d": ("30 days", "1day",  30),
}

_MAX_POINTS = 500  # BR-K4 hard wall

# 15 s — short enough that the 30 s polling tile never serves stale data more
# than once; long enough that React Strict Mode's double-mount in dev does not
# double Supabase egress on the first render.
_CACHE_CONTROL = "private, max-age=15"


def _build_latest(row: dict) -> LatestTelemetry:
    """Materialise a ``LatestTelemetry`` from one row of the latest view.

    KAT-13 contract: ``device_unlinked_at`` is populated only when
    ``device_status == 'UNLINKED'``; for ACTIVE/OFFLINE/PENDING the value is
    suppressed even though the view exposes ``device_updated_at`` for every
    row. Keeping the field None on non-UNLINKED rows prevents the frontend
    from mis-rendering the "Détaché" pill on a freshly-ingested reading whose
    device row happens to have a recent ``updated_at`` from an unrelated
    column update (e.g. last_seen).
    """
    device_status = row.get("device_status")
    unlinked_at = (
        row.get("device_updated_at")
        if device_status == "UNLINKED"
        else None
    )
    return LatestTelemetry(
        device_id=row["device_id"],
        device_label=row.get("device_label"),
        device_status=device_status,
        device_unlinked_at=unlinked_at,
        soil_moisture=row["soil_moisture"],
        soil_temperature=row["soil_temperature"],
        soil_ph=row["soil_ph"],
        soil_conductivity=row["soil_conductivity"],
        battery_level=row["battery_level"],
        recorded_at=row["recorded_at"],
        received_at=row["received_at"],
    )


@router.get(
    "/latest",
    response_model=LatestTelemetry,
    responses={
        204: {"description": "Parcel exists but has no telemetry yet."},
        404: {"description": "Parcel not found (or not accessible to caller)."},
    },
)
async def get_latest(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> LatestTelemetry | Response:
    """Most recent reading on this parcel.

    KAT-13 extension: when the parcel's currently-paired devices are all
    silent but historical telemetry exists from an UNLINKED device, this
    endpoint returns the most recent UNLINKED-device reading tagged with
    ``device_status='UNLINKED'`` instead of a blank 204. The frontend renders
    an amber "Détaché il y a X" pill on the tile.

    Returns 204 only for the genuine "no telemetry ever" case (no device or
    device paired without an ingest). Returns 404 when the parcel either does
    not exist or is not visible to the caller — RLS makes those two
    indistinguishable, which is the desired behaviour (no enumeration).
    """
    # The KAT-13-extended view returns one row per (parcel, device) pair
    # (UNLINKED included). Take the single most-recent across the parcel and
    # the view already carries the device label + status + updated_at, so we
    # do not need the second m1_katara_devices round-trip the story §5.3
    # sketch implied.
    latest = (
        db.table(_LATEST_VIEW)
        .select(
            "device_id, device_label, device_status, device_updated_at, "
            "soil_moisture, soil_temperature, soil_ph, soil_conductivity, "
            "battery_level, recorded_at, received_at"
        )
        .eq("parcel_id", str(parcel_id))
        .order("recorded_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = latest.data or []

    if not rows:
        # Disambiguate "doesn't exist / not yours" vs "yours but empty". The
        # extra round-trip costs ~10 ms and lets the UI render the correct
        # empty state instead of a generic error.
        parcel = (
            db.table(_PARCELS_TABLE)
            .select("id")
            .eq("id", str(parcel_id))
            .limit(1)
            .execute()
        )
        if not (parcel.data or []):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="parcel_not_found",
            )
        return Response(
            status_code=status.HTTP_204_NO_CONTENT,
            headers={"Cache-Control": _CACHE_CONTROL},
        )

    response.headers["Cache-Control"] = _CACHE_CONTROL
    return _build_latest(rows[0])


@router.get("/history", response_model=HistoryResponse)
async def get_history(
    parcel_id: UUID,
    window: Window,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
    device_id: UUID | None = None,
) -> HistoryResponse:
    """Bucketed series for the chart. BR-K4: ``len(buckets) <= 500`` always.

    KAT-13 extension: when ``device_id`` is supplied, the buckets reflect only
    that device's contribution to the parcel's history. Default (omitted)
    behaviour is unchanged — aggregate across all devices ever on the parcel.
    """
    # Pydantic's Literal already 422s a bad value at FastAPI's parsing layer.
    # The redundant guard below gives the frontend a localizable error string
    # ("window_must_be_24h_7d_or_30d") instead of FastAPI's default validation
    # envelope.
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
            "p_window": pg_interval,
            "p_bucket": granularity,
            # KAT-13: the 4-arg overload accepts NULL to mean "no device
            # filter". Passing the param explicitly (even when None) so the
            # supabase-py RPC layer dispatches to the right overload.
            "p_device_id": str(device_id) if device_id else None,
        },
    ).execute()

    rows = rpc.data or []
    buckets = [HistoryBucket(**r) for r in rows]

    # Regression tripwire. expected_cap is the per-window arithmetic ceiling;
    # _MAX_POINTS is the BR-K4 wall. Either being exceeded means the SQL
    # function or the granularity table drifted from the documented contract.
    assert len(buckets) <= _MAX_POINTS, (
        f"BR-K4 violation: history returned {len(buckets)} points "
        f"for window={window}, granularity={granularity}, "
        f"device_filter={'yes' if device_id else 'no'} (cap={expected_cap})"
    )

    response.headers["Cache-Control"] = _CACHE_CONTROL
    return HistoryResponse(
        window=window,
        granularity=granularity,
        point_count=len(buckets),
        buckets=buckets,
    )


# ── KAT-13 — devices-history ────────────────────────────────────────────────
@devices_history_router.get(
    "/devices-history",
    response_model=DeviceHistoryResponse,
    summary="Per-device telemetry contribution history (KAT-13)",
    description=(
        "Lists every device that has ever produced telemetry on this parcel "
        "— currently-paired AND historically-paired devices that were later "
        "unlinked or relocated. Used by the parcel detail page to attribute "
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
        db.table(_DEVICE_HISTORY_VIEW)
        .select(
            "device_uuid, device_id, device_status, api_key_last4, "
            "first_recorded_at, last_recorded_at, sample_count, "
            "is_currently_paired, device_updated_at"
        )
        .eq("parcel_id", str(parcel_id))
        .order("last_recorded_at", desc=True)
        .execute()
    )
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return DeviceHistoryResponse(
        devices=[DeviceHistoryEntry(**r) for r in (res.data or [])],
    )
