"""FAR-06 — farmarket ad expiry worker entry point.

Run with:
    python -m app.workers.farmarket_expiry

In Docker, this command is wired into ``infra/docker-compose.yml`` under the
``farmarket_expiry_worker`` service.

Required env vars:
    DATABASE_URL                        — asyncpg DSN, direct :5432 (NOT pooler :6543)

Optional env vars:
    EXPIRY_SCAN_PERIOD_S                — sweep interval in seconds (default 86400 = 24 h)
    HEALTHCHECKS_FAR_EXPIRY_PING_URL    — Healthchecks.io ping URL (omit to disable)
    SENTRY_DSN                          — Sentry ingest DSN (INF-08)
    SENTRY_ENVIRONMENT                  — Sentry environment tag (default "prod")
    LOG_LEVEL                           — Python logging level (default "INFO")
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

import sentry_sdk
from dotenv import load_dotenv

from app.workers.farmarket_expiry.sweeper import run_sweeper

load_dotenv()

log = logging.getLogger("farmarket_expiry")


def _init_observability() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0")),
            environment=os.getenv("SENTRY_ENVIRONMENT", "prod"),
            release=os.getenv("GIT_SHA", "unknown"),
            server_name="farmarket-expiry-worker",
            send_default_pii=False,
        )

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format=(
            '{"ts":"%(asctime)s","lvl":"%(levelname)s",'
            '"logger":"%(name)s","msg":"%(message)s"}'
        ),
        stream=sys.stdout,
    )


async def _main() -> None:
    _init_observability()

    stop = asyncio.Event()

    def _on_signal(*_: object) -> None:
        log.info("shutdown_signal_received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_signal)
        except (NotImplementedError, RuntimeError):
            signal.signal(sig, _on_signal)

    log.info("farmarket_expiry_worker_starting")
    try:
        await run_sweeper(stop_event=stop)
    finally:
        log.info("farmarket_expiry_worker_stopped")


if __name__ == "__main__":
    asyncio.run(_main())
