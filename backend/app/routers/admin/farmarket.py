"""FAR-08 / FAR-09 — Admin FarMarket endpoints.

Two read-only list endpoints (FAR-08) and one write toggle (FAR-09), all
gated by require_role("ADMIN") and using service_client() to bypass RLS so
the admin sees all records regardless of farmer_id / buyer_id.

AUTH-05: routers/admin/ is the AUTH-05 allowlisted prefix for service_client().
Every call site carries a # JUSTIFICATION: comment.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from app.core.security import AuthUser, require_role
from app.db import service_client

router = APIRouter(prefix="/admin/farmarket", tags=["admin", "farmarket"])

_ADS_TABLE = "m2_farmarket_ads"


# ---------------------------------------------------------------------------
# Pydantic response schemas
# ---------------------------------------------------------------------------


class AdminAdOut(BaseModel):
    id: uuid.UUID
    farmer_id: uuid.UUID
    title: str
    product_type: str
    region: str
    price_mad: str
    quantity_kg: str
    status: str
    is_featured: bool
    photo_paths: list[str]
    expires_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


class FeatureToggleOut(BaseModel):
    """Response from PATCH /admin/farmarket/ads/{ad_id}/feature."""

    id: uuid.UUID
    is_featured: bool
    updated_at: datetime

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# GET /admin/farmarket/ads  (FAR-08)
# ---------------------------------------------------------------------------


@router.get(
    "/ads",
    response_class=ORJSONResponse,
    summary="[ADMIN] List all FarMarket ads (all statuses, all farmers)",
)
async def admin_list_ads(
    _: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    status: str | None = Query(default=None),
    region: str | None = Query(default=None),
    product_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> ORJSONResponse:
    """List ALL FarMarket ads bypassing RLS — admin-only.

    Returns ads across all farmers and all statuses.
    """
    # JUSTIFICATION: admin read — needs all ads across all farmers; RLS would
    # restrict to the caller's farmer_id. routers/admin/ is the AUTH-05 allowlist.
    client = service_client()

    offset = (page - 1) * page_size
    query = (
        client.table(_ADS_TABLE)
        .select("*", count="exact")
        .order("created_at", desc=True)
        .range(offset, offset + page_size - 1)
    )

    if status:
        query = query.eq("status", status)
    if region:
        query = query.eq("region", region)
    if product_type:
        query = query.ilike("product_type", f"%{product_type}%")

    result = query.execute()
    total: int = result.count or 0
    items = result.data or []

    return ORJSONResponse(
        {
            "items": [
                AdminAdOut(
                    id=r["id"],
                    farmer_id=r["farmer_id"],
                    title=r["title"],
                    product_type=r["product_type"],
                    region=r["region"],
                    price_mad=str(r["price_mad"]),
                    quantity_kg=str(r["quantity_kg"]),
                    status=r["status"],
                    is_featured=r["is_featured"],
                    photo_paths=r.get("photo_paths") or [],
                    expires_at=r["expires_at"],
                    created_at=r["created_at"],
                    updated_at=r["updated_at"],
                ).model_dump(mode="json")
                for r in items
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_next": (offset + page_size) < total,
        }
    )


# ---------------------------------------------------------------------------
# PATCH /admin/farmarket/ads/{ad_id}/feature  (FAR-09)
# ---------------------------------------------------------------------------


@router.patch(
    "/ads/{ad_id}/feature",
    response_class=ORJSONResponse,
    summary="[ADMIN] Toggle featured flag on a FarMarket ad",
    status_code=200,
)
async def admin_toggle_ad_featured(
    ad_id: uuid.UUID,
    _: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> ORJSONResponse:
    """Toggle is_featured on a single ad.

    Flips the current boolean value (NOT is_featured).
    Returns the new state.  Idempotent: calling twice restores original state.
    Returns 404 if the ad_id does not exist.
    """
    client = service_client()  # JUSTIFICATION: admin write — toggle featured flag, RLS bypass

    # Fetch current is_featured value first (PostgREST does not support
    # SET col = NOT col directly via the Python client).
    fetch = (
        client.table(_ADS_TABLE)
        .select("id, is_featured")
        .eq("id", str(ad_id))
        .maybe_single()
        .execute()
    )

    if fetch.data is None:
        raise HTTPException(status_code=404, detail="ad_not_found")

    new_value = not fetch.data["is_featured"]

    update = (
        client.table(_ADS_TABLE)
        .update({"is_featured": new_value})
        .eq("id", str(ad_id))
        .select("id, is_featured, updated_at")
        .execute()
    )

    row = update.data[0]
    return ORJSONResponse(
        FeatureToggleOut(
            id=row["id"],
            is_featured=row["is_featured"],
            updated_at=row["updated_at"],
        ).model_dump(mode="json")
    )
