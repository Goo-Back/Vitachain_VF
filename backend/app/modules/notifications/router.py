"""Notifications router (placeholder — NOT-* stories layer Brevo wrapper here)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/healthz", response_class=ORJSONResponse)
async def notifications_healthz() -> dict[str, str]:
    return {"module": "notifications", "status": "ok"}
