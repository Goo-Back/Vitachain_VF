# VitaChain Backend — FastAPI (INF-04)

Implements [docs/stories/INF-04-fastapi-backend-scaffold-healthcheck.md](../docs/stories/INF-04-fastapi-backend-scaffold-healthcheck.md).

```
backend/
├── app/
│   ├── main.py                  # create_app() + ASGI entry
│   ├── core/                    # config, logging, middleware, supabase, security
│   ├── routers/health.py        # /healthz, /readyz, /version
│   └── modules/<name>/router.py # placeholders for KAT-* / FAR-* / SEC-* / BOT-* / NOT-*
├── tests/                       # pytest-anyio, ASGITransport
├── Dockerfile                   # multi-stage, non-root, HEALTHCHECK on /api/v1/healthz
├── Makefile                     # install / lock / dev / lint / test / docker-* / smoke
└── requirements.in[ .lock.txt ] # pip-tools managed
```

## Local quickstart (Git-Bash / WSL)

```bash
cd backend
cp .env.example .env             # paste Supabase keys from Bitwarden
make install
make lock                        # generates requirements.lock.txt
make test                        # 7 tests should pass
make dev                         # http://localhost:8000/api/v1/docs
```

## Docker quickstart

```bash
make docker-build
make docker-run
curl http://localhost:8000/api/v1/healthz    # → {"status":"ok","service":"backend",...}
make docker-stop
```

## Boundaries

- **Backend-only env**: every variable here is read by FastAPI containers only. `NEXT_PUBLIC_*` is forbidden — frontend owns those (INF-03).
- **Service-role key**: held by [app/core/supabase.py](app/core/supabase.py)'s `get_supabase_admin()`. Never imported from anything that ships to the browser (AUTH-05).
- **JWT verification**: [app/core/security.py](app/core/security.py) — wired but not attached to any route until AUTH-03.

## What this story does NOT do

| Concern | Story |
|---|---|
| Real auth on protected endpoints | AUTH-03 |
| Service-role isolation **proof** in CI | AUTH-05 / INF-05 |
| Brevo client wrapper + email templates | NOT-01..07 |
| IoT ingestion (50 ms SLA) | KAT-03 |
| Reservation + pickup code | SEC-04 |
| Sentry SDK init | INF-08 |
| HTTPS | INF-06 |
| Rate limiting on `/api/v1/*` | AUTH-08 |
