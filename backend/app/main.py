"""FastAPI app factory.

Importing this module triggers ``create_app()`` at module level so uvicorn /
gunicorn can do ``app.main:app``. Tests build a fresh app per test via
``create_app()`` directly.
"""

from __future__ import annotations

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.middleware import RequestIdMiddleware
from app.core.observability import init_observability
from app.modules.botabaqa.router import router as botabaqa_router
from app.modules.farmarket.router import router as farmarket_router
from app.modules.katara.devices import router as katara_devices_router
from app.modules.katara.devices import unlink_router as katara_unlink_router
from app.modules.katara.diagnostics import router as katara_diagnostics_router
from app.modules.katara.external import router as katara_external_router
from app.modules.katara.ingest import router as katara_ingest_router
from app.modules.katara.overview import router as katara_overview_router
from app.modules.katara.router import router as katara_router
from app.modules.katara.telemetry import (
    devices_history_router as katara_devices_history_router,
)
from app.modules.katara.telemetry import router as katara_telemetry_router
from app.modules.katara.thresholds import router as katara_thresholds_router
from app.modules.notifications.router import router as notifications_router
from app.modules.secondserve.router import router as secondserve_router
from app.routers.admin.farmarket import router as admin_farmarket_router
from app.routers.admin.kyc import router as admin_kyc_router
from app.routers.admin.users import router as admin_users_router
from app.routers.health import router as health_router
from app.routers.kyc import router as kyc_router

# Mirror every worker __main__: load backend/.env into os.environ. pydantic-
# settings reads .env for the Settings object, but NOT into os.environ — so the
# request-time clients that read os.environ directly (owm_client /
# sentinel_client, behind /katara/parcels/{id}/weather and /ndvi) raise
# KeyError → 500 when the API is started with `uvicorn app.main:app`. Loading
# here (override=False, so real env vars and the conftest test-seed always win)
# makes those keys available without changing the documented dev workflow.
load_dotenv()


def create_app() -> FastAPI:
    configure_logging()
    s = get_settings()

    app = FastAPI(
        title="VitaChain Backend",
        version="0.1.0",
        default_response_class=ORJSONResponse,
        docs_url="/api/v1/docs" if s.environment != "prod" else None,
        redoc_url=None,
        openapi_url="/api/v1/openapi.json" if s.environment != "prod" else None,
    )

    # INF-08 — Sentry init must happen BEFORE the first middleware so the
    # FastApiIntegration can wrap the ASGI stack at the outermost layer.
    init_observability(app)

    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id",
                       "X-Device-Id", "X-Device-Api-Key"],
        expose_headers=["X-Request-Id", "X-Telemetry-Id"],
    )

    app.include_router(health_router, prefix="/api/v1")
    app.include_router(kyc_router, prefix="/api/v1")
    app.include_router(admin_kyc_router, prefix="/api/v1")
    app.include_router(admin_farmarket_router, prefix="/api/v1")
    app.include_router(admin_users_router, prefix="/api/v1")
    app.include_router(katara_router, prefix="/api/v1")
    app.include_router(katara_devices_router, prefix="/api/v1")
    app.include_router(katara_unlink_router, prefix="/api/v1")
    app.include_router(katara_ingest_router, prefix="/api/v1")
    app.include_router(katara_telemetry_router, prefix="/api/v1")
    app.include_router(katara_devices_history_router, prefix="/api/v1")
    app.include_router(katara_thresholds_router, prefix="/api/v1")
    app.include_router(katara_diagnostics_router, prefix="/api/v1")
    app.include_router(katara_overview_router, prefix="/api/v1")
    app.include_router(katara_external_router, prefix="/api/v1")
    app.include_router(farmarket_router, prefix="/api/v1")
    app.include_router(secondserve_router, prefix="/api/v1")
    app.include_router(botabaqa_router, prefix="/api/v1")
    app.include_router(notifications_router, prefix="/api/v1")

    # INF-08 — planted error route. Only out of prod; before_send drops the
    # event if a prod instance is ever accidentally hit.
    if s.environment != "prod":
        @app.get("/api/v1/_sentry_test", tags=["_internal"])
        async def _sentry_test() -> dict[str, str]:
            raise RuntimeError(
                "INF-08 planted test — if you see this in Sentry, the pipeline is wired."
            )

    return app


app = create_app()
