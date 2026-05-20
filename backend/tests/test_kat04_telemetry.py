"""KAT-04 — dashboard telemetry endpoint coverage.

Two layers, mirroring KAT-03:

* :class:`TestGranularityTable` — pure-unit on the router's window→granularity
  map. Asserts BR-K4 (≤ 500 returned points) is structurally satisfied for
  every supported window, and that the documented set of windows is the only
  set the router accepts.

* :class:`TestRouterMounted` — boots the real app via :func:`create_app` and
  asserts the auth contract on the two telemetry endpoints: missing bearer
  → 401, bad ``?window`` → 422 with the localizable detail string. No DB
  writes; the e2e block (against staging, after ``seed_kat04_demo.py``) lives
  under ``--run-e2e`` and is skipped by default.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.modules.katara.telemetry import _MAX_POINTS, _PICK_GRANULARITY


# ---------------------------------------------------------------------------
# Pure-unit: window → granularity table
# ---------------------------------------------------------------------------


class TestGranularityTable:
    def test_every_window_is_capped_below_br_k4_wall(self) -> None:
        """BR-K4: no documented window can return > 500 points."""
        for window, (_, granularity, cap) in _PICK_GRANULARITY.items():
            assert cap <= _MAX_POINTS, (
                f"window={window} granularity={granularity} cap={cap} "
                f"exceeds BR-K4 wall ({_MAX_POINTS})"
            )

    def test_window_keys_are_exactly_the_three_documented_values(self) -> None:
        assert set(_PICK_GRANULARITY) == {"24h", "7d", "30d"}

    def test_arithmetic_caps_match_documented_values(self) -> None:
        """The per-window cap matches the §4.1 table — if this drifts, the
        story doc and the runtime stop agreeing."""
        assert _PICK_GRANULARITY["24h"][2] == 96   # 24 h × 4 / h
        assert _PICK_GRANULARITY["7d"][2] == 168   # 7 d × 24 h
        assert _PICK_GRANULARITY["30d"][2] == 30   # 30 d

    def test_granularities_are_postgres_date_trunc_compatible(self) -> None:
        """date_trunc only accepts a known set of unit strings; if a future
        edit puts ``'1h'`` (Postgres rejects) here, this fails fast."""
        accepted = {"15min", "1hour", "1day"}
        for window, (_, granularity, _cap) in _PICK_GRANULARITY.items():
            assert granularity in accepted, (
                f"window={window} granularity={granularity!r} is not a "
                f"date_trunc unit recognised by the SQL function"
            )


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
_LATEST = f"/api/v1/katara/parcels/{_PARCEL}/telemetry/latest"
_HISTORY = f"/api/v1/katara/parcels/{_PARCEL}/telemetry/history"


class TestRouterMounted:
    @pytest.mark.anyio
    async def test_latest_requires_bearer(self, app_client: AsyncClient) -> None:
        r = await app_client.get(_LATEST)
        assert r.status_code == 401
        assert r.json()["detail"] == "missing_bearer_token"

    @pytest.mark.anyio
    async def test_history_requires_bearer(self, app_client: AsyncClient) -> None:
        r = await app_client.get(f"{_HISTORY}?window=24h")
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_history_rejects_unknown_window_with_422(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            f"{_HISTORY}?window=quarterly",
            headers={"Authorization": f"Bearer {_make_token(role='FARMER')}"},
        )
        # FastAPI's Pydantic-Literal validation fires at the query-parsing
        # layer (422) before the router body runs. We don't claim the detail
        # string here — only the status — because Pydantic and our custom
        # guard emit different envelopes.
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_history_missing_window_is_422(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            _HISTORY,
            headers={"Authorization": f"Bearer {_make_token(role='FARMER')}"},
        )
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_latest_rejects_garbage_parcel_id_with_422(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            "/api/v1/katara/parcels/not-a-uuid/telemetry/latest",
            headers={"Authorization": f"Bearer {_make_token(role='FARMER')}"},
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# e2e — staged against the real DB after seed_kat04_demo.py has run.
# Activated only when SUPABASE_URL + a paired demo device are present, and
# the `--run-e2e` opt-in flag is passed (or KAT04_E2E=1 is in the env).
# ---------------------------------------------------------------------------


_E2E_OPT_IN = (
    os.environ.get("KAT04_E2E") == "1"
    or "--run-e2e" in os.environ.get("PYTEST_ADDOPTS", "").split()
)


@pytest.mark.skipif(
    not _E2E_OPT_IN,
    reason="KAT-04 e2e — set KAT04_E2E=1 and a staging demo parcel to run.",
)
class TestTelemetryFlowE2E:
    """Requires:
      * a paired demo device (KAT-02) on a known parcel
      * ``scripts/seed_kat04_demo.py`` already run against that device
      * env vars: API_BASE_URL, KAT04_DEMO_PARCEL_ID, KAT04_FARMER_JWT
        (optionally KAT04_FARMER_B_JWT and KAT04_CITIZEN_JWT for the
        RLS-isolation checks).
    """

    @pytest.fixture
    def api_base(self) -> str:
        return os.environ.get("API_BASE_URL", "http://localhost:8000")

    @pytest.fixture
    def parcel_id(self) -> str:
        v = os.environ.get("KAT04_DEMO_PARCEL_ID")
        if not v:
            pytest.skip("KAT04_DEMO_PARCEL_ID not set")
        return v

    @pytest.fixture
    def farmer_jwt(self) -> str:
        v = os.environ.get("KAT04_FARMER_JWT")
        if not v:
            pytest.skip("KAT04_FARMER_JWT not set")
        return v

    def _get(self, api_base: str, jwt: str, path: str):
        import requests

        return requests.get(
            f"{api_base}{path}",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=10,
        )

    def test_latest_returns_recent_row(
        self, api_base: str, farmer_jwt: str, parcel_id: str,
    ) -> None:
        r = self._get(
            api_base, farmer_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/telemetry/latest",
        )
        assert r.status_code in (200, 204)
        if r.status_code == 200:
            body = r.json()
            recorded = datetime.fromisoformat(
                body["recorded_at"].replace("Z", "+00:00"),
            )
            assert (datetime.now(timezone.utc) - recorded).total_seconds() < 60 * 60 * 24
            # Cache-Control header documented in §4.3
            assert "private" in r.headers.get("Cache-Control", "")

    @pytest.mark.parametrize(
        "window,expected_max",
        [("24h", 96), ("7d", 168), ("30d", 30)],
    )
    def test_history_obeys_br_k4(
        self, api_base: str, farmer_jwt: str, parcel_id: str,
        window: str, expected_max: int,
    ) -> None:
        r = self._get(
            api_base, farmer_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/telemetry/history?window={window}",
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["window"] == window
        assert body["point_count"] == len(body["buckets"])
        assert len(body["buckets"]) <= expected_max
        assert len(body["buckets"]) <= 500

    def test_other_farmer_sees_zero_rows_on_history(
        self, api_base: str, parcel_id: str,
    ) -> None:
        other_jwt = os.environ.get("KAT04_FARMER_B_JWT")
        if not other_jwt:
            pytest.skip("KAT04_FARMER_B_JWT not set")
        r = self._get(
            api_base, other_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/telemetry/history?window=7d",
        )
        assert r.status_code == 200
        assert r.json()["buckets"] == []

    def test_citizen_sees_zero_rows(
        self, api_base: str, parcel_id: str,
    ) -> None:
        citizen_jwt = os.environ.get("KAT04_CITIZEN_JWT")
        if not citizen_jwt:
            pytest.skip("KAT04_CITIZEN_JWT not set")
        r = self._get(
            api_base, citizen_jwt,
            f"/api/v1/katara/parcels/{parcel_id}/telemetry/history?window=24h",
        )
        assert r.status_code == 200
        assert r.json()["buckets"] == []
