"""FAR-04 worker entrypoint.

Run with::

    python -m app.workers.farmarket_order_notify

Mirrors :mod:`app.workers.katara_diagnostic_email.__main__` (KAT-09):
Sentry + JSON logging + SIGINT/SIGTERM handlers with Windows fallback.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

import sentry_sdk
from dotenv import load_dotenv

from app.workers.farmarket_order_notify.listener import run_listener

load_dotenv()

log = logging.getLogger("farmarket_order_notify")


def _init_observability() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            environment=os.getenv("SENTRY_ENVIRONMENT", "prod"),
            release=os.getenv("GIT_SHA", "unknown"),
            server_name="farmarket-order-notify-worker",
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

    log.info("farmarket_order_notify_worker_starting")
    try:
        await run_listener(stop_event=stop)
    finally:
        log.info("farmarket_order_notify_worker_stopped")


if __name__ == "__main__":
    asyncio.run(_main())
