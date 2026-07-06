"""KAT-14 — farmer-level multi-parcel overview endpoint coverage.

Three layers, same shape as KAT-13:

* :class:`TestOverviewSchemas` — pure-unit on the new Pydantic models
  (:class:`ParcelOverviewEntry`, :class:`FarmKpiRollup`,
  :class:`FarmerOverviewResponse`). Covers nullable fields (no telemetry yet),
  Decimal preservation for surface area, and the rollup round-trip.

* :class:`TestRouterMounted` — boots the real app via :func:`create_app` and
  asserts the auth contract on the one new GET surface. No DB writes; the e2e
  staging walk lives under ``--run-e2e`` and is skipped by default.

* :class:`TestOverviewE2E` — gated by ``KAT14_E2E=1`` (or ``--run-e2e``).
  Runs the §7.2 round-trip against staging — 3 parcels, mixed device states,
  cross-farmer isolation.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.modules.katara.schemas import (
    FarmKpiRollup,
    FarmerOverviewResponse,
    ParcelOverviewEntry,
)


# ---------------------------------------------------------------------------
# Pure-unit: Pydantic schemas
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TestOverviewSchemas:
    def _entry_payload(self, **overrides) -> dict:
        base = {
            "parcel_id": str(uuid.uuid4()),
            "name": "Tomates Nord",
            "crop_type": "Tomates",
            "surface_area_ha": "4.2500",
            "device_active_count": 1,
            "device_offline_count": 0,
            "device_pending_count": 0,
            "device_unlinked_count": 0,
            "last_reading_at": _now(),
            "last_soil_moisture": 38.1,
            "has_open_threshold_breach": False,
            "open_alert_count": 0,
        }
        base.update(overrides)
        return base

    def test_active_entry_validates(self) -> None:
        m = ParcelOverviewEntry(**self._entry_payload())
        assert m.device_active_count == 1
        assert m.has_open_threshold_breach is False

    def test_no_telemetry_yet_entry_validates(self) -> None:
        # A brand-new parcel with no device, no telemetry, no thresholds
        # still appears on the overview — the left-joins in the view emit
        # null for the telemetry columns.
        m = ParcelOverviewEntry(
            **self._entry_payload(last_reading_at=None, last_soil_moisture=None),
        )
        assert m.last_reading_at is None
        assert m.last_soil_moisture is None

    def test_surface_area_preserves_decimal(self) -> None:
        # The wire format is a string; Pydantic Decimal must not round-trip
        # through float (which would drop the trailing zeros and break the
        # KPI sum's exact Decimal arithmetic).
        m = ParcelOverviewEntry(**self._entry_payload(surface_area_ha="4.2500"))
        assert m.surface_area_ha == Decimal("4.2500")

    @pytest.mark.parametrize("bad_count", [-1, "two", 1.5])
    def test_negative_or_malformed_device_count_rejected(
        self, bad_count: object,
    ) -> None:
        # Defensive: a regression in the view that emits a non-int device
        # count must die at the Pydantic boundary, not on the dashboard.
        if bad_count == 1.5:
            # Pydantic v2 coerces 1.5 → 1 for `int`; pin the strict path.
            with pytest.raises(ValidationError):
                ParcelOverviewEntry(
                    **self._entry_payload(device_active_count="1.5"),
                )
            return
        with pytest.raises(ValidationError):
            ParcelOverviewEntry(
                **self._entry_payload(device_active_count=bad_count),
            )

    def test_kpi_round_trip(self) -> None:
        kpi = FarmKpiRollup(
            parcel_count=3,
            total_surface_ha=Decimal("12.4500"),
            device_active_count=2,
            device_offline_count=1,
            device_pending_count=0,
            device_unlinked_count=1,
            parcels_with_open_breach=1,
            open_alert_count=1,
        )
        dumped = kpi.model_dump(mode="json")
        rebuilt = FarmKpiRollup(**dumped)
        assert rebuilt.total_surface_ha == Decimal("12.4500")
        assert rebuilt.parcels_with_open_breach == 1

    def test_response_empty_parcels_validates(self) -> None:
        # The brand-new-farmer state — KPI zeroed, no parcels.
        resp = FarmerOverviewResponse(
            kpi=FarmKpiRollup(
                parcel_count=0,
                total_surface_ha=Decimal("0.0000"),
                device_active_count=0,
                device_offline_count=0,
                device_pending_count=0,
                device_unlinked_count=0,
                parcels_with_open_breach=0,
                open_alert_count=0,
            ),
            parcels=[],
        )
        assert resp.parcels == []
        assert resp.kpi.parcel_count == 0

    def test_response_round_trip(self) -> None:
        resp = FarmerOverviewResponse(
            kpi=FarmKpiRollup(
                parcel_count=1,
                total_surface_ha=Decimal("4.2500"),
                device_active_count=1,
                device_offline_count=0,
                device_pending_count=0,
                device_unlinked_count=0,
                parcels_with_open_breach=0,
                open_alert_count=0,
            ),
            parcels=[ParcelOverviewEntry(**self._entry_payload())],
        )
        dumped = resp.model_dump(mode="json")
        rebuilt = FarmerOverviewResponse(**dumped)
        assert len(rebuilt.parcels) == 1
        assert rebuilt.kpi.parcel_count == 1


# ---------------------------------------------------------------------------
# Router mounted on the real app — auth-contract only (no DB writes)
# ---------------------------------------------------------------------------


@pytest.fixture
async def app_client():
    from app.main import create_app  # lazy import — conftest seeds env first

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as c:
        yield c


_OVERVIEW = "/api/v1/katara/farmers/me/overview"


class TestRouterMounted:
    @pytest.mark.anyio
    async def test_overview_requires_bearer(
        self, app_client: AsyncClient,
    ) -> None:
        r = await app_client.get(_OVERVIEW)
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_overview_rejects_expired_token(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            _OVERVIEW,
            headers={
                "Authorization": f"Bearer {_make_token(exp_offset=-1)}",
            },
        )
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_overview_rejects_bad_signature(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            _OVERVIEW,
            headers={
                "Authorization": f"Bearer {_make_token(secret='not-the-real-secret-X')}",
            },
        )
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# e2e — staged against the real DB. Gated by --run-e2e (or KAT14_E2E=1).
# Requires:
#   * FARMER-A with 3 parcels and mixed device states
#   * env vars: API_BASE_URL, KAT14_FARMER_A_JWT, KAT14_FARMER_B_JWT
# ---------------------------------------------------------------------------


_E2E_OPT_IN = (
    os.environ.get("KAT14_E2E") == "1"
    or "--run-e2e" in os.environ.get("PYTEST_ADDOPTS", "").split()
)


@pytest.mark.skipif(
    not _E2E_OPT_IN,
    reason="KAT-14 e2e — set KAT14_E2E=1 and a staged farmer to run.",
)
class TestOverviewE2E:
    @pytest.fixture
    def api_base(self) -> str:
        return os.environ.get("API_BASE_URL", "http://localhost:8000")

    @pytest.fixture
    def farmer_a_jwt(self) -> str:
        v = os.environ.get("KAT14_FARMER_A_JWT")
        if not v:
            pytest.skip("KAT14_FARMER_A_JWT not set")
        return v

    @pytest.fixture
    def farmer_b_jwt(self) -> str:
        v = os.environ.get("KAT14_FARMER_B_JWT")
        if not v:
            pytest.skip("KAT14_FARMER_B_JWT not set")
        return v

    def _get(self, api_base: str, jwt: str):
        import requests

        return requests.get(
            f"{api_base}{_OVERVIEW}",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=10,
        )

    def test_overview_returns_kpi_and_parcels(
        self, api_base: str, farmer_a_jwt: str,
    ) -> None:
        # §7.2 step 3 — payload shape against a 3-parcel farmer.
        r = self._get(api_base, farmer_a_jwt)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "kpi" in body and "parcels" in body
        assert body["kpi"]["parcel_count"] == len(body["parcels"])
        # KPI sums equal per-parcel sums (the handler is the only place this
        # invariant is enforced — a regression would silently mis-report).
        assert body["kpi"]["device_active_count"] == sum(
            p["device_active_count"] for p in body["parcels"]
        )
        assert body["kpi"]["parcels_with_open_breach"] == sum(
            1 for p in body["parcels"] if p["has_open_threshold_breach"]
        )

    def test_cross_farmer_isolation(
        self, api_base: str, farmer_a_jwt: str, farmer_b_jwt: str,
    ) -> None:
        # §7.2 step 5 — RLS on the underlying tables must keep farmers apart.
        ra = self._get(api_base, farmer_a_jwt)
        rb = self._get(api_base, farmer_b_jwt)
        assert ra.status_code == 200
        assert rb.status_code == 200
        ids_a = {p["parcel_id"] for p in ra.json()["parcels"]}
        ids_b = {p["parcel_id"] for p in rb.json()["parcels"]}
        assert ids_a.isdisjoint(ids_b), (
            "KAT-14 isolation breach: farmer A and farmer B see overlapping "
            "parcel ids — the view's RLS inheritance from m1_katara_parcels "
            "is not holding."
        )

    def test_overview_sets_short_cache_header(
        self, api_base: str, farmer_a_jwt: str,
    ) -> None:
        # The 60 s window is part of the public contract — a CDN or proxy
        # sitting between the client and FastAPI must see it.
        r = self._get(api_base, farmer_a_jwt)
        assert r.status_code == 200
        assert "max-age=60" in r.headers.get("cache-control", "")
        assert "private" in r.headers.get("cache-control", "")
