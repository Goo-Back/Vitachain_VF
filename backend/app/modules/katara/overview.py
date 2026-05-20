"""KAT-14 — farmer-level multi-parcel overview endpoint.

One read-only GET that fans out to the per-parcel summary view shipped in
migration 0028. Collapses what would otherwise be 1 + 3×N round-trips from
the dashboard into a single payload — see KAT-14 §6.1 for the rationale.

RLS posture: pure user-JWT scope via ``get_db_for_user``. The view inherits
RLS from its four base tables (parcels / devices / telemetry / thresholds);
the endpoint never escalates to service-role.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from supabase import Client

from app.core.security import AuthUser, get_current_user, get_db_for_user
from app.modules.katara.schemas import (
    FarmerOverviewResponse,
    FarmKpiRollup,
    ParcelOverviewEntry,
)

router = APIRouter(prefix="/katara/farmers/me", tags=["katara"])

_OVERVIEW_VIEW = "m1_katara_farmer_parcels_overview"

# The KPI strip is the summary view, not the live-monitoring view. A 60 s
# staleness window is the right cost/freshness trade for a page a farmer
# hits 1–3× per session (KAT-14 §4.3).
_CACHE_CONTROL = "private, max-age=60"


@router.get(
    "/overview",
    response_model=FarmerOverviewResponse,
    summary="Farm-wide multi-parcel overview (KAT-14)",
    description=(
        "Returns every parcel owned by the authenticated farmer along with "
        "a summary tile (device-status mix, latest reading, breach flag) and "
        "a farm-level KPI rollup. RLS-scoped under the user's JWT — never "
        "service-role. One round-trip replaces what would otherwise be "
        "1 + N calls from the frontend."
    ),
)
async def get_farmer_overview(
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> FarmerOverviewResponse:
    res = (
        db.table(_OVERVIEW_VIEW)
        .select(
            "parcel_id, name, crop_type, surface_area_ha, "
            "device_active_count, device_offline_count, "
            "device_pending_count, device_unlinked_count, "
            "last_reading_at, last_soil_moisture, "
            "has_open_threshold_breach"
        )
        # Defense-in-depth: explicit filter alongside the RLS on the view
        # (migration 0030 adds security_invoker=true; this catches any
        # future regression where the view loses that attribute).
        .eq("farmer_id", str(user.id))
        # Alphabetical ordering is the more useful nav default once a
        # farmer has > 2 parcels (KAT-14 §2 — deliberately diverges from
        # KAT-01's `created_at asc` for list_parcels).
        .order("name", desc=False)
        .execute()
    )
    parcels = [ParcelOverviewEntry(**row) for row in (res.data or [])]

    # KPI is summed in Python rather than in a second SQL pass — N ≤ 10
    # parcels in MVD, so the cost is microseconds, and the handler stays
    # auditable in one place (KAT-14 §5.3 design point #1).
    kpi = FarmKpiRollup(
        parcel_count=len(parcels),
        total_surface_ha=sum(
            (p.surface_area_ha for p in parcels), Decimal("0")
        ),
        device_active_count=sum(p.device_active_count for p in parcels),
        device_offline_count=sum(p.device_offline_count for p in parcels),
        device_pending_count=sum(p.device_pending_count for p in parcels),
        device_unlinked_count=sum(p.device_unlinked_count for p in parcels),
        parcels_with_open_breach=sum(
            1 for p in parcels if p.has_open_threshold_breach
        ),
    )

    response.headers["Cache-Control"] = _CACHE_CONTROL
    return FarmerOverviewResponse(kpi=kpi, parcels=parcels)
