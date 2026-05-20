"""KAT-07 — AI diagnostic request endpoints.

POST /api/v1/katara/parcels/{parcel_id}/diagnostics
    Create a PENDING diagnostic row. Enforces:
      BR-K5 — 409 if the latest row is PENDING or PROCESSING.
      BR-K6 — 429 if ≥ 3 diagnostics exist for this parcel in the past 24h.
    Requires verification_status = VERIFIED (AUTH-06 gate).

GET /api/v1/katara/parcels/{parcel_id}/diagnostics/latest
    Return the most-recent diagnostic row, or 404 if none.
    Used by KAT-10 polling and by the initial server-side fetch in page.tsx.
    Requires authenticated FARMER (owner) — RLS scopes the result.

No service-role on either path. RLS is the security boundary; the verification
gate on POST is a UX nicety (a clear 403 instead of an opaque RLS-empty).
The KAT-08/09 worker transitions status via service_role only.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.core.security import (
    AuthUser,
    get_current_user,
    get_db_for_user,
    require_verified,
)
from app.modules.katara.schemas import DiagnosticOut

router = APIRouter(
    prefix="/katara/parcels/{parcel_id}/diagnostics",
    tags=["katara"],
)

_DIAGNOSTICS_TABLE = "m1_katara_diagnostics"
_PARCELS_TABLE     = "m1_katara_parcels"

# BR-K5 — the two statuses that count as "in-flight" for the duplicate guard.
_IN_FLIGHT_STATUSES = ("PENDING", "PROCESSING")

# BR-K6 — max diagnostics per parcel per rolling window.
_RATE_LIMIT_MAX   = 3
_RATE_LIMIT_HOURS = 24


def _verify_parcel_owner(db: Client, parcel_id: UUID) -> None:
    """RLS already filters; the extra round-trip lets us emit a clean 404
    instead of a degenerate empty payload when the parcel is not the caller's.
    Indexed PK lookup — ~10 ms.
    """
    res = (
        db.table(_PARCELS_TABLE)
        .select("id")
        .eq("id", str(parcel_id))
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "parcel_not_found")


def _fetch_latest_row(db: Client, parcel_id: UUID) -> dict | None:
    res = (
        db.table(_DIAGNOSTICS_TABLE)
        .select("*")
        .eq("parcel_id", str(parcel_id))
        .order("requested_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _count_recent(db: Client, parcel_id: UUID, hours: int) -> int:
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    res = (
        db.table(_DIAGNOSTICS_TABLE)
        .select("id", count="exact")
        .eq("parcel_id", str(parcel_id))
        .gte("requested_at", since)
        .execute()
    )
    return res.count or 0


@router.post(
    "",
    response_model=DiagnosticOut,
    status_code=status.HTTP_201_CREATED,
)
async def request_diagnostic(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> DiagnosticOut:
    _verify_parcel_owner(db, parcel_id)

    # BR-K5 — block while a diagnostic is in flight for this parcel.
    latest = _fetch_latest_row(db, parcel_id)
    if latest and latest["status"] in _IN_FLIGHT_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "diagnostic_already_in_progress",
        )

    # BR-K6 — rolling 24h rate limit.
    if _count_recent(db, parcel_id, hours=_RATE_LIMIT_HOURS) >= _RATE_LIMIT_MAX:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "diagnostic_rate_limit_exceeded",
        )

    inserted = (
        db.table(_DIAGNOSTICS_TABLE)
        .insert({"parcel_id": str(parcel_id)})
        .execute()
    )
    if not inserted.data:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "diagnostic_create_failed",
        )
    return DiagnosticOut(**inserted.data[0])


@router.get("/latest", response_model=DiagnosticOut)
async def get_latest_diagnostic(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> DiagnosticOut:
    """Most-recent diagnostic for the parcel; 404 if none.

    RLS scopes the result to the parcel owner and admins — no explicit
    farmer_id filter needed. The parcel-existence check fires first so the
    error is always 404 (not an empty payload) for mismatched parcels.
    """
    _verify_parcel_owner(db, parcel_id)
    row = _fetch_latest_row(db, parcel_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no_diagnostic_found")
    return DiagnosticOut(**row)
