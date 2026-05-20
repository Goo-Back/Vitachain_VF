"""KAT-02 — ESP32 device pairing endpoints.

Mounted under the existing katara router at
``/api/v1/katara/parcels/{parcel_id}/devices``. The pairing endpoint is the
ONLY place the plaintext api_key crosses an HTTP boundary — every other
endpoint returns :class:`DeviceOut` which exposes only ``api_key_last4``.

AUTH-04 defence-in-depth: both the
``katara_devices_insert_verified_farmer_owns_parcel`` RLS policy AND the
FastAPI :func:`_require_verified_farmer` + parcel-ownership pre-check below
enforce the same contract. Either alone would suffice; we run both because the
AUTH-07 matrix treats them as independent failure surfaces.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from supabase import Client

from app.core.api_keys import (
    generate_device_api_key,
    hash_device_api_key,
    last4,
)
from app.core.security import AuthUser, get_current_user, get_db_for_user
from app.modules.katara.router import _require_verified_farmer
from app.modules.katara.schemas import (
    DeviceOut,
    DevicePair,
    DevicePairResponse,
    UnlinkDeviceResponse,
)

router = APIRouter(prefix="/katara/parcels/{parcel_id}/devices", tags=["katara"])

# KAT-12 — unlink lives on a parcel-less prefix because the operation is
# scoped to the device row, not to a parcel (the row already carries its
# parcel_id, and the relink path will pair on a *different* parcel by reusing
# the existing POST /katara/parcels/{new_parcel_id}/devices endpoint). Two
# separate routers keep the URL semantics clean — `/devices/{uuid}/unlink` is
# a device-scoped verb, `/parcels/{id}/devices` is the parcel-scoped CRUD.
unlink_router = APIRouter(prefix="/katara/devices", tags=["katara"])

_DEVICES_TABLE = "m1_katara_devices"
_PARCELS_TABLE = "m1_katara_parcels"
_TELEMETRY_TABLE = "m1_katara_telemetry"  # created in KAT-03; tolerated below


def _assert_owns_parcel(db: Client, parcel_id: UUID, farmer_id: UUID) -> None:
    """Defence-in-depth ownership pre-check.

    RLS already scopes the parcel sub-select inside the device INSERT policy,
    but reading the parcel first lets us emit a clean 404 (rather than the
    opaque RLS-rejection that would otherwise come back as an insert that
    returns zero rows). 404 (not 403) avoids leaking which parcels exist for
    other farmers.
    """
    res = (
        db.table(_PARCELS_TABLE)
        .select("id")
        .eq("id", str(parcel_id))
        .eq("farmer_id", str(farmer_id))
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="parcel_not_found",
        )


@router.post(
    "",
    response_model=DevicePairResponse,
    status_code=status.HTTP_201_CREATED,
)
async def pair_device(
    parcel_id: UUID,
    body: DevicePair,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> DevicePairResponse:
    """Pair an ESP32 to a parcel (initial pair OR KAT-12 re-pair).

    KAT-12 relink contract: re-pairing a previously-unlinked physical device
    on a new parcel uses *this* endpoint with the same literal ``device_id``
    (printed on the ESP32 case). KAT-02's partial unique indexes —
    ``m1_katara_devices_one_active_per_device_id`` and
    ``_one_active_per_parcel``, both filtered ``where status <> 'UNLINKED'``
    — let the INSERT succeed because the prior row is UNLINKED. A fresh
    bcrypt-hashed api-key is generated and returned in the one-shot modal;
    the old row's api-key stays in place and is mechanically rejected by
    KAT-03 ingest because :func:`public.verify_device_api_key` filters
    UNLINKED rows.
    """
    _assert_owns_parcel(db, parcel_id, user.id)

    plaintext = generate_device_api_key()
    try:
        inserted = (
            db.table(_DEVICES_TABLE)
            .insert(
                {
                    "device_id": body.device_id,
                    "parcel_id": str(parcel_id),
                    # farmer_id is re-asserted by trg_m1_katara_devices_sync_farmer;
                    # we still pass it so the RLS WITH CHECK clause sees the value.
                    "farmer_id": str(user.id),
                    "api_key_hash": hash_device_api_key(plaintext),
                    "api_key_last4": last4(plaintext),
                }
            )
            .execute()
        )
    except Exception as exc:
        msg = str(exc)
        # BR-K1: partial unique index on (parcel_id) where status<>'UNLINKED'
        # OR on (device_id) where status<>'UNLINKED' rejected the insert.
        if (
            "m1_katara_devices_one_active_per_parcel" in msg
            or "m1_katara_devices_one_active_per_device_id" in msg
            or "duplicate key value" in msg
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="device_already_paired",
            ) from exc
        raise

    rows = inserted.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="device_already_paired",
        )
    row = rows[0]
    return DevicePairResponse(
        id=row["id"],
        device_id=row["device_id"],
        parcel_id=row["parcel_id"],
        farmer_id=row["farmer_id"],
        api_key=plaintext,
        api_key_last4=row["api_key_last4"],
        status=row["status"],
        last_seen=row.get("last_seen"),
        created_at=row["created_at"],
        updated_at=row.get("updated_at"),
    )


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> list[DeviceOut]:
    _assert_owns_parcel(db, parcel_id, user.id)
    res = (
        db.table(_DEVICES_TABLE)
        .select(
            "id,device_id,parcel_id,farmer_id,api_key_last4,status,"
            "last_seen,created_at,updated_at"
        )
        .eq("parcel_id", str(parcel_id))
        .neq("status", "UNLINKED")
        .order("created_at", desc=False)
        .execute()
    )
    return [DeviceOut(**row) for row in (res.data or [])]


@router.post(
    "/{device_row_id}/rotate-key",
    response_model=DevicePairResponse,
)
async def rotate_device_key(
    parcel_id: UUID,
    device_row_id: UUID,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> DevicePairResponse:
    """Regenerate the api_key. Use when the farmer suspects compromise or
    re-flashes the device. The old plaintext is irrecoverable."""
    _assert_owns_parcel(db, parcel_id, user.id)

    plaintext = generate_device_api_key()
    res = (
        db.table(_DEVICES_TABLE)
        .update(
            {
                "api_key_hash": hash_device_api_key(plaintext),
                "api_key_last4": last4(plaintext),
            }
        )
        .eq("id", str(device_row_id))
        .eq("parcel_id", str(parcel_id))
        .eq("farmer_id", str(user.id))
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="device_not_found",
        )
    row = rows[0]
    return DevicePairResponse(
        id=row["id"],
        device_id=row["device_id"],
        parcel_id=row["parcel_id"],
        farmer_id=row["farmer_id"],
        api_key=plaintext,
        api_key_last4=row["api_key_last4"],
        status=row["status"],
        last_seen=row.get("last_seen"),
        created_at=row["created_at"],
        updated_at=row.get("updated_at"),
    )


@router.delete(
    "/{device_row_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def unpair_device(
    parcel_id: UUID,
    device_row_id: UUID,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> Response:
    """KAT-02-scoped DELETE: only allowed when the device has never sent
    telemetry. KAT-12 will replace this with a proper unlink that preserves
    history (status → UNLINKED). The telemetry check is best-effort — KAT-03
    creates the telemetry table; we tolerate its absence during the
    KAT-02-before-KAT-03 window.
    """
    _assert_owns_parcel(db, parcel_id, user.id)

    try:
        tele = (
            db.table(_TELEMETRY_TABLE)
            .select("id", count="exact")
            .eq("device_id", str(device_row_id))
            .limit(1)
            .execute()
        )
        if (tele.count or 0) > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="device_has_telemetry_use_unlink_in_kat12",
            )
    except HTTPException:
        raise
    except Exception:  # noqa: S110 — telemetry table not created yet (pre-KAT-03)
        pass

    res = (
        db.table(_DEVICES_TABLE)
        .delete()
        .eq("id", str(device_row_id))
        .eq("parcel_id", str(parcel_id))
        .eq("farmer_id", str(user.id))
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="device_not_found",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── KAT-12 — unlink ──────────────────────────────────────────────────────────


@unlink_router.post(
    "/{device_uuid}/unlink",
    status_code=status.HTTP_200_OK,
    response_model=UnlinkDeviceResponse,
    responses={
        403: {"description": "Caller is not a FARMER role"},
        404: {"description": "Device not found (or not visible to caller)"},
        409: {"description": "Device is already UNLINKED"},
    },
    summary="Unlink a device from its parcel (KAT-12)",
    description=(
        "Soft-detaches the device from its parcel by flipping status to "
        "UNLINKED. The api-key is mechanically invalidated on the next "
        "ESP32 transmission (KAT-03 ingest returns 401 "
        "invalid_device_credentials thanks to the `status <> 'UNLINKED'` "
        "filter in `verify_device_api_key`). Historical telemetry remains "
        "under the original parcel (queryable in KAT-13). To pair the same "
        "physical device on a different parcel, POST to "
        "/api/v1/katara/parcels/{new_parcel_id}/devices with the same "
        "literal device_id — the partial unique indexes from KAT-02 allow "
        "the re-pair because the old row is now UNLINKED."
    ),
)
async def unlink_device(
    device_uuid: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> UnlinkDeviceResponse:
    # KAT-12 §5.2 — design choices:
    #
    # 1. No `_require_verified_farmer` gate. An unlink is a destructive
    #    walk-back of a prior valid action; if a farmer's verification was
    #    revoked after they paired, they should still be able to detach the
    #    devices they own. Role gate only.
    # 2. The WHERE clause is id-only (no `auth.uid() = farmer_id` predicate):
    #    the `katara_devices_update_own` RLS policy from KAT-02 already
    #    scopes the UPDATE to rows the caller owns. Adding the predicate
    #    explicitly would be dead weight that obscures RLS's role.
    # 3. `.neq("status", "UNLINKED")` makes the UPDATE idempotent at the DB
    #    layer — a second attempt returns zero rows, which the 404/409
    #    disambiguation below maps to 409 device_already_unlinked.
    if user.role != "FARMER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="role_not_allowed",
        )

    result = (
        db.table(_DEVICES_TABLE)
        .update({"status": "UNLINKED"})
        .eq("id", str(device_uuid))
        .neq("status", "UNLINKED")
        .execute()
    )

    rows = result.data or []
    if not rows:
        # Either RLS hid the row (cross-farmer → not visible) or the row was
        # already UNLINKED. Disambiguate with one follow-up SELECT under the
        # same RLS context: an unrelated farmer's device surfaces as 404
        # (no existence leak), the caller's own UNLINKED row surfaces as 409.
        probe = (
            db.table(_DEVICES_TABLE)
            .select("id,status")
            .eq("id", str(device_uuid))
            .limit(1)
            .execute()
        )
        probe_rows = probe.data or []
        if not probe_rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="device_not_found",
            )
        if probe_rows[0]["status"] == "UNLINKED":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="device_already_unlinked",
            )
        # Defensive: RLS + the .neq() should have covered both branches.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="unexpected_unlink_state",
        )

    row = rows[0]
    return UnlinkDeviceResponse(
        id=row["id"],
        device_id=row["device_id"],
        parcel_id=row["parcel_id"],
        status="UNLINKED",
    )
