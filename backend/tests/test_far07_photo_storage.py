"""FAR-07 — Photo storage constraint verification.

These tests pin every enforcement layer of the "photos stored in Storage, not DB"
architectural constraint (PRD §6.2.1 FAR-07, BR-F2).

Layer coverage
--------------
* Schema layer  — AdOut.photo_urls is computed, not persisted; photo_paths is text[].
* Router layer  — count, size, MIME gate; storage path convention; public URL format.
* AUTH-05 layer — no service_client() call in the farmarket router module.
"""
from __future__ import annotations

import ast
import io
import time
import uuid
from decimal import Decimal
from pathlib import Path

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.modules.farmarket.schemas import (
    MAX_PHOTO_BYTES,
    MAX_PHOTOS,
    AdOut,
)

_ALG = "HS256"
_AUD = "authenticated"
_BUCKET = "farmarket-photos"
_ROUTER_PATH = Path(__file__).parent.parent / "app" / "modules" / "farmarket" / "router.py"


def _secret() -> str:
    return get_settings().supabase_jwt_secret.get_secret_value()


def _make_token(
    *,
    role: str = "FARMER",
    verification_status: str = "VERIFIED",
    sub: str | None = None,
) -> str:
    now = int(time.time())
    return pyjwt.encode(
        {
            "iat": now,
            "exp": now + 3600,
            "aud": _AUD,
            "sub": sub or str(uuid.uuid4()),
            "email": "farmer@test.local",
            "user_role": role,
            "verification_status": verification_status,
        },
        _secret(),
        algorithm=_ALG,
    )


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Schema layer
# ---------------------------------------------------------------------------

class TestSchemaLayer:
    def test_photo_paths_is_list_of_strings(self) -> None:
        """AdOut.photo_paths must be list[str] — not bytes, not list[bytes]."""
        annotation = AdOut.model_fields["photo_paths"].annotation
        assert annotation == list[str], (
            f"photo_paths annotation is {annotation!r} — must be list[str] (FAR-07)"
        )

    def test_photo_urls_not_a_db_field(self) -> None:
        """photo_urls is a computed field — it must not be stored in the DB."""
        # AdOut has photo_urls as a plain field populated by the router, not the DB.
        # If someone adds it to the DB insert dict, this test should catch it via
        # confirming the router never persists it.
        router_src = _ROUTER_PATH.read_text()
        assert '"photo_urls"' not in router_src, (
            "photo_urls must not appear as a DB key in router inserts (FAR-07)"
        )

    def test_max_photos_constant(self) -> None:
        assert MAX_PHOTOS == 5, "BR-F2: MAX_PHOTOS must be 5"

    def test_max_photo_bytes_constant(self) -> None:
        assert MAX_PHOTO_BYTES == 2 * 1024 * 1024, "BR-F2: MAX_PHOTO_BYTES must be 2 MB"


# ---------------------------------------------------------------------------
# Public URL format
# ---------------------------------------------------------------------------

class TestPublicUrlFormat:
    def test_storage_public_url_contains_bucket_and_path(self) -> None:
        """_storage_public_url must build a /object/public/ URL — no signed URL."""
        from app.modules.farmarket.router import _storage_public_url

        farmer_id = uuid.uuid4()
        ad_id = uuid.uuid4()
        path = f"{farmer_id}/{ad_id}/tomatoes.jpg"

        url = _storage_public_url(path)

        assert "/object/public/" in url, (
            f"URL {url!r} is not a public storage URL — check _storage_public_url (FAR-07)"
        )
        assert _BUCKET in url, f"URL {url!r} does not reference the '{_BUCKET}' bucket"
        assert str(farmer_id) in url
        assert str(ad_id) in url
        assert "tomatoes.jpg" in url

    def test_storage_public_url_no_signed_token(self) -> None:
        """Public bucket must not use signed URLs (token= param)."""
        from app.modules.farmarket.router import _storage_public_url

        url = _storage_public_url("a/b/c.jpg")
        assert "token=" not in url, (
            "Public bucket must not produce signed URLs — remove token= param (FAR-07)"
        )


# ---------------------------------------------------------------------------
# Router auth contract — photo validation gates (no DB / Storage calls needed)
# ---------------------------------------------------------------------------

class TestRouterPhotoGates:
    """
    These tests mount the FastAPI app and hit POST /farmarket/ads with:
    - too many photos  → 422
    - photo too large  → 422
    - wrong MIME type  → 422

    DB and Storage writes are mocked out because the test focuses on the
    *validation* layer, not the storage integration.
    """

    @pytest.fixture()
    def verified_farmer_token(self) -> str:
        return _make_token(role="FARMER", verification_status="VERIFIED")

    @pytest.mark.asyncio
    async def test_too_many_photos_returns_422(
        self, verified_farmer_token: str
    ) -> None:
        from unittest.mock import AsyncMock, patch

        from app.main import create_app

        app = create_app()
        base_fields = {
            "title": "Tomates FAR-07",
            "description": "Description longue pour satisfaire la validation Pydantic.",
            "product_type": "Tomates",
            "price_mad": "4.50",
            "quantity_kg": "100",
            "region": "Souss-Massa",
        }

        # Build MAX_PHOTOS + 1 tiny fake images
        files = [
            ("photos", (f"img{i}.jpg", b"\xff\xd8\xff" + b"x" * 10, "image/jpeg"))
            for i in range(MAX_PHOTOS + 1)
        ]

        with patch(
            "app.modules.farmarket.router.get_db_for_user",
            return_value=AsyncMock(),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/farmarket/ads",
                    headers=_auth(verified_farmer_token),
                    data=base_fields,
                    files=files,
                )

        assert resp.status_code == 422, (
            f"Expected 422 for {MAX_PHOTOS + 1} photos, got {resp.status_code}"
        )
        assert "too_many_photos" in resp.text

    @pytest.mark.asyncio
    async def test_photo_over_2mb_returns_422(
        self, verified_farmer_token: str
    ) -> None:
        from unittest.mock import AsyncMock, patch

        from app.main import create_app

        app = create_app()
        base_fields = {
            "title": "Tomates FAR-07 size",
            "description": "Description longue pour satisfaire la validation Pydantic.",
            "product_type": "Tomates",
            "price_mad": "4.50",
            "quantity_kg": "100",
            "region": "Souss-Massa",
        }
        oversized = b"\xff\xd8\xff" + b"x" * (MAX_PHOTO_BYTES + 1)

        with patch(
            "app.modules.farmarket.router.get_db_for_user",
            return_value=AsyncMock(),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/farmarket/ads",
                    headers=_auth(verified_farmer_token),
                    data=base_fields,
                    files=[("photos", ("big.jpg", oversized, "image/jpeg"))],
                )

        assert resp.status_code == 422, (
            f"Expected 422 for oversized photo, got {resp.status_code}"
        )
        assert "photo_too_large" in resp.text

    @pytest.mark.asyncio
    async def test_non_image_mime_returns_422(
        self, verified_farmer_token: str
    ) -> None:
        from unittest.mock import AsyncMock, patch

        from app.main import create_app

        app = create_app()
        base_fields = {
            "title": "Tomates FAR-07 mime",
            "description": "Description longue pour satisfaire la validation Pydantic.",
            "product_type": "Tomates",
            "price_mad": "4.50",
            "quantity_kg": "100",
            "region": "Souss-Massa",
        }

        with patch(
            "app.modules.farmarket.router.get_db_for_user",
            return_value=AsyncMock(),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/farmarket/ads",
                    headers=_auth(verified_farmer_token),
                    data=base_fields,
                    files=[("photos", ("malware.exe", b"MZ\x90\x00", "application/octet-stream"))],
                )

        assert resp.status_code == 422, (
            f"Expected 422 for non-image MIME, got {resp.status_code}"
        )
        assert "invalid_photo_type" in resp.text


# ---------------------------------------------------------------------------
# Storage path convention (AST-level, no network)
# ---------------------------------------------------------------------------

class TestStoragePathConvention:
    def test_path_includes_farmer_id_and_ad_id(self) -> None:
        """The path must embed {user.id}/{ad_id}/filename — cross-farmer isolation.

        The Storage RLS policy (migration 0033) asserts
        ``(storage.foldername(name))[1] = auth.uid()::text``.
        This test pins that the router builds the path in the matching order.
        """
        router_src = _ROUTER_PATH.read_text()
        # The router contains: storage_path = f"{user.id}/{ad_id}/{safe_name}"
        assert "user.id" in router_src and "ad_id" in router_src
        # Confirm the order: user.id is the FIRST path segment
        line = next(
            (ln for ln in router_src.splitlines() if "storage_path" in ln and "user.id" in ln),
            None,
        )
        assert line is not None, "Could not find storage_path assignment in router (FAR-07)"
        # user.id must appear before ad_id in the f-string
        assert line.index("user.id") < line.index("ad_id"), (
            "Storage path must be {user.id}/{ad_id}/... — user.id must be the first segment"
        )


# ---------------------------------------------------------------------------
# AUTH-05 boundary — no service_client() on the upload path
# ---------------------------------------------------------------------------

class TestAuth05Boundary:
    def test_farmarket_router_does_not_call_service_client(self) -> None:
        """The farmarket router must not call service_client() on any path.

        Photos are uploaded via the user-scoped Supabase client (bearer JWT
        forwarded).  The service-role key must never be used in this module.
        AUTH-05 allow-list does not include modules/farmarket/.
        """
        router_src = _ROUTER_PATH.read_text()
        assert "service_client" not in router_src, (
            "farmarket/router.py calls service_client() — AUTH-05 violation (FAR-07). "
            "Photo uploads must use the user-scoped client (get_db_for_user)."
        )

    def test_no_service_role_key_in_router_module(self) -> None:
        """No direct reference to SUPABASE_SERVICE_ROLE_KEY in the farmarket module."""
        schemas_path = _ROUTER_PATH.parent / "schemas.py"
        for path in (_ROUTER_PATH, schemas_path):
            src = path.read_text()
            assert "SERVICE_ROLE_KEY" not in src, (
                f"{path.name} references SERVICE_ROLE_KEY — AUTH-05 violation (FAR-07)"
            )
