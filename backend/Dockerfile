# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

# ----- build deps in a throwaway layer --------------------------------------
FROM base AS deps
WORKDIR /app
# Lockfile is optional today (developer can run `make lock` after install).
# Prefer it when present, fall back to requirements.in otherwise.
COPY requirements.in ./
COPY requirements.lock.txt* ./
RUN if [ -f requirements.lock.txt ]; then \
        pip install -r requirements.lock.txt; \
    else \
        pip install -r requirements.in; \
    fi

# ----- test stage (bundles tests + pyproject; never used in prod) -----------
FROM deps AS test
WORKDIR /app
COPY ./app ./app
COPY ./tests ./tests
COPY ./pyproject.toml ./pyproject.toml
ENV PYTHONPATH=/app \
    SUPABASE_URL=https://example.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=test-service-role-key \
    SUPABASE_JWT_SECRET=test-jwt-secret-must-be-at-least-thirty-two-bytes \
    ENVIRONMENT=dev
CMD ["pytest", "-ra"]

# ----- runtime --------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV PORT=8000 \
    WEB_CONCURRENCY=2 \
    GUNICORN_TIMEOUT=60
RUN groupadd --system app \
 && useradd --system --gid app --create-home --home-dir /home/app app
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
