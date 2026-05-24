"""FAR-05 — edit and soft-delete own ad: unit tests for the router guards."""

from __future__ import annotations

import uuid
from unittest import mock

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.core.security import AuthUser
from app.main import app

_FARMER_ID = uuid.uuid4()
_OTHER_FARMER_ID = uuid.uuid4()
_AD_ID = uuid.uuid4()

_ACTIVE_AD_ROW = {
    "id": str(_AD_ID),
    "farmer_id": str(_FARMER_ID),
    "title": "Tomates rondes",
    "description": "Description de test suffisamment longue.",
    "product_type": "Tomates",
    "price_mad": "2.50",
    "quantity_kg": "100.00",
    "region": "Souss-Massa",
    "photo_paths": [],
    "status": "ACTIVE",
    "is_featured": False,
    "expires_at": "2026-06-01T00:00:00+00:00",
    "created_at": "2026-05-01T00:00:00+00:00",
    "updated_at": "2026-05-01T00:00:00+00:00",
}

_EXPIRED_AD_ROW = {**_ACTIVE_AD_ROW, "status": "EXPIRED"}
_DELETED_AD_ROW = {**_ACTIVE_AD_ROW, "status": "DELETED"}


def _make_verified_farmer(user_id: uuid.UUID) -> AuthUser:
    return AuthUser(id=user_id, role="FARMER", email="farmer@test.ma")


class _MockSingleResult:
    def __init__(self, data: dict | None) -> None:
        self.data = data


class _MockResult:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


def _make_db_mock(
    ad_row: dict | None,
    update_returns: dict | None = None,
) -> mock.MagicMock:
    db = mock.MagicMock()
    single_result = _MockSingleResult(ad_row)
    (
        db.table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = single_result
    update_data = [update_returns] if update_returns else []
    (
        db.table.return_value
        .update.return_value
        .eq.return_value
        .execute.return_value
    ) = _MockResult(update_data)
    return db


class TestUpdateAdOwnershipGuard:
    def test_non_owner_returns_403(self) -> None:
        from app.modules.farmarket import router as far_router

        other_farmer = _make_verified_farmer(_OTHER_FARMER_ID)
        db = _make_db_mock(_ACTIVE_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: other_farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Attempted overwrite"},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert r.json()["detail"] == "not_ad_owner"

    def test_ad_not_found_returns_404(self) -> None:
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(None)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Test"},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_404_NOT_FOUND


class TestUpdateAdEditabilityGuard:
    def test_expired_ad_returns_409(self) -> None:
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(_EXPIRED_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Updated title"},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_409_CONFLICT
        assert "ad_not_editable" in r.json()["detail"]

    def test_no_fields_returns_422(self) -> None:
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(_ACTIVE_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


class TestDeleteAdGuards:
    def test_non_owner_returns_403(self) -> None:
        from app.modules.farmarket import router as far_router

        other_farmer = _make_verified_farmer(_OTHER_FARMER_ID)
        db = _make_db_mock(_ACTIVE_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: other_farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.delete(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert r.json()["detail"] == "not_ad_owner"

    def test_already_deleted_is_idempotent_204(self) -> None:
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(_DELETED_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.delete(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_204_NO_CONTENT

    def test_ad_not_found_returns_404(self) -> None:
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(None)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.delete(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_404_NOT_FOUND
