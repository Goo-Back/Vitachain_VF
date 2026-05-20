"""KAT-01 — parcel registry coverage.

Two layers, mirroring the AUTH-06 split between unit and integration tests:

* :class:`TestGeoJSONValidator` — pure Pydantic validation of
  :class:`ParcelCreate` and :class:`ParcelUpdate`. No network, no Supabase.

* :class:`TestParcelRouterMounted` — boots the real FastAPI app via
  :func:`create_app` and asserts the auth contract on
  ``/api/v1/katara/parcels``: unauthenticated → 401; PENDING farmer / wrong
  role → 403. The DB write paths (verified farmer round-trip, RLS
  cross-farmer isolation) live in the staging drill — see
  ``docs/stories/KAT-01-farmer-registers-parcel.md`` §6.
"""

from __future__ import annotations

import time
import uuid

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import get_settings
from app.modules.katara.schemas import ParcelCreate, ParcelUpdate

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


VALID_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [-8.0, 31.0],
            [-8.0, 31.1],
            [-7.9, 31.1],
            [-7.9, 31.0],
            [-8.0, 31.0],
        ]
    ],
}

VALID_FEATURE = {
    "type": "Feature",
    "geometry": VALID_POLYGON,
    "properties": {},
}

PARCEL_BODY = {
    "name": "Parcelle Test",
    "crop_type": "Tomates",
    "surface_area_ha": 1.5,
    "geojson": VALID_POLYGON,
}


# ---------------------------------------------------------------------------
# Pure-unit: Pydantic validator
# ---------------------------------------------------------------------------


class TestGeoJSONValidator:
    """No network — exercises the structural validator end-to-end."""

    def test_polygon_accepted(self) -> None:
        p = ParcelCreate(
            name="X", crop_type="Y", surface_area_ha=1, geojson=VALID_POLYGON
        )
        assert p.geojson["type"] == "Polygon"

    def test_multipolygon_accepted(self) -> None:
        mp = {
            "type": "MultiPolygon",
            "coordinates": [VALID_POLYGON["coordinates"]],
        }
        p = ParcelCreate(name="X", crop_type="Y", surface_area_ha=1, geojson=mp)
        assert p.geojson["type"] == "MultiPolygon"

    def test_feature_wrapping_polygon_accepted(self) -> None:
        p = ParcelCreate(
            name="X", crop_type="Y", surface_area_ha=1, geojson=VALID_FEATURE
        )
        assert p.geojson["type"] == "Feature"

    def test_point_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelCreate(
                name="X",
                crop_type="Y",
                surface_area_ha=1,
                geojson={"type": "Point", "coordinates": [0, 0]},
            )

    def test_linestring_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelCreate(
                name="X",
                crop_type="Y",
                surface_area_ha=1,
                geojson={"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            )

    def test_feature_wrapping_point_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelCreate(
                name="X",
                crop_type="Y",
                surface_area_ha=1,
                geojson={
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [0, 0]},
                    "properties": {},
                },
            )

    def test_empty_coordinates_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelCreate(
                name="X",
                crop_type="Y",
                surface_area_ha=1,
                geojson={"type": "Polygon", "coordinates": []},
            )

    def test_zero_area_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelCreate(
                name="X", crop_type="Y", surface_area_ha=0, geojson=VALID_POLYGON
            )

    def test_negative_area_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelCreate(
                name="X",
                crop_type="Y",
                surface_area_ha=-1,
                geojson=VALID_POLYGON,
            )

    def test_blank_name_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelCreate(
                name="   ",
                crop_type="Y",
                surface_area_ha=1,
                geojson=VALID_POLYGON,
            )

    def test_blank_crop_type_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelCreate(
                name="X",
                crop_type="   ",
                surface_area_ha=1,
                geojson=VALID_POLYGON,
            )

    def test_update_all_none_is_valid_pydantic(self) -> None:
        # ParcelUpdate allows an empty patch at the Pydantic layer; the router
        # is responsible for rejecting it with 422 no_fields_to_update.
        ParcelUpdate()

    def test_update_invalid_geojson_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelUpdate(geojson={"type": "Point", "coordinates": [0, 0]})

    def test_update_negative_area_rejected(self) -> None:
        with pytest.raises(ValidationError):
            ParcelUpdate(surface_area_ha=-2)

    def test_name_and_crop_type_trimmed(self) -> None:
        p = ParcelCreate(
            name="  Parcelle Nord  ",
            crop_type="  Tomates  ",
            surface_area_ha=1,
            geojson=VALID_POLYGON,
        )
        assert p.name == "Parcelle Nord"
        assert p.crop_type == "Tomates"


# ---------------------------------------------------------------------------
# Router mounted on the real app — auth-contract only (no DB writes)
# ---------------------------------------------------------------------------


@pytest.fixture
async def real_client():
    from app.main import create_app

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestParcelRouterMounted:
    """The KAT-01 endpoints are wired and gated as documented."""

    @pytest.mark.anyio
    async def test_module_healthz(self, real_client) -> None:
        r = await real_client.get("/api/v1/katara/healthz")
        assert r.status_code == 200
        assert r.json() == {"module": "katara", "status": "ok"}

    @pytest.mark.anyio
    async def test_create_requires_auth(self, real_client) -> None:
        r = await real_client.post("/api/v1/katara/parcels", json=PARCEL_BODY)
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_list_requires_auth(self, real_client) -> None:
        r = await real_client.get("/api/v1/katara/parcels")
        assert r.status_code == 401

    @pytest.mark.anyio
    async def test_pending_farmer_blocked_on_create(self, real_client) -> None:
        token = _make_token(role="FARMER", verification_status="PENDING")
        r = await real_client.post(
            "/api/v1/katara/parcels", json=PARCEL_BODY, headers=_auth(token)
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_legacy_session_blocked_on_create(self, real_client) -> None:
        # Session predates AUTH-06 (no verification_status claim) — must 403.
        token = _make_token(role="FARMER", verification_status=None)
        r = await real_client.post(
            "/api/v1/katara/parcels", json=PARCEL_BODY, headers=_auth(token)
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "verification_required"

    @pytest.mark.anyio
    async def test_restaurant_blocked_on_create(self, real_client) -> None:
        token = _make_token(role="RESTAURANT", verification_status="VERIFIED")
        r = await real_client.post(
            "/api/v1/katara/parcels", json=PARCEL_BODY, headers=_auth(token)
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_citizen_blocked_on_create(self, real_client) -> None:
        token = _make_token(role="CITIZEN", verification_status=None)
        r = await real_client.post(
            "/api/v1/katara/parcels", json=PARCEL_BODY, headers=_auth(token)
        )
        assert r.status_code == 403
        assert r.json()["detail"] == "role_not_allowed"

    @pytest.mark.anyio
    async def test_invalid_geojson_returns_422(self, real_client) -> None:
        # Reaches the Pydantic validator before any DB call — works even when
        # SUPABASE_URL points at the dummy seeded by conftest.
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        bad = {**PARCEL_BODY, "geojson": {"type": "Point", "coordinates": [0, 0]}}
        r = await real_client.post(
            "/api/v1/katara/parcels", json=bad, headers=_auth(token)
        )
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_zero_area_returns_422(self, real_client) -> None:
        token = _make_token(role="FARMER", verification_status="VERIFIED")
        bad = {**PARCEL_BODY, "surface_area_ha": 0}
        r = await real_client.post(
            "/api/v1/katara/parcels", json=bad, headers=_auth(token)
        )
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_expired_token_returns_401(self, real_client) -> None:
        # Expiry surfaces from get_current_user before role/verification —
        # the frontend redirect path keys on 401.
        token = _make_token(
            role="FARMER", verification_status="VERIFIED", exp_offset=-1
        )
        r = await real_client.post(
            "/api/v1/katara/parcels", json=PARCEL_BODY, headers=_auth(token)
        )
        assert r.status_code == 401
