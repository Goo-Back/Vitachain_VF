"""FAR-04 — LISTEN/NOTIFY lifecycle + 30-minute backstop.

Mirrors :mod:`app.workers.katara_diagnostic_email.listener` (KAT-09). One
dedicated asyncpg connection on the ``farmarket_order_placed`` channel
(emitted by migration 0041's AFTER INSERT trigger), bounded notification
queue, exponential-backoff reconnect, 30-minute backstop scan that picks up
orders whose first INSERT preceded a worker restart.
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

if TYPE_CHECKING:  # pragma: no cover
    import asyncpg

from app.workers.farmarket_order_notify.sender import notify_order

log = logging.getLogger("farmarket_order_notify.listener")

CHANNEL = "farmarket_order_placed"
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
    url = os.getenv("HEALTHCHECKS_FAR_ORDER_NOTIFY_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)


async def _wait_or_stop(stop_event: asyncio.Event, timeout: float) -> bool:
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
    queue: asyncio.Queue[str], stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        try:
            payload = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue

        order_id = _parse_payload(payload)
        if order_id is None:
            log.warning("malformed_notification_payload payload=%r", payload)
            with suppress(Exception):
                import sentry_sdk
                sentry_sdk.capture_message(
                    f"farmarket_order_notify malformed payload: {payload!r}",
                    level="warning",
                )
            continue

        try:
            await notify_order(order_id)
        except Exception:
            log.exception("sender_unhandled id=%s", str(order_id))
            with suppress(Exception):
                import sentry_sdk
                sentry_sdk.capture_exception()


async def _scan_unnotified_ids() -> list[UUID]:
    from app.db import service_client
    # JUSTIFICATION: backstop scan needs all unnotified orders across all
    # restaurants. AUTH-05 allow-list entry: workers/farmarket_order_notify/.
    db = service_client()
    since = (
        datetime.now(timezone.utc) - timedelta(minutes=BACKSTOP_WINDOW_MIN)
    ).isoformat()
    res = (
        db.table("m2_farmarket_orders")
        .select("id")
        .is_("notified_at", "null")
        .gte("created_at", since)
        .order("created_at", desc=False)
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
    for order_id in ids:
        try:
            queue.put_nowait(str(order_id))
        except asyncio.QueueFull:
            log.warning("backstop_queue_full dropping_remaining=%d", len(ids))
            return


async def _backstop_loop(queue: asyncio.Queue[str], stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        if await _wait_or_stop(stop_event, BACKSTOP_PERIOD_S):
            return
        await _backstop_once(queue)


def _make_notification_handler(queue: asyncio.Queue[str]) -> Any:
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
            log.warning("notification_queue_full dropping=%r", payload)

    return _handler


async def _hold_listen_connection(
    conn: "asyncpg.Connection", stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set() and not conn.is_closed():
        if await _wait_or_stop(stop_event, 5.0):
            return


async def run_listener(stop_event: asyncio.Event) -> None:
    import asyncpg

    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(
        dsn=dsn, min_size=2, max_size=4, command_timeout=10.0,
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
