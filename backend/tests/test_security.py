"""AUTH-03 — JWT validation + role gating coverage.

The fixtures spin up a minimal FastAPI app exposing two routes that exercise
the dependency surface (``get_current_user`` and ``require_role``). Tokens are
signed with a *synthetic* secret seeded by ``conftest.py`` — no live Supabase
calls. The ``TestJwtConfigConstants`` class asserts the source-controlled
intent in ``supabase/config.toml`` matches PRD §7.1 so a drift fails pytest
*and* ``scripts/verify-jwt-config.sh``.
"""

from __future__ import annotations

import pathlib
import time
import uuid

import jwt as pyjwt
import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.security import AuthUser, get_current_user, require_role

_ALG = "HS256"
_AUD = "authenticated"


def _secret() -> str:
    return get_settings().supabase_jwt_secret.get_secret_value()


def _make_token(
    *,
    sub: str | None = None,
    role: str | None = "FARMER",
    email: str = "farmer@test.local",
    exp_offset: int = 3600,
    secret: str | None = None,
    audience: str | None = _AUD,
    extra: dict | None = None,
) -> str:
    now = int(time.time())
    payload: dict = {
        "iat": now,
        "exp": now + exp_offset,
        "email": email,
    }
    if sub is not None:
        payload["sub"] = sub
    else:
        payload["sub"] = str(uuid.uuid4())
    if role is not None:
        payload["user_role"] = role
    if audience is not None:
        payload["aud"] = audience
    if extra:
        payload.update(extra)
    return pyjwt.encode(payload, secret or _secret(), algorithm=_ALG)


@pytest.fixture
def app() -> FastAPI:
    a = FastAPI()

    @a.get("/me")
    async def me(user: AuthUser = Depends(get_current_user)) -> dict:
        return {"id": str(user.id), "role": user.role, "email": user.email}

    @a.get("/farmer-only")
    async def farmer_only(
        user: AuthUser = Depends(require_role("FARMER")),
    ) -> dict:
        return {"ok": True, "id": str(user.id)}

    @a.get("/staff-only")
    async def staff_only(
        user: AuthUser = Depends(require_role("ADMIN", "RESTAURANT")),
    ) -> dict:
        return {"ok": True, "role": user.role}

    return a


@pytest.fixture
async def jwt_client(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# get_current_user
# ---------------------------------------------------------------------------


class TestGetCurrentUser:
    @pytest.mark.anyio
    async def test_valid_token_returns_auth_user(self, jwt_client):
        uid = str(uuid.uuid4())
        r = await jwt_client.get("/me", headers=_auth(_make_token(sub=uid)))
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == uid
        assert body["role"] == "FARMER"
        assert body["email"] == "farmer@test.local"

    @pytest.mark.anyio
    async def test_expired_token_returns_401(self, jwt_client):
        r = await jwt_client.get("/me", headers=_auth(_make_token(exp_offset=-1)))
        assert r.status_code == 401
        assert r.json()["detail"] == "token_expired"

    @pytest.mark.anyio
    async def test_wrong_secret_returns_401(self, jwt_client):
        r = await jwt_client.get(
            "/me",
            headers=_auth(_make_token(secret="this-is-not-the-real-jwt-secret-X")),
        )
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_token"

    @pytest.mark.anyio
    async def test_wrong_algorithm_returns_401(self, jwt_client):
        # HS512 instead of HS256 — settings pin algorithms=["HS256"].
        token = pyjwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "iat": int(time.time()),
                "exp": int(time.time()) + 3600,
                "aud": _AUD,
            },
            _secret(),
            algorithm="HS512",
        )
        r = await jwt_client.get("/me", headers=_auth(token))
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_token"

    @pytest.mark.anyio
    async def test_wrong_audience_returns_401(self, jwt_client):
        r = await jwt_client.get(
            "/me",
            headers=_auth(_make_token(audience="not-authenticated")),
        )
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_token"

    @pytest.mark.anyio
    async def test_missing_sub_returns_401(self, jwt_client):
        r = await jwt_client.get("/me", headers=_auth(_make_token(sub="")))
        assert r.status_code == 401
        assert r.json()["detail"] == "missing_sub"

    @pytest.mark.anyio
    async def test_non_uuid_sub_returns_401(self, jwt_client):
        r = await jwt_client.get(
            "/me", headers=_auth(_make_token(sub="not-a-uuid"))
        )
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_sub"

    @pytest.mark.anyio
    async def test_no_auth_header_returns_401(self, jwt_client):
        r = await jwt_client.get("/me")
        assert r.status_code == 401
        assert r.json()["detail"] == "missing_bearer_token"

    @pytest.mark.anyio
    async def test_malformed_bearer_returns_401(self, jwt_client):
        r = await jwt_client.get("/me", headers=_auth("not.a.valid.jwt"))
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_token"

    @pytest.mark.anyio
    async def test_legacy_app_metadata_role_accepted(self, jwt_client):
        # Tokens issued before AUTH-02's hook activated carry the role in
        # app_metadata.role rather than top-level user_role. Both shapes must
        # resolve until the migration window closes.
        token = _make_token(
            role=None, extra={"app_metadata": {"role": "CITIZEN"}}
        )
        r = await jwt_client.get("/me", headers=_auth(token))
        assert r.status_code == 200
        assert r.json()["role"] == "CITIZEN"


# ---------------------------------------------------------------------------
# require_role
# ---------------------------------------------------------------------------


class TestRequireRole:
    @pytest.mark.anyio
    async def test_correct_role_passes(self, jwt_client):
        r = await jwt_client.get(
            "/farmer-only", headers=_auth(_make_token(role="FARMER"))
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True

    @pytest.mark.anyio
    async def test_wrong_role_returns_403(self, jwt_client):
        r = await jwt_client.get(
            "/farmer-only", headers=_auth(_make_token(role="RESTAURANT"))
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_admin_blocked_by_farmer_gate(self, jwt_client):
        r = await jwt_client.get(
            "/farmer-only", headers=_auth(_make_token(role="ADMIN"))
        )
        assert r.status_code == 403

    @pytest.mark.anyio
    async def test_multi_role_allow_list(self, jwt_client):
        # /staff-only accepts ADMIN | RESTAURANT.
        for role in ("ADMIN", "RESTAURANT"):
            r = await jwt_client.get(
                "/staff-only", headers=_auth(_make_token(role=role))
            )
            assert r.status_code == 200, role
            assert r.json()["role"] == role

        r = await jwt_client.get(
            "/staff-only", headers=_auth(_make_token(role="FARMER"))
        )
        assert r.status_code == 403

    @pytest.mark.anyio
    async def test_expired_token_returns_401_not_403(self, jwt_client):
        # Expiry is the inner check — wrong order would surface as 403 here.
        r = await jwt_client.get(
            "/farmer-only",
            headers=_auth(_make_token(role="FARMER", exp_offset=-1)),
        )
        assert r.status_code == 401
        assert r.json()["detail"] == "token_expired"


# ---------------------------------------------------------------------------
# supabase/config.toml — PRD §7.1 source-controlled intent
# ---------------------------------------------------------------------------


class TestJwtConfigConstants:
    """Assert supabase/config.toml carries the PRD §7.1 JWT values."""

    _TOML = pathlib.Path(__file__).resolve().parents[2] / "supabase" / "config.toml"

    def _read(self) -> str:
        return self._TOML.read_text(encoding="utf-8")

    def test_jwt_expiry_is_3600(self):
        assert "jwt_expiry = 3600" in self._read(), (
            "supabase/config.toml jwt_expiry must be 3600 s (PRD §7.1 — 1h access token)"
        )

    def test_refresh_token_rotation_enabled(self):
        assert "enable_refresh_token_rotation = true" in self._read()

    def test_refresh_token_reuse_interval_is_10(self):
        assert "refresh_token_reuse_interval = 10" in self._read()
