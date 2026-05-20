"""M3 BotaBa9a router (placeholder — BOT-* stories layer business code here)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

router = APIRouter(prefix="/botabaqa", tags=["botabaqa"])


@router.get("/healthz", response_class=ORJSONResponse)
async def botabaqa_healthz() -> dict[str, str]:
    return {"module": "botabaqa", "status": "ok"}
