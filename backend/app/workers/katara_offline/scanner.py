"""KAT-11 — periodic scan for silent ESP32 devices.

Every ``SCAN_PERIOD_S`` seconds:

  1. UPDATE m1_katara_devices SET status='OFFLINE', last_offline_alert_at=now()
     WHERE status='ACTIVE' AND last_seen<now()-1h
       AND (last_offline_alert_at IS NULL
            OR now()-last_offline_alert_at > 24h)
     RETURNING id, device_id, parcel_id, farmer_id, last_seen;
  2. For each returned row, fetch profile + parcel name and send a Brevo
     transactional email in the farmer's saved locale.

Two layered safeguards mean the worker is restart-safe + replica-safe:

* The UPDATE clause is the atomic claim — concurrent workers see zero rows
  on subsequent passes because the row is already OFFLINE.
* A boot-time immediate ``_scan_once`` recovers the silent-device backlog
  within seconds of restart, not after a full ``SCAN_PERIOD_S`` window.

Opposite of KAT-06 §4.3: the status flip happens *before* Brevo dispatch.
Rationale §6.5 — KAT-11's 5-min cadence makes "re-alert on Brevo retry" the
worse failure mode than "miss this hour's email", and the 24h window means
the next pass after recovery picks up the alert anyway. A Brevo 5xx costs
*one* email this hour, never a flood.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import UUID

import httpx
import sentry_sdk

if TYPE_CHECKING:  # pragma: no cover — runtime import is deferred to run_scanner()
    import asyncpg

from app.workers import mailer  # NOT-01
from app.workers.katara_offline.templates import (
    FALLBACK_LOCALE,
    TEMPLATE_IDS,
    resolve_locale,
)

log = logging.getLogger("katara_offline.scanner")

SCAN_PERIOD_S = 300                # 5-min CRON cadence — see §6.2
HEARTBEAT_PERIOD_S = 60
SILENCE_THRESHOLD = "1 hour"       # interpolated into the SQL interval literal
ANTI_SPAM_WINDOW = "24 hours"      # mirrors BR-K2 (KAT-06 §4.3)

SCAN_SQL = f"""
    update public.m1_katara_devices
       set status = 'OFFLINE',
           last_offline_alert_at = now()
     where status = 'ACTIVE'
       and last_seen is not null
       and last_seen < now() - interval '{SILENCE_THRESHOLD}'
       and (last_offline_alert_at is null
            or now() - last_offline_alert_at > interval '{ANTI_SPAM_WINDOW}')
    returning id, device_id, parcel_id, farmer_id, last_seen
"""

PROFILE_SQL = """
    select p.email, p.locale, p.full_name, pa.name as parcel_name
      from public.profiles p
      join public.m1_katara_parcels pa on pa.farmer_id = p.id
     where pa.id = $1 and p.id = $2
"""


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_KAT_OFFLINE_PING_URL")
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


def _build_params(
    *,
    profile: dict[str, Any],
    device_id: str,
    parcel_id: UUID,
    last_seen: datetime,
    minutes_silent: int,
) -> dict[str, Any]:
    dashboard_base = os.getenv(
        "FRONTEND_BASE_URL", "https://vitachain.ma",
    ).rstrip("/")
    dashboard_url = f"{dashboard_base}/dashboard/farmer/parcels/{parcel_id}"
    return {
        "farmer_name":    profile.get("full_name") or "",
        "parcel_name":    profile.get("parcel_name") or "",
        "device_id":      device_id,
        "last_seen_at":   last_seen.astimezone(timezone.utc).isoformat(),
        "minutes_silent": minutes_silent,
        "dashboard_url":  dashboard_url,
    }


async def _send_for_row(
    pool: "asyncpg.Pool",
    row: Any,
    now: datetime,
) -> None:
    parcel_id: UUID = row["parcel_id"]
    farmer_id: UUID = row["farmer_id"]
    last_seen: datetime = row["last_seen"]
    device_id: str = row["device_id"]

    async with pool.acquire() as conn:
        profile = await conn.fetchrow(PROFILE_SQL, parcel_id, farmer_id)
    if profile is None or not profile.get("email"):
        # Defensive: profile/parcel deleted between UPDATE and SELECT, or the
        # farmer has no email on file. The row is already flipped to OFFLINE
        # so the next pass won't re-alert.
        log.warning(
            "offline_alert_profile_missing device_id=%s parcel_id=%s",
            device_id, str(parcel_id),
        )
        return

    locale = resolve_locale(profile.get("locale"))
    template_id = TEMPLATE_IDS.get(locale, 0) or TEMPLATE_IDS.get(FALLBACK_LOCALE, 0)
    if not template_id:
        log.warning(
            "brevo_template_id_unset locale=%s device_id=%s",
            locale, device_id,
        )
        return

    minutes_silent = max(1, int((now - last_seen).total_seconds() // 60))

    params = _build_params(
        profile=dict(profile),
        device_id=device_id,
        parcel_id=parcel_id,
        last_seen=last_seen,
        minutes_silent=minutes_silent,
    )

    try:
        await mailer.send_template(
            to=profile["email"],
            template_id=template_id,
            params=params,
            locale=locale,
        )
        log.info(
            "offline_alert_sent device_id=%s farmer_id=%s minutes_silent=%d locale=%s",
            device_id, str(farmer_id), minutes_silent, locale,
        )
    except Exception:
        # Status is already flipped to OFFLINE and last_offline_alert_at is
        # already stamped (§6.5). A Brevo failure here means this user does
        # not receive this round's email. The 24h anti-spam window prevents
        # the next pass from re-sending; the next natural re-alert window
        # opens at +24h.
        log.exception(
            "offline_alert_brevo_failed device_id=%s farmer_id=%s",
            device_id, str(farmer_id),
        )
        with suppress(Exception):
            sentry_sdk.capture_exception()


async def _scan_once(pool: "asyncpg.Pool") -> int:
    """One CRON tick. Returns the number of devices alerted."""
    started = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        rows = await conn.fetch(SCAN_SQL)

    if not rows:
        log.info("offline_scan_pass alerted=0")
        return 0

    # Bounded fan-out — <=50 demo devices in worst case. Plain gather is safe;
    # if post-MVD load demands it, swap for a semaphore here.
    await asyncio.gather(
        *(_send_for_row(pool, row, started) for row in rows),
        return_exceptions=False,
    )
    log.info("offline_scan_pass alerted=%d", len(rows))
    return len(rows)


async def run_scanner(stop_event: asyncio.Event) -> None:
    """Main loop. Owns the asyncpg pool + scan tick + heartbeat task."""
    # Runtime import keeps the rest of the package import-safe in test
    # environments where the asyncpg C extension is unavailable.
    import asyncpg

    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=3,
        command_timeout=10.0,
    )

    heartbeat = asyncio.create_task(_heartbeat_loop(stop_event))

    try:
        # Boot-time immediate pass: a worker restart during a wave of offline
        # devices should not wait 5 min to discover the backlog.
        try:
            await _scan_once(pool)
        except Exception:
            log.exception("offline_scan_boot_pass_failed")
            with suppress(Exception):
                sentry_sdk.capture_exception()

        while not stop_event.is_set():
            if await _wait_or_stop(stop_event, SCAN_PERIOD_S):
                return
            try:
                await _scan_once(pool)
            except Exception:
                log.exception("offline_scan_pass_failed")
                with suppress(Exception):
                    sentry_sdk.capture_exception()
                # Continue the loop — next tick retries.
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await heartbeat
        with suppress(Exception):
            await pool.close()
