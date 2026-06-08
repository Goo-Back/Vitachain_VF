"""FAR-05 — edit and soft-delete own ad: unit tests for the router guards."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from unittest import mock

from fastapi import status
from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user, get_db_for_user
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
    return AuthUser(
        id=user_id,
        role="FARMER",
        verification_status="VERIFIED",
        email="farmer@test.ma",
    )


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


@contextmanager
def _client_as(farmer: AuthUser, db: mock.MagicMock) -> Iterator[TestClient]:
    """Yield a TestClient with the auth + DB dependencies overridden.

    The ad-mutation routes resolve ``require_verified("FARMER")`` — whose inner
    guard depends on ``get_current_user`` — plus ``get_db_for_user``. Overriding
    those two via ``app.dependency_overrides`` injects the test farmer and a mock
    DB without a real JWT. Patching the module-level names would not work: the
    dependencies are bound into the routes at import time, before any patch.
    """
    app.dependency_overrides[get_current_user] = lambda: farmer
    app.dependency_overrides[get_db_for_user] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_db_for_user, None)


class TestUpdateAdOwnershipGuard:
    def test_non_owner_returns_403(self) -> None:
        farmer = _make_verified_farmer(_OTHER_FARMER_ID)
        with _client_as(farmer, _make_db_mock(_ACTIVE_AD_ROW)) as client:
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Attempted overwrite"},
            )
        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert r.json()["detail"] == "not_ad_owner"

    def test_ad_not_found_returns_404(self) -> None:
        farmer = _make_verified_farmer(_FARMER_ID)
        with _client_as(farmer, _make_db_mock(None)) as client:
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Test"},
            )
        assert r.status_code == status.HTTP_404_NOT_FOUND


class TestUpdateAdEditabilityGuard:
    def test_expired_ad_returns_409(self) -> None:
        farmer = _make_verified_farmer(_FARMER_ID)
        with _client_as(farmer, _make_db_mock(_EXPIRED_AD_ROW)) as client:
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Updated title"},
            )
        assert r.status_code == status.HTTP_409_CONFLICT
        assert "ad_not_editable" in r.json()["detail"]

    def test_no_fields_returns_422(self) -> None:
        farmer = _make_verified_farmer(_FARMER_ID)
        with _client_as(farmer, _make_db_mock(_ACTIVE_AD_ROW)) as client:
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={},
            )
        assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


class TestDeleteAdGuards:
    def test_non_owner_returns_403(self) -> None:
        farmer = _make_verified_farmer(_OTHER_FARMER_ID)
        with _client_as(farmer, _make_db_mock(_ACTIVE_AD_ROW)) as client:
            r = client.delete(f"/api/v1/farmarket/ads/{_AD_ID}")
        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert r.json()["detail"] == "not_ad_owner"

    def test_already_deleted_is_idempotent_204(self) -> None:
        farmer = _make_verified_farmer(_FARMER_ID)
        with _client_as(farmer, _make_db_mock(_DELETED_AD_ROW)) as client:
            r = client.delete(f"/api/v1/farmarket/ads/{_AD_ID}")
        assert r.status_code == status.HTTP_204_NO_CONTENT

    def test_ad_not_found_returns_404(self) -> None:
        farmer = _make_verified_farmer(_FARMER_ID)
        with _client_as(farmer, _make_db_mock(None)) as client:
            r = client.delete(f"/api/v1/farmarket/ads/{_AD_ID}")
        assert r.status_code == status.HTTP_404_NOT_FOUND
