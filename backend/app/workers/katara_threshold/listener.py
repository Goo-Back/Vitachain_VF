"""KAT-06 — LISTEN/NOTIFY lifecycle + reconnect + polling backstop.

Holds one dedicated asyncpg connection in LISTEN mode against the
``katara_telemetry_inserted`` channel KAT-03's trigger emits. Decodes the
``'<device_id>|<telemetry_row_id>'`` payload, hands every well-formed
notification off to :func:`evaluate_and_send`, and survives transient DB
drops via exponential-backoff reconnect.

Backstop strategy — two layers:
  * **Periodic** (:func:`_backstop_loop`): every 5 min, scan the last 6 min
    of telemetry and re-run the evaluator. BR-K2 makes this idempotent.
  * **Post-reconnect** (:func:`_backstop_once`): runs immediately after a
    successful (re)connect to close the LISTEN gap.

A 60-second Healthchecks.io heartbeat pings ``HEALTHCHECKS_KAT_THRESHOLD_PING_URL``;
a 5-minute silence wakes on-call via INF-08's Uptime Kuma bridge.
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

if TYPE_CHECKING:  # pragma: no cover — runtime import is deferred to run_listener()
    import asyncpg

from app.workers.katara_threshold.evaluator import evaluate_and_send

log = logging.getLogger("katara_threshold.listener")

CHANNEL = "katara_telemetry_inserted"
BACKOFF_SEQ: tuple[int, ...] = (1, 2, 4, 8, 30, 60)
HEARTBEAT_PERIOD_S = 60
BACKSTOP_PERIOD_S = 300
BACKSTOP_LOOKBACK_S = 360  # 1-min overlap with the previous backstop run
QUEUE_MAX = 1024


def _parse_payload(payload: str | None) -> tuple[UUID, UUID] | None:
    """Return ``(device_id, telemetry_id)`` or ``None`` on malformed input."""
    if not payload:
        return None
    try:
        a, b = payload.split("|", 1)
        return UUID(a), UUID(b)
    except (ValueError, AttributeError):
        return None


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_KAT_THRESHOLD_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)


async def _wait_or_stop(stop_event: asyncio.Event, timeout: float) -> bool:
    """Sleep up to ``timeout`` seconds; return True if the stop flag fired."""
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
    pool: "asyncpg.Pool",
    stop_event: asyncio.Event,
) -> None:
    """Drain the notification queue and run the evaluator off the LISTEN path."""
    while not stop_event.is_set():
        try:
            payload = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue

        parsed = _parse_payload(payload)
        if parsed is None:
            log.warning("malformed_notification_payload payload=%r", payload)
            with suppress(Exception):
                import sentry_sdk
                sentry_sdk.capture_message(
                    f"katara_threshold malformed payload: {payload!r}",
                    level="warning",
                )
            continue

        _device_id, telemetry_id = parsed
        try:
            await evaluate_and_send(pool=pool, telemetry_id=telemetry_id)
        except Exception:
            log.exception(
                "evaluator_failed telemetry_id=%s", str(telemetry_id),
            )
            with suppress(Exception):
                import sentry_sdk
                sentry_sdk.capture_exception()


async def _scan_recent_telemetry(
    pool: "asyncpg.Pool", since: datetime,
) -> list[Any]:
    async with pool.acquire() as conn:
        return await conn.fetch(
            "select id from public.m1_katara_telemetry "
            "where recorded_at >= $1 order by recorded_at",
            since,
        )


async def _backstop_once(pool: "asyncpg.Pool") -> None:
    """One-shot post-reconnect backstop. Idempotent thanks to BR-K2."""
    since = datetime.now(timezone.utc) - timedelta(seconds=BACKSTOP_LOOKBACK_S)
    try:
        rows = await _scan_recent_telemetry(pool, since)
    except Exception:
        log.exception("post_reconnect_backstop_query_failed")
        return
    log.info("post_reconnect_backstop row_count=%d", len(rows))
    for row in rows:
        try:
            await evaluate_and_send(pool=pool, telemetry_id=row["id"])
        except Exception:
            log.exception(
                "post_reconnect_backstop_evaluator_failed telemetry_id=%s",
                str(row["id"]),
            )


async def _backstop_loop(pool: "asyncpg.Pool", stop_event: asyncio.Event) -> None:
    """Periodic backstop. Closes the gap on any notification the listener missed."""
    while not stop_event.is_set():
        if await _wait_or_stop(stop_event, BACKSTOP_PERIOD_S):
            return
        since = datetime.now(timezone.utc) - timedelta(seconds=BACKSTOP_LOOKBACK_S)
        try:
            rows = await _scan_recent_telemetry(pool, since)
        except Exception:
            log.exception("backstop_query_failed")
            continue
        log.info("backstop_pass row_count=%d", len(rows))
        for row in rows:
            try:
                await evaluate_and_send(pool=pool, telemetry_id=row["id"])
            except Exception:
                log.exception(
                    "backstop_evaluator_failed telemetry_id=%s", str(row["id"]),
                )


def _make_notification_handler(queue: asyncio.Queue[str]) -> Any:
    """Return an asyncpg notification callback that enqueues the payload.

    The callback is fired on the listener connection's thread; we hand the
    payload off to the bounded queue immediately so a slow evaluator cannot
    back-pressure into asyncpg's read loop.
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
            # Polling backstop will catch this within 5 minutes; drop + log.
            log.warning("notification_queue_full dropping=%r", payload)

    return _handler


async def _hold_listen_connection(
    conn: "asyncpg.Connection", stop_event: asyncio.Event,
) -> None:
    """Block until shutdown or the connection drops."""
    while not stop_event.is_set() and not conn.is_closed():
        if await _wait_or_stop(stop_event, 5.0):
            return


async def run_listener(stop_event: asyncio.Event) -> None:
    """Main loop. Owns the asyncpg pool + consumer / backstop / heartbeat tasks."""
    # Runtime import — keeps the rest of the package import-safe in test
    # environments where the asyncpg C extension is unavailable (e.g. Python
    # 3.14 without prebuilt wheels). The worker container always has it.
    import asyncpg

    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=2,
        max_size=4,
        command_timeout=10.0,
    )
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_MAX)

    consumer = asyncio.create_task(_consume_queue(queue, pool, stop_event))
    backstop = asyncio.create_task(_backstop_loop(pool, stop_event))
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
                await _backstop_once(pool)
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
