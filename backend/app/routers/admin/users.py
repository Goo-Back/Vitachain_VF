"""ADM-04 — admin user management endpoints.

Mounted at ``/api/v1/admin/users``:

  * ``GET   /``            — paginated, searchable list of every profile.
  * ``PATCH /{id}/role``   — change a user's role.
  * ``PATCH /{id}/ban``    — ban / unban a user.

All routes are gated by ``require_role("ADMIN")`` and use ``service_client()``
so the admin sees and edits every profile regardless of owner-RLS.

  * Role + verification_status + banned are protected by the migration 0005/0049
    ``enforce_profile_immutability`` BEFORE-UPDATE trigger, which only admits the
    ``service_role`` JWT — ``service_client()`` provides exactly that.
  * A ban is *enforced* at the auth layer: we set a Supabase auth
    ``ban_duration`` (via the admin API) which revokes the user's sessions, and
    mirror the state into ``profiles.banned`` for listing/filtering.

AUTH-05: ``routers/admin/`` is the allow-listed prefix for ``service_client()``.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from app.core.security import AuthUser, require_role
from app.core.supabase import get_supabase_admin
from app.db import service_client

router = APIRouter(prefix="/admin/users", tags=["admin", "users"])

Role = Literal["FARMER", "RESTAURANT", "CITIZEN", "ADMIN"]

# A long fixed ban == effectively permanent; "none" lifts it. Supabase expects a
# Go duration string. ~100 years.
_BAN_DURATION = "876000h"


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str | None
    role: str
    verification_status: str
    banned: bool
    created_at: str


class RoleBody(BaseModel):
    role: Role


class BanBody(BaseModel):
    banned: bool


@router.get("", response_class=ORJSONResponse)
async def list_users(
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    q: Annotated[str | None, Query(max_length=200)] = None,
    role: Annotated[Role | None, Query()] = None,
    status_filter: Annotated[
        Literal["active", "banned"] | None, Query(alias="status")
    ] = None,
    page: Annotated[int, Query(ge=0)] = 0,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    # JUSTIFICATION: ADM-04 admin user directory — listing every profile requires
    # bypassing owner-RLS; routers/admin/ is the AUTH-05 allow-listed prefix.
    client = service_client()

    query = client.table("profiles").select(
        "id, email, full_name, role, verification_status, banned, created_at",
        count="exact",
    )
    if q:
        # email or full_name contains `q` (case-insensitive).
        like = f"%{q}%"
        query = query.or_(f"email.ilike.{like},full_name.ilike.{like}")
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
        "users": [UserOut(**r).model_dump() for r in rows],
        "total": res.count or 0,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/{user_id}/role", response_class=ORJSONResponse)
async def set_role(
    user_id: uuid.UUID,
    body: RoleBody,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    if str(user_id) == str(admin.id):
        # Guard against the calling admin demoting themselves out of the console.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="cannot_change_own_role"
        )
    # JUSTIFICATION: ADM-04 role change — profiles.role is gated by the migration
    # 0005 immutability trigger; only the service_role JWT may write it.
    client = service_client()
    res = (
        client.table("profiles")
        .update({"role": body.role})
        .eq("id", str(user_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found"
        )
    return {"id": str(user_id), "role": body.role}


@router.patch("/{user_id}/ban", response_class=ORJSONResponse)
async def set_banned(
    user_id: uuid.UUID,
    body: BanBody,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    if str(user_id) == str(admin.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="cannot_ban_self"
        )

    # 1. Enforce at the auth layer — revokes existing sessions and blocks login.
    try:
        get_supabase_admin().auth.admin.update_user_by_id(
            str(user_id),
            {"ban_duration": _BAN_DURATION if body.banned else "none"},
        )
    except Exception as exc:  # noqa: BLE001 — surface as a clean 502
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="auth_ban_failed"
        ) from exc

    # 2. Mirror into profiles for the admin list/filter. service_client carries
    # the service_role JWT the immutability trigger admits.
    # JUSTIFICATION: ADM-04 ban flag — profiles.banned is admin-controlled by the
    # migration 0049 immutability guard; service_role is the only writer.
    client = service_client()
    res = (
        client.table("profiles")
        .update({"banned": body.banned})
        .eq("id", str(user_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found"
        )
    return {"id": str(user_id), "banned": body.banned}
