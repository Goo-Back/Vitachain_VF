"""FAR-06 — nightly sweep that flips ACTIVE ads past their expiry to EXPIRED.

Design notes:
- One atomic UPDATE per pass; the WHERE clause is the entire business rule.
- Uses asyncpg direct connection (DATABASE_URL) to bypass RLS.
  # JUSTIFICATION: FAR-06 is a platform-level maintenance sweep with no user
  # context. The farmarket_ads_update_own RLS policy (auth.uid() = farmer_id)
  # correctly blocks this operation when called with a user JWT. The asyncpg
  # DSN (direct :5432, postgres superuser) is the documented pattern for
  # system workers in this codebase (see katara_offline, katara_diagnostic).
- Heartbeat ping to Healthchecks.io is sent ONLY after a successful sweep
  (even a zero-row sweep counts as successful). A failed sweep does NOT ping
  so Healthchecks detects the silence and alerts.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress

import httpx
import sentry_sdk

log = logging.getLogger("farmarket_expiry.sweeper")

EXPIRY_SWEEP_SQL = """
    update public.m2_farmarket_ads
       set status    = 'EXPIRED',
           updated_at = now()
     where status    = 'ACTIVE'
       and expires_at < now()
    returning id
"""


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_FAR_EXPIRY_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)
        log.debug("farmarket_expiry_heartbeat_pinged")


async def sweep_once(pool: "asyncpg.Pool") -> int:  # noqa: F821
    """One sweep pass. Returns the number of ads expired. Raises on DB error."""
    rows = await pool.fetch(EXPIRY_SWEEP_SQL)
    expired_count = len(rows)
    log.info("farmarket_expiry_sweep_done expired=%d", expired_count)
    return expired_count


async def run_sweeper(stop_event: asyncio.Event) -> None:
    """Main loop — owns the asyncpg pool, sweep tick, and heartbeat."""
    import asyncpg  # runtime import — keeps package import-safe in unit tests

    scan_period: float = float(os.getenv("EXPIRY_SCAN_PERIOD_S", "86400"))
    dsn = os.environ["DATABASE_URL"]

    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=2,
        command_timeout=15.0,
    )

    async with httpx.AsyncClient() as http_client:
        try:
            # Boot-time pass — expire any backlog immediately on (re)start.
            try:
                await sweep_once(pool)
                await _ping_heartbeat(http_client)
            except Exception:
                log.exception("farmarket_expiry_boot_pass_failed")
                with suppress(Exception):
                    sentry_sdk.capture_exception()

            while not stop_event.is_set():
                # Sleep up to scan_period; wake early if stop_event fires.
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=scan_period)
                    return  # stop was requested
                except asyncio.TimeoutError:
                    pass  # normal wakeup — time for the next sweep

                try:
                    await sweep_once(pool)
                    await _ping_heartbeat(http_client)
                except Exception:
                    log.exception("farmarket_expiry_sweep_pass_failed")
                    with suppress(Exception):
                        sentry_sdk.capture_exception()
                    # Do NOT ping heartbeat on failure — Healthchecks silence = alert.
                    # Continue the loop; next wakeup retries.
        finally:
            with suppress(Exception):
                await pool.close()
