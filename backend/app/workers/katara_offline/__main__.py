"""KAT-11 worker entrypoint.

Run with::

    python -m app.workers.katara_offline

In Docker the same command is wired into ``infra/docker-compose.yml`` under
service ``katara_offline_worker``.

Single-process design: one CRON-style asyncio loop + one Brevo HTTP client.
The scan runs every 5 minutes against ``m1_katara_devices``, atomically
flipping rows ``ACTIVE → OFFLINE`` whose ``last_seen`` is older than 1 hour
and dispatching a locale-appropriate Brevo email to the owning farmer. The
WHERE clause itself enforces BR-K11-1 (≤ 1 email per device per 24 h), so
multiple replicas are safe — only the first claim wins each row.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

import sentry_sdk
from dotenv import load_dotenv

from app.workers.katara_offline.scanner import run_scanner

load_dotenv()

log = logging.getLogger("katara_offline")


def _init_observability() -> None:
    """Sentry + JSON-line logging. Both no-op when env vars are unset."""
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            environment=os.getenv("SENTRY_ENVIRONMENT", "prod"),
            release=os.getenv("GIT_SHA", "unknown"),
            server_name="katara-offline-worker",
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
            # Windows event loop has no add_signal_handler; fall through to
            # signal.signal so Ctrl-C still flips the stop flag on dev boxes.
            signal.signal(sig, _on_signal)

    log.info("katara_offline_worker_starting")
    try:
        await run_scanner(stop_event=stop)
    finally:
        log.info("katara_offline_worker_stopped")


if __name__ == "__main__":
    asyncio.run(_main())
