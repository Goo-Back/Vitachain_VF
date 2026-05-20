"""KAT-05 — alert threshold endpoints.

GET — always returns five rows. Missing rows are hydrated with
``public.m1_katara_threshold_defaults()`` so the UI always has a coherent state
to render the Sparkline band overlay (no "empty parcel" branch on the client).

PUT — bulk idempotent upsert in a single transaction. The audit-guard trigger
silently strips ``last_alert_at`` / ``last_alert_value`` if the client sends
them, so we accept them in the body but do not pass them on the way in. KAT-06's
worker is the only legitimate writer of those columns.

No service-role on this path. RLS is the security boundary; the verification
gate on PUT is a UX nicety (a clear 403 instead of an opaque RLS-empty).
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from supabase import Client

from app.core.security import (
    AuthUser,
    get_current_user,
    get_db_for_user,
    require_verified,
)
from app.modules.katara.schemas import (
    Metric,
    ThresholdRow,
    ThresholdsResponse,
    ThresholdsUpdateRequest,
)

router = APIRouter(
    prefix="/katara/parcels/{parcel_id}/thresholds",
    tags=["katara"],
)

_THRESHOLDS_TABLE = "m1_katara_thresholds"
_PARCELS_TABLE = "m1_katara_parcels"

_METRICS: tuple[Metric, ...] = (
    "soil_moisture",
    "soil_temperature",
    "soil_ph",
    "soil_conductivity",
    "battery_level",
)

# Thresholds are configuration the caller just edited — never serve stale.
_CACHE_CONTROL = "private, max-age=0, must-revalidate"


async def _verify_parcel_exists_for_caller(db: Client, parcel_id: UUID) -> None:
    """Disambiguate "doesn't exist / not yours" from "exists but empty".

    RLS already filters; the extra round-trip lets us return a clean 404 to
    the UI instead of a degenerate empty payload. Indexed PK lookup — ~10 ms.
    """
    check = (
        db.table(_PARCELS_TABLE)
        .select("id")
        .eq("id", str(parcel_id))
        .limit(1)
        .execute()
    )
    if not (check.data or []):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="parcel_not_found",
        )


async def _hydrate(db: Client, parcel_id: UUID) -> list[ThresholdRow]:
    """Return five rows — persisted where they exist, defaults otherwise.

    Hydration uses the SQL helper ``m1_katara_threshold_defaults`` so the API
    and the UI never carry default values themselves; one source of truth.
    """
    existing = (
        db.table(_THRESHOLDS_TABLE)
        .select(
            "metric, min_value, max_value, enabled, "
            "last_alert_at, last_alert_value"
        )
        .eq("parcel_id", str(parcel_id))
        .execute()
    )
    by_metric = {r["metric"]: r for r in (existing.data or [])}

    rows: list[ThresholdRow] = []
    for m in _METRICS:
        if m in by_metric:
            rows.append(ThresholdRow(**by_metric[m]))
            continue
        defaults = db.rpc(
            "m1_katara_threshold_defaults", {"p_metric": m}
        ).execute()
        rec = (defaults.data or [{}])[0]
        rows.append(
            ThresholdRow(
                metric=m,
                min_value=rec.get("min_value"),
                max_value=rec.get("max_value"),
                enabled=rec.get("enabled", True),
            )
        )
    return rows


@router.get("", response_model=ThresholdsResponse)
async def get_thresholds(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> ThresholdsResponse:
    """Read the five thresholds for ``parcel_id``.

    Allowed for any authenticated FARMER / ADMIN; RLS scopes the result. The
    PENDING farmer can read their own (so the form renders pre-populated)
    even though they cannot write — symmetry with how an unverified farmer
    can already *see* their parcel page.
    """
    await _verify_parcel_exists_for_caller(db, parcel_id)
    rows = await _hydrate(db, parcel_id)
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return ThresholdsResponse(parcel_id=parcel_id, rows=rows)


@router.put("", response_model=ThresholdsResponse)
async def put_thresholds(
    parcel_id: UUID,
    body: ThresholdsUpdateRequest,
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))],
    db: Annotated[Client, Depends(get_db_for_user)],
    response: Response,
) -> ThresholdsResponse:
    """Bulk upsert. Keyed on ``(parcel_id, metric)``; the audit-guard trigger
    silently drops ``last_alert_at`` / ``last_alert_value`` from non-service
    writes. We re-hydrate after the upsert so the response reflects the
    post-trigger state (audit columns preserved, ``updated_at`` refreshed)."""
    await _verify_parcel_exists_for_caller(db, parcel_id)

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

    (
        db.table(_THRESHOLDS_TABLE)
        .upsert(upserts, on_conflict="parcel_id,metric")
        .execute()
    )

    rows = await _hydrate(db, parcel_id)
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return ThresholdsResponse(parcel_id=parcel_id, rows=rows)
