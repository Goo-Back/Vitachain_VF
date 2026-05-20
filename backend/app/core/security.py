"""AUTH-03 — JWT validation and role gating.

Single source of truth for *who is calling the backend*. Every authenticated
route imports :func:`get_current_user`; role-gated routes layer
:func:`require_role` on top. Centralising here means JWT decode / expiry /
``sub`` parsing live in exactly one place — downstream stories (AUTH-04 RLS,
AUTH-06 KYC claim, every module endpoint) consume the resulting
:class:`AuthUser` and never touch raw payloads.

The signing secret is the **JWT secret** (Dashboard → Settings → API → JWT
Secret), not the service-role key. The latter bypasses RLS and lives only in
the service-role HTTP client (AUTH-05).
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Literal

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client

from app.core.config import get_settings
from app.db import user_scoped_client

Role = Literal["FARMER", "RESTAURANT", "CITIZEN", "ADMIN"]
VerificationStatus = Literal["PENDING", "VERIFIED", "REJECTED"]

# `auto_error=False` so we own the 401 vs 403 distinction: a missing header is
# 401_unauthorized (the route requires auth and the caller did not present it),
# not the default 403 HTTPBearer would emit. Downstream module stories rely on
# this code split when wiring frontend redirects.
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class AuthUser:
    """Decoded, validated caller identity. Immutable — pass by value."""

    id: uuid.UUID
    role: Role | None  # AUTH-02 places `user_role` in the JWT claims.
    verification_status: VerificationStatus | None  # AUTH-06 — `verification_status` claim
    email: str | None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _decode_jwt(token: str) -> dict:
    s = get_settings()
    try:
        return jwt.decode(
            token,
            s.supabase_jwt_secret.get_secret_value(),
            algorithms=[s.supabase_jwt_algorithm],
            audience=s.supabase_jwt_audience,
        )
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("token_expired") from exc
    except jwt.InvalidTokenError as exc:
        # Covers bad signature, malformed header, wrong audience, etc.
        raise _unauthorized("invalid_token") from exc


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
) -> AuthUser:
    """FastAPI dependency: extract + validate the bearer JWT.

    Raises 401 on a missing/expired/invalid token. Returns an
    :class:`AuthUser` populated from the JWT's ``sub``, ``user_role`` (the
    custom claim from AUTH-02), and ``email`` claims. Role-based access is
    delegated to :func:`require_role`.
    """
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise _unauthorized("missing_bearer_token")

    payload = _decode_jwt(creds.credentials)

    sub = payload.get("sub")
    if not sub:
        raise _unauthorized("missing_sub")
    try:
        uid = uuid.UUID(str(sub))
    except (ValueError, TypeError) as exc:
        raise _unauthorized("invalid_sub") from exc

    # AUTH-02's custom_access_token_hook lifts profiles.role to top-level
    # `user_role`. Older sessions (pre-hook) carry it in user_metadata /
    # app_metadata — accept both during the transition window. AUTH-06 will
    # layer `verification_status` here following the same pattern.
    role = (
        payload.get("user_role")
        or payload.get("app_metadata", {}).get("role")
        or payload.get("user_metadata", {}).get("role")
    )

    # AUTH-06 — `verification_status` claim is added in migration 0014.
    # Older sessions issued BEFORE that migration carry no claim → None.
    # Any route that gates on the value MUST use require_verified() (which
    # 403s on None) rather than reading the claim directly.
    verification_status = payload.get("verification_status")

    return AuthUser(
        id=uid,
        role=role,  # type: ignore[arg-type]
        verification_status=verification_status,  # type: ignore[arg-type]
        email=payload.get("email"),
    )


def require_role(*allowed: Role) -> Callable[..., Awaitable[AuthUser]]:
    """Factory: a dependency that 403s unless the caller has one of *allowed*.

    Expiry is checked *before* role (the inner ``get_current_user`` runs
    first), so an expired token surfaces as 401 even on a role-gated route —
    the frontend's auth-redirect path keys on the status code, not the body.
    """

    async def _guard(
        user: Annotated[AuthUser, Depends(get_current_user)],
    ) -> AuthUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="role_not_allowed",
            )
        return user

    return _guard


def require_verified(*allowed: Role) -> Callable[..., Awaitable[AuthUser]]:
    """AUTH-06 — factory: 403 unless the caller is in *allowed* AND verified.

    Role gate fires first (``role_not_allowed``), verification gate fires
    second (``verification_required``). The order is observable from the
    error body and matches ``require_role`` — frontend redirect logic can
    key on the detail string without parsing further.

    Use this on every route PRD §7.1 AUTH-06 names "professional action":
    create ad (FAR-01), publish meal (SEC-01), register parcel (KAT-01).
    Do NOT use this on /kyc/* — those endpoints are reachable by PENDING
    pros (that is the whole point of KYC).
    """

    async def _guard(
        user: Annotated[AuthUser, Depends(get_current_user)],
    ) -> AuthUser:
        if user.role not in allowed:
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

    return _guard


async def get_db_for_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
) -> Client:
    """AUTH-04 — RLS-scoped Supabase client for the caller.

    Wires the bearer credential from ``HTTPBearer`` into
    :func:`app.db.user_scoped_client`. The resulting client carries the
    caller's JWT in ``Authorization`` so PostgREST evaluates RLS as the
    authenticated user — never as the service role.

    Usage::

        from app.core.security import get_db_for_user

        @router.get("/ads")
        async def list_ads(db: Client = Depends(get_db_for_user)):
            return db.table("ads").select("*").execute().data

    Raises 401 if the bearer token is missing/empty. JWT signature validation
    happens on the Postgres side — pair this with ``Depends(get_current_user)``
    when the route also needs the decoded :class:`AuthUser`.
    """
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise _unauthorized("missing_bearer_token")
    return user_scoped_client(creds.credentials)
