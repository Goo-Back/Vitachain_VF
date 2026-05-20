"""Health + version routes.

* ``/healthz`` — **liveness**. Constant-time, no external dependency.
  Consumed by Docker HEALTHCHECK, NGINX upstream tests, ``infra/scripts/verify.sh``.
* ``/readyz``  — **readiness**. Probes Supabase REST + Auth admin under a
  short timeout. Consumed by Uptime Kuma (INF-08), **not** Docker — we never
  want a Supabase blip to restart the backend.
* ``/version`` — build info.
"""

from __future__ import annotations

import anyio
import httpx
from fastapi import APIRouter, status
from fastapi.responses import ORJSONResponse

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/healthz", response_class=ORJSONResponse, summary="Liveness probe")
async def healthz() -> dict[str, str]:
    s = get_settings()
    return {"status": "ok", "service": s.service_name, "version": s.git_sha}


@router.get("/readyz", response_class=ORJSONResponse, summary="Readiness probe")
async def readyz() -> ORJSONResponse:
    s = get_settings()
    checks: dict[str, str] = {}
    key = s.supabase_service_role_key.get_secret_value()
    headers = {"apikey": key, "authorization": f"Bearer {key}"}

    async def _probe(name: str, url: str) -> None:
        try:
            with anyio.fail_after(s.readyz_timeout_s):
                async with httpx.AsyncClient(timeout=s.readyz_timeout_s) as client:
                    r = await client.get(url, headers=headers)
            checks[name] = "ok" if r.status_code < 500 else f"http_{r.status_code}"
        except Exception as exc:
            checks[name] = f"error:{type(exc).__name__}"

    base = str(s.supabase_url).rstrip("/")
    async with anyio.create_task_group() as tg:
        tg.start_soon(_probe, "supabase_rest", f"{base}/rest/v1/?select=1")
        tg.start_soon(_probe, "supabase_auth", f"{base}/auth/v1/admin/users?page=1&per_page=1")

    ready = all(v == "ok" for v in checks.values())
    return ORJSONResponse(
        {"status": "ready" if ready else "degraded", "checks": checks},
        status_code=(status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE),
    )


@router.get("/version", response_class=ORJSONResponse, summary="Build info")
async def version() -> dict[str, str]:
    s = get_settings()
    return {"service": s.service_name, "commit": s.git_sha}
