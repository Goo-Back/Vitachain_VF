"""KAT-12 — unlink endpoint coverage.

Two layers, mirroring KAT-02's split:

* :class:`TestUnlinkResponseSchema` — pure-unit on the Pydantic model.
  Asserts :class:`UnlinkDeviceResponse` rejects any status other than
  ``UNLINKED`` (a defensive contract — the handler only ever returns
  ``UNLINKED`` and a schema regression would silently leak the wrong status
  to the frontend's local-state flip).

* :class:`TestUnlinkRouterMounted` — boots the real app via
  :func:`create_app` and asserts the auth contract on
  ``/api/v1/katara/devices/{uuid}/unlink``: unauthenticated → 401,
  RESTAURANT/CITIZEN/ADMIN → 403 ``role_not_allowed`` (no verification gate
  on unlink by design; see KAT-12 §5.2 design point #2 — a farmer whose
  verification was later revoked must still be able to walk back a prior
  valid pair). DB-write paths (happy 200, RLS-hidden 404, already-UNLINKED
  409, end-to-end unlink→ingest-401→re-pair→ingest-204) live in the staging
  drill — see docs/stories/KAT-12-unlink-relink-device.md §7.3.
"""

from __future__ import annotations

import time
import uuid

import httpx
import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import get_settings
from app.modules.katara.schemas import UnlinkDeviceResponse

_ALG = "HS256"
_AUD = "authenticated"


def _secret() -> str:
    return get_settings().supabase_jwt_secret.get_secret_value()


def _make_token(
    *,
    role: str | None = "FARMER",
    verification_status: str | None = "VERIFIED",
    sub: str | None = None,
    exp_offset: int = 3600,
) -> str:
    now = int(time.time())
    payload: dict = {
        "iat": now,
        "exp": now + exp_offset,
        "aud": _AUD,
        "sub": sub or str(uuid.uuid4()),
        "email": "farmer@test.local",
    }
    if role is not None:
        payload["user_role"] = role
    if verification_status is not None:
        payload["verification_status"] = verification_status
    return pyjwt.encode(payload, _secret(), algorithm=_ALG)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Pure-unit: Pydantic
# ---------------------------------------------------------------------------


class TestUnlinkResponseSchema:
    def test_unlinked_status_accepted(self) -> None:
        body = UnlinkDeviceResponse(
            id=uuid.uuid4(),
            device_id="ESP-KAT-001",
            parcel_id=uuid.uuid4(),
            status="UNLINKED",
        )
        assert body.status == "UNLINKED"

    @pytest.mark.parametrize("bad", ["ACTIVE", "PENDING", "OFFLINE", "unlinked", ""])
    def test_non_unlinked_status_rejected(self, bad: str) -> None:
        # The frontend flips its local state on the response shape; any drift
        # from the literal "UNLINKED" must die at the Pydantic boundary.
        with pytest.raises(ValidationError):
            UnlinkDeviceResponse(
                id=uuid.uuid4(),
                device_id="ESP-KAT-001",
                parcel_id=uuid.uuid4(),
                status=bad,  # type: ignore[arg-type]
            )

    def test_no_api_key_leak(self) -> None:
        # KAT-02 ships a similar guard on DeviceOut. The unlink response must
        # not regress and start exposing the plaintext or the bcrypt hash.
        fields = set(UnlinkDeviceResponse.model_fields.keys())
        assert "api_key" not in fields
        assert "api_key_hash" not in fields
        assert "api_key_last4" not in fields


# ---------------------------------------------------------------------------
# Router mounted on the real app — auth-contract only (no DB writes)
# ---------------------------------------------------------------------------


@pytest.fixture
async def real_client() -> AsyncClient:
    # Lazy import — defers FastAPI app construction until conftest has seeded
    # the dummy Supabase env vars. Mirrors test_kat02_devices.py.
    from app.main import create_app  # noqa: PLC0415

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


_DEVICE_UUID = "11111111-1111-1111-1111-111111111111"
_UNLINK_PATH = f"/api/v1/katara/devices/{_DEVICE_UUID}/unlink"


class TestUnlinkRouterMounted:
    """KAT-12 endpoint is wired and gated as documented."""

    @pytest.mark.anyio
    async def test_unlink_requires_auth(self, real_client: AsyncClient) -> None:
        r = await real_client.post(_UNLINK_PATH)
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_expired_token_returns_401(
        self, real_client: AsyncClient
    ) -> None:
        token = _make_token(
            role="FARMER", verification_status="VERIFIED", exp_offset=-1
        )
        r = await real_client.post(_UNLINK_PATH, headers=_auth(token))
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_restaurant_blocked(self, real_client: AsyncClient) -> None:
        token = _make_token(role="RESTAURANT", verification_status="VERIFIED")
        r = await real_client.post(_UNLINK_PATH, headers=_auth(token))
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_citizen_blocked(self, real_client: AsyncClient) -> None:
        token = _make_token(role="CITIZEN", verification_status=None)
        r = await real_client.post(_UNLINK_PATH, headers=_auth(token))
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_admin_blocked(self, real_client: AsyncClient) -> None:
        # Admins manage devices through KAT-02's admin RLS policy, not via
        # the farmer-facing unlink endpoint. The role gate is strict.
        token = _make_token(role="ADMIN", verification_status=None)
        r = await real_client.post(_UNLINK_PATH, headers=_auth(token))
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_pending_farmer_allowed_through_role_gate(
        self, real_client: AsyncClient
    ) -> None:
        # KAT-12 §5.2 design point #2: an unlink walks back a prior valid pair.
        # A farmer whose verification was later revoked must still be able to
        # detach their devices. The role gate accepts the token; the request
        # then attempts the DB UPDATE and surfaces a DB-layer error (the dummy
        # Supabase env in conftest never reaches a live row, so any non-403
        # response — or a network-layer ConnectError proving the role gate
        # did not short-circuit — confirms the gate passed).
        token = _make_token(role="FARMER", verification_status="PENDING")
        try:
            r = await real_client.post(_UNLINK_PATH, headers=_auth(token))
            assert r.status_code != 403
        except httpx.ConnectError:
            pass  # DNS failure means role gate passed; 403 would have returned a response

    @pytest.mark.anyio
    async def test_malformed_device_uuid_returns_422(
        self, real_client: AsyncClient
    ) -> None:
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        r = await real_client.post(
            "/api/v1/katara/devices/not-a-uuid/unlink",
            headers=_auth(token),
        )
        assert r.status_code == 422
