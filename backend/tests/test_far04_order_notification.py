"""FAR-04 — anonymised order notification: sanitiser + payload purity."""

from __future__ import annotations

from uuid import uuid4

from app.workers.farmarket_order_notify.sanitise import redact_contact_info
from app.workers.farmarket_order_notify.sender import (
    _build_producer_payload,
    _order_short_code,
)


class TestRedactContactInfo:
    def test_none_passthrough(self) -> None:
        assert redact_contact_info(None) is None

    def test_blank_collapses_to_none(self) -> None:
        assert redact_contact_info("   ") is None

    def test_email_redacted(self) -> None:
        out = redact_contact_info("Contact: foo@bar.com pour info")
        assert "foo@bar.com" not in out
        assert "[email redacted]" in out

    def test_moroccan_mobile_redacted(self) -> None:
        out = redact_contact_info("Appelle-moi au 0612345678 SVP")
        assert "0612345678" not in out
        assert "[phone redacted]" in out

    def test_international_phone_redacted(self) -> None:
        out = redact_contact_info("Tel: +212 612345678")
        assert "+212" not in out or "[phone redacted]" in out

    def test_multiple_patterns_all_redacted(self) -> None:
        out = redact_contact_info("a@b.com or call 0712345678")
        assert "a@b.com" not in out
        assert "0712345678" not in out

    def test_safe_text_passthrough(self) -> None:
        out = redact_contact_info("Livraison en matinée, merci.")
        assert out == "Livraison en matinée, merci."


class TestProducerPayloadAnonymisation:
    """BR-F5: ``restaurant_id`` must never appear in the Brevo params dict."""

    def test_payload_omits_restaurant_id(self) -> None:
        resto_uuid = str(uuid4())
        order_id = uuid4()
        order = {
            "id": str(order_id),
            "restaurant_id": resto_uuid,
            "delivery_region": "Souss-Massa",
            "delivery_notes": "Livraison matin.",
        }
        farmer_items = [
            {
                "id": str(uuid4()),
                "ad_id": str(uuid4()),
                "quantity_kg": "10",
                "unit_price_mad": "8.5",
                "line_total_mad": "85.00",
            }
        ]
        ads_by_id = {
            farmer_items[0]["ad_id"]: {"title": "Tomates", "product_type": "Légumes"}
        }

        payload = _build_producer_payload(
            order=order, farmer_items=farmer_items, ads_by_id=ads_by_id,
        )

        as_str = repr(payload)
        assert resto_uuid not in as_str
        assert "restaurant_id" not in payload
        assert "restaurant_email" not in payload
        assert "restaurant_name" not in payload
        assert payload["delivery_region"] == "Souss-Massa"
        assert payload["items_count"] == 1
        assert payload["order_short_code"].startswith("VITA-")

    def test_sanitised_notes_in_payload(self) -> None:
        order_id = uuid4()
        order = {
            "id": str(order_id),
            "restaurant_id": str(uuid4()),
            "delivery_region": "Souss-Massa",
            "delivery_notes": "Contact: chef@resto.ma au 0612345678",
        }
        payload = _build_producer_payload(
            order=order, farmer_items=[], ads_by_id={},
        )
        assert "chef@resto.ma" not in payload["delivery_notes_sanitised"]
        assert "0612345678" not in payload["delivery_notes_sanitised"]


class TestOrderShortCode:
    def test_format_is_vita_prefix(self) -> None:
        code = _order_short_code(uuid4())
        assert code.startswith("VITA-")
        assert len(code) == len("VITA-") + 8
