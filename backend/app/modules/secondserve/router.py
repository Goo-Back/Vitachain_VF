"""M4 SecondServe router (placeholder — SEC-* stories layer business code here)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

router = APIRouter(prefix="/secondserve", tags=["secondserve"])


@router.get("/healthz", response_class=ORJSONResponse)
async def secondserve_healthz() -> dict[str, str]:
    return {"module": "secondserve", "status": "ok"}
