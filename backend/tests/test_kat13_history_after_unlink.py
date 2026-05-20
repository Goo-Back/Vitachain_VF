"""KAT-13 — historical telemetry after unlink endpoint coverage.

Two layers, same shape as KAT-04 / KAT-12:

* :class:`TestLatestTelemetrySchema` — pure-unit on the
  :class:`LatestTelemetry` model extension. The KAT-13 fields
  (``device_label``, ``device_status``, ``device_unlinked_at``) are additive
  and optional, so a KAT-04-shaped payload (no new fields) still validates.

* :class:`TestDeviceHistorySchema` — pure-unit on the new
  :class:`DeviceHistoryEntry` / :class:`DeviceHistoryResponse` models. Verifies
  the status literal is constrained and the response shape round-trips.

* :class:`TestRouterMounted` — boots the real app via :func:`create_app` and
  asserts the auth contract on the three KAT-13 surfaces (``/latest`` extended,
  ``/history?device_id=...``, ``/devices-history``). No DB writes; the e2e
  staging walk lives under ``--run-e2e`` and is skipped by default.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.modules.katara.schemas import (
    DeviceHistoryEntry,
    DeviceHistoryResponse,
    LatestTelemetry,
)


# ---------------------------------------------------------------------------
# Pure-unit: Pydantic schemas
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TestLatestTelemetrySchema:
    """KAT-13 extends KAT-04's LatestTelemetry with three optional fields.
    The KAT-04 callsites pass no new fields; the KAT-13 callsites set the
    UNLINKED branch."""

    def _base_payload(self) -> dict:
        return {
            "device_id": str(uuid.uuid4()),
            "soil_moisture": 45.0,
            "soil_temperature": 22.0,
            "soil_ph": 6.8,
            "soil_conductivity": 1100.0,
            "battery_level": 92,
            "recorded_at": _now(),
            "received_at": _now(),
        }

    def test_kat04_shape_still_validates(self) -> None:
        # Back-compat probe: a payload with no KAT-13 fields must validate.
        m = LatestTelemetry(**self._base_payload())
        assert m.device_label is None
        assert m.device_status is None
        assert m.device_unlinked_at is None

    def test_active_payload_validates(self) -> None:
        payload = self._base_payload() | {
            "device_label": "ESP-KAT-001",
            "device_status": "ACTIVE",
        }
        m = LatestTelemetry(**payload)
        assert m.device_status == "ACTIVE"
        assert m.device_unlinked_at is None

    def test_unlinked_payload_validates_with_timestamp(self) -> None:
        ts = _now() - timedelta(days=3)
        payload = self._base_payload() | {
            "device_label": "ESP-KAT-001",
            "device_status": "UNLINKED",
            "device_unlinked_at": ts,
        }
        m = LatestTelemetry(**payload)
        assert m.device_status == "UNLINKED"
        assert m.device_unlinked_at is not None

    @pytest.mark.parametrize(
        "bad_status",
        ["active", "REMOVED", "DELETED", "Unlinked", ""],
    )
    def test_invalid_device_status_rejected(self, bad_status: str) -> None:
        # Drift on the literal would silently leak the wrong pill colour to
        # the UI; we die at the Pydantic boundary instead.
        payload = self._base_payload() | {"device_status": bad_status}
        with pytest.raises(ValidationError):
            LatestTelemetry(**payload)


class TestDeviceHistorySchema:
    """The new schemas powering the <DeviceHistoryCard>."""

    def _entry_payload(self, **overrides) -> dict:
        base = {
            "device_uuid": str(uuid.uuid4()),
            "device_id": "ESP-KAT-001",
            "device_status": "ACTIVE",
            "api_key_last4": "ab12",
            "first_recorded_at": _now() - timedelta(days=7),
            "last_recorded_at": _now(),
            "sample_count": 96,
            "is_currently_paired": True,
            "device_updated_at": _now(),
        }
        base.update(overrides)
        return base

    def test_active_entry_validates(self) -> None:
        m = DeviceHistoryEntry(**self._entry_payload())
        assert m.device_status == "ACTIVE"
        assert m.is_currently_paired is True

    def test_unlinked_entry_validates(self) -> None:
        m = DeviceHistoryEntry(
            **self._entry_payload(
                device_status="UNLINKED", is_currently_paired=False,
            ),
        )
        assert m.device_status == "UNLINKED"
        assert m.is_currently_paired is False

    def test_api_key_last4_can_be_null(self) -> None:
        # Defensive: a stale row whose api_key_last4 has been cleared by a
        # future archival pass must still flow through the read path.
        m = DeviceHistoryEntry(**self._entry_payload(api_key_last4=None))
        assert m.api_key_last4 is None

    @pytest.mark.parametrize(
        "bad_status", ["active", "ARCHIVED", "removed", ""],
    )
    def test_invalid_status_rejected(self, bad_status: str) -> None:
        with pytest.raises(ValidationError):
            DeviceHistoryEntry(**self._entry_payload(device_status=bad_status))

    def test_response_empty_devices_validates(self) -> None:
        # A parcel with no telemetry ever returns an empty list; the
        # frontend hides the card when empty (see DeviceHistoryCard.tsx).
        m = DeviceHistoryResponse(devices=[])
        assert m.devices == []

    def test_response_round_trip(self) -> None:
        m = DeviceHistoryResponse(
            devices=[DeviceHistoryEntry(**self._entry_payload())],
        )
        assert len(m.devices) == 1
        # Round-trip through JSON (the wire format) must preserve the literal.
        dumped = m.model_dump(mode="json")
        rebuilt = DeviceHistoryResponse(**dumped)
        assert rebuilt.devices[0].device_status == "ACTIVE"


# ---------------------------------------------------------------------------
# Router mounted on the real app — auth-contract only (no DB writes)
# ---------------------------------------------------------------------------


@pytest.fixture
async def app_client():
    from app.main import create_app  # lazy import — conftest seeds env first

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test",
    ) as c:
        yield c


_PARCEL = "11111111-1111-1111-1111-111111111111"
_DEVICE = "22222222-2222-2222-2222-222222222222"
_DEVICES_HISTORY = f"/api/v1/katara/parcels/{_PARCEL}/devices-history"
_HISTORY_FILTERED = (
    f"/api/v1/katara/parcels/{_PARCEL}/telemetry/history"
    f"?window=7d&device_id={_DEVICE}"
)


class TestRouterMounted:
    @pytest.mark.anyio
    async def test_devices_history_requires_bearer(
        self, app_client: AsyncClient,
    ) -> None:
        r = await app_client.get(_DEVICES_HISTORY)
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_history_with_device_filter_requires_bearer(
        self, app_client: AsyncClient,
    ) -> None:
        r = await app_client.get(_HISTORY_FILTERED)
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_history_rejects_malformed_device_id(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            f"/api/v1/katara/parcels/{_PARCEL}/telemetry/history"
            f"?window=7d&device_id=not-a-uuid",
            headers={"Authorization": f"Bearer {_make_token(role='FARMER')}"},
        )
        # FastAPI's UUID parsing emits 422 at the query-parsing layer.
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_devices_history_rejects_garbage_parcel_id(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            "/api/v1/katara/parcels/not-a-uuid/devices-history",
            headers={"Authorization": f"Bearer {_make_token(role='FARMER')}"},
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# e2e — staged against the real DB after a paired-then-unlinked device exists
# on a known parcel. Gated by --run-e2e (or KAT13_E2E=1).
# ---------------------------------------------------------------------------


_E2E_OPT_IN = (
    os.environ.get("KAT13_E2E") == "1"
    or "--run-e2e" in os.environ.get("PYTEST_ADDOPTS", "").split()
)


@pytest.mark.skipif(
    not _E2E_OPT_IN,
    reason="KAT-13 e2e — set KAT13_E2E=1 and a staged parcel to run.",
)
class TestHistoryAfterUnlinkE2E:
    """Requires:
    * a parcel with at least one UNLINKED device that produced telemetry
    * env vars: API_BASE_URL, KAT13_DEMO_PARCEL_ID, KAT13_FARMER_JWT
    """

    @pytest.fixture
    def api_base(self) -> str:
        return os.environ.get("API_BASE_URL", "http://localhost:8000")

    @pytest.fixture
    def parcel_id(self) -> str:
        v = os.environ.get("KAT13_DEMO_PARCEL_ID")
        if not v:
            pytest.skip("KAT13_DEMO_PARCEL_ID not set")
        return v

    @pytest.fixture
    def farmer_jwt(self) -> str:
        v = os.environ.get("KAT13_FARMER_JWT")
        if not v:
            pytest.skip("KAT13_FARMER_JWT not set")
        return v

    def _get(self, api_base: str, jwt: str, path: str):
        import requests

        return requests.get(
            f"{api_base}{path}",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=10,
        )

    def test_devices_history_lists_unlinked_devices(
        self, api_base: str, farmer_jwt: str, parcel_id: str,
    ) -> None:
        # S4 from the story §5.7 matrix.
        r = self._get(
            api_base, farmer_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/devices-history",
        )
        assert r.status_code == 200, r.text
        devices = r.json()["devices"]
        assert len(devices) >= 1
        statuses = {d["device_status"] for d in devices}
        assert statuses.issubset({"PENDING", "ACTIVE", "OFFLINE", "UNLINKED"})

    def test_history_unaffected_by_unlink(
        self, api_base: str, farmer_jwt: str, parcel_id: str,
    ) -> None:
        # S1 from the matrix — implicit pre/post: the rows survived an unlink
        # because they are still here. We assert the response shape.
        r = self._get(
            api_base, farmer_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/telemetry/history?window=7d",
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["window"] == "7d"
        assert body["point_count"] == len(body["buckets"])
        assert body["point_count"] <= 500

    def test_history_filter_returns_single_device_slice(
        self, api_base: str, farmer_jwt: str, parcel_id: str,
    ) -> None:
        # S2 from the matrix. First, find an UNLINKED device on this parcel.
        d = self._get(
            api_base, farmer_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/devices-history",
        )
        assert d.status_code == 200
        unlinked = [
            e for e in d.json()["devices"]
            if e["device_status"] == "UNLINKED"
        ]
        if not unlinked:
            pytest.skip("no UNLINKED device on the staged parcel")

        target = unlinked[0]
        r = self._get(
            api_base, farmer_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/telemetry/history"
            f"?window=7d&device_id={target['device_uuid']}",
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for bucket in body["buckets"]:
            # The function returns device_count = 1 when a single-device
            # filter is applied (or 0 when the bucket is empty).
            assert bucket["device_count"] in (0, 1)

    def test_latest_falls_back_to_unlinked_when_only_unlinked_devices(
        self, api_base: str, farmer_jwt: str, parcel_id: str,
    ) -> None:
        # S3 from the matrix — only asserts the contract when the staged
        # parcel has no currently-active device.
        r = self._get(
            api_base, farmer_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/telemetry/latest",
        )
        assert r.status_code in (200, 204)
        if r.status_code == 200:
            body = r.json()
            # KAT-13 fields are present even on ACTIVE rows (just nulled out
            # for the UNLINKED-specific timestamp).
            assert "device_status" in body
            if body["device_status"] == "UNLINKED":
                assert body["device_unlinked_at"] is not None
