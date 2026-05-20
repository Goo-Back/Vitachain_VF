"""AUTH-06 — KYC flow + ``require_verified`` coverage.

The fixtures spin up an isolated FastAPI app exposing two routes that
exercise the new ``require_verified`` factory, and unit-test the
``AuthUser.verification_status`` claim round-trip. The KYC routers themselves
(``backend/app/routers/kyc.py``, ``backend/app/routers/admin/kyc.py``) talk
to Supabase Storage + PostgREST and are exercised by ``pytest -m integration``
against the staging project — see the §6 drill in the AUTH-06 story.
"""

from __future__ import annotations

import time
import uuid

import jwt as pyjwt
import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.security import (
    AuthUser,
    get_current_user,
    require_verified,
)

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
        "email": "pro@test.local",
    }
    if role is not None:
        payload["user_role"] = role
    if verification_status is not None:
        payload["verification_status"] = verification_status
    return pyjwt.encode(payload, _secret(), algorithm=_ALG)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def app() -> FastAPI:
    a = FastAPI()

    @a.get("/me")
    async def me(user: AuthUser = Depends(get_current_user)) -> dict:
        return {
            "id": str(user.id),
            "role": user.role,
            "verification_status": user.verification_status,
        }

    @a.get("/farmer-verified")
    async def farmer_verified(
        user: AuthUser = Depends(require_verified("FARMER")),
    ) -> dict:
        return {"ok": True, "id": str(user.id)}

    @a.get("/pro-verified")
    async def pro_verified(
        user: AuthUser = Depends(require_verified("FARMER", "RESTAURANT")),
    ) -> dict:
        return {"ok": True, "role": user.role}

    return a


@pytest.fixture
async def client(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestVerificationStatusClaim:
    """The JWT claim from migration 0014 round-trips into AuthUser."""

    @pytest.mark.anyio
    async def test_verified_claim_present(self, client):
        r = await client.get(
            "/me", headers=_auth(_make_token(verification_status="VERIFIED"))
        )
        assert r.status_code == 200
        assert r.json()["verification_status"] == "VERIFIED"

    @pytest.mark.anyio
    async def test_pending_claim_present(self, client):
        r = await client.get(
            "/me", headers=_auth(_make_token(verification_status="PENDING"))
        )
        assert r.status_code == 200
        assert r.json()["verification_status"] == "PENDING"

    @pytest.mark.anyio
    async def test_legacy_session_without_claim_is_none(self, client):
        # Token issued BEFORE migration 0014 — no `verification_status` claim.
        # AuthUser must surface None (and require_verified must 403).
        r = await client.get(
            "/me", headers=_auth(_make_token(verification_status=None))
        )
        assert r.status_code == 200
        assert r.json()["verification_status"] is None


class TestRequireVerified:
    """Role + verification gating ordering and error contract."""

    @pytest.mark.anyio
    async def test_verified_farmer_passes(self, client):
        r = await client.get(
            "/farmer-verified",
            headers=_auth(_make_token(role="FARMER", verification_status="VERIFIED")),
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True

    @pytest.mark.anyio
    async def test_pending_farmer_blocked(self, client):
        r = await client.get(
            "/farmer-verified",
            headers=_auth(_make_token(role="FARMER", verification_status="PENDING")),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_rejected_farmer_blocked(self, client):
        r = await client.get(
            "/farmer-verified",
            headers=_auth(_make_token(role="FARMER", verification_status="REJECTED")),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_legacy_session_blocked(self, client):
        # A session without the claim cannot reach a verified-only route.
        r = await client.get(
            "/farmer-verified",
            headers=_auth(_make_token(role="FARMER", verification_status=None)),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_wrong_role_fires_first(self, client):
        # CITIZEN with VERIFIED status still gets role_not_allowed — the role
        # gate fires before the verification gate. Mirrors require_role's
        # ordering so frontend redirect logic can be deterministic.
        r = await client.get(
            "/farmer-verified",
            headers=_auth(_make_token(role="CITIZEN", verification_status="VERIFIED")),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_multi_role_allowed(self, client):
        for role in ("FARMER", "RESTAURANT"):
            r = await client.get(
                "/pro-verified",
                headers=_auth(_make_token(role=role, verification_status="VERIFIED")),
            )
            assert r.status_code == 200, role
            assert r.json()["role"] == role

    @pytest.mark.anyio
    async def test_expired_token_returns_401_not_403(self, client):
        # Expiry surfaces from the inner get_current_user — must beat both
        # role + verification checks. The frontend redirect path keys on 401.
        r = await client.get(
            "/farmer-verified",
            headers=_auth(
                _make_token(
                    role="FARMER",
                    verification_status="VERIFIED",
                    exp_offset=-1,
                )
            ),
        )
        assert r.status_code == 401
        assert r.json()["detail"] == "token_expired"


class TestKycRouterMounted:
    """Smoke: the KYC routers are mounted on the real app."""

    @pytest.mark.anyio
    async def test_user_kyc_requires_auth(self):
        from app.main import create_app

        a = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=a), base_url="http://test"
        ) as c:
            # No bearer → 401, not 404.
            r = await c.get("/api/v1/kyc/me")
            assert r.status_code == 401

    @pytest.mark.anyio
    async def test_admin_kyc_requires_admin_role(self):
        from app.main import create_app

        a = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=a), base_url="http://test"
        ) as c:
            r = await c.get(
                "/api/v1/admin/kyc/pending",
                headers=_auth(_make_token(role="FARMER", verification_status="VERIFIED")),
            )
            assert r.status_code == 403
            assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_citizen_blocked_from_kyc_upload(self):
        from app.main import create_app

        a = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=a), base_url="http://test"
        ) as c:
            r = await c.post(
                "/api/v1/kyc/upload-url",
                headers=_auth(
                    _make_token(role="CITIZEN", verification_status=None)
                ),
                json={
                    "document_type": "CIN",
                    "mime_type": "application/pdf",
                    "size_bytes": 1024,
                },
            )
            assert r.status_code == 403
            assert r.json()["detail"] == "kyc_not_required"


class TestSubmitRequestValidation:
    """Pydantic body validation on /kyc/submit."""

    @pytest.mark.anyio
    async def test_size_too_large_rejected(self):
        from app.main import create_app

        a = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=a), base_url="http://test"
        ) as c:
            r = await c.post(
                "/api/v1/kyc/upload-url",
                headers=_auth(_make_token(role="FARMER", verification_status="PENDING")),
                json={
                    "document_type": "CIN",
                    "mime_type": "application/pdf",
                    "size_bytes": 6 * 1024 * 1024,  # 6 MB > 5 MB cap
                },
            )
            assert r.status_code == 422

    @pytest.mark.anyio
    async def test_bad_mime_rejected(self):
        from app.main import create_app

        a = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=a), base_url="http://test"
        ) as c:
            r = await c.post(
                "/api/v1/kyc/upload-url",
                headers=_auth(_make_token(role="FARMER", verification_status="PENDING")),
                json={
                    "document_type": "CIN",
                    "mime_type": "application/x-executable",
                    "size_bytes": 1024,
                },
            )
            assert r.status_code == 422

    @pytest.mark.anyio
    async def test_forged_storage_path_rejected(self):
        from app.main import create_app

        a = create_app()
        farmer_id = uuid.uuid4()
        other = uuid.uuid4()
        async with AsyncClient(
            transport=ASGITransport(app=a), base_url="http://test"
        ) as c:
            r = await c.post(
                "/api/v1/kyc/submit",
                headers=_auth(
                    _make_token(
                        role="FARMER",
                        verification_status="PENDING",
                        sub=str(farmer_id),
                    )
                ),
                json={
                    "document_type": "CIN",
                    "storage_path": f"{other}/forged.pdf",
                },
            )
            # The handler 400s on the mismatched prefix before touching storage.
            assert r.status_code == 400
            assert r.json()["detail"] == "storage_path_user_mismatch"
