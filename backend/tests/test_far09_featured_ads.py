"""FAR-09 — Featured ads at top of catalog.

Coverage
--------
* ADMIN can toggle is_featured on an existing ad (200, new state returned)
* Non-ADMIN roles (FARMER, RESTAURANT, CITIZEN) → 403 on PATCH endpoint
* PATCH on a non-existent ad_id → 404 ad_not_found
* Calling PATCH twice restores the original value (idempotent toggle)
* AUTH-05: service_client() is used in the toggle endpoint
"""
from __future__ import annotations

import time
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings

_ALG = "HS256"
_AUD = "authenticated"


def _make_token(*, role: str, sub: str | None = None) -> str:
    now = int(time.time())
    return pyjwt.encode(
        {
            "iat": now,
            "exp": now + 3600,
            "aud": _AUD,
            "sub": sub or str(uuid.uuid4()),
            "email": f"{role.lower()}@test.local",
            "user_role": role,
            "verification_status": "VERIFIED",
        },
        get_settings().supabase_jwt_secret.get_secret_value(),
        algorithm=_ALG,
    )


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_AD_ID = str(uuid.uuid4())

_EXISTING_AD = {
    "id": _AD_ID,
    "is_featured": False,
}

_TOGGLE_RESPONSE = {
    "id": _AD_ID,
    "is_featured": True,
    "updated_at": "2026-05-23T10:00:00+00:00",
}


def _mock_service_client_for_toggle(
    fetch_data: dict | None,
    update_data: dict | None = None,
) -> MagicMock:
    """Mock service_client() for the toggle endpoint's two-step fetch + update."""

    class _FetchResp:
        data = fetch_data

    class _UpdateResp:
        data = [update_data] if update_data else []

    mock_client = MagicMock()

    fetch_q = MagicMock()
    fetch_q.select.return_value = fetch_q
    fetch_q.eq.return_value = fetch_q
    fetch_q.maybe_single.return_value = fetch_q
    fetch_q.execute.return_value = _FetchResp()

    update_q = MagicMock()
    update_q.update.return_value = update_q
    update_q.eq.return_value = update_q
    update_q.select.return_value = update_q
    update_q.execute.return_value = _UpdateResp()

    call_count = {"n": 0}

    def _table_side(table_name: str) -> MagicMock:  # noqa: ARG001
        call_count["n"] += 1
        return fetch_q if call_count["n"] == 1 else update_q

    mock_client.table.side_effect = _table_side
    return mock_client


# ---------------------------------------------------------------------------
# Auth gate — non-ADMIN roles are rejected
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["FARMER", "RESTAURANT", "CITIZEN"])
async def test_non_admin_toggle_returns_403(role: str) -> None:
    from app.main import create_app

    token = _make_token(role=role)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as client:
        resp = await client.patch(
            f"/api/v1/admin/farmarket/ads/{_AD_ID}/feature",
            headers=_auth(token),
        )
    assert resp.status_code == 403, f"{role} should be forbidden on featured toggle"


# ---------------------------------------------------------------------------
# ADMIN happy path — toggle flips the flag
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_toggle_featured_returns_200() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")
    mock_client = _mock_service_client_for_toggle(
        fetch_data=_EXISTING_AD,
        update_data=_TOGGLE_RESPONSE,
    )

    with patch(
        "app.routers.admin.farmarket.service_client",
        return_value=mock_client,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            resp = await client.patch(
                f"/api/v1/admin/farmarket/ads/{_AD_ID}/feature",
                headers=_auth(token),
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == _AD_ID
    assert body["is_featured"] is True
    assert "updated_at" in body


# ---------------------------------------------------------------------------
# 404 — ad does not exist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_toggle_nonexistent_ad_returns_404() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")
    mock_client = _mock_service_client_for_toggle(fetch_data=None)

    with patch(
        "app.routers.admin.farmarket.service_client",
        return_value=mock_client,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            resp = await client.patch(
                f"/api/v1/admin/farmarket/ads/{uuid.uuid4()}/feature",
                headers=_auth(token),
            )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "ad_not_found"


# ---------------------------------------------------------------------------
# Idempotency — toggle twice restores original value
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_toggle_twice_restores_original() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")

    mock1 = _mock_service_client_for_toggle(
        fetch_data={"id": _AD_ID, "is_featured": False},
        update_data={"id": _AD_ID, "is_featured": True, "updated_at": "2026-05-23T10:00:00+00:00"},
    )
    mock2 = _mock_service_client_for_toggle(
        fetch_data={"id": _AD_ID, "is_featured": True},
        update_data={"id": _AD_ID, "is_featured": False, "updated_at": "2026-05-23T10:01:00+00:00"},
    )

    with patch("app.routers.admin.farmarket.service_client", return_value=mock1):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            r1 = await client.patch(
                f"/api/v1/admin/farmarket/ads/{_AD_ID}/feature",
                headers=_auth(token),
            )

    with patch("app.routers.admin.farmarket.service_client", return_value=mock2):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            r2 = await client.patch(
                f"/api/v1/admin/farmarket/ads/{_AD_ID}/feature",
                headers=_auth(token),
            )

    assert r1.json()["is_featured"] is True
    assert r2.json()["is_featured"] is False


# ---------------------------------------------------------------------------
# AUTH-05 boundary — service_client() used in toggle, not user_scoped_client
# ---------------------------------------------------------------------------


class TestAuth05BoundaryFar09:
    def test_toggle_endpoint_uses_service_client(self) -> None:
        src = (
            Path(__file__).parent.parent
            / "app" / "routers" / "admin" / "farmarket.py"
        ).read_text()

        assert "admin_toggle_ad_featured" in src, (
            "Toggle function must be defined in routers/admin/farmarket.py"
        )
        assert "service_client" in src, (
            "Toggle endpoint must use service_client() (AUTH-05 allowlist)"
        )
        assert "JUSTIFICATION" in src, (
            "Every service_client() call site requires a # JUSTIFICATION: comment"
        )
