"""NOT-01 — notifications_outbox dispatcher.

Polls ``public.notifications_outbox`` every 30 s for rows where
``dispatched_at IS NULL`` and ``attempts < 5``, resolves the user's email
from ``public.profiles``, picks the right Brevo template, sends via
:mod:`app.workers.mailer`, then marks the row ``dispatched_at = now()``.

Required env vars (one per event type × locale):
    BREVO_TEMPLATE_KYC_APPROVED_FR / _AR / _EN
    BREVO_TEMPLATE_KYC_REJECTED_FR / _AR / _EN
    BREVO_TEMPLATE_KYC_SUBMITTED_FR / _AR / _EN

``FOR UPDATE SKIP LOCKED`` makes the poll safe under multi-instance deploys.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import suppress
from typing import TYPE_CHECKING, Any
from uuid import UUID

import httpx

if TYPE_CHECKING:
    import asyncpg

from app.workers import mailer

log = logging.getLogger("notifications_mailer.dispatcher")

POLL_INTERVAL_S = 30
MAX_ATTEMPTS = 5
BATCH_SIZE = 50
HEARTBEAT_PERIOD_S = 60

_TEMPLATE_ENV: dict[tuple[str, str], str] = {
    ("kyc.approved",  "fr"): "BREVO_TEMPLATE_KYC_APPROVED_FR",
    ("kyc.approved",  "ar"): "BREVO_TEMPLATE_KYC_APPROVED_AR",
    ("kyc.approved",  "en"): "BREVO_TEMPLATE_KYC_APPROVED_EN",
    ("kyc.rejected",  "fr"): "BREVO_TEMPLATE_KYC_REJECTED_FR",
    ("kyc.rejected",  "ar"): "BREVO_TEMPLATE_KYC_REJECTED_AR",
    ("kyc.rejected",  "en"): "BREVO_TEMPLATE_KYC_REJECTED_EN",
    ("kyc.submitted", "fr"): "BREVO_TEMPLATE_KYC_SUBMITTED_FR",
    ("kyc.submitted", "ar"): "BREVO_TEMPLATE_KYC_SUBMITTED_AR",
    ("kyc.submitted", "en"): "BREVO_TEMPLATE_KYC_SUBMITTED_EN",
}


def _resolve_locale(locale: str) -> str:
    return locale if locale in ("fr", "ar", "en") else "fr"


def _template_id(event_type: str, locale: str) -> int:
    env_key = _TEMPLATE_ENV.get((event_type, locale))
    if not env_key:
        env_key = _TEMPLATE_ENV.get((event_type, "fr"))
    if not env_key:
        return 0
    return int(os.getenv(env_key, "0"))


async def _dispatch_row(
    conn: "asyncpg.Connection",
    row: Any,
    frontend_base: str,
) -> None:
    row_id: UUID = row["id"]
    user_id: UUID = row["user_id"]
    event_type: str = row["type"]
    locale: str = _resolve_locale(row["locale"] or "fr")
    raw_context = row["context"] or {}
    context: dict[str, Any] = json.loads(raw_context) if isinstance(raw_context, str) else raw_context

    profile = await conn.fetchrow(
        "select email, full_name from public.profiles where id = $1",
        user_id,
    )
    if not profile or not profile["email"]:
        log.warning("no_email_for_user row_id=%s user_id=%s", row_id, user_id)
        await conn.execute(
            "update public.notifications_outbox "
            "set attempts = attempts + 1, last_error = $1, updated_at = now() "
            "where id = $2",
            "no email found for user",
            row_id,
        )
        return

    email = profile["email"]
    full_name = profile["full_name"] or ""

    tid = _template_id(event_type, locale)
    if not tid:
        log.warning(
            "template_id_unset event_type=%s locale=%s row_id=%s — "
            "set BREVO_TEMPLATE_KYC_*_* in .env",
            event_type, locale, row_id,
        )
        await conn.execute(
            "update public.notifications_outbox "
            "set attempts = attempts + 1, last_error = $1, updated_at = now() "
            "where id = $2",
            f"BREVO_TEMPLATE env unset for {event_type}/{locale}",
            row_id,
        )
        return

    params: dict[str, Any] = {"full_name": full_name}
    if event_type == "kyc.approved":
        params["dashboard_url"] = f"{frontend_base}/dashboard/farmer/parcels"
    elif event_type == "kyc.rejected":
        params["note"] = context.get("note") or ""
        params["resubmit_url"] = f"{frontend_base}/onboarding/verification"
    elif event_type == "kyc.submitted":
        params["status_url"] = f"{frontend_base}/onboarding/verification"

    try:
        await mailer.send_template(
            to=email,
            template_id=tid,
            params=params,
            locale=locale,
        )
    except Exception as exc:
        log.exception(
            "brevo_send_failed event_type=%s row_id=%s to=%s",
            event_type, row_id, email,
        )
        await conn.execute(
            "update public.notifications_outbox "
            "set attempts = attempts + 1, last_error = $1, updated_at = now() "
            "where id = $2",
            str(exc)[:500],
            row_id,
        )
        return

    await conn.execute(
        "update public.notifications_outbox "
        "set dispatched_at = now(), updated_at = now() "
        "where id = $1",
        row_id,
    )
    log.info(
        "notification_dispatched event_type=%s to=%s row_id=%s",
        event_type, email, row_id,
    )


async def _poll_once(pool: "asyncpg.Pool", frontend_base: str) -> int:
    # JUSTIFICATION: NOT-01 dispatcher — reads notifications_outbox (service-
    # level table, no user JWT available) and profiles.email via the service-
    # role DSN (DATABASE_URL). This is the sole legitimate consumer of the
    # outbox per AUTH-06 / NOT-01 spec.
    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                """
                select id, user_id, type, locale, context
                from public.notifications_outbox
                where dispatched_at is null
                  and attempts < $1
                order by created_at
                limit $2
                for update skip locked
                """,
                MAX_ATTEMPTS,
                BATCH_SIZE,
            )
            for row in rows:
                try:
                    await _dispatch_row(conn, row, frontend_base)
                except Exception:
                    log.exception("dispatch_row_unexpected_error row_id=%s", row["id"])
    return len(rows)


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_NOTIFICATIONS_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)


async def _heartbeat_loop(stop_event: asyncio.Event) -> None:
    async with httpx.AsyncClient() as client:
        await _ping_heartbeat(client)
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=HEARTBEAT_PERIOD_S)
            except asyncio.TimeoutError:
                pass
            await _ping_heartbeat(client)


async def run_dispatcher(stop_event: asyncio.Event) -> None:
    import asyncpg

    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=3, command_timeout=15.0)
    frontend_base = os.getenv("FRONTEND_BASE_URL", "https://vitachain.ma").rstrip("/")

    heartbeat = asyncio.create_task(_heartbeat_loop(stop_event))
    log.info("notifications_mailer_dispatcher_started")

    try:
        while not stop_event.is_set():
            try:
                count = await _poll_once(pool, frontend_base)
                if count:
                    log.info("poll_pass dispatched=%d", count)
            except Exception:
                log.exception("poll_error")

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_S)
            except asyncio.TimeoutError:
                pass
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await heartbeat
        with suppress(Exception):
            await pool.close()
        log.info("notifications_mailer_dispatcher_stopped")
