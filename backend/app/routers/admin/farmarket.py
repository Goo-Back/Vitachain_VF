"""FAR-08 / FAR-09 — Admin FarMarket endpoints.

Two read-only list endpoints (FAR-08) and one write toggle (FAR-09), all
gated by require_role("ADMIN") and using service_client() to bypass RLS so
the admin sees all records regardless of farmer_id / buyer_id.

AUTH-05: routers/admin/ is the AUTH-05 allowlisted prefix for service_client().
Every call site carries a # JUSTIFICATION: comment.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_role
from app.db import service_client

router = APIRouter(prefix="/admin/farmarket", tags=["admin", "farmarket"])

_ADS_TABLE = "m2_farmarket_ads"
_ORDERS_TABLE = "m2_farmarket_orders"
_ORDER_ITEMS_TABLE = "m2_farmarket_order_items"
_PAYMENT_AUDIT_TABLE = "m2_farmarket_payment_audit"
_COD_OUTSTANDING_VIEW = "v_farmarket_cod_outstanding"


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


# ===========================================================================
# FAR-PAY-02 — Payment integrity layer for ops/admin.
#
# Three endpoints:
#   * GET   /orders                       — list with filters
#   * PATCH /orders/{id}/payment          — force-set payment_status with reason
#   * GET   /orders/{id}/payment-audit    — transition history of a single order
#
# All gated by require_role("ADMIN"). Writes go through service_client()
# because the admin override flips the row to PAID/DUE/FAILED from any state
# — wider than the narrow RLS policies allow. The companion audit INSERT is
# what keeps the integrity trail unbroken; it's the contract these endpoints
# uphold.
# ===========================================================================


PaymentMethodLiteral = Literal["COD", "PSP_TRANSFER"]
AdminPaymentStatusLiteral = Literal["DUE", "PAID", "FAILED"]


class AdminOrderOut(BaseModel):
    id: uuid.UUID
    restaurant_id: uuid.UUID
    status: str
    delivery_region: str
    delivery_notes: str | None
    # Migration 0050 — courier-facing contact (admin/ops visibility only).
    delivery_contact_name: str | None = None
    delivery_phone: str | None = None
    delivery_address: str | None = None
    delivery_city: str | None = None
    subtotal_mad: str
    logistics_fee_mad: str
    total_mad: str
    payment_method: str
    payment_status: str
    paid_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AdminOrderListItem(AdminOrderOut):
    age_days: float | None = None


class AdminOrderListResponse(BaseModel):
    items: list[AdminOrderListItem]
    total: int
    page: int
    page_size: int
    has_next: bool


class PaymentOverrideIn(BaseModel):
    new_status: AdminPaymentStatusLiteral
    reason: str = Field(min_length=3, max_length=500)


class PaymentAuditRow(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    actor_id: uuid.UUID
    actor_role: str
    previous_status: str
    new_status: str
    previous_paid_at: datetime | None
    new_paid_at: datetime | None
    reason: str
    created_at: datetime


# ---------------------------------------------------------------------------
# GET /admin/farmarket/orders
# ---------------------------------------------------------------------------


@router.get(
    "/orders",
    response_class=ORJSONResponse,
    summary="[ADMIN] List FarMarket orders with payment filters",
)
async def admin_list_orders(
    _: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    payment_method: PaymentMethodLiteral | None = Query(default=None),
    payment_status: str | None = Query(default=None),
    status: str | None = Query(default=None),
    region: str | None = Query(default=None),
    outstanding_cod: bool = Query(
        default=False,
        description="Shortcut for payment_method=COD&payment_status=DUE, sorted oldest first.",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> ORJSONResponse:
    """List orders for the ops dashboard.

    When ``outstanding_cod=true`` the handler reads
    v_farmarket_cod_outstanding (which carries the age_days column used by
    the reconciliation queue). Otherwise it reads the raw orders table with
    the requested filters.
    """
    # JUSTIFICATION: admin read — ops needs cross-restaurant visibility;
    # RLS would restrict to the caller's own orders. routers/admin/ is the
    # AUTH-05 allowlist.
    client = service_client()

    offset = (page - 1) * page_size

    if outstanding_cod:
        query = (
            client.table(_COD_OUTSTANDING_VIEW)
            .select("*", count="exact")
            .order("created_at", desc=False)
            .range(offset, offset + page_size - 1)
        )
        if region:
            query = query.eq("delivery_region", region)
    else:
        query = (
            client.table(_ORDERS_TABLE)
            .select("*", count="exact")
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
        )
        if payment_method:
            query = query.eq("payment_method", payment_method)
        if payment_status:
            query = query.eq("payment_status", payment_status)
        if status:
            query = query.eq("status", status)
        if region:
            query = query.eq("delivery_region", region)

    result = query.execute()
    total: int = result.count or 0
    items = result.data or []

    def _row(r: dict) -> dict:
        return AdminOrderListItem(
            id=r["id"],
            restaurant_id=r["restaurant_id"],
            status=r["status"],
            delivery_region=r["delivery_region"],
            delivery_notes=r.get("delivery_notes"),
            delivery_contact_name=r.get("delivery_contact_name"),
            delivery_phone=r.get("delivery_phone"),
            delivery_address=r.get("delivery_address"),
            delivery_city=r.get("delivery_city"),
            subtotal_mad=str(r["subtotal_mad"]),
            logistics_fee_mad=str(r["logistics_fee_mad"]),
            total_mad=str(r["total_mad"]),
            payment_method=r.get("payment_method") or "COD",
            payment_status=r["payment_status"],
            paid_at=r.get("paid_at"),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
            age_days=(
                float(r["age_days"]) if r.get("age_days") is not None else None
            ),
        ).model_dump(mode="json")

    return ORJSONResponse(
        AdminOrderListResponse(
            items=[_row(r) for r in items],
            total=total,
            page=page,
            page_size=page_size,
            has_next=(offset + page_size) < total,
        ).model_dump(mode="json")
    )


# ---------------------------------------------------------------------------
# PATCH /admin/farmarket/orders/{id}/payment
# ---------------------------------------------------------------------------


@router.patch(
    "/orders/{order_id}/payment",
    response_class=ORJSONResponse,
    summary="[ADMIN] Override payment_status with mandatory reason",
)
async def admin_override_payment(
    order_id: uuid.UUID,
    payload: PaymentOverrideIn,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> ORJSONResponse:
    """Admin override — force-set payment_status to DUE / PAID / FAILED.

    Use cases:
      * Driver returns with cash but restaurant forgot to click confirm
        → admin marks PAID with reason 'driver_deposited_cash'.
      * Refund / chargeback received from the PSP
        → admin marks FAILED with reason 'psp_chargeback_<ref>'.
      * Restaurant disputes a paid mark
        → admin reverses PAID → DUE with reason 'disputed_by_restaurant'.

    The audit row is written atomically (best-effort — if it fails after the
    UPDATE we surface 500 so ops can re-run).
    """
    # JUSTIFICATION: admin write — payment override needs to write under the
    # admin's JWT AND insert the audit row. service_client() is fine here
    # because we explicitly stamp actor_id = admin.id on the audit row, so
    # the integrity trail still resolves to a real human.
    client = service_client()

    existing = (
        client.table(_ORDERS_TABLE)
        .select("id, payment_method, payment_status, paid_at")
        .eq("id", str(order_id))
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="order_not_found")

    previous_status = existing.data["payment_status"]
    previous_paid_at = existing.data.get("paid_at")
    new_status = payload.new_status

    if previous_status == new_status:
        raise HTTPException(
            status_code=409,
            detail=f"payment_already_{new_status.lower()}",
        )

    # PAID → set paid_at; anything else → clear it. Keeps the column honest.
    new_paid_at: str | None = None
    if new_status == "PAID":
        new_paid_at = datetime.now(timezone.utc).isoformat()

    update_result = (
        client.table(_ORDERS_TABLE)
        .update(
            {
                "payment_status": new_status,
                "paid_at": new_paid_at,
            }
        )
        .eq("id", str(order_id))
        .execute()
    )
    if not update_result.data:
        raise HTTPException(status_code=500, detail="payment_override_failed")

    audit_insert = (
        client.table(_PAYMENT_AUDIT_TABLE)
        .insert(
            {
                "order_id": str(order_id),
                "actor_id": str(admin.id),
                "actor_role": "ADMIN",
                "previous_status": previous_status,
                "new_status": new_status,
                "previous_paid_at": previous_paid_at,
                "new_paid_at": new_paid_at,
                "reason": payload.reason.strip(),
            }
        )
        .execute()
    )
    if not audit_insert.data:
        raise HTTPException(status_code=500, detail="payment_audit_insert_failed")

    row = update_result.data[0]
    return ORJSONResponse(
        AdminOrderOut(
            id=row["id"],
            restaurant_id=row["restaurant_id"],
            status=row["status"],
            delivery_region=row["delivery_region"],
            delivery_notes=row.get("delivery_notes"),
            delivery_contact_name=row.get("delivery_contact_name"),
            delivery_phone=row.get("delivery_phone"),
            delivery_address=row.get("delivery_address"),
            delivery_city=row.get("delivery_city"),
            subtotal_mad=str(row["subtotal_mad"]),
            logistics_fee_mad=str(row["logistics_fee_mad"]),
            total_mad=str(row["total_mad"]),
            payment_method=row.get("payment_method") or "COD",
            payment_status=row["payment_status"],
            paid_at=row.get("paid_at"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        ).model_dump(mode="json")
    )


# ---------------------------------------------------------------------------
# GET /admin/farmarket/orders/{id}/payment-audit
# ---------------------------------------------------------------------------


@router.get(
    "/orders/{order_id}/payment-audit",
    response_class=ORJSONResponse,
    summary="[ADMIN] Payment-status transition history of a single order",
)
async def admin_list_payment_audit(
    order_id: uuid.UUID,
    _: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> ORJSONResponse:
    """Return the audit chain for one order (oldest → newest)."""
    # JUSTIFICATION: admin read — audit table is admin-readable by RLS, but
    # service_client() avoids one extra round-trip resolving auth.uid().
    client = service_client()

    result = (
        client.table(_PAYMENT_AUDIT_TABLE)
        .select("*")
        .eq("order_id", str(order_id))
        .order("created_at", desc=False)
        .execute()
    )
    rows = result.data or []
    return ORJSONResponse(
        {
            "items": [
                PaymentAuditRow(
                    id=r["id"],
                    order_id=r["order_id"],
                    actor_id=r["actor_id"],
                    actor_role=r["actor_role"],
                    previous_status=r["previous_status"],
                    new_status=r["new_status"],
                    previous_paid_at=r.get("previous_paid_at"),
                    new_paid_at=r.get("new_paid_at"),
                    reason=r["reason"],
                    created_at=r["created_at"],
                ).model_dump(mode="json")
                for r in rows
            ],
            "total": len(rows),
        }
    )


# ===========================================================================
# FAR-COD — Admin order management (status pipeline) + dashboard stats.
#
# PATCH /orders/{id}/status — coarse ops override of the order header status
#   (confirm / ship / deliver / cancel / return). This is the rescue-lane
#   counterpart to the per-item state machine (migration 0042): the trigger
#   derives the header from item statuses, but ops sometimes needs to drive the
#   header directly (e.g. mark a whole order DELIVERED at depot, or RETURNED).
#
# GET /stats — KPI + report aggregates for the admin dashboard.
#
# All gated by require_role("ADMIN"); writes use service_client() (AUTH-05
# allowlisted prefix) following the same pattern as the rest of this module.
# ===========================================================================


# Allowed coarse admin transitions on the order HEADER. Terminal states
# (REJECTED, CANCELLED, RETURNED) have no outgoing edges except DELIVERED →
# RETURNED. Kept deliberately narrow so the dashboard buttons map 1:1.
_ADMIN_ORDER_TRANSITIONS: dict[str, set[str]] = {
    "PENDING": {"ACCEPTED", "CANCELLED"},
    "PARTIALLY_ACCEPTED": {"ACCEPTED", "IN_PROGRESS", "CANCELLED"},
    "ACCEPTED": {"IN_PROGRESS", "CANCELLED"},
    "IN_PROGRESS": {"DELIVERED", "CANCELLED"},
    "DELIVERED": {"RETURNED"},
    "REJECTED": set(),
    "CANCELLED": set(),
    "RETURNED": set(),
}

AdminOrderStatusLiteral = Literal[
    "PENDING",
    "PARTIALLY_ACCEPTED",
    "ACCEPTED",
    "REJECTED",
    "IN_PROGRESS",
    "DELIVERED",
    "CANCELLED",
    "RETURNED",
]


class OrderStatusOverrideIn(BaseModel):
    new_status: AdminOrderStatusLiteral


@router.patch(
    "/orders/{order_id}/status",
    response_class=ORJSONResponse,
    summary="[ADMIN] Override the order header status (confirm/ship/deliver/cancel/return)",
)
async def admin_override_order_status(
    order_id: uuid.UUID,
    payload: OrderStatusOverrideIn,
    _: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> ORJSONResponse:
    """Coarse ops override of the order header status.

    Validates the transition against ``_ADMIN_ORDER_TRANSITIONS`` (409 on an
    illegal edge). The per-item state machine is untouched; the header-recompute
    trigger (0042/0050) treats CANCELLED and RETURNED as terminal so a later
    item change cannot revive a returned/cancelled order.
    """
    # JUSTIFICATION: admin write — ops drives the order header directly across
    # all restaurants; RLS would scope to the caller. routers/admin/ allowlist.
    client = service_client()

    existing = (
        client.table(_ORDERS_TABLE)
        .select("status")
        .eq("id", str(order_id))
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="order_not_found")

    current = existing.data["status"]
    new_status = payload.new_status
    if new_status == current:
        raise HTTPException(status_code=409, detail=f"already_{current.lower()}")
    if new_status not in _ADMIN_ORDER_TRANSITIONS.get(current, set()):
        raise HTTPException(
            status_code=409,
            detail=f"invalid_transition: {current} -> {new_status}",
        )

    update_result = (
        client.table(_ORDERS_TABLE)
        .update({"status": new_status})
        .eq("id", str(order_id))
        .execute()
    )
    if not update_result.data:
        raise HTTPException(status_code=500, detail="order_status_update_failed")

    row = update_result.data[0]
    return ORJSONResponse(
        AdminOrderOut(
            id=row["id"],
            restaurant_id=row["restaurant_id"],
            status=row["status"],
            delivery_region=row["delivery_region"],
            delivery_notes=row.get("delivery_notes"),
            delivery_contact_name=row.get("delivery_contact_name"),
            delivery_phone=row.get("delivery_phone"),
            delivery_address=row.get("delivery_address"),
            delivery_city=row.get("delivery_city"),
            subtotal_mad=str(row["subtotal_mad"]),
            logistics_fee_mad=str(row["logistics_fee_mad"]),
            total_mad=str(row["total_mad"]),
            payment_method=row.get("payment_method") or "COD",
            payment_status=row["payment_status"],
            paid_at=row.get("paid_at"),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        ).model_dump(mode="json")
    )


class AdminStatsOut(BaseModel):
    orders_total: int
    orders_by_status: dict[str, int]
    delivered_count: int
    cancelled_count: int
    rejected_count: int
    returned_count: int
    # Booked = every order that is not cancelled / rejected / returned.
    revenue_booked_mad: str
    # Collected = payment actually reconciled (PAID).
    revenue_collected_mad: str
    # Outstanding cash still owed on COD orders (payment_status = DUE).
    cod_outstanding_mad: str
    products_sold_kg: str
    # Rates as fractions of orders_total (0.0–1.0). 0 when there are no orders.
    cancellation_rate: float
    return_rate: float


@router.get(
    "/stats",
    response_class=ORJSONResponse,
    summary="[ADMIN] FarMarket dashboard KPIs + report aggregates",
)
async def admin_stats(
    _: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> ORJSONResponse:
    """Aggregate KPIs for the admin dashboard / reports tab.

    Aggregation is done in Python over the full orders + delivered-items sets.
    Fine at MVP scale; revisit with SQL views / materialised aggregates if the
    table grows large.
    """
    # JUSTIFICATION: admin read — needs cross-restaurant aggregates; RLS would
    # scope to the caller. routers/admin/ is the AUTH-05 allowlist.
    client = service_client()

    orders = (
        client.table(_ORDERS_TABLE)
        .select("status, total_mad, payment_method, payment_status")
        .execute()
    ).data or []

    by_status: dict[str, int] = {}
    revenue_booked = Decimal("0")
    revenue_collected = Decimal("0")
    cod_outstanding = Decimal("0")
    non_revenue = {"CANCELLED", "REJECTED", "RETURNED"}

    for o in orders:
        st = o["status"]
        by_status[st] = by_status.get(st, 0) + 1
        total = Decimal(str(o["total_mad"]))
        if st not in non_revenue:
            revenue_booked += total
        if o.get("payment_status") == "PAID":
            revenue_collected += total
        if o.get("payment_method") == "COD" and o.get("payment_status") == "DUE":
            cod_outstanding += total

    orders_total = len(orders)
    delivered = by_status.get("DELIVERED", 0)
    cancelled = by_status.get("CANCELLED", 0)
    rejected = by_status.get("REJECTED", 0)
    returned = by_status.get("RETURNED", 0)

    # Products sold = kg across DELIVERED line items.
    items = (
        client.table(_ORDER_ITEMS_TABLE)
        .select("quantity_kg, status")
        .eq("status", "DELIVERED")
        .execute()
    ).data or []
    products_sold = sum((Decimal(str(i["quantity_kg"])) for i in items), Decimal("0"))

    cancellation_rate = (cancelled / orders_total) if orders_total else 0.0
    return_rate = (returned / orders_total) if orders_total else 0.0

    return ORJSONResponse(
        AdminStatsOut(
            orders_total=orders_total,
            orders_by_status=by_status,
            delivered_count=delivered,
            cancelled_count=cancelled,
            rejected_count=rejected,
            returned_count=returned,
            revenue_booked_mad=f"{revenue_booked:.2f}",
            revenue_collected_mad=f"{revenue_collected:.2f}",
            cod_outstanding_mad=f"{cod_outstanding:.2f}",
            products_sold_kg=f"{products_sold:.2f}",
            cancellation_rate=round(cancellation_rate, 4),
            return_rate=round(return_rate, 4),
        ).model_dump(mode="json")
    )
