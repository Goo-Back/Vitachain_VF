"""ADM-05 — Centralised SecondServe administration endpoints.

SecondServe ships its own in-app admin (a client-only Vite app gated by the
``ss_profiles.role = 'admin'`` flag + ``ss_*`` RLS). This router brings the same
controls into the unified VitaChain admin console so a single ``profiles.role =
'ADMIN'`` operator can manage both products from one place.

Everything is gated by ``require_role("ADMIN")`` (VitaChain's role, *not*
SecondServe's) and uses ``service_client()`` to bypass ``ss_*`` RLS — the admin
sees and edits every SecondServe row regardless of owner.

Mounted at ``/api/v1/admin/secondserve``:

  Users
    * ``GET    /users``                — paginated, searchable profile list.
    * ``PATCH  /users/{id}/ban``       — ban / unban (SecondServe-scoped).
    * ``DELETE /users/{id}``           — permanently delete a profile.
  Partners
    * ``GET    /partners``             — restaurant accounts (pending/approved).
    * ``PATCH  /partners/{id}/approval`` — approve / suspend a restaurant.
  Orders
    * ``GET    /orders``               — global order ledger (filter + search).
    * ``PATCH  /orders/{id}/cancel``   — cancel an active order.
  Support
    * ``GET    /support``              — support ticket queue.
    * ``PATCH  /support/{id}/resolve`` — respond + mark resolved.
  Stats
    * ``GET    /stats``                — KPIs + bestselling snapshot.

Ban semantics: we set ``ss_profiles.banned`` only. We deliberately do NOT touch
the shared ``auth.users`` session — a SecondServe ban must stay scoped to
SecondServe and not lock the same person out of VitaChain. SecondServe enforces
the flag via its own RLS / query filters.

AUTH-05: ``routers/admin/`` is the allow-listed prefix for ``service_client()``.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from app.core.security import AuthUser, require_role
from app.db import service_client

router = APIRouter(prefix="/admin/secondserve", tags=["admin", "secondserve"])

_PROFILES = "ss_profiles"
_ORDERS = "ss_orders"
_TICKETS = "ss_support_tickets"

SsRole = Literal["consumer", "restaurant", "admin"]
OrderStatus = Literal["active", "cancelled", "completed"]


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class SsUserOut(BaseModel):
    id: str
    role: str
    email: str
    name: str
    city: str
    approved: bool
    banned: bool
    commerce_type: str | None = None
    address: str | None = None
    phone: str | None = None
    created_at: str


class SsOrderOut(BaseModel):
    id: str
    consumer_id: str
    consumer_name: str | None = None
    consumer_phone: str | None = None
    restaurant_id: str
    quantity: int
    total_price: float
    status: str
    payment_method: str
    payment_status: str
    paid_at: str | None = None
    offer_snapshot: dict[str, Any]
    created_at: str


class SsTicketOut(BaseModel):
    id: str
    user_id: str
    user_email: str
    user_name: str
    user_role: str
    subject: str
    message: str
    status: str
    response: str | None = None
    created_at: str


class BanBody(BaseModel):
    banned: bool


class ApprovalBody(BaseModel):
    approved: bool


class ResolveBody(BaseModel):
    response: str


SsPaymentStatus = Literal["pending", "successful", "failed"]


class PaymentOverrideBody(BaseModel):
    new_status: SsPaymentStatus
    reason: str


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.get("/users", response_class=ORJSONResponse)
async def list_users(
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    q: Annotated[str | None, Query(max_length=200)] = None,
    role: Annotated[SsRole | None, Query()] = None,
    status_filter: Annotated[
        Literal["active", "banned"] | None, Query(alias="status")
    ] = None,
    page: Annotated[int, Query(ge=0)] = 0,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    # JUSTIFICATION: ADM-05 SecondServe directory — listing every ss_profiles row
    # bypasses owner-RLS; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()
    query = client.table(_PROFILES).select(
        "id, role, email, name, city, approved, banned, commerce_type,"
        " address, phone, created_at",
        count="exact",
    )
    if q:
        like = f"%{q}%"
        query = query.or_(f"email.ilike.{like},name.ilike.{like}")
    if role:
        query = query.eq("role", role)
    if status_filter == "banned":
        query = query.eq("banned", True)
    elif status_filter == "active":
        query = query.eq("banned", False)

    res = (
        query.order("created_at", desc=True)
        .range(page * page_size, page * page_size + page_size - 1)
        .execute()
    )
    rows = res.data or []
    return {
        "items": [SsUserOut(**r).model_dump() for r in rows],
        "total": res.count or 0,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/users/{user_id}/ban", response_class=ORJSONResponse)
async def set_banned(
    user_id: uuid.UUID,
    body: BanBody,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    # Ban stays SecondServe-scoped: we flip ss_profiles.banned only and never
    # revoke the shared auth.users session (that would lock the person out of
    # VitaChain too). SecondServe enforces the flag through its own RLS.
    # JUSTIFICATION: ADM-05 SecondServe ban — ss_profiles is RLS-guarded;
    # routers/admin/ is the AUTH-05 allow-listed service_client() prefix.
    client = service_client()
    res = (
        client.table(_PROFILES)
        .update({"banned": body.banned})
        .eq("id", str(user_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found"
        )
    return {"id": str(user_id), "banned": body.banned}


@router.delete("/users/{user_id}", response_class=ORJSONResponse)
async def delete_user(
    user_id: uuid.UUID,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    # JUSTIFICATION: ADM-05 SecondServe account removal — deleting an ss_profiles
    # row bypasses owner-RLS; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()
    res = (
        client.table(_PROFILES).delete().eq("id", str(user_id)).execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found"
        )
    return {"id": str(user_id), "deleted": True}


# ---------------------------------------------------------------------------
# Partners
# ---------------------------------------------------------------------------


@router.get("/partners", response_class=ORJSONResponse)
async def list_partners(
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    approved: Annotated[bool | None, Query()] = None,
    page: Annotated[int, Query(ge=0)] = 0,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict:
    # JUSTIFICATION: ADM-05 partner approvals — restaurant accounts are read
    # across all owners; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()
    query = client.table(_PROFILES).select(
        "id, role, email, name, city, approved, banned, commerce_type,"
        " address, phone, created_at",
        count="exact",
    ).eq("role", "restaurant")
    if approved is not None:
        query = query.eq("approved", approved)

    res = (
        query.order("created_at", desc=True)
        .range(page * page_size, page * page_size + page_size - 1)
        .execute()
    )
    rows = res.data or []
    return {
        "items": [SsUserOut(**r).model_dump() for r in rows],
        "total": res.count or 0,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/partners/{partner_id}/approval", response_class=ORJSONResponse)
async def set_approval(
    partner_id: uuid.UUID,
    body: ApprovalBody,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    # JUSTIFICATION: ADM-05 partner approval — ss_profiles.approved is admin-only
    # under SecondServe RLS; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()
    res = (
        client.table(_PROFILES)
        .update({"approved": body.approved})
        .eq("id", str(partner_id))
        .eq("role", "restaurant")
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="partner_not_found"
        )
    return {"id": str(partner_id), "approved": body.approved}


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------


@router.get("/orders", response_class=ORJSONResponse)
async def list_orders(
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    status_filter: Annotated[OrderStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    page: Annotated[int, Query(ge=0)] = 0,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict:
    # JUSTIFICATION: ADM-05 global order ledger — every ss_orders row is read
    # regardless of owner; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()
    query = client.table(_ORDERS).select(
        "id, consumer_id, consumer_name, consumer_phone, restaurant_id,"
        " quantity, total_price, status, payment_method, payment_status,"
        " paid_at, offer_snapshot, created_at",
        count="exact",
    )
    if status_filter:
        query = query.eq("status", status_filter)
    if q:
        like = f"%{q}%"
        query = query.or_(
            f"consumer_name.ilike.{like},consumer_phone.ilike.{like}"
        )

    res = (
        query.order("created_at", desc=True)
        .range(page * page_size, page * page_size + page_size - 1)
        .execute()
    )
    rows = res.data or []
    return {
        "items": [SsOrderOut(**r).model_dump() for r in rows],
        "total": res.count or 0,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/orders/{order_id}/cancel", response_class=ORJSONResponse)
async def cancel_order(
    order_id: uuid.UUID,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    # JUSTIFICATION: ADM-05 order cancellation — ss_orders writes are owner/admin
    # only under RLS; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()
    res = (
        client.table(_ORDERS)
        .update({"status": "cancelled"})
        .eq("id", str(order_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="order_not_found"
        )
    return {"id": str(order_id), "status": "cancelled"}


_PAYMENT_AUDIT = "ss_payment_audit"


@router.patch("/orders/{order_id}/payment", response_class=ORJSONResponse)
async def override_payment_status(
    order_id: uuid.UUID,
    body: PaymentOverrideBody,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    """ADM-05 COD reconciliation: manually set payment_status with a mandatory reason.

    Use cases: driver deposited cash but consumer forgot to confirm, disputed
    payment, failed delivery that needs to be marked failed.
    """
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="reason_required",
        )
    # JUSTIFICATION: ADM-05 payment override — ss_orders payment_status update
    # bypasses consumer-scoped RLS; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()

    order_res = (
        client.table(_ORDERS)
        .select("id, payment_method, payment_status, paid_at")
        .eq("id", str(order_id))
        .maybe_single()
        .execute()
    )
    if not order_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="order_not_found"
        )
    order = order_res.data
    prev_status = order["payment_status"]
    prev_paid_at = order.get("paid_at")

    new_paid_at = None
    if body.new_status == "successful" and prev_status != "successful":
        from datetime import datetime, timezone
        new_paid_at = datetime.now(timezone.utc).isoformat()

    patch: dict[str, Any] = {"payment_status": body.new_status}
    if new_paid_at:
        patch["paid_at"] = new_paid_at
    elif body.new_status != "successful":
        patch["paid_at"] = None

    update_res = (
        client.table(_ORDERS)
        .update(patch)
        .eq("id", str(order_id))
        .execute()
    )
    if not update_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="order_not_found"
        )

    client.table(_PAYMENT_AUDIT).insert({
        "order_id": str(order_id),
        "actor_id": admin.sub,
        "actor_role": "admin",
        "previous_status": prev_status,
        "new_status": body.new_status,
        "previous_paid_at": prev_paid_at,
        "new_paid_at": new_paid_at or prev_paid_at if body.new_status == "successful" else None,
        "reason": reason,
    }).execute()

    return {
        "id": str(order_id),
        "payment_status": body.new_status,
        "paid_at": new_paid_at or (prev_paid_at if body.new_status == "successful" else None),
    }


@router.get("/orders/{order_id}/payment-audit", response_class=ORJSONResponse)
async def get_payment_audit(
    order_id: uuid.UUID,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    """ADM-05 payment audit trail for a single SecondServe order."""
    # JUSTIFICATION: ADM-05 payment audit view — ss_payment_audit is admin-readable
    # via RLS; service_client used for consistency; routers/admin/ is AUTH-05 prefix.
    client = service_client()
    res = (
        client.table(_PAYMENT_AUDIT)
        .select(
            "id, order_id, actor_id, actor_role, previous_status, new_status,"
            " previous_paid_at, new_paid_at, reason, created_at"
        )
        .eq("order_id", str(order_id))
        .order("created_at", desc=False)
        .execute()
    )
    return {"order_id": str(order_id), "entries": res.data or []}


# ---------------------------------------------------------------------------
# Support
# ---------------------------------------------------------------------------


@router.get("/support", response_class=ORJSONResponse)
async def list_tickets(
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    status_filter: Annotated[
        Literal["pending", "resolved"] | None, Query(alias="status")
    ] = None,
    page: Annotated[int, Query(ge=0)] = 0,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict:
    # JUSTIFICATION: ADM-05 support queue — all ss_support_tickets are read by
    # the admin; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()
    query = client.table(_TICKETS).select(
        "id, user_id, user_email, user_name, user_role, subject, message,"
        " status, response, created_at",
        count="exact",
    )
    if status_filter:
        query = query.eq("status", status_filter)

    res = (
        query.order("created_at", desc=True)
        .range(page * page_size, page * page_size + page_size - 1)
        .execute()
    )
    rows = res.data or []
    return {
        "items": [SsTicketOut(**r).model_dump() for r in rows],
        "total": res.count or 0,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/support/{ticket_id}/resolve", response_class=ORJSONResponse)
async def resolve_ticket(
    ticket_id: uuid.UUID,
    body: ResolveBody,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    response = body.response.strip()
    if not response:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="response_required",
        )
    # JUSTIFICATION: ADM-05 ticket resolution — ss_support_tickets updates are
    # admin-only under RLS; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()
    res = (
        client.table(_TICKETS)
        .update({"status": "resolved", "response": response})
        .eq("id", str(ticket_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="ticket_not_found"
        )
    return {"id": str(ticket_id), "status": "resolved"}


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


@router.get("/stats", response_class=ORJSONResponse)
async def stats(
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    # JUSTIFICATION: ADM-05 KPIs — aggregating counts/revenue across every
    # ss_* row bypasses RLS; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()

    def _count(table: str, **eq: Any) -> int:
        q = client.table(table).select("id", count="exact")
        for col, val in eq.items():
            q = q.eq(col, val)
        return q.execute().count or 0

    total_users = _count(_PROFILES)
    total_partners = _count(_PROFILES, role="restaurant")
    total_orders = _count(_ORDERS)
    completed_orders = _count(_ORDERS, status="completed")
    cancelled_orders = _count(_ORDERS, status="cancelled")
    active_orders = _count(_ORDERS, status="active")
    open_tickets = _count(_TICKETS, status="pending")

    # Revenue + bestsellers need the rows; pull the lean columns only.
    order_rows = (
        client.table(_ORDERS)
        .select("quantity, total_price, status, payment_status, offer_snapshot")
        .execute()
        .data
        or []
    )

    revenue = 0.0
    meals_rescued = 0
    freq: dict[str, dict[str, Any]] = {}
    for o in order_rows:
        price = float(o.get("total_price") or 0)
        qty = int(o.get("quantity") or 0)
        if o.get("status") == "completed" or o.get("payment_status") == "successful":
            revenue += price
        if o.get("status") != "cancelled":
            meals_rescued += qty
        snap = o.get("offer_snapshot") or {}
        key = str(snap.get("id") or snap.get("name") or "")
        if not key:
            continue
        bucket = freq.setdefault(
            key,
            {"name": snap.get("name") or "—", "image": snap.get("image") or "",
             "count": 0, "revenue": 0.0},
        )
        bucket["count"] += qty
        bucket["revenue"] += price

    popular = sorted(freq.values(), key=lambda b: b["count"], reverse=True)[:5]
    cancellation_rate = (cancelled_orders / total_orders) if total_orders else 0.0

    return {
        "total_users": total_users,
        "total_partners": total_partners,
        "total_orders": total_orders,
        "active_orders": active_orders,
        "completed_orders": completed_orders,
        "cancelled_orders": cancelled_orders,
        "open_tickets": open_tickets,
        "revenue": round(revenue, 2),
        "meals_rescued": meals_rescued,
        "cancellation_rate": round(cancellation_rate, 4),
        "popular_products": popular,
    }
