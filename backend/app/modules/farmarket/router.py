"""M2 FarMarket router (placeholder — FAR-* stories layer business code here)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

router = APIRouter(prefix="/farmarket", tags=["farmarket"])


@router.get("/healthz", response_class=ORJSONResponse)
async def farmarket_healthz() -> dict[str, str]:
    return {"module": "farmarket", "status": "ok"}
