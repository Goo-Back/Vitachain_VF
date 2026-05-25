"""FAR-04 — anonymised order notification worker.

Listens for ``farmarket_order_placed`` (emitted by migration 0041's AFTER
INSERT trigger on ``m2_farmarket_orders``) and dispatches one Brevo email per
distinct producer in the order — each email contains ONLY that producer's
items + a coarse delivery region + a sha256 ``resto_handle``. Restaurant
identifiers (name, email, phone, address) never enter the payload.

BR-F4: the Brevo API key is read here (backend worker), never on the frontend.
BR-F5: the producer payload is built from
``v_farmer_incoming_items`` join semantics — ``restaurant_id`` is loaded only
for the audit log and explicitly not forwarded.
"""
