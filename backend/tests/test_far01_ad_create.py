"""FAR-01 — Ad creation: schema validation + router auth-contract tests.

Two layers, matching the KAT-01 / AUTH-06 test structure:

* :class:`TestAdCreateSchema` — pure Pydantic validation with no network.
  Covers every validator branch in :class:`AdCreate` plus the shared
  constants.  Fast; runs in CI without any env vars beyond the conftest seed.

* :class:`TestAdRouterMounted` — boots the real FastAPI app via
  :func:`create_app` and asserts the auth contract on
  ``POST /api/v1/farmarket/ads`` and ``GET /api/v1/farmarket/ads``:
  unauthenticated → 401; wrong role → 403; PENDING farmer → 403.
  DB + Storage writes are NOT exercised here — those live in the staging
  drill described in ``docs/stories/FAR-01-farmer-creates-ad.md`` §6.
"""

from __future__ import annotations

import io
import time
import uuid
from decimal import Decimal

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import get_settings
from app.modules.farmarket.schemas import (
    MAX_PHOTO_BYTES,
    MAX_PHOTOS,
    MOROCCO_REGIONS,
    AdCreate,
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
        "email": "farmer@test.local",
    }
    if role is not None:
        payload["user_role"] = role
    if verification_status is not None:
        payload["verification_status"] = verification_status
    return pyjwt.encode(payload, _secret(), algorithm=_ALG)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Minimal multipart body for auth-contract tests (never reaches DB)
# ---------------------------------------------------------------------------

_FORM_FIELDS = {
    "title": "Tomates BIO Souss",
    "description": "Récolte fraîche de Souss-Massa, calibre A.",
    "product_type": "Tomates",
    "price_mad": "4.50",
    "quantity_kg": "500.00",
    "region": "Souss-Massa",
}


# ===========================================================================
# Pure-unit: Pydantic validators
# ===========================================================================


class TestAdCreateSchema:

    def test_valid_payload_accepted(self) -> None:
        ad = AdCreate(
            title="Tomates BIO",
            description="Récolte fraîche du Souss-Massa.",
            product_type="Tomates",
            price_mad=Decimal("4.50"),
            quantity_kg=Decimal("500.00"),
            region="Souss-Massa",
        )
        assert ad.title == "Tomates BIO"
        assert ad.price_mad == Decimal("4.50")
        assert ad.region == "Souss-Massa"

    def test_title_stripped(self) -> None:
        ad = AdCreate(
            title="  Tomates  ",
            description="A" * 15,
            product_type="Légumes",
            price_mad=Decimal("1"),
            quantity_kg=Decimal("10"),
            region="Oriental",
        )
        assert ad.title == "Tomates"

    def test_title_too_short_rejected(self) -> None:
        with pytest.raises(ValidationError, match="title"):
            AdCreate(
                title="AB",
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("1"),
                quantity_kg=Decimal("10"),
                region="Oriental",
            )

    def test_title_too_long_rejected(self) -> None:
        with pytest.raises(ValidationError, match="title"):
            AdCreate(
                title="T" * 101,
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("1"),
                quantity_kg=Decimal("10"),
                region="Oriental",
            )

    def test_description_too_short_rejected(self) -> None:
        with pytest.raises(ValidationError, match="description"):
            AdCreate(
                title="Valid",
                description="Short",
                product_type="Tomates",
                price_mad=Decimal("1"),
                quantity_kg=Decimal("10"),
                region="Oriental",
            )

    def test_price_zero_rejected(self) -> None:
        with pytest.raises(ValidationError, match="price_mad"):
            AdCreate(
                title="Valid",
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("0"),
                quantity_kg=Decimal("10"),
                region="Oriental",
            )

    def test_price_negative_rejected(self) -> None:
        with pytest.raises(ValidationError, match="price_mad"):
            AdCreate(
                title="Valid",
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("-1"),
                quantity_kg=Decimal("10"),
                region="Oriental",
            )

    def test_quantity_zero_rejected(self) -> None:
        with pytest.raises(ValidationError, match="quantity_kg"):
            AdCreate(
                title="Valid",
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("1"),
                quantity_kg=Decimal("0"),
                region="Oriental",
            )

    def test_invalid_region_rejected(self) -> None:
        with pytest.raises(ValidationError, match="region"):
            AdCreate(
                title="Valid",
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("1"),
                quantity_kg=Decimal("10"),
                region="Atlantique",
            )

    def test_all_12_regions_accepted(self) -> None:
        assert len(MOROCCO_REGIONS) == 12
        for region in MOROCCO_REGIONS:
            ad = AdCreate(
                title="Valid title",
                description="A" * 15,
                product_type="Poivrons",
                price_mad=Decimal("2"),
                quantity_kg=Decimal("100"),
                region=region,
            )
            assert ad.region == region

    def test_constants(self) -> None:
        assert MAX_PHOTOS == 5
        assert MAX_PHOTO_BYTES == 2 * 1024 * 1024


# ===========================================================================
# Router mounted on the real app — auth-contract only (no DB / Storage writes)
# ===========================================================================


@pytest.fixture
async def real_client():
    from app.main import create_app

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestAdRouterMounted:
    """Auth contract for POST /ads and GET /ads — no DB writes exercised."""

    @pytest.mark.anyio
    async def test_healthz(self, real_client) -> None:
        r = await real_client.get("/api/v1/farmarket/healthz")
        assert r.status_code == 200
        assert r.json() == {"module": "farmarket", "status": "ok"}

    # ── POST /ads ──────────────────────────────────────────────────────────

    @pytest.mark.anyio
    async def test_create_no_auth_returns_401(self, real_client) -> None:
        r = await real_client.post("/api/v1/farmarket/ads", data=_FORM_FIELDS)
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_create_restaurant_returns_403_role_not_allowed(self, real_client) -> None:
        token = _make_token(role="RESTAURANT", verification_status="VERIFIED")
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=_FORM_FIELDS,
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_create_citizen_returns_403_role_not_allowed(self, real_client) -> None:
        token = _make_token(role="CITIZEN", verification_status=None)
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=_FORM_FIELDS,
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_create_pending_farmer_returns_403_verification_required(
        self, real_client
    ) -> None:
        token = _make_token(role="FARMER", verification_status="PENDING")
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=_FORM_FIELDS,
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_create_legacy_session_no_claim_returns_403(self, real_client) -> None:
        # Session issued before AUTH-06 — no verification_status claim.
        token = _make_token(role="FARMER", verification_status=None)
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=_FORM_FIELDS,
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_create_expired_token_returns_401(self, real_client) -> None:
        token = _make_token(role="FARMER", verification_status="VERIFIED", exp_offset=-1)
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=_FORM_FIELDS,
            headers=_auth(token),
        )
        assert r.status_code == 401
        assert r.json()["detail"] == "token_expired"

    @pytest.mark.anyio
    async def test_create_too_many_photos_returns_422(self, real_client) -> None:
        # The BR-F2 count check fires BEFORE the verified-farmer DB probe,
        # so this test exercises the router validation even with a real token.
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        files = [
            ("photos", (f"img{i}.jpg", b"x" * 10, "image/jpeg"))
            for i in range(MAX_PHOTOS + 1)
        ]
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=_FORM_FIELDS,
            files=files,
            headers=_auth(token),
        )
        assert r.status_code == 422
        assert "too_many_photos" in r.json()["detail"]

    @pytest.mark.anyio
    async def test_create_oversized_photo_returns_422(self, real_client) -> None:
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        big = b"x" * (MAX_PHOTO_BYTES + 1)
        files = [("photos", ("big.jpg", big, "image/jpeg"))]
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=_FORM_FIELDS,
            files=files,
            headers=_auth(token),
        )
        assert r.status_code == 422
        assert "photo_too_large" in r.json()["detail"]

    @pytest.mark.anyio
    async def test_create_non_image_mime_returns_422(self, real_client) -> None:
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        files = [("photos", ("doc.pdf", b"pdf_content", "application/pdf"))]
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=_FORM_FIELDS,
            files=files,
            headers=_auth(token),
        )
        assert r.status_code == 422
        assert "invalid_photo_type" in r.json()["detail"]

    @pytest.mark.anyio
    async def test_create_invalid_region_returns_422(self, real_client) -> None:
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        bad_data = {**_FORM_FIELDS, "region": "Atlantique"}
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=bad_data,
            headers=_auth(token),
        )
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_create_missing_title_returns_422(self, real_client) -> None:
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        bad = {k: v for k, v in _FORM_FIELDS.items() if k != "title"}
        r = await real_client.post(
            "/api/v1/farmarket/ads",
            data=bad,
            headers=_auth(token),
        )
        assert r.status_code == 422

    # ── GET /ads ───────────────────────────────────────────────────────────

    @pytest.mark.anyio
    async def test_list_no_auth_returns_401(self, real_client) -> None:
        r = await real_client.get("/api/v1/farmarket/ads")
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_list_restaurant_returns_403(self, real_client) -> None:
        token = _make_token(role="RESTAURANT", verification_status="VERIFIED")
        r = await real_client.get(
            "/api/v1/farmarket/ads",
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_list_pending_farmer_returns_403(self, real_client) -> None:
        token = _make_token(role="FARMER", verification_status="PENDING")
        r = await real_client.get(
            "/api/v1/farmarket/ads",
            headers=_auth(token),
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"
