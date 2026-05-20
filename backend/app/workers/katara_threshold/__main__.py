"""KAT-06 worker entrypoint.

Run with::

    python -m app.workers.katara_threshold

In Docker the same command is wired into ``infra/docker-compose.yml`` under
service ``katara_threshold_worker``.

Single-process design: one LISTEN connection + one Brevo HTTP client. MVD
load (≤ 50 farmers × 1 ESP32 × 15-min cadence = ~3 reads/min peak) does not
warrant horizontal scale-out. If post-MVD load demands replicas the design
is safe: NOTIFY is broadcast to all listeners, and the audit-column UPDATE
serialises BR-K2 at the DB.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

import sentry_sdk
from dotenv import load_dotenv

from app.workers.katara_threshold.listener import run_listener

load_dotenv()

log = logging.getLogger("katara_threshold")


def _init_observability() -> None:
    """Sentry + JSON-line logging. Both no-op when env vars are unset."""
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            environment=os.getenv("SENTRY_ENVIRONMENT", "prod"),
            release=os.getenv("GIT_SHA", "unknown"),
            server_name="katara-threshold-worker",
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

    log.info("katara_threshold_worker_starting")
    try:
        await run_listener(stop_event=stop)
    finally:
        log.info("katara_threshold_worker_stopped")


if __name__ == "__main__":
    asyncio.run(_main())
