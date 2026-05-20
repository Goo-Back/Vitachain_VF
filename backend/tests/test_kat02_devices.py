"""KAT-02 — device pairing coverage.

Three layers, mirroring KAT-01:

* :class:`TestApiKeyUtility` — pure-unit. No network, no Supabase. Verifies
  the ``vk_<32 hex>`` shape, uniqueness over many draws, and the bcrypt
  round-trip via the same primitive ``public.verify_device_api_key`` uses on
  the SQL side.

* :class:`TestDevicePayload` — pure-unit on the Pydantic models. Asserts
  ``DevicePair`` rejects anything that does not match ``^ESP-KAT-\\d{3}$``
  and ``DeviceOut`` has no ``api_key`` / ``api_key_hash`` fields.

* :class:`TestDeviceRouterMounted` — boots the real app via
  :func:`create_app` and asserts the auth contract on
  ``/api/v1/katara/parcels/{id}/devices``: unauthenticated → 401, PENDING
  farmer → 403 ``verification_required``, RESTAURANT → 403 ``role_not_allowed``,
  malformed ``device_id`` → 422. DB-write paths (BR-K1 409, RLS cross-farmer
  isolation, plaintext-once contract on the live response) live in the staging
  drill — see docs/stories/KAT-02-esp32-device-pairing.md §6.
"""

from __future__ import annotations

import time
import uuid

import bcrypt
import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.api_keys import (
    generate_device_api_key,
    hash_device_api_key,
    last4,
)
from app.core.config import get_settings
from app.modules.katara.schemas import DeviceOut, DevicePair, DevicePairResponse

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
# Pure-unit: api_keys utility
# ---------------------------------------------------------------------------


class TestApiKeyUtility:
    def test_key_format(self) -> None:
        k = generate_device_api_key()
        assert k.startswith("vk_")
        # vk_ (3) + 16 random bytes hex-encoded (32 chars) = 35.
        assert len(k) == 35

    def test_keys_are_unique(self) -> None:
        keys = {generate_device_api_key() for _ in range(50)}
        assert len(keys) == 50

    def test_bcrypt_roundtrip(self) -> None:
        plaintext = generate_device_api_key()
        h = hash_device_api_key(plaintext)
        # checkpw is the same primitive pgcrypto.crypt(plaintext, hash) calls
        # on the SQL side — round-tripping here proves the verifier in 0017
        # will accept the rows this router persists.
        assert bcrypt.checkpw(plaintext.encode(), h.encode())
        assert not bcrypt.checkpw(b"vk_wrong", h.encode())

    def test_last4(self) -> None:
        k = "vk_0123456789abcdef0123456789abcdef"
        assert last4(k) == "cdef"
        assert len(last4(generate_device_api_key())) == 4


# ---------------------------------------------------------------------------
# Pure-unit: Pydantic
# ---------------------------------------------------------------------------


class TestDevicePayload:
    def test_valid_device_id(self) -> None:
        body = DevicePair(device_id="ESP-KAT-001")
        assert body.device_id == "ESP-KAT-001"

    def test_device_id_trimmed(self) -> None:
        body = DevicePair(device_id="  ESP-KAT-042  ")
        assert body.device_id == "ESP-KAT-042"

    @pytest.mark.parametrize(
        "bad",
        [
            "esp-kat-001",     # lower-case
            "ESP-KAT-01",      # 2 digits
            "ESP-KAT-0001",    # 4 digits
            "ESP-KAT-ABC",     # not digits
            "FOO-KAT-001",     # wrong prefix
            "ESP_KAT_001",     # wrong separator
            "",                 # blank
        ],
    )
    def test_invalid_device_id_rejected(self, bad: str) -> None:
        with pytest.raises(ValidationError):
            DevicePair(device_id=bad)

    def test_device_out_omits_plaintext_and_hash(self) -> None:
        # If a new field is added to DeviceOut, this test trips the moment it
        # contains 'api_key' / 'api_key_hash' — a hard guarantee that list/get
        # responses never carry the plaintext or the bcrypt hash.
        fields = set(DeviceOut.model_fields.keys())
        assert "api_key" not in fields
        assert "api_key_hash" not in fields
        assert "api_key_last4" in fields

    def test_pair_response_carries_plaintext(self) -> None:
        fields = set(DevicePairResponse.model_fields.keys())
        assert "api_key" in fields  # plaintext — shown ONCE
        assert "api_key_last4" in fields
        # Hash never leaves the DB.
        assert "api_key_hash" not in fields


# ---------------------------------------------------------------------------
# Router mounted on the real app — auth-contract only (no DB writes)
# ---------------------------------------------------------------------------


@pytest.fixture
async def real_client() -> AsyncClient:
    # Same lazy import pattern as test_kat01_parcels.py — defers FastAPI app
    # construction until conftest.py has seeded the dummy Supabase env vars.
    from app.main import create_app  # noqa: PLC0415

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


_PARCEL_ID = "11111111-1111-1111-1111-111111111111"
_DEVICE_BODY = {"device_id": "ESP-KAT-101"}


class TestDeviceRouterMounted:
    """KAT-02 endpoints are wired and gated as documented."""

    @pytest.mark.anyio
    async def test_pair_requires_auth(self, real_client: AsyncClient) -> None:
        r = await real_client.post(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices", json=_DEVICE_BODY
        )
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_list_requires_auth(self, real_client: AsyncClient) -> None:
        r = await real_client.get(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices"
        )
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_pending_farmer_blocked_on_pair(
        self, real_client: AsyncClient
    ) -> None:
        token = _make_token(role="FARMER", verification_status="PENDING")
        r = await real_client.post(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices",
            json=_DEVICE_BODY,
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_legacy_session_blocked_on_pair(
        self, real_client: AsyncClient
    ) -> None:
        # Pre-AUTH-06 session (no verification_status claim) must 403.
        token = _make_token(role="FARMER", verification_status=None)
        r = await real_client.post(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices",
            json=_DEVICE_BODY,
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_restaurant_blocked_on_pair(
        self, real_client: AsyncClient
    ) -> None:
        token = _make_token(role="RESTAURANT", verification_status="VERIFIED")
        r = await real_client.post(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices",
            json=_DEVICE_BODY,
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_citizen_blocked_on_pair(self, real_client: AsyncClient) -> None:
        token = _make_token(role="CITIZEN", verification_status=None)
        r = await real_client.post(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices",
            json=_DEVICE_BODY,
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_invalid_device_id_returns_422(
        self, real_client: AsyncClient
    ) -> None:
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        r = await real_client.post(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices",
            json={"device_id": "not-a-real-id"},
            headers=_auth(token),
        )
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_expired_token_returns_401(
        self, real_client: AsyncClient
    ) -> None:
        token = _make_token(
            role="FARMER", verification_status="VERIFIED", exp_offset=-1
        )
        r = await real_client.post(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices",
            json=_DEVICE_BODY,
            headers=_auth(token),
        )
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_rotate_key_requires_auth(
        self, real_client: AsyncClient
    ) -> None:
        r = await real_client.post(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices/{_PARCEL_ID}/rotate-key"
        )
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_unpair_requires_auth(self, real_client: AsyncClient) -> None:
        r = await real_client.delete(
            f"/api/v1/katara/parcels/{_PARCEL_ID}/devices/{_PARCEL_ID}"
        )
        assert r.status_code == 401
