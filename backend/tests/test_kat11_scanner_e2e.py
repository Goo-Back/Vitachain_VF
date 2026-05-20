"""KAT-11 — end-to-end offline-detection round-trip.

Gated behind ``KAT11_E2E=1`` (mirrors KAT-03 / KAT-06 e2e pattern). Requires:

* a staging Postgres with the KAT-02 / KAT-03 schema + the KAT-11 migration
  (db/migrations/0025_kat11_offline_alert_column.sql) applied
* env vars: ``DATABASE_URL``, ``KAT11_DEMO_PARCEL_ID``, ``KAT11_DEMO_FARMER_ID``

Two scenarios:
  1. Seed an ACTIVE device with ``last_seen = now() - 2h``, run one scan →
     ``mailer.send_template`` is called once; the row flips to OFFLINE and
     ``last_offline_alert_at`` is non-null.
  2. Re-run the same scan immediately → 0 new emails (BR-K11-1 anti-spam).
"""
from __future__ import annotations

import os
import uuid
from unittest.mock import AsyncMock, patch

import pytest

_E2E_OPT_IN = (
    os.environ.get("KAT11_E2E") == "1"
    or "--run-e2e" in os.environ.get("PYTEST_ADDOPTS", "").split()
)

pytestmark = pytest.mark.skipif(
    not _E2E_OPT_IN,
    reason="KAT-11 e2e — set KAT11_E2E=1 + staging DATABASE_URL to run.",
)


@pytest.fixture
def parcel_id() -> uuid.UUID:
    return uuid.UUID(os.environ["KAT11_DEMO_PARCEL_ID"])


@pytest.fixture
def farmer_id() -> uuid.UUID:
    return uuid.UUID(os.environ["KAT11_DEMO_FARMER_ID"])


async def _open_pool():
    import asyncpg

    return await asyncpg.create_pool(
        dsn=os.environ["DATABASE_URL"],
        min_size=1,
        max_size=2,
        command_timeout=10.0,
    )


async def _seed_silent_device(
    pool, *, parcel_id: uuid.UUID, farmer_id: uuid.UUID,
) -> uuid.UUID:
    """Insert a paired, ACTIVE device whose last_seen sits 2h in the past."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            insert into public.m1_katara_devices
                (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4,
                 status, last_seen)
            values ($1, $2, $3, $4, $5, 'ACTIVE', now() - interval '2 hours')
            returning id
            """,
            f"ESP-KAT-{uuid.uuid4().hex[:3].upper()}",
            parcel_id,
            farmer_id,
            "$2b$12$dummybcrypthashe2etestonly0000000000000000000000",
            "e2e0",
        )
        return row["id"]


async def _cleanup_device(pool, device_pk: uuid.UUID) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "delete from public.m1_katara_devices where id = $1",
            device_pk,
        )


@pytest.mark.asyncio
async def test_kat11_end_to_end_offline_detection(parcel_id, farmer_id):
    from app.workers.katara_offline.scanner import _scan_once

    pool = await _open_pool()
    device_pk = await _seed_silent_device(
        pool, parcel_id=parcel_id, farmer_id=farmer_id,
    )

    send_mock = AsyncMock(return_value={"messageId": "<e2e-ok>"})
    try:
        with patch(
            "app.workers.katara_offline.scanner.mailer.send_template",
            send_mock,
        ):
            # Pass 1 — first scan sees the silent device.
            alerted = await _scan_once(pool)
            assert alerted >= 1, "scan did not see the seeded silent device"
            assert send_mock.await_count >= 1

            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "select status::text, last_offline_alert_at "
                    "from public.m1_katara_devices where id = $1",
                    device_pk,
                )
            assert row["status"] == "OFFLINE"
            assert row["last_offline_alert_at"] is not None

            # Pass 2 — second scan must NOT re-alert (BR-K11-1 anti-spam).
            send_count_before = send_mock.await_count
            alerted2 = await _scan_once(pool)
            assert alerted2 == 0
            assert send_mock.await_count == send_count_before
    finally:
        await _cleanup_device(pool, device_pk)
        await pool.close()
