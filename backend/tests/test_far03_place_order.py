"""FAR-03 — Order placement: schema + logistics fee + endpoint auth guards."""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from app.modules.farmarket.schemas import (
    LOGISTICS_FEE_FLAT_MIN,
    ORDER_MAX_ITEMS,
    OrderCreate,
    OrderItemCreate,
    compute_logistics_fee,
)


class TestOrderItemCreate:
    def test_positive_quantity_ok(self) -> None:
        item = OrderItemCreate(ad_id=uuid4(), quantity_kg=Decimal("12.50"))
        assert item.quantity_kg == Decimal("12.50")

    def test_zero_quantity_rejected(self) -> None:
        with pytest.raises(ValueError, match="quantity_kg"):
            OrderItemCreate(ad_id=uuid4(), quantity_kg=Decimal("0"))

    def test_negative_quantity_rejected(self) -> None:
        with pytest.raises(ValueError, match="quantity_kg"):
            OrderItemCreate(ad_id=uuid4(), quantity_kg=Decimal("-1"))


class TestOrderCreate:
    def _valid_payload(self, n_items: int = 1) -> dict:
        return {
            "delivery_region": "Souss-Massa",
            "delivery_notes": None,
            "items": [
                OrderItemCreate(ad_id=uuid4(), quantity_kg=Decimal("5"))
                for _ in range(n_items)
            ],
        }

    def test_valid_minimal(self) -> None:
        order = OrderCreate(**self._valid_payload())
        assert order.delivery_region == "Souss-Massa"
        assert len(order.items) == 1

    def test_invalid_region_rejected(self) -> None:
        with pytest.raises(ValueError, match="delivery_region"):
            OrderCreate(
                delivery_region="Atlantique",
                delivery_notes=None,
                items=[OrderItemCreate(ad_id=uuid4(), quantity_kg=Decimal("5"))],
            )

    def test_empty_items_rejected(self) -> None:
        with pytest.raises(ValueError, match="between"):
            OrderCreate(
                delivery_region="Souss-Massa", delivery_notes=None, items=[],
            )

    def test_too_many_items_rejected(self) -> None:
        with pytest.raises(ValueError, match="between"):
            OrderCreate(**self._valid_payload(n_items=ORDER_MAX_ITEMS + 1))

    def test_duplicate_ad_ids_rejected(self) -> None:
        shared = uuid4()
        with pytest.raises(ValueError, match="distinct"):
            OrderCreate(
                delivery_region="Souss-Massa",
                delivery_notes=None,
                items=[
                    OrderItemCreate(ad_id=shared, quantity_kg=Decimal("5")),
                    OrderItemCreate(ad_id=shared, quantity_kg=Decimal("3")),
                ],
            )

    def test_notes_too_long_rejected(self) -> None:
        with pytest.raises(ValueError, match="500"):
            OrderCreate(
                delivery_region="Souss-Massa",
                delivery_notes="x" * 501,
                items=[OrderItemCreate(ad_id=uuid4(), quantity_kg=Decimal("5"))],
            )

    def test_blank_notes_collapse_to_none(self) -> None:
        order = OrderCreate(
            delivery_region="Souss-Massa",
            delivery_notes="   ",
            items=[OrderItemCreate(ad_id=uuid4(), quantity_kg=Decimal("5"))],
        )
        assert order.delivery_notes is None


class TestLogisticsFee:
    def test_floor_below_threshold(self) -> None:
        assert compute_logistics_fee(Decimal("100")) == LOGISTICS_FEE_FLAT_MIN

    def test_rate_above_threshold(self) -> None:
        # 5% of 2000 = 100 > 50 floor
        assert compute_logistics_fee(Decimal("2000")) == Decimal("100.00")

    def test_zero_subtotal_returns_floor(self) -> None:
        assert compute_logistics_fee(Decimal("0")) == LOGISTICS_FEE_FLAT_MIN


# Endpoint-level RLS / role-gate coverage lives in
# db/tests/auth07_business_rules.sql (Postgres pgTAP cells) and the e2e role
# matrix test (backend/tests/test_auth07_role_matrix_e2e.py). The Pydantic
# schemas + the logistics-fee contract above cover the application-layer
# surface for FAR-03.
