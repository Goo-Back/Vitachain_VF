"""M4 SecondServe router.

Currently hosts the cross-app SSO handoff (SEC-handoff) used by VitaChain to
open the separate SecondServe app already authenticated. SEC-* business stories
layer further endpoints here.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from app.core.security import AuthUser, get_current_user
from app.core.supabase import get_supabase_admin

router = APIRouter(prefix="/secondserve", tags=["secondserve"])


@router.get("/healthz", response_class=ORJSONResponse)
async def secondserve_healthz() -> dict[str, str]:
    return {"module": "secondserve", "status": "ok"}


class HandoffResponse(BaseModel):
    """Single-use OTP that SecondServe exchanges for its OWN session."""

    token_hash: str


@router.post("/handoff", response_class=ORJSONResponse)
async def secondserve_handoff(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> HandoffResponse:
    """Mint a one-time magic-link token so the caller can open SecondServe
    already authenticated.

    Why an OTP and not the caller's existing tokens: SecondServe lives on a
    different origin, so it cannot read VitaChain's cookie session. Passing the
    caller's refresh token would make both apps share one (rotating) refresh
    token chain → random cross-app logouts. Instead we generate a short-lived,
    single-use magic-link token here (service role, backend-only) which
    SecondServe verifies with `verifyOtp` to obtain an INDEPENDENT session.

    Farmers are barred from SecondServe (product rule), enforced here too so a
    crafted client request cannot bypass the UI gate.
    """
    if user.role == "FARMER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="farmer_not_allowed"
        )
    if not user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="missing_email"
        )

    admin = get_supabase_admin()
    try:
        # `generate_link` (admin) creates the token WITHOUT sending an email.
        res = admin.auth.admin.generate_link(
            {"type": "magiclink", "email": user.email}
        )
        # Response shape is stable across gotrue 2.x (res.properties.hashed_token),
        # but read defensively in case a dict is returned.
        props = getattr(res, "properties", None) or {}
        token_hash = getattr(props, "hashed_token", None)
        if token_hash is None and isinstance(props, dict):
            token_hash = props.get("hashed_token")
    except Exception as exc:  # noqa: BLE001 — surface as a clean 502
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="link_generation_failed"
        ) from exc

    if not token_hash:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="no_token_hash"
        )
    return HandoffResponse(token_hash=token_hash)
