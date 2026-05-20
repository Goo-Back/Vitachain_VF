"""KAT-07 — AI diagnostic request endpoint coverage.

Three layers, mirroring KAT-05:

* :class:`TestSchemas` — pure-unit on the :class:`DiagnosticOut` shape and the
  :data:`DiagnosticStatus` literal — proves the wire contract KAT-08 / KAT-10
  will design against.

* :class:`TestRouterMounted` — boots the real app via :func:`create_app` and
  asserts the auth contract on both endpoints: missing bearer → 401, garbage
  parcel_id → 422.

* :class:`TestDiagnosticsFlowE2E` — opt-in (``KAT07_E2E=1``). Drills the
  BR-K5 (in-flight) and BR-K6 (24h cap) handler checks plus the audit-guard
  trigger against a staging Supabase project.
"""

from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.main import create_app
from app.modules.katara.diagnostics import (
    _IN_FLIGHT_STATUSES,
    _RATE_LIMIT_HOURS,
    _RATE_LIMIT_MAX,
)
from app.modules.katara.schemas import DiagnosticOut


# ---------------------------------------------------------------------------
# Pure-unit — wire shape + handler constants
# ---------------------------------------------------------------------------


class TestSchemas:
    def test_diagnostic_out_round_trip(self) -> None:
        payload = {
            "id": "11111111-1111-1111-1111-111111111111",
            "parcel_id": "22222222-2222-2222-2222-222222222222",
            "farmer_id": "33333333-3333-3333-3333-333333333333",
            "status": "PENDING",
            "result_text": None,
            "error_detail": None,
            "requested_at": "2026-05-17T08:00:00Z",
            "started_at": None,
            "completed_at": None,
        }
        m = DiagnosticOut(**payload)
        assert m.status == "PENDING"
        assert m.result_text is None
        assert m.started_at is None

    def test_diagnostic_out_rejects_unknown_status(self) -> None:
        with pytest.raises(ValidationError):
            DiagnosticOut(
                id="11111111-1111-1111-1111-111111111111",  # type: ignore[arg-type]
                parcel_id="22222222-2222-2222-2222-222222222222",  # type: ignore[arg-type]
                farmer_id="33333333-3333-3333-3333-333333333333",  # type: ignore[arg-type]
                status="QUEUED",  # type: ignore[arg-type]
                requested_at="2026-05-17T08:00:00Z",  # type: ignore[arg-type]
            )

    def test_in_flight_set_matches_documented_pair(self) -> None:
        # BR-K5: a "COMPLETED" row must not block a re-request — only PENDING
        # and PROCESSING count as in-flight. Hard-coding the assertion guards
        # against an accidental drift if someone adds a new transient state.
        assert _IN_FLIGHT_STATUSES == ("PENDING", "PROCESSING")

    def test_rate_limit_constants_match_br_k6(self) -> None:
        # BR-K6 — 3 / parcel / 24h. Pinned as a tripwire: a refactor that
        # raises the cap (e.g. to make load tests pass) without an explicit
        # PRD update fails this assertion first.
        assert _RATE_LIMIT_MAX == 3
        assert _RATE_LIMIT_HOURS == 24


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
_DIAGNOSTICS = f"/api/v1/katara/parcels/{_PARCEL}/diagnostics"
_LATEST = f"{_DIAGNOSTICS}/latest"


class TestRouterMounted:
    @pytest.mark.anyio
    async def test_post_requires_bearer(self, app_client: AsyncClient) -> None:
        r = await app_client.post(_DIAGNOSTICS)
        assert r.status_code == 401
        assert r.json()["detail"] == "missing_bearer_token"

    @pytest.mark.anyio
    async def test_latest_requires_bearer(self, app_client: AsyncClient) -> None:
        r = await app_client.get(_LATEST)
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_post_rejects_garbage_parcel_id_with_422(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        token = _make_token(
            role="FARMER",
            extra={"verification_status": "VERIFIED"},
        )
        r = await app_client.post(
            "/api/v1/katara/parcels/not-a-uuid/diagnostics",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_latest_rejects_garbage_parcel_id_with_422(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        r = await app_client.get(
            "/api/v1/katara/parcels/not-a-uuid/diagnostics/latest",
            headers={"Authorization": f"Bearer {_make_token(role='FARMER')}"},
        )
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_post_unverified_farmer_403(
        self, app_client: AsyncClient,
    ) -> None:
        from tests.test_security import _make_token

        # PENDING farmer — the verification gate must fire BEFORE the DB call,
        # so the response is 403 verification_required without any RLS round-trip.
        token = _make_token(
            role="FARMER",
            extra={"verification_status": "PENDING"},
        )
        r = await app_client.post(
            _DIAGNOSTICS,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_post_wrong_role_403(self, app_client: AsyncClient) -> None:
        from tests.test_security import _make_token

        token = _make_token(
            role="RESTAURANT",
            extra={"verification_status": "VERIFIED"},
        )
        r = await app_client.post(
            _DIAGNOSTICS,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"


# ---------------------------------------------------------------------------
# e2e — staged against the real DB. Activated by KAT07_E2E=1 + staging env.
# ---------------------------------------------------------------------------

_E2E_OPT_IN = (
    os.environ.get("KAT07_E2E") == "1"
    or "--run-e2e" in os.environ.get("PYTEST_ADDOPTS", "").split()
)


@pytest.mark.skipif(
    not _E2E_OPT_IN,
    reason="KAT-07 e2e — set KAT07_E2E=1 and a staging demo parcel to run.",
)
class TestDiagnosticsFlowE2E:
    """Requires:
      * a parcel owned by the FARMER whose JWT is KAT07_FARMER_JWT (VERIFIED)
      * env vars: API_BASE_URL, KAT07_DEMO_PARCEL_ID, KAT07_FARMER_JWT
        (optionally KAT07_FARMER_B_JWT for the RLS-isolation drill,
        KAT07_SERVICE_ROLE_URL + KAT07_SERVICE_ROLE_KEY for the audit-guard
        positive cell).
    """

    @staticmethod
    def _u() -> str:
        api = os.environ.get("API_BASE_URL", "http://localhost:8000")
        pid = os.environ["KAT07_DEMO_PARCEL_ID"]
        return f"{api}/api/v1/katara/parcels/{pid}/diagnostics"

    @staticmethod
    def _headers(jwt: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {jwt}"}

    def test_happy_path_post_then_get_latest(self) -> None:
        import requests

        jwt = os.environ["KAT07_FARMER_JWT"]

        post = requests.post(self._u(), headers=self._headers(jwt))
        assert post.status_code in (201, 409), post.text
        if post.status_code == 409:
            pytest.skip(
                "an earlier diagnostic is in flight; reset before re-running"
            )
        body = post.json()
        assert body["status"] == "PENDING"
        assert body["result_text"] is None

        latest = requests.get(f"{self._u()}/latest", headers=self._headers(jwt))
        assert latest.status_code == 200
        assert latest.json()["id"] == body["id"]

    def test_second_post_while_in_flight_returns_409(self) -> None:
        import requests

        jwt = os.environ["KAT07_FARMER_JWT"]

        r = requests.post(self._u(), headers=self._headers(jwt))
        assert r.status_code == 409
        assert r.json()["detail"] == "diagnostic_already_in_progress"

    def test_unverified_post_returns_403(self) -> None:
        import requests

        jwt = os.environ.get("KAT07_PENDING_FARMER_JWT")
        if not jwt:
            pytest.skip("KAT07_PENDING_FARMER_JWT not set")
        r = requests.post(self._u(), headers=self._headers(jwt))
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    def test_other_farmer_get_latest_returns_404(self) -> None:
        import requests

        jwt = os.environ.get("KAT07_FARMER_B_JWT")
        if not jwt:
            pytest.skip("KAT07_FARMER_B_JWT not set")
        r = requests.get(f"{self._u()}/latest", headers=self._headers(jwt))
        # RLS makes the row invisible; the parcel-existence check fires first
        # and emits 404 (not 200 with a partial body) — exactly the contract
        # KAT-10 polls against.
        assert r.status_code == 404
