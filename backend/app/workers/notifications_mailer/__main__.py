"""NOT-01 — notifications mailer worker entrypoint.

Run with::

    python -m app.workers.notifications_mailer

Polls ``public.notifications_outbox`` every 30 s and dispatches pending KYC
emails (kyc.approved, kyc.rejected, kyc.submitted) via Brevo transactional
templates. See :mod:`app.workers.notifications_mailer.dispatcher` for design.

Required env vars:
    DATABASE_URL                   — asyncpg DSN (Supabase pooler)
    BREVO_API_KEY                  — Brevo v3 API key
    BREVO_TEMPLATE_KYC_APPROVED_FR / _AR / _EN
    BREVO_TEMPLATE_KYC_REJECTED_FR / _AR / _EN
    BREVO_TEMPLATE_KYC_SUBMITTED_FR / _AR / _EN
    FRONTEND_BASE_URL              — base URL for email links (default: https://vitachain.ma)
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

import sentry_sdk
from dotenv import load_dotenv

from app.workers.notifications_mailer.dispatcher import run_dispatcher

# Load backend/.env into os.environ so DATABASE_URL and BREVO_* are available.
# pydantic-settings reads .env into the Settings object only; os.environ is
# not populated unless we call this explicitly.
load_dotenv()

log = logging.getLogger("notifications_mailer")


def _init_observability() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            environment=os.getenv("SENTRY_ENVIRONMENT", "prod"),
            release=os.getenv("GIT_SHA", "unknown"),
            server_name="notifications-mailer-worker",
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

    log.info("notifications_mailer_starting")
    try:
        await run_dispatcher(stop_event=stop)
    finally:
        log.info("notifications_mailer_stopped")


if __name__ == "__main__":
    asyncio.run(_main())
