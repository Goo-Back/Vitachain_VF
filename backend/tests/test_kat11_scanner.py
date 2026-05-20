"""KAT-11 — offline-detection scanner unit tests.

The scanner's logic lives mostly in SQL (the atomic UPDATE ... RETURNING is
the BR-K11-1 truth table). The unit-test surface therefore covers the
post-UPDATE fan-out: parcel/profile fetch, locale fallback, Brevo dispatch,
and graceful degradation on each known failure mode (KAT-11 §6.7).

Five scenarios from KAT-11 §7.1:

  S1  UPDATE returns 0 rows  → no send, scan returns 0.
  S2  UPDATE returns 1 row, locale=fr  → FR template, well-formed params.
  S3  UPDATE returns 1 row, locale=xx (unknown)  → FR fallback.
  S4  UPDATE returns 1 row, profile missing  → no send, warning log.
  S5  UPDATE returns 2 rows, Brevo fails for the second  → first sent,
      second Sentry-captured, scan still returns 2 (rows already flipped
      to OFFLINE regardless of email outcome).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.workers.katara_offline import scanner as scanner_mod
from app.workers.katara_offline.scanner import _scan_once
from app.workers.katara_offline.templates import TEMPLATE_IDS, resolve_locale


NOW = datetime(2026, 5, 17, 14, 0, tzinfo=timezone.utc)
TWO_HOURS_AGO = NOW - timedelta(hours=2)


# ---------------------------------------------------------------------------
# Helpers — asyncpg pool/conn doubles.
# ---------------------------------------------------------------------------


def _make_row(**overrides):
    """Return a dict-like row mirroring asyncpg.Record's __getitem__ contract."""
    base = {
        "id":         uuid4(),
        "device_id":  "ESP-KAT-001",
        "parcel_id":  uuid4(),
        "farmer_id":  uuid4(),
        "last_seen":  TWO_HOURS_AGO,
    }
    base.update(overrides)
    return base


def _make_profile(**overrides):
    base = {
        "email":       "farmer@vitachain.test",
        "locale":      "fr",
        "full_name":   "Ahmed Ben Salah",
        "parcel_name": "Olive Grove North",
    }
    base.update(overrides)
    return base


class _AcquireCtx:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *_):
        return False


def _make_pool(update_rows: list[dict], profile_rows: list[dict | None]):
    """Build a fake asyncpg pool.

    Each ``conn.fetch`` call returns the next item from ``update_rows``; each
    ``conn.fetchrow`` returns the next from ``profile_rows``. The scanner
    acquires one connection per scan + one per per-row profile fetch, so we
    return the same mock connection every time via an async-context-manager.
    """
    conn = SimpleNamespace()
    conn.fetch = AsyncMock(side_effect=list(update_rows))
    conn.fetchrow = AsyncMock(side_effect=list(profile_rows))

    pool = MagicMock()
    pool.acquire = MagicMock(side_effect=lambda: _AcquireCtx(conn))
    return pool, conn


@pytest.fixture(autouse=True)
def _wire_brevo_template_ids(monkeypatch):
    """Force deterministic template ids so resolve_locale + dispatch don't
    silently no-op when the env vars are unset in CI."""
    monkeypatch.setitem(TEMPLATE_IDS, "fr", 1101)
    monkeypatch.setitem(TEMPLATE_IDS, "ar", 1102)
    monkeypatch.setitem(TEMPLATE_IDS, "en", 1103)
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://vitachain.test")
    yield


@pytest.fixture
def send_mock(monkeypatch):
    mock = AsyncMock(return_value={"messageId": "<brevo-ok>"})
    monkeypatch.setattr(scanner_mod.mailer, "send_template", mock)
    return mock


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s1_no_silent_devices(send_mock) -> None:
    pool, _ = _make_pool(update_rows=[[]], profile_rows=[])

    alerted = await _scan_once(pool)

    assert alerted == 0
    assert send_mock.await_count == 0


@pytest.mark.asyncio
async def test_s2_single_silent_device_fr_dispatch(send_mock) -> None:
    row = _make_row(device_id="ESP-KAT-042")
    profile = _make_profile(locale="fr")
    pool, _ = _make_pool(update_rows=[[row]], profile_rows=[profile])

    alerted = await _scan_once(pool)

    assert alerted == 1
    assert send_mock.await_count == 1
    kwargs = send_mock.await_args.kwargs
    assert kwargs["to"] == "farmer@vitachain.test"
    assert kwargs["template_id"] == TEMPLATE_IDS["fr"]
    assert kwargs["locale"] == "fr"
    params = kwargs["params"]
    assert params["device_id"] == "ESP-KAT-042"
    assert params["parcel_name"] == "Olive Grove North"
    assert params["minutes_silent"] >= 60
    assert params["dashboard_url"].endswith(f"/parcels/{row['parcel_id']}")
    assert params["last_seen_at"].endswith("+00:00") or params["last_seen_at"].endswith("Z")


@pytest.mark.asyncio
async def test_s3_unknown_locale_falls_back_to_fr(send_mock) -> None:
    row = _make_row()
    profile = _make_profile(locale="xx")
    pool, _ = _make_pool(update_rows=[[row]], profile_rows=[profile])

    alerted = await _scan_once(pool)

    assert alerted == 1
    assert send_mock.await_count == 1
    assert send_mock.await_args.kwargs["template_id"] == TEMPLATE_IDS["fr"]
    assert send_mock.await_args.kwargs["locale"] == "fr"
    # Sanity: resolve_locale itself behaves consistently with the dispatch.
    assert resolve_locale("xx") == "fr"


@pytest.mark.asyncio
async def test_s4_profile_missing_no_dispatch(send_mock, caplog) -> None:
    row = _make_row()
    pool, _ = _make_pool(update_rows=[[row]], profile_rows=[None])

    with caplog.at_level("WARNING", logger="katara_offline.scanner"):
        alerted = await _scan_once(pool)

    # The row was flipped to OFFLINE at the DB level; the count reflects that.
    assert alerted == 1
    assert send_mock.await_count == 0
    assert any("offline_alert_profile_missing" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_s5_two_rows_brevo_fails_for_second(monkeypatch, caplog) -> None:
    row_a = _make_row(device_id="ESP-KAT-100")
    row_b = _make_row(device_id="ESP-KAT-200")
    profile_a = _make_profile(full_name="Farmer A", parcel_name="Parcel A")
    profile_b = _make_profile(full_name="Farmer B", parcel_name="Parcel B",
                              email="b@vitachain.test")
    pool, _ = _make_pool(
        update_rows=[[row_a, row_b]],
        profile_rows=[profile_a, profile_b],
    )

    send_mock = AsyncMock(side_effect=[{"ok": True}, RuntimeError("brevo 503")])
    monkeypatch.setattr(scanner_mod.mailer, "send_template", send_mock)

    captured = MagicMock()
    monkeypatch.setattr(scanner_mod.sentry_sdk, "capture_exception", captured)

    with caplog.at_level("ERROR", logger="katara_offline.scanner"):
        alerted = await _scan_once(pool)

    assert alerted == 2
    assert send_mock.await_count == 2
    assert captured.call_count == 1
    assert any("offline_alert_brevo_failed" in rec.message for rec in caplog.records)
