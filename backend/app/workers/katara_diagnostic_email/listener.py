"""KAT-09 — LISTEN/NOTIFY lifecycle + 30-minute backstop.

Mirrors :mod:`app.workers.katara_diagnostic.listener` (KAT-08): one dedicated
asyncpg connection on the ``katara_diagnostic_completed`` channel emitted by
migration 0024's AFTER UPDATE trigger, a bounded notification queue
decoupling the LISTEN callback from the Brevo HTTP call, and an
exponential-backoff reconnect.

Two backstop layers:

* :func:`_backstop_once` — runs immediately after every (re)connect so any
  notification missed during a disconnect is picked up. NOTIFY messages are
  not buffered by Postgres across a dropped LISTEN — the backstop is the
  durability floor.
* :func:`_backstop_loop` — every 60 s, scan COMPLETED rows in the last 30
  minutes that still have ``notified_at IS NULL``. The sender's
  ``notified_at IS NULL`` guard on the UPDATE filter keeps this idempotent
  even under multi-worker fan-out.

Heartbeat hits ``HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL`` every 60 s; a
5-min silence pages on-call via INF-08's Uptime Kuma bridge.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any
from uuid import UUID

import httpx

if TYPE_CHECKING:  # pragma: no cover — runtime import deferred for testability
    import asyncpg

from app.workers.katara_diagnostic_email.sender import send_diagnostic_email

log = logging.getLogger("katara_diagnostic_email.listener")

CHANNEL = "katara_diagnostic_completed"
BACKOFF_SEQ: tuple[int, ...] = (1, 2, 4, 8, 30, 60)
HEARTBEAT_PERIOD_S   = 60
BACKSTOP_PERIOD_S    = 60
BACKSTOP_WINDOW_MIN  = 30
BACKSTOP_LIMIT       = 16
QUEUE_MAX            = 256


def _parse_payload(payload: str | None) -> UUID | None:
    if not payload:
        return None
    try:
        return UUID(payload.strip())
    except (ValueError, AttributeError):
        return None


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)


async def _wait_or_stop(stop_event: asyncio.Event, timeout: float) -> bool:
    """Sleep up to ``timeout`` seconds; return ``True`` if shutdown fired."""
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=timeout)
        return True
    except asyncio.TimeoutError:
        return False


async def _heartbeat_loop(stop_event: asyncio.Event) -> None:
    async with httpx.AsyncClient() as client:
        await _ping_heartbeat(client)
        while not stop_event.is_set():
            if await _wait_or_stop(stop_event, HEARTBEAT_PERIOD_S):
                return
            await _ping_heartbeat(client)


async def _consume_queue(
    queue: asyncio.Queue[str],
    stop_event: asyncio.Event,
) -> None:
    """Drain the notification queue and dispatch each diagnostic email."""
    while not stop_event.is_set():
        try:
            payload = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue

        diag_id = _parse_payload(payload)
        if diag_id is None:
            log.warning("malformed_notification_payload payload=%r", payload)
            with suppress(Exception):
                import sentry_sdk
                sentry_sdk.capture_message(
                    f"katara_diagnostic_email malformed payload: {payload!r}",
                    level="warning",
                )
            continue

        try:
            await send_diagnostic_email(diag_id)
        except Exception:
            log.exception("sender_unhandled id=%s", str(diag_id))
            with suppress(Exception):
                import sentry_sdk
                sentry_sdk.capture_exception()


async def _scan_unnotified_ids() -> list[UUID]:
    """Backstop scan — COMPLETED rows with ``notified_at IS NULL`` in the window."""
    from app.db import service_client
    # JUSTIFICATION: KAT-09 worker reads m1_katara_diagnostics via service_role
    # to find every farmer's COMPLETED-but-not-yet-emailed row. The user JWT
    # is not in scope here — the listener reacts to a system NOTIFY. AUTH-05
    # allow-list entry: workers/katara_diagnostic_email/.
    db = service_client()
    since = (
        datetime.now(timezone.utc) - timedelta(minutes=BACKSTOP_WINDOW_MIN)
    ).isoformat()
    res = (
        db.table("m1_katara_diagnostics")
        .select("id")
        .eq("status", "COMPLETED")
        .is_("notified_at", "null")
        .gte("completed_at", since)
        .order("completed_at", desc=False)
        .limit(BACKSTOP_LIMIT)
        .execute()
    )
    out: list[UUID] = []
    for row in (res.data or []):
        try:
            out.append(UUID(str(row["id"])))
        except (KeyError, ValueError):
            continue
    return out


async def _backstop_once(queue: asyncio.Queue[str]) -> None:
    try:
        ids = await _scan_unnotified_ids()
    except Exception:
        log.exception("backstop_query_failed")
        return
    log.info("backstop_pass row_count=%d", len(ids))
    for diag_id in ids:
        try:
            queue.put_nowait(str(diag_id))
        except asyncio.QueueFull:
            log.warning("backstop_queue_full dropping_remaining=%d", len(ids))
            return


async def _backstop_loop(queue: asyncio.Queue[str], stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        if await _wait_or_stop(stop_event, BACKSTOP_PERIOD_S):
            return
        await _backstop_once(queue)


def _make_notification_handler(queue: asyncio.Queue[str]) -> Any:
    """asyncpg notification callback — hand the payload to the bounded queue.

    The callback fires on the listener connection's read loop; we never block
    it. A slow Brevo call backs up on the queue (not on asyncpg).
    """

    def _handler(
        _conn: "asyncpg.Connection",
        _pid: int,
        channel: str,
        payload: str,
    ) -> None:
        if channel != CHANNEL:
            return
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            # Backstop will catch this within the next minute; drop + log.
            log.warning("notification_queue_full dropping=%r", payload)

    return _handler


async def _hold_listen_connection(
    conn: "asyncpg.Connection", stop_event: asyncio.Event,
) -> None:
    """Block until shutdown or the LISTEN connection drops."""
    while not stop_event.is_set() and not conn.is_closed():
        if await _wait_or_stop(stop_event, 5.0):
            return


async def run_listener(stop_event: asyncio.Event) -> None:
    """Top-level loop. Owns the asyncpg pool + consumer / backstop / heartbeat tasks."""
    # Runtime import — keeps the rest of the package import-safe in test
    # environments where the asyncpg C extension is unavailable. The worker
    # container always has it.
    import asyncpg

    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=2,
        max_size=4,
        command_timeout=10.0,
    )
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_MAX)

    consumer  = asyncio.create_task(_consume_queue(queue, stop_event))
    backstop  = asyncio.create_task(_backstop_loop(queue, stop_event))
    heartbeat = asyncio.create_task(_heartbeat_loop(stop_event))

    backoff_idx = 0
    listen_conn: "asyncpg.Connection | None" = None
    handler = _make_notification_handler(queue)

    try:
        while not stop_event.is_set():
            try:
                listen_conn = await pool.acquire()
                await listen_conn.add_listener(CHANNEL, handler)
                log.info("listener_subscribed channel=%s", CHANNEL)
                backoff_idx = 0
                await _backstop_once(queue)
                await _hold_listen_connection(listen_conn, stop_event)
            except (asyncpg.PostgresConnectionError, OSError, ConnectionError) as exc:
                wait_s = BACKOFF_SEQ[min(backoff_idx, len(BACKOFF_SEQ) - 1)]
                log.warning(
                    "listener_disconnected_will_retry error=%s retry_in_s=%d",
                    exc, wait_s,
                )
                backoff_idx += 1
                await _wait_or_stop(stop_event, wait_s)
            finally:
                if listen_conn is not None:
                    with suppress(Exception):
                        await listen_conn.remove_listener(CHANNEL, handler)
                    with suppress(Exception):
                        await pool.release(listen_conn)
                    listen_conn = None
    finally:
        for task in (consumer, backstop, heartbeat):
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
        with suppress(Exception):
            await pool.close()
