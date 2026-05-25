"""FAR-10 — Order tracking: status update payload + endpoint guards.

The DB triggers (transition validation, header derivation, cancel RLS) are
covered by `db/tests/auth07_business_rules.sql` cells F-10*. This file
exercises the Python surface around them.
"""

from __future__ import annotations

import pytest

from app.modules.farmarket.schemas import OrderItemStatusUpdate


class TestOrderItemStatusUpdate:
    def test_minimal(self) -> None:
        upd = OrderItemStatusUpdate(new_status="ACCEPTED")
        assert upd.new_status == "ACCEPTED"
        assert upd.producer_note is None

    def test_with_note(self) -> None:
        upd = OrderItemStatusUpdate(
            new_status="REJECTED", producer_note="En rupture de stock.",
        )
        assert upd.producer_note == "En rupture de stock."

    def test_invalid_status_rejected(self) -> None:
        with pytest.raises(ValueError):
            OrderItemStatusUpdate(new_status="EXPLODED")  # type: ignore[arg-type]

    def test_blank_note_collapses_to_none(self) -> None:
        upd = OrderItemStatusUpdate(new_status="ACCEPTED", producer_note="   ")
        assert upd.producer_note is None

    def test_note_too_long_rejected(self) -> None:
        with pytest.raises(ValueError, match="500"):
            OrderItemStatusUpdate(new_status="REJECTED", producer_note="x" * 501)


# Endpoint-level guards (PATCH /orders/{id}/cancel, PATCH
# /orders/items/{id}/status, GET /orders/incoming) are covered by the
# Postgres-side test suite (transition trigger raises P0001 on invalid
# graph; the cancel RLS narrows to PENDING -> CANCELLED at the DB layer).
# The Python surface that this file owns is the OrderItemStatusUpdate
# payload validation above.
