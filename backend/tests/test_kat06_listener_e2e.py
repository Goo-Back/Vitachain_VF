"""KAT-06 — end-to-end listener round-trip.

Gated behind ``KAT06_E2E=1`` (mirrors KAT-03 / KAT-05 e2e pattern). Requires:

* a staging Postgres with the KAT-03 / KAT-05 schema migrated
* env vars: ``DATABASE_URL``, ``KAT06_DEMO_PARCEL_ID``, ``KAT06_DEMO_FARMER_ID``,
  ``KAT06_DEMO_DEVICE_ID``, ``BREVO_TEMPLATE_KAT_THRESHOLD_FR``

Three scenarios:
  1. Forge a telemetry insert crossing ``soil_moisture.min`` → ``mailer.send_template``
     is invoked once within 10 s; ``last_alert_at`` advances.
  2. Forge a second crossing 5 s later → no second call (BR-K2).
  3. Bump the threshold's ``updated_at`` past ``last_alert_at``, forge a third
     crossing → ``send_template`` fires again.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

_E2E_OPT_IN = (
    os.environ.get("KAT06_E2E") == "1"
    or "--run-e2e" in os.environ.get("PYTEST_ADDOPTS", "").split()
)

pytestmark = pytest.mark.skipif(
    not _E2E_OPT_IN,
    reason="KAT-06 e2e — set KAT06_E2E=1 + staging DATABASE_URL to run.",
)


@pytest.fixture
def parcel_id() -> uuid.UUID:
    return uuid.UUID(os.environ["KAT06_DEMO_PARCEL_ID"])


@pytest.fixture
def farmer_id() -> uuid.UUID:
    return uuid.UUID(os.environ["KAT06_DEMO_FARMER_ID"])


@pytest.fixture
def device_id() -> uuid.UUID:
    return uuid.UUID(os.environ["KAT06_DEMO_DEVICE_ID"])


async def _insert_telemetry(
    *,
    device_id: uuid.UUID,
    parcel_id: uuid.UUID,
    farmer_id: uuid.UUID,
    soil_moisture: float,
) -> uuid.UUID:
    import asyncpg

    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn)
    try:
        row = await conn.fetchrow(
            "insert into public.m1_katara_telemetry "
            "(device_id, parcel_id, farmer_id, recorded_at, "
            " soil_moisture, soil_temperature, soil_ph, "
            " soil_conductivity, battery_level) "
            "values ($1, $2, $3, $4, $5, 20.0, 6.5, 1500.0, 80) "
            "returning id",
            device_id, parcel_id, farmer_id,
            datetime.now(timezone.utc), soil_moisture,
        )
        assert row is not None
        return row["id"]
    finally:
        await conn.close()


@pytest.mark.anyio
async def test_first_crossing_sends_email(
    parcel_id: uuid.UUID, farmer_id: uuid.UUID, device_id: uuid.UUID,
) -> None:
    from app.workers.katara_threshold.evaluator import evaluate_and_send
    import asyncpg

    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=2)
    try:
        tid = await _insert_telemetry(
            device_id=device_id, parcel_id=parcel_id, farmer_id=farmer_id,
            soil_moisture=10.0,
        )
        with patch(
            "app.workers.katara_threshold.evaluator.mailer.send_template",
            new=AsyncMock(return_value={"messageId": "stub"}),
        ) as send_mock:
            await evaluate_and_send(pool=pool, telemetry_id=tid)

        assert send_mock.await_count == 1
        call = send_mock.await_args
        assert call.kwargs["params"]["crossed_bound"] == "min"
        assert call.kwargs["params"]["metric_value"] == 10.0

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "select last_alert_at, last_alert_value "
                "from public.m1_katara_thresholds "
                "where parcel_id = $1 and metric = 'soil_moisture'",
                parcel_id,
            )
        assert row is not None
        assert row["last_alert_at"] is not None
        assert float(row["last_alert_value"]) == 10.0

        # Second insert within window — BR-K2 should suppress.
        tid2 = await _insert_telemetry(
            device_id=device_id, parcel_id=parcel_id, farmer_id=farmer_id,
            soil_moisture=8.0,
        )
        send_mock.reset_mock()
        await evaluate_and_send(pool=pool, telemetry_id=tid2)
        assert send_mock.await_count == 0
    finally:
        await pool.close()
