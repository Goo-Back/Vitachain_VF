"""KAT-05 — alert threshold endpoint coverage.

Three layers, mirroring KAT-04:

* :class:`TestThresholdValidator` — pure-unit on the Pydantic validators.
  Mirrors the per-metric DB CHECKs so malformed payloads are rejected at the
  422 boundary before a round-trip ever fires.

* :class:`TestRouterMounted` — boots the real app via :func:`create_app` and
  asserts the auth contract on the two threshold endpoints: missing bearer
  → 401, garbage parcel_id → 422.

* :class:`TestThresholdsFlowE2E` — opt-in (``KAT05_E2E=1``). Drills the bulk
  PUT happy path, the audit-column clamp, and the cross-farmer 404 against
  staging.
"""

from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.main import create_app
from app.modules.katara.schemas import (
    ThresholdRow,
    ThresholdsUpdateRequest,
    _METRIC_RANGE,
)


# ---------------------------------------------------------------------------
# Pure-unit: Pydantic validators mirror the DB CHECKs
# ---------------------------------------------------------------------------


class TestThresholdValidator:
    def test_enabled_without_bounds_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ThresholdRow(metric="soil_moisture", enabled=True)

    def test_disabled_without_bounds_also_rejected(self) -> None:
        # Mirrors the DB ``kat_threshold_at_least_one_bound`` CHECK — a row
        # with both bounds null is meaningless even when disabled.
        with pytest.raises(ValidationError):
            ThresholdRow(metric="soil_moisture", enabled=False)

    def test_min_ge_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ThresholdRow(metric="soil_moisture", min_value=80, max_value=20)

    def test_min_eq_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ThresholdRow(metric="soil_moisture", min_value=50, max_value=50)

    @pytest.mark.parametrize(
        "metric,value",
        [
            ("soil_ph", 20),
            ("soil_moisture", -1),
            ("soil_temperature", 100),
            ("soil_conductivity", 99999),
            ("battery_level", 101),
        ],
    )
    def test_out_of_range_rejected_before_db(
        self, metric: str, value: float
    ) -> None:
        with pytest.raises(ValidationError):
            ThresholdRow(metric=metric, min_value=value)  # type: ignore[arg-type]

    def test_one_sided_bound_accepted(self) -> None:
        # battery_level default is min=15, max=null — the one-sided-bound case.
        row = ThresholdRow(metric="battery_level", min_value=15)
        assert row.max_value is None
        assert row.enabled is True

    def test_bulk_request_requires_all_five_metrics(self) -> None:
        rows = [
            ThresholdRow(metric="soil_moisture", min_value=25, max_value=75),
        ]
        with pytest.raises(ValidationError):
            ThresholdsUpdateRequest(rows=rows)

    def test_bulk_request_rejects_duplicate_metric(self) -> None:
        rows = [
            ThresholdRow(metric="soil_moisture", min_value=25, max_value=75),
            ThresholdRow(metric="soil_moisture", min_value=30, max_value=70),
            ThresholdRow(metric="soil_temperature", min_value=5, max_value=35),
            ThresholdRow(metric="soil_ph", min_value=5.5, max_value=7.5),
            ThresholdRow(metric="soil_conductivity", min_value=400, max_value=3000),
        ]
        with pytest.raises(ValidationError):
            ThresholdsUpdateRequest(rows=rows)

    def test_bulk_request_happy_path(self) -> None:
        rows = [
            ThresholdRow(metric=m, min_value=lo, max_value=hi)  # type: ignore[arg-type]
            for m, (lo, hi) in {
                "soil_moisture":     (25.0, 75.0),
                "soil_temperature":  (5.0, 35.0),
                "soil_ph":           (5.5, 7.5),
                "soil_conductivity": (400.0, 3000.0),
                "battery_level":     (15.0, None),
            }.items()
        ]
        body = ThresholdsUpdateRequest(rows=rows)
        assert {r.metric for r in body.rows} == set(_METRIC_RANGE)


# ---------------------------------------------------------------------------
# Router mounted on the real app — auth-contract only (no DB writes)
# ---------------------------------------------------------------------------


@pytest.fixture
async def app_client():
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test",
    ) as c:
        yield c


_PARCEL = "11111111-1111-1111-1111-111111111111"
_THRESHOLDS = f"/api/v1/katara/parcels/{_PARCEL}/thresholds"


class TestRouterMounted:
    @pytest.mark.anyio
    async def test_get_requires_bearer(self, app_client: AsyncClient) -> None:
        r = await app_client.get(_THRESHOLDS)
        assert r.status_code == 401
        assert r.json()["detail"] == "missing_bearer_token"

    @pytest.mark.anyio
    async def test_put_requires_bearer(self, app_client: AsyncClient) -> None:
        r = await app_client.put(_THRESHOLDS, json={"rows": []})
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_get_rejects_garbage_parcel_id_with_422(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            "/api/v1/katara/parcels/not-a-uuid/thresholds",
            headers={"Authorization": f"Bearer {_make_token(role='FARMER')}"},
        )
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_put_rejects_missing_metrics_with_422(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        token = _make_token(
            role="FARMER",
            extra={"verification_status": "VERIFIED"},
        )
        r = await app_client.put(
            _THRESHOLDS,
            headers={"Authorization": f"Bearer {token}"},
            json={
                "rows": [
                    {"metric": "soil_moisture", "min_value": 25, "max_value": 75},
                ]
            },
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# e2e — staged against the real DB. Activated by KAT05_E2E=1 + staging env.
# ---------------------------------------------------------------------------

_E2E_OPT_IN = (
    os.environ.get("KAT05_E2E") == "1"
    or "--run-e2e" in os.environ.get("PYTEST_ADDOPTS", "").split()
)


@pytest.mark.skipif(
    not _E2E_OPT_IN,
    reason="KAT-05 e2e — set KAT05_E2E=1 and a staging demo parcel to run.",
)
class TestThresholdsFlowE2E:
    """Requires:
      * a parcel owned by the FARMER whose JWT is KAT05_FARMER_JWT
      * env vars: API_BASE_URL, KAT05_DEMO_PARCEL_ID, KAT05_FARMER_JWT
        (optionally KAT05_FARMER_B_JWT and KAT05_CITIZEN_JWT for the
        RLS-isolation checks).
    """

    @staticmethod
    def _u() -> str:
        api = os.environ.get("API_BASE_URL", "http://localhost:8000")
        pid = os.environ["KAT05_DEMO_PARCEL_ID"]
        return f"{api}/api/v1/katara/parcels/{pid}/thresholds"

    @staticmethod
    def _bulk_body(**overrides: tuple[float | None, float | None]) -> dict:
        defaults: dict[str, tuple[float | None, float | None]] = {
            "soil_moisture":     (25.0, 75.0),
            "soil_temperature":  (5.0, 35.0),
            "soil_ph":           (5.5, 7.5),
            "soil_conductivity": (400.0, 3000.0),
            "battery_level":     (15.0, None),
        }
        defaults.update(overrides)
        return {
            "rows": [
                {"metric": m, "min_value": mn, "max_value": mx, "enabled": True}
                for m, (mn, mx) in defaults.items()
            ]
        }

    def test_get_hydrates_defaults(self) -> None:
        import requests

        jwt = os.environ["KAT05_FARMER_JWT"]
        r = requests.get(self._u(), headers={"Authorization": f"Bearer {jwt}"})
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert {row["metric"] for row in rows} == set(_METRIC_RANGE)

    def test_put_upserts_and_reflects(self) -> None:
        import requests

        jwt = os.environ["KAT05_FARMER_JWT"]
        body = self._bulk_body(soil_moisture=(30.0, 70.0))
        r = requests.put(
            self._u(),
            json=body,
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200
        moisture = next(
            x for x in r.json()["rows"] if x["metric"] == "soil_moisture"
        )
        assert moisture["min_value"] == 30
        assert moisture["max_value"] == 70

    def test_audit_columns_silently_clamped(self) -> None:
        import requests

        jwt = os.environ["KAT05_FARMER_JWT"]
        body = self._bulk_body()
        body["rows"][0]["last_alert_at"] = "2024-01-01T00:00:00Z"
        body["rows"][0]["last_alert_value"] = 999.0
        r = requests.put(
            self._u(),
            json=body,
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200
        moisture = next(
            x for x in r.json()["rows"] if x["metric"] == "soil_moisture"
        )
        assert moisture["last_alert_at"] is None
        assert moisture["last_alert_value"] is None

    def test_citizen_404(self) -> None:
        import requests

        jwt = os.environ.get("KAT05_CITIZEN_JWT")
        if not jwt:
            pytest.skip("KAT05_CITIZEN_JWT not set")
        r = requests.get(self._u(), headers={"Authorization": f"Bearer {jwt}"})
        assert r.status_code == 404
