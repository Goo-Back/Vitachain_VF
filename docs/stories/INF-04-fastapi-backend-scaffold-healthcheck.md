# INF-04 — FastAPI backend scaffold + healthcheck endpoint

> **Epic:** E0 — Infrastructure & DevOps Foundation
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must
> **Status:** TODO
> **Depends on:** [INF-01](INF-01-provision-vps-docker-nginx.md) (`IN_PROGRESS` — VPS/Docker/NGINX), [INF-02](INF-02-supabase-project-base-schema.md) (`DONE` — project `qyyxgdfetzjqfpygikbz`, `eu-central-1`, PG17)
> **Unblocks:** AUTH-05, INF-05, INF-08, NOT-01, KAT-03 → KAT-13, FAR-03, FAR-04, FAR-06, SEC-04 → SEC-08, ADM-02
> **Acceptance:** `curl http://vitachain.ma/api/v1/healthz` returns `200 OK` with `{"status":"ok","service":"backend"}` behind NGINX.

---

## 1. Purpose

Stand up the single FastAPI application that will own every server-side workflow Next.js cannot do directly against Supabase under RLS — `service_role` reads, business-rule enforcement, IoT ingestion (`KAT-03`), atomic stock decrement (`SEC-04`), Brevo email triggers (`NOT-01`), AI orchestration (`KAT-08`).

The scope here is deliberately narrow: **scaffold + healthcheck only**. No domain endpoints, no auth dependency wiring beyond stubs, no Celery, no Redis. Domain stories layer their routers on top of this skeleton; `AUTH-05` proves the service-role isolation; `INF-05` adds CI; `INF-08` adds Sentry; `NOT-01` adds the Brevo wrapper.

When this story is `DONE`, the PRD §12 Phase-1 gate is fully satisfied (the other half — Next.js auth journey — landed under [INF-03](INF-03-nextjs-scaffold-login-dashboard.md)): NGINX terminates HTTP, fronts `/` → frontend and `/api/v1/*` → backend, and `curl http://vitachain.ma/api/v1/healthz` is the canary that proves the wiring on the VPS.

---

## 2. Scope

### In scope

- FastAPI 0.115+ project under `backend/`, Python 3.12, Pydantic v2, type-checked end-to-end.
- App factory pattern (`create_app()`) so tests, scripts, and uvicorn share one entry point.
- Settings via `pydantic-settings` reading `backend/.env` (locally) / Docker env (VPS).
- Supabase **service-role** client singleton (`AUTH-05`) — instantiated lazily, never exported from a module the frontend could import.
- Routers:
  - `GET /api/v1/healthz` — **liveness**: returns `200 {"status":"ok","service":"backend","version":<git-sha-or-tag>}`. No external dependency. Never blocks.
  - `GET /api/v1/readyz` — **readiness**: pings Supabase REST + auth admin (`select 1` via PostgREST + `auth/v1/admin/users?per_page=1`); returns `200 {"status":"ready","checks":{...}}` only if both succeed inside `READYZ_TIMEOUT_S` (default 2 s); else `503`.
  - `GET /api/v1/version` — `{commit, built_at}` for ops.
- Stubbed module routers — empty `APIRouter()` files under `app/modules/{katara,farmarket,secondserve,botabaqa,notifications}/router.py`, each mounted under `/api/v1/<module>/` with a single `GET /api/v1/<module>/healthz` that returns `200 {"module":"<name>"}`. These give every downstream story a known import path; no business code lives here yet.
- Auth dependency stubs — `get_current_user` (verifies the Supabase JWT via the project's JWT secret, returns `{sub, role, email}`) and `require_role(*allowed)` (raises `403` otherwise). **Wired but not yet attached** to any route — `AUTH-03`/`AUTH-05` will exercise them; `KAT-03` is the first consumer.
- Logging: structlog → JSON to stdout. Request-id middleware (uuid7 if available, uuid4 fallback) propagating `X-Request-Id`.
- CORS: locked to `NEXT_PUBLIC_SITE_URL` + `http://localhost:3000` (dev only).
- Multi-stage Dockerfile (`python:3.12-slim`, non-root, `uvicorn` under `gunicorn` with the `uvicorn.workers.UvicornWorker` class, 2 workers default).
- `HEALTHCHECK` on the container hitting `/api/v1/healthz` directly.
- NGINX vhost extension: `location /api/v1/` → `proxy_pass http://vita_backend;` with `proxy_set_header` trio, `client_max_body_size 10m`, `proxy_read_timeout 300s` (preparing for slow `KAT-08` AI calls; tightened by `AUTH-08` for `/ingest`).
- `docker-compose.yml` `backend` service on `vita_net`, `expose: ["8000"]`, never published to the host.
- `backend/.env.example` listing exactly the variables this app may read.
- `infra/scripts/verify.sh` extended with backend checks (mirrors the INF-03 pattern).
- Smoke tests (pytest + httpx ASGI transport) for the four health routes.

### Out of scope (later stories)

- Real auth wiring on protected endpoints → **AUTH-03** (JWT verification roll-out), **AUTH-04** (RLS reads through user JWT).
- Service-role isolation **proof** via CI grep + bundle check → **AUTH-05** / **INF-05**.
- Brevo client wrapper + transactional email templates → **NOT-01..NOT-07**.
- IoT ingestion endpoint with the 50 ms SLA → **KAT-03**.
- Atomic stock decrement / pickup code generation → **SEC-04**.
- CRON workers (ad expiry, meal expiry, offline-device detection) → **FAR-06**, **SEC-07**, **KAT-11**.
- Sentry SDK init → **INF-08**.
- HTTPS / HSTS / cert rotation → **INF-06**.
- NGINX rate limiting on `/api/v1/*` → **AUTH-08**.
- CI pipeline (ruff + mypy + pytest + Docker build) → **INF-05**.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-01](INF-01-provision-vps-docker-nginx.md) `DONE` *(or local Docker Desktop for the smoke pass)* | VPS reachable, NGINX accepting upstream pool extensions. |
| [INF-02](INF-02-supabase-project-base-schema.md) `DONE` | Need `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (Bitwarden). |
| Python 3.12 locally | Match the Docker base image; avoids subtle stdlib drift. |
| `pip` ≥ 24, optionally `uv` for faster local installs | Lockfile is `requirements.lock.txt` (pip-tools `compile`). Do not switch to Poetry without team alignment. |
| Bitwarden access | `VitaChain — Supabase URL`, `Supabase service_role key`, `Supabase JWT secret`. |
| `make` on developer laptops | Reuses the same target style as `infra/Makefile` and `db/Makefile`. |

---

## 4. Target configuration

| Setting | Value | Source |
|---|---|---|
| Framework | FastAPI ≥ 0.115 | PRD §2.1; tech spec §2.1 (Python 3.12 + FastAPI). |
| ASGI server | `uvicorn[standard]` under `gunicorn -k uvicorn.workers.UvicornWorker` | Production-grade graceful shutdown + worker recycling. |
| Workers | `WEB_CONCURRENCY=2` (default) | Fits the 4 vCPU VPS without starving NGINX/frontend. Tunable via env. |
| Python | 3.12.x | Tech spec §2.1. |
| Type checker | mypy strict mode (CI-only — INF-05 turns it on) | Catches Pydantic v2 + async drift early. |
| Lint/format | ruff + ruff-format | Single tool, replaces black + isort + flake8. |
| Dep manager | `pip-tools` (`requirements.in` → `requirements.lock.txt`) | Reproducible; no `Pipfile`/`poetry.lock` to maintain. |
| URL prefix | `/api/v1` | Tech spec §2.3 / §3.x — every module router mounts under this. |
| Health (live) | `GET /api/v1/healthz` | Tech spec §7.2 "NGINX routing works for at least 2 routes (`/` → frontend, `/api/v1/health` → backend)". |
| Health (ready) | `GET /api/v1/readyz` | Distinct from liveness — used by Uptime Kuma in INF-08, **not** by Docker. |
| Container port | `8000`, exposed only on `vita_net` | NGINX is the sole ingress. |
| Telemetry | None at this stage | Sentry attaches in INF-08; OpenTelemetry deferred. |
| Time | UTC everywhere; logs in ISO-8601 with `Z` suffix | Aligns with `timestamptz` storage from INF-02. |

---

## 5. Step-by-Step Implementation

### 5.1 Project layout

From the repo root, create:

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                  # create_app() + uvicorn entry
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py            # Settings (pydantic-settings)
│   │   ├── logging.py           # structlog config
│   │   ├── middleware.py        # request_id middleware
│   │   ├── supabase.py          # service-role client singleton
│   │   └── security.py          # JWT verify + role dep (stubs)
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── health.py            # /healthz, /readyz, /version
│   │   └── meta.py              # OpenAPI tags metadata
│   └── modules/
│       ├── __init__.py
│       ├── katara/router.py     # placeholder
│       ├── farmarket/router.py  # placeholder
│       ├── secondserve/router.py# placeholder
│       ├── botabaqa/router.py   # placeholder
│       └── notifications/router.py  # placeholder
├── tests/
│   ├── __init__.py
│   ├── conftest.py              # async client fixture
│   └── test_health.py           # health/readiness smoke
├── .env.example
├── .dockerignore
├── Dockerfile
├── Makefile
├── pyproject.toml               # ruff + pytest config (no build backend yet)
├── requirements.in              # top-level deps
└── requirements.lock.txt        # pinned (pip-compile output)
```

### 5.2 Dependencies

[backend/requirements.in](../../backend/requirements.in):

```
fastapi>=0.115,<0.116
uvicorn[standard]>=0.32,<0.33
gunicorn>=23.0,<24.0
pydantic>=2.9,<3.0
pydantic-settings>=2.5,<3.0
httpx>=0.27,<0.28          # used by readiness probe + future Brevo client
supabase>=2.8,<3.0         # service-role client (sync + async wrappers)
PyJWT[crypto]>=2.9,<3.0    # JWT verification (AUTH-03 will exercise)
python-multipart>=0.0.12   # form parsing (later: FAR-07 photo upload)
structlog>=24.4,<25.0
orjson>=3.10,<4.0          # faster JSON responses (FastAPI ORJSONResponse)
```

Generate the lockfile (once, then on every change):

```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate   # Git-Bash on Windows
pip install pip-tools
pip-compile --generate-hashes --output-file=requirements.lock.txt requirements.in
pip install -r requirements.lock.txt
```

Commit both `requirements.in` and `requirements.lock.txt`.

### 5.3 Settings

[backend/app/core/config.py](../../backend/app/core/config.py):

```python
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend configuration.

    Loaded from environment variables; in dev, `backend/.env` is auto-loaded.
    Anything starting with ``NEXT_PUBLIC_`` is owned by the frontend (INF-03)
    and MUST NOT be read here.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- runtime --------------------------------------------------------------
    environment: Literal["dev", "ci", "prod"] = "dev"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    service_name: str = "backend"
    git_sha: str = Field(default="unknown", alias="GIT_SHA")

    # --- Supabase (service-role, backend-only — AUTH-05) ----------------------
    supabase_url: AnyHttpUrl
    supabase_service_role_key: SecretStr
    supabase_jwt_secret: SecretStr
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_algorithm: Literal["HS256"] = "HS256"  # Supabase default

    # --- HTTP -----------------------------------------------------------------
    cors_allow_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://vitachain.ma"]
    )
    readyz_timeout_s: float = 2.0


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
```

### 5.4 Supabase client (service-role, lazy)

[backend/app/core/supabase.py](../../backend/app/core/supabase.py):

```python
from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache(maxsize=1)
def get_supabase_admin() -> Client:
    """Service-role Supabase client. **Never** exposed to the frontend.

    Bypasses RLS. Only routers that need server-side writes (KAT-03 ingest,
    SEC-04 reservation, NOT-* email triggers, ADM-* admin actions) should
    consume this dependency. Routes that read data on behalf of an end user
    must use the user's JWT instead (AUTH-04).
    """
    s = get_settings()
    return create_client(str(s.supabase_url), s.supabase_service_role_key.get_secret_value())
```

> The client is only constructed on first call, so importing `app.core.supabase` in a test that mocks `get_supabase_admin` does not hit the network.

### 5.5 Security stubs

[backend/app/core/security.py](../../backend/app/core/security.py):

```python
from __future__ import annotations

from typing import Annotated, Iterable, Literal, TypedDict

import jwt
from fastapi import Depends, Header, HTTPException, status

from app.core.config import get_settings

Role = Literal["FARMER", "RESTAURANT", "CITIZEN", "ADMIN"]


class CurrentUser(TypedDict):
    sub: str
    email: str | None
    role: Role | None


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Verify a Supabase access token and return the principal.

    AUTH-03 wires this onto protected routes; AUTH-02 adds `role` as a custom
    JWT claim. Today the dependency exists but is not attached to any route.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = authorization.split(" ", 1)[1]
    s = get_settings()
    try:
        payload = jwt.decode(
            token,
            s.supabase_jwt_secret.get_secret_value(),
            algorithms=[s.supabase_jwt_algorithm],
            audience=s.supabase_jwt_audience,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from exc
    return CurrentUser(
        sub=str(payload["sub"]),
        email=payload.get("email"),
        role=payload.get("user_metadata", {}).get("role")
        or payload.get("app_metadata", {}).get("role"),
    )


def require_role(*allowed: Role):
    """FastAPI dependency factory: 403 unless the caller has one of *allowed*."""

    async def _guard(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if user["role"] not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "role not allowed")
        return user

    return _guard
```

> Until `AUTH-02` lands the `custom_access_token_hook`, `role` arrives via `user_metadata` (set by INF-03's `register` action). The dependency tolerates both shapes.

### 5.6 Logging + request-id middleware

[backend/app/core/logging.py](../../backend/app/core/logging.py):

```python
from __future__ import annotations

import logging
import sys

import structlog

from app.core.config import get_settings


def configure_logging() -> None:
    s = get_settings()
    level = getattr(logging, s.log_level)
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(level),
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ],
        cache_logger_on_first_use=True,
    )
```

[backend/app/core/middleware.py](../../backend/app/core/middleware.py):

```python
from __future__ import annotations

import uuid
from typing import Awaitable, Callable

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Tag every request with an X-Request-Id (in + out) and bind it to logs."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        structlog.contextvars.bind_contextvars(request_id=rid, path=request.url.path)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id", "path")
        response.headers["X-Request-Id"] = rid
        return response
```

### 5.7 Health router

[backend/app/routers/health.py](../../backend/app/routers/health.py):

```python
from __future__ import annotations

import anyio
import httpx
from fastapi import APIRouter, status
from fastapi.responses import ORJSONResponse

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/healthz", response_class=ORJSONResponse, summary="Liveness probe")
async def healthz() -> dict[str, str]:
    """Liveness — process is up. No external dependency.

    Consumed by Docker's HEALTHCHECK, NGINX upstream tests, and INF-01's
    verify.sh. MUST stay constant-time and never block.
    """
    s = get_settings()
    return {"status": "ok", "service": s.service_name, "version": s.git_sha}


@router.get("/readyz", response_class=ORJSONResponse, summary="Readiness probe")
async def readyz() -> ORJSONResponse:
    """Readiness — backend can reach Supabase REST + Auth admin.

    Consumed by Uptime Kuma (INF-08) and humans during incidents. Distinct
    from liveness so Docker never restarts the container just because
    Supabase is briefly unreachable.
    """
    s = get_settings()
    checks: dict[str, str] = {}
    headers = {
        "apikey": s.supabase_service_role_key.get_secret_value(),
        "authorization": f"Bearer {s.supabase_service_role_key.get_secret_value()}",
    }

    async def _probe(name: str, url: str) -> None:
        try:
            with anyio.fail_after(s.readyz_timeout_s):
                async with httpx.AsyncClient(timeout=s.readyz_timeout_s) as client:
                    r = await client.get(url, headers=headers)
                checks[name] = "ok" if r.status_code < 500 else f"http_{r.status_code}"
        except Exception as exc:  # noqa: BLE001
            checks[name] = f"error:{type(exc).__name__}"

    base = str(s.supabase_url).rstrip("/")
    async with anyio.create_task_group() as tg:
        tg.start_soon(_probe, "supabase_rest", f"{base}/rest/v1/?select=1")
        tg.start_soon(_probe, "supabase_auth", f"{base}/auth/v1/admin/users?page=1&per_page=1")

    ready = all(v == "ok" for v in checks.values())
    return ORJSONResponse(
        {"status": "ready" if ready else "degraded", "checks": checks},
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
    )


@router.get("/version", response_class=ORJSONResponse, summary="Build info")
async def version() -> dict[str, str]:
    s = get_settings()
    return {"service": s.service_name, "commit": s.git_sha}
```

### 5.8 Module placeholders

Repeat the same shape for each module — example for Katara:

[backend/app/modules/katara/router.py](../../backend/app/modules/katara/router.py):

```python
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

router = APIRouter(prefix="/katara", tags=["katara"])


@router.get("/healthz", response_class=ORJSONResponse)
async def katara_healthz() -> dict[str, str]:
    """Per-module liveness; lets ops bisect which router is loaded."""
    return {"module": "katara", "status": "ok"}
```

Create `farmarket/router.py`, `secondserve/router.py`, `botabaqa/router.py`, `notifications/router.py` with the same template (change `prefix` and `module` string each time).

### 5.9 App factory

[backend/app/main.py](../../backend/app/main.py):

```python
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.middleware import RequestIdMiddleware
from app.modules.botabaqa.router import router as botabaqa_router
from app.modules.farmarket.router import router as farmarket_router
from app.modules.katara.router import router as katara_router
from app.modules.notifications.router import router as notifications_router
from app.modules.secondserve.router import router as secondserve_router
from app.routers.health import router as health_router


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

    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
        expose_headers=["X-Request-Id"],
    )

    # Cross-cutting health surface (no /api/v1 prefix yet — added below).
    app.include_router(health_router, prefix="/api/v1")
    # Module placeholders — each one owns its `/api/v1/<module>` namespace.
    app.include_router(katara_router, prefix="/api/v1")
    app.include_router(farmarket_router, prefix="/api/v1")
    app.include_router(secondserve_router, prefix="/api/v1")
    app.include_router(botabaqa_router, prefix="/api/v1")
    app.include_router(notifications_router, prefix="/api/v1")

    return app


app = create_app()
```

> Docs (`/api/v1/docs`) are exposed in `dev`/`ci` and hidden in `prod` — surface area reduction; AUTH-08 will rate-limit the path anyway, but better never to advertise it.

### 5.10 Environment template

[backend/.env.example](../../backend/.env.example):

```ini
# VitaChain backend — backend-only environment. Owning story: INF-04.
# NEVER add a `NEXT_PUBLIC_*` variable here — the frontend owns those (INF-03).
# NEVER paste these values into anything reachable by the browser (AUTH-05).

ENVIRONMENT=dev
LOG_LEVEL=INFO
GIT_SHA=local

# Supabase (from Bitwarden — INF-02 §5.2).
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

# CORS (comma-separated). In prod, set to https://vitachain.ma after INF-06.
CORS_ALLOW_ORIGINS=http://localhost:3000,http://vitachain.ma
```

Locally, `cp backend/.env.example backend/.env` then fill from Bitwarden. The VPS reads them from `/opt/vitachain/.env` injected by Compose.

### 5.11 Tests

[backend/tests/conftest.py](../../backend/tests/conftest.py):

```python
from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret-32-bytes-minimum-XXX")

from app.main import create_app  # noqa: E402  (env must be set first)


@pytest.fixture()
async def client():
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
```

[backend/tests/test_health.py](../../backend/tests/test_health.py):

```python
import pytest


@pytest.mark.anyio
async def test_healthz_returns_200(client):
    r = await client.get("/api/v1/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "backend"


@pytest.mark.anyio
async def test_module_healthz_routes_all_load(client):
    for module in ("katara", "farmarket", "secondserve", "botabaqa", "notifications"):
        r = await client.get(f"/api/v1/{module}/healthz")
        assert r.status_code == 200, module
        assert r.json()["module"] == module


@pytest.mark.anyio
async def test_request_id_round_trips(client):
    r = await client.get("/api/v1/healthz", headers={"X-Request-Id": "test-abc"})
    assert r.headers.get("X-Request-Id") == "test-abc"


@pytest.fixture
def anyio_backend():
    return "asyncio"
```

[backend/pyproject.toml](../../backend/pyproject.toml) (tool config only — no build backend):

```toml
[tool.ruff]
line-length = 100
target-version = "py312"
extend-exclude = ["tests/__init__.py"]

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "S", "T20", "ASYNC", "ANN"]
ignore = ["ANN401"]  # allow Any in narrow places

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101", "ANN"]

[tool.pytest.ini_options]
addopts = "-ra -q"
testpaths = ["tests"]
asyncio_mode = "auto"
```

### 5.12 Dockerfile

[backend/Dockerfile](../../backend/Dockerfile):

```dockerfile
# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY requirements.lock.txt ./
RUN pip install --require-hashes -r requirements.lock.txt

FROM base AS runner
WORKDIR /app
ENV PORT=8000 \
    WEB_CONCURRENCY=2 \
    GUNICORN_TIMEOUT=60
RUN groupadd --system app && useradd --system --gid app --create-home --home-dir /home/app app
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY --chown=app:app ./app ./app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/v1/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["gunicorn", "app.main:app", \
     "--bind", "0.0.0.0:8000", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "2", \
     "--timeout", "60", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--forwarded-allow-ips", "*"]
```

[backend/.dockerignore](../../backend/.dockerignore):

```
.venv/
.env
.env.*
!.env.example
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.mypy_cache/
tests/
docs/
.git/
```

### 5.13 Makefile

[backend/Makefile](../../backend/Makefile):

```makefile
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help install lock dev lint format typecheck test docker-build docker-run smoke

help:
	@awk 'BEGIN{FS=":.*##"; printf "Targets:\n"} /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install:        ## Create venv and install pinned deps
	python -m venv .venv && . .venv/Scripts/activate && pip install -r requirements.lock.txt

lock:           ## Recompile requirements.lock.txt from requirements.in
	. .venv/Scripts/activate && pip-compile --generate-hashes --output-file=requirements.lock.txt requirements.in

dev:            ## Hot-reload uvicorn on :8000
	. .venv/Scripts/activate && uvicorn app.main:app --reload --port 8000

lint:           ## Ruff lint
	. .venv/Scripts/activate && ruff check app tests

format:         ## Ruff format
	. .venv/Scripts/activate && ruff format app tests

test:           ## pytest
	. .venv/Scripts/activate && pytest

docker-build:   ## Build the production image
	docker build -t vitachain/backend:dev .

docker-run:     ## Run the production image locally on :8000
	docker run --rm -p 8000:8000 --env-file .env vitachain/backend:dev

smoke:          ## curl the four health endpoints
	@curl -fsS http://127.0.0.1:8000/api/v1/healthz | tee /dev/stderr
	@curl -fsS http://127.0.0.1:8000/api/v1/version | tee /dev/stderr
	@curl -fsS http://127.0.0.1:8000/api/v1/katara/healthz | tee /dev/stderr
	@curl -fsS http://127.0.0.1:8000/api/v1/readyz | tee /dev/stderr
```

> Windows note: contributors using PowerShell directly can call `python -m venv .venv; .\.venv\Scripts\Activate.ps1` and the inner commands as-is — the Makefile is meant for Git-Bash/WSL on Windows or any POSIX shell.

### 5.14 Compose integration

Append to [infra/docker-compose.yml](../../infra/docker-compose.yml):

```yaml
  # ---------------------------------------------------------------------------
  # INF-04 — FastAPI backend (health + module placeholders today; domain
  # routers attach in KAT-*/FAR-*/SEC-*/BOT-*/NOT-*).
  # Built from ../backend/ on the VPS; service-role secrets are runtime-only.
  # ---------------------------------------------------------------------------
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    image: vitachain/backend:latest
    container_name: vita_backend
    restart: unless-stopped
    environment:
      ENVIRONMENT: ${ENVIRONMENT:-prod}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
      GIT_SHA: ${GIT_SHA:-unknown}
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      SUPABASE_JWT_SECRET: ${SUPABASE_JWT_SECRET}
      CORS_ALLOW_ORIGINS: ${CORS_ALLOW_ORIGINS:-http://vitachain.ma}
      WEB_CONCURRENCY: ${WEB_CONCURRENCY:-2}
    networks:
      - vita_net
    expose:
      - "8000"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8000/api/v1/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Make NGINX start *after* backend is up (soft order — proxy fails to 502 until the upstream is healthy, but boot order matters for the first deploy):

```yaml
  nginx:
    # ...existing...
    depends_on:
      - frontend
      - backend
```

Mirror the `SUPABASE_*` keys in [infra/.env.example](../../infra/.env.example), grouped under an `INF-04` section. Keep them **below** the existing `NEXT_PUBLIC_*` block so it stays clear which ones belong to which surface.

### 5.15 NGINX vhost extension

Edit [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf) — add an upstream + a location block. The `/api/v1/` location must be declared **before** the catch-all `/` block (NGINX evaluates prefix locations by length; this is redundant but explicit).

```nginx
upstream vita_backend {
    server backend:8000;
    keepalive 32;
}

server {
    # ...existing listen / server_name / /healthz / acme ...

    # ---- Backend (FastAPI) -------------------------------------------------
    location /api/v1/ {
        proxy_pass         http://vita_backend;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Request-Id      $request_id;

        # Bumped to 300s for the future KAT-08 AI orchestration path.
        # AUTH-08 will tighten /api/v1/katara/ingest to its 50 ms SLA bucket.
        proxy_connect_timeout 5s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;

        client_max_body_size  10m;  # FAR-07 photo upload tolerance.

        proxy_intercept_errors on;
        error_page 502 503 504 /50x.html;
    }

    # ...existing location / { ... } stays below this block ...
}
```

> Why a single `/api/v1/` prefix rather than the per-module `proxy_pass` from the tech spec? The MVD runs **one** FastAPI container; one upstream, one location. If domain isolation later forces a split into katara/secondserve/farmarket containers (tech spec table R2–R5), this story's NGINX block becomes the template — copy, change `upstream`, scope the `location`.

### 5.16 verify.sh extension

Append a new section to [infra/scripts/verify.sh](../../infra/scripts/verify.sh) (mirrors the INF-03 pattern; only the labels change):

```bash
# --- INF-04 backend checks ---------------------------------------------------
echo ""
echo "INF-04 verification (backend)"
echo "----------------------------------------"

check "vita_backend is Up (healthy)" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose ps --format '{{.Name}} {{.Status}}' | grep -Eq 'vita_backend.*Up.*healthy'"

check "/api/v1/healthz returns service=backend" \
    bash -c "curl -fsS http://$VPS_HOST/api/v1/healthz | grep -q '\"service\":\"backend\"'"

check "/api/v1/readyz returns ready" \
    bash -c "curl -fsS http://$VPS_HOST/api/v1/readyz | grep -q '\"status\":\"ready\"'"

check "/api/v1/katara/healthz returns module=katara" \
    bash -c "curl -fsS http://$VPS_HOST/api/v1/katara/healthz | grep -q '\"module\":\"katara\"'"

check "service-role key not leaked under backend/" \
    bash -c "! grep -RIn 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' '$SCRIPT_DIR/../../backend' --exclude-dir=.venv --exclude-dir=__pycache__ 2>/dev/null | grep -v '\\.env\\.example' | grep -q ."

check "no NEXT_PUBLIC_ leak into backend/ source" \
    bash -c "! grep -RIn 'NEXT_PUBLIC_' '$SCRIPT_DIR/../../backend' --include='*.py' 2>/dev/null | grep -q ."
```

And add Makefile targets to [infra/Makefile](../../infra/Makefile) under the INF-03 helpers:

```makefile
# --- INF-04 helpers ---------------------------------------------------------
backend-build:    ## Build the backend image on the VPS (no restart)
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose build backend"

backend-logs:     ## Tail FastAPI logs on the VPS
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose logs -f --tail=200 backend"

backend-rebuild:  ## Force rebuild + recreate the backend container
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose build --no-cache backend && docker compose up -d --force-recreate backend"
```

### 5.17 `deploy.sh` adjustment

The existing [infra/scripts/deploy.sh](../../infra/scripts/deploy.sh) already rsyncs `infra/` and `frontend/`. Add `backend/` to the rsync source list (one line in the `rsync` invocation), and exclude `backend/.venv`, `backend/__pycache__`, and `backend/.env` via the existing `--filter='. ./.gitignore'` (these are git-ignored — see §5.18).

### 5.18 `.gitignore`

Append to the repo root [.gitignore](../../.gitignore):

```
# backend
backend/.venv/
backend/.env
backend/.env.*
!backend/.env.example
backend/__pycache__/
backend/**/__pycache__/
backend/.pytest_cache/
backend/.ruff_cache/
backend/.mypy_cache/
*.pyc
```

---

## 6. Verification Checklist

### Local (developer laptop)

- [ ] `make -C backend install` succeeds; `pip check` reports no broken deps.
- [ ] `make -C backend lint` returns zero findings.
- [ ] `make -C backend test` passes (4 tests).
- [ ] `make -C backend dev` boots; `curl http://localhost:8000/api/v1/healthz` → `{"status":"ok","service":"backend","version":"local"}`.
- [ ] `curl http://localhost:8000/api/v1/readyz` against the live Supabase project returns `{"status":"ready", ...}` with both `supabase_rest` and `supabase_auth` reporting `ok`.
- [ ] `curl -i http://localhost:8000/api/v1/healthz -H 'X-Request-Id: t1'` echoes `X-Request-Id: t1` back.
- [ ] Browse `http://localhost:8000/api/v1/docs` — Swagger UI lists `health` + the five module tags; each has one route.
- [ ] `make -C backend docker-build && make -C backend docker-run` — image starts; `curl http://localhost:8000/api/v1/healthz` still returns 200.

### VPS (after `make -C infra deploy`)

- [ ] `make -C infra verify` — every INF-01 + INF-03 + INF-04 check is green.
- [ ] `curl http://vitachain.ma/api/v1/healthz` → `200 OK` with `service=backend`.
- [ ] `curl http://vitachain.ma/api/v1/readyz` → `200 OK` and `status=ready`.
- [ ] `curl http://vitachain.ma/api/v1/katara/healthz` → `200 OK` with `module=katara`.
- [ ] `curl http://vitachain.ma/` still returns the Next.js landing (frontend untouched by the NGINX edit).
- [ ] `docker compose ps` shows `vita_backend` as `Up (healthy)` and `vita_nginx` still `Up (healthy)`.
- [ ] `docker compose logs backend --tail=20` shows JSON log lines with a `request_id` field on each request.
- [ ] `grep -RIn 'SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_JWT_SECRET' frontend/ | grep -v '.env.example'` returns **no matches** (AUTH-05 pre-flight).
- [ ] `grep -RIn 'NEXT_PUBLIC_' backend/ --include='*.py'` returns **no matches**.

### Negative tests

- [ ] `curl http://vitachain.ma/api/v1/nonexistent` returns `404` with a FastAPI JSON envelope (not the NGINX 50x page).
- [ ] Stop the `backend` container (`docker compose stop backend`). `curl http://vitachain.ma/api/v1/healthz` returns the **NGINX 502 fallback page** (`/50x.html`), not a hang. Restart with `docker compose start backend` — verify `/api/v1/healthz` is `200` again within `start_period` (20 s).
- [ ] With a bogus `SUPABASE_SERVICE_ROLE_KEY` in `infra/.env`, `/api/v1/readyz` returns `503` with `status=degraded` and `supabase_*` checks reporting `http_401`.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| FastAPI app | [backend/](../../backend/) (scaffold + health) |
| Settings + Supabase client + security stubs | [backend/app/core/](../../backend/app/core/) |
| Health router | [backend/app/routers/health.py](../../backend/app/routers/health.py) |
| Module placeholders | [backend/app/modules/](../../backend/app/modules/) (5 routers) |
| Tests | [backend/tests/](../../backend/tests/) (4 tests, all passing) |
| Container | [backend/Dockerfile](../../backend/Dockerfile), service in [infra/docker-compose.yml](../../infra/docker-compose.yml) |
| Backend env template | [backend/.env.example](../../backend/.env.example) |
| NGINX vhost update | [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf) |
| Verify script update | [infra/scripts/verify.sh](../../infra/scripts/verify.sh) |
| Infra env template update | [infra/.env.example](../../infra/.env.example) |
| Infra Makefile helpers | [infra/Makefile](../../infra/Makefile) (`backend-*` targets) |
| Runbook entry | Append "Backend rollout & rollback" section to [docs/runbook.md](../runbook.md) |
| `spring-status.yml` update | Flip `INF-04.status` → `DONE`; bump `summary.done`; decrement `summary.todo` |

---

## 8. Risks & Mitigations

| Risk | Mitigation | Source |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` leaks into a frontend route | Frontend (INF-03) reads only `NEXT_PUBLIC_*`; INF-05 CI greps both trees; verify.sh asserts both directions | PRD §7.1 AUTH-05 |
| Health endpoint blocks on Supabase reachability and Docker restarts the container during a Supabase outage | `/healthz` is dependency-free; `/readyz` carries the dependency probe but is **not** wired to the Docker HEALTHCHECK | Docker healthcheck semantics |
| `gunicorn` worker count starves NGINX/frontend on the 4 vCPU VPS | `WEB_CONCURRENCY=2` default, env-overridable; documented to be raised only after `INF-08` shows headroom | Tech spec §4.4 Scalability Level 1 |
| NGINX `/api/v1/` block is shadowed by `/` and never matches | Prefix-location precedence is length-based; verified in §6 by hitting `/api/v1/healthz` from outside; documented above | NGINX manual |
| JWT verification rejects valid tokens because Supabase rotated the secret | Secret read from env at process boot; `make -C infra backend-rebuild` is a one-liner for rotation; tracked as a §11 follow-up | — |
| Future module split (katara/secondserve/farmarket separate containers) forces a rewrite | Today's structure already mounts each module under its own `APIRouter`; splitting is `Dockerfile ARG MODULE=katara` + a `--app-import` switch — no business-code refactor | Tech spec §2.3 |
| `pip-compile`-generated lockfile drifts on Windows vs Linux | Lockfile is generated **inside** the container (or under WSL) and committed once; CI runs `pip install --require-hashes` from the same lockfile | pip-tools docs |
| Readiness probe accidentally counts against Supabase free-tier auth admin quota | `?per_page=1` minimises payload; probe runs only on demand (Uptime Kuma at 60 s intervals = 1.4 k calls/day, well under quota) | Supabase pricing |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Project layout, deps, lockfile | 30 min |
| Settings + logging + middleware + Supabase client | 45 min |
| Health router + version + module placeholders | 30 min |
| Security stubs (JWT verify + role dep) | 30 min |
| Tests (4 cases, async client fixture) | 30 min |
| Dockerfile + Makefile | 45 min |
| Compose integration + NGINX block | 30 min |
| verify.sh + Makefile helpers + .env templates | 20 min |
| Local + VPS verification checklist | 30 min |
| Runbook + `spring-status.yml` update | 15 min |
| **Total active work** | **~5 h** |

---

## 10. Definition of Done

1. **Acceptance criterion met:** `curl http://vitachain.ma/api/v1/healthz` returns `200` with `{"status":"ok","service":"backend",...}` behind NGINX, in a clean shell with no auth headers.
2. Verification checklist (§6) fully ticked, on both local dev (`make -C backend dev`) and the VPS (`make -C infra verify` green).
3. Deliverables (§7) committed under `backend/`, `infra/`, and `docs/`.
4. [docs/spring-status.yml](../spring-status.yml) updated and committed: `INF-04.status: DONE`, `summary.done` incremented, `summary.in_progress` adjusted; a hand-off line added under `project.last_updated` like the existing INF-02/INF-03 entries.
5. Hand-off note posted to the team channel naming the unblocked stories: **AUTH-05** (service-role isolation can now be exercised end-to-end), **INF-05** (CI now has a Python tree to lint/typecheck/test/build), **INF-08** (Sentry SDK gets one entry point: `app.main:create_app`), **NOT-01** (Brevo wrapper has a home), and the first domain consumers — **KAT-03** (ingestion), **FAR-03** (contact lead → seller email), **SEC-04** (reservation + pickup code), **BOT-04** (lead webhook).

---

## 11. Hand-off — (to be filled on completion)

### 11.1 What landed

*(Mirror the INF-03 §11.1 structure: file list under `backend/`, infra integration diff summary, any collateral fixes shipped under this ticket's ownership.)*

### 11.2 Verification evidence

*(Paste `make -C backend test` output, `make -C infra verify` tally, and the curl traces for `/api/v1/healthz`, `/api/v1/readyz`, `/api/v1/katara/healthz` from the VPS.)*

### 11.3 What's *not* covered (and why that's fine for DoD)

- Real auth on protected routes — covered by `AUTH-03`.
- Brevo wrapper / email templates — `NOT-01..07`.
- Sentry init — `INF-08`.
- HTTPS — `INF-06`.

### 11.4 Stories now unblocked

| Story | Why |
|---|---|
| **AUTH-05** | A backend exists that holds the service-role key; the isolation invariant can be tested with the §6 negative tests + INF-05 CI greps. |
| **INF-05** | CI can now `cd backend && pip install --require-hashes -r requirements.lock.txt && ruff check && pytest && docker build`. |
| **INF-08** | Sentry SDK + Uptime Kuma get a single backend URL to monitor (`/api/v1/healthz` live, `/api/v1/readyz` ready). |
| **NOT-01** | `app/modules/notifications/` is the home for the Brevo client wrapper. |
| **KAT-03** | `app/modules/katara/router.py` is the file where `POST /api/v1/katara/ingest` lands; the 50 ms SLA path inherits the established middleware stack. |
| **FAR-03 / FAR-04** | Contact-lead endpoint slots into `app/modules/farmarket/router.py`; uses `get_supabase_admin` to read the seller's email under service role. |
| **SEC-04 → SEC-08** | Reservation + pickup-code generation + validation + commission report all live under `app/modules/secondserve/`. |
| **BOT-04** | The Supabase DB-webhook target URL (or a backend proxy if needed) gets a known FastAPI home. |

### 11.5 Known follow-ups (not part of INF-04)

- **AUTH-07** should add a regression test that hits each module's `/healthz` with and without a JWT and asserts the public-vs-protected boundary is what each subsequent story declared.
- **INF-05** secret-leak grep already enumerated in `verify.sh` (§5.16); promote to CI as a `pre-commit` hook + GitHub Action.
- **INF-08** Sentry init is a 3-line addition to `create_app()` once the DSN is in Bitwarden; do not wire here to keep the scaffold dependency-free.
- Rotate `SUPABASE_JWT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` once before the demo and document the `make -C infra backend-rebuild` cadence in the runbook.

### 11.6 Operator runbook (when INF-01 reaches DONE)

```bash
# On developer laptop, from repo root:
cp infra/.env.example infra/.env
# Fill: VPS_HOST, VPS_USER=vitachain, PROJECT_DIR=/opt/vitachain
#       NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY        (INF-03)
#       SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET   (INF-04, from Bitwarden)
#       CORS_ALLOW_ORIGINS=http://vitachain.ma

make -C infra deploy            # rsync infra/ + frontend/ + backend/, compose build + up -d
make -C infra verify            # runs INF-01 + INF-03 + INF-04 verification checklist

# Manual smoke (30s):
#   curl http://vitachain.ma/api/v1/healthz       → 200 {"status":"ok","service":"backend",...}
#   curl http://vitachain.ma/api/v1/readyz        → 200 {"status":"ready", "checks":{...}}
#   curl http://vitachain.ma/api/v1/katara/healthz→ 200 {"module":"katara","status":"ok"}
#   curl http://vitachain.ma/                     → 200 (frontend still serves)
#   curl -i http://vitachain.ma/api/v1/healthz -H 'X-Request-Id: ops-smoke-1'
#                                                  → response carries X-Request-Id: ops-smoke-1
```

When the manual smoke passes on the live domain, no further INF-04 work remains.
