"""FAR-02 — Catalog browse: CatalogQuery schema + endpoint guard tests."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.modules.farmarket.schemas import (
    CATALOG_PAGE_SIZE_DEFAULT,
    CATALOG_PAGE_SIZE_MAX,
    CatalogQuery,
)


class TestCatalogQuery:
    def test_defaults(self) -> None:
        q = CatalogQuery()
        assert q.region is None
        assert q.product_type is None
        assert q.price_min is None
        assert q.price_max is None
        assert q.page == 1
        assert q.page_size == CATALOG_PAGE_SIZE_DEFAULT

    def test_valid_region(self) -> None:
        q = CatalogQuery(region="Souss-Massa")
        assert q.region == "Souss-Massa"

    def test_invalid_region_rejected(self) -> None:
        with pytest.raises(ValueError, match="region"):
            CatalogQuery(region="Atlantique")

    def test_none_region_valid(self) -> None:
        q = CatalogQuery(region=None)
        assert q.region is None

    def test_negative_price_min_rejected(self) -> None:
        with pytest.raises(ValueError, match="non-negative"):
            CatalogQuery(price_min=Decimal("-1"))

    def test_negative_price_max_rejected(self) -> None:
        with pytest.raises(ValueError, match="non-negative"):
            CatalogQuery(price_max=Decimal("-0.01"))

    def test_zero_price_is_valid(self) -> None:
        q = CatalogQuery(price_min=Decimal("0"), price_max=Decimal("0"))
        assert q.price_min == Decimal("0")

    def test_page_zero_rejected(self) -> None:
        with pytest.raises(ValueError):
            CatalogQuery(page=0)

    def test_page_size_over_max_rejected(self) -> None:
        with pytest.raises(ValueError):
            CatalogQuery(page_size=CATALOG_PAGE_SIZE_MAX + 1)

    def test_page_size_at_max_is_valid(self) -> None:
        q = CatalogQuery(page_size=CATALOG_PAGE_SIZE_MAX)
        assert q.page_size == CATALOG_PAGE_SIZE_MAX

    def test_product_type_filter_passthrough(self) -> None:
        q = CatalogQuery(product_type="tomate")
        assert q.product_type == "tomate"


class TestCatalogEndpoint:
    def test_catalog_requires_auth(self, test_client) -> None:
        resp = test_client.get("/api/v1/farmarket/catalog")
        assert resp.status_code == 401

    def test_catalog_invalid_region_returns_422(
        self, test_client, farmer_token: str
    ) -> None:
        resp = test_client.get(
            "/api/v1/farmarket/catalog?region=NonExistent",
            headers={"Authorization": f"Bearer {farmer_token}"},
        )
        assert resp.status_code == 422

    def test_catalog_negative_price_min_returns_422(
        self, test_client, farmer_token: str
    ) -> None:
        resp = test_client.get(
            "/api/v1/farmarket/catalog?price_min=-5",
            headers={"Authorization": f"Bearer {farmer_token}"},
        )
        assert resp.status_code == 422

    def test_catalog_page_zero_returns_422(
        self, test_client, farmer_token: str
    ) -> None:
        resp = test_client.get(
            "/api/v1/farmarket/catalog?page=0",
            headers={"Authorization": f"Bearer {farmer_token}"},
        )
        assert resp.status_code == 422

    def test_catalog_page_size_over_max_returns_422(
        self, test_client, farmer_token: str
    ) -> None:
        resp = test_client.get(
            f"/api/v1/farmarket/catalog?page_size={CATALOG_PAGE_SIZE_MAX + 1}",
            headers={"Authorization": f"Bearer {farmer_token}"},
        )
        assert resp.status_code == 422
