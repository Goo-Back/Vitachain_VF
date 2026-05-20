"""M1 Katara router.

Mounts at ``/api/v1/katara``. Houses the per-module liveness probe plus the
KAT-01 parcel registry. Telemetry ingest (KAT-03), thresholds (KAT-05) and
diagnostic (KAT-07) will add their own sub-routers as the stories land.

AUTH-06 contract — parcel mutation is gated by
:func:`_require_verified_farmer` at the FastAPI layer AND by the
``katara_parcels_insert_verified_farmer`` RLS policy (migration 0016). Either
gate alone would suffice; running both is the AUTH-04 defence-in-depth pattern
used across every "professional action" endpoint in PRD §7.1.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import ORJSONResponse
from supabase import Client

from app.core.security import AuthUser, get_current_user, get_db_for_user
from app.modules.katara.schemas import ParcelCreate, ParcelOut, ParcelUpdate

router = APIRouter(prefix="/katara", tags=["katara"])

_PARCELS_TABLE = "m1_katara_parcels"


@router.get("/healthz", response_class=ORJSONResponse)
async def katara_healthz() -> dict[str, str]:
    """Per-module liveness; lets ops bisect which router is loaded."""
    return {"module": "katara", "status": "ok"}


def _require_verified_farmer(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> AuthUser:
    """KAT-01 mutation gate. Mirrors require_verified('FARMER').

    Inlined (rather than reusing core.security.require_verified) so the error
    detail strings match the bilingual frontend copy on
    /dashboard/farmer/parcels/new — the existing helper returns
    ``role_not_allowed`` / ``verification_required`` strings that the
    onboarding flow already keys on, which are not the right copy here.
    """
    if user.role != "FARMER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="role_not_allowed",
        )
    if user.verification_status != "VERIFIED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="verification_required",
        )
    return user


@router.post(
    "/parcels",
    response_model=ParcelOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_parcel(
    body: ParcelCreate,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> ParcelOut:
    inserted = (
        db.table(_PARCELS_TABLE)
        .insert(
            {
                "farmer_id": str(user.id),
                "name": body.name,
                "geojson": body.geojson,
                "crop_type": body.crop_type,
                # decimal → str so PostgREST stores the exact value rather than
                # an IEEE-754 round-tripped through JSON.
                "surface_area_ha": str(body.surface_area_ha),
            }
        )
        .execute()
    )
    if not inserted.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="parcel_create_failed",
        )
    return ParcelOut(**inserted.data[0])


@router.get("/parcels", response_model=list[ParcelOut])
async def list_parcels(
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> list[ParcelOut]:
    # RLS scopes to farmer_id = auth.uid() — the explicit .eq() below is
    # cosmetic for the SQL log; remove only after the AUTH-07 isolation cell
    # for this table is green on every CI run.
    res = (
        db.table(_PARCELS_TABLE)
        .select("*")
        .eq("farmer_id", str(user.id))
        .order("created_at", desc=False)
        .execute()
    )
    return [ParcelOut(**row) for row in (res.data or [])]


@router.get("/parcels/{parcel_id}", response_model=ParcelOut)
async def get_parcel(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> ParcelOut:
    res = (
        db.table(_PARCELS_TABLE)
        .select("*")
        .eq("id", str(parcel_id))
        .eq("farmer_id", str(user.id))
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="parcel_not_found",
        )
    return ParcelOut(**rows[0])


@router.patch("/parcels/{parcel_id}", response_model=ParcelOut)
async def update_parcel(
    parcel_id: UUID,
    body: ParcelUpdate,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> ParcelOut:
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="no_fields_to_update",
        )
    if "surface_area_ha" in patch:
        patch["surface_area_ha"] = str(patch["surface_area_ha"])

    res = (
        db.table(_PARCELS_TABLE)
        .update(patch)
        .eq("id", str(parcel_id))
        .eq("farmer_id", str(user.id))
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="parcel_not_found",
        )
    return ParcelOut(**res.data[0])


@router.delete(
    "/parcels/{parcel_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_parcel(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> Response:
    try:
        res = (
            db.table(_PARCELS_TABLE)
            .delete()
            .eq("id", str(parcel_id))
            .eq("farmer_id", str(user.id))
            .execute()
        )
    except Exception as exc:
        # KAT-02 introduced m1_katara_devices.parcel_id ON DELETE RESTRICT, so
        # a parcel with a linked device now raises 23503 instead of silently
        # succeeding. The farmer must unpair the device first.
        msg = str(exc)
        if "violates foreign key constraint" in msg or "23503" in msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="parcel_has_device_unpair_first",
            ) from exc
        raise
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="parcel_not_found",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
