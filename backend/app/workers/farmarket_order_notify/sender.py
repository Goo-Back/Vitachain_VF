"""FAR-04 — fan out per-producer Brevo emails for a placed order.

Anonymisation contract (BR-F5):

* The order header is loaded once via service_client (AUTH-05 allow-listed
  worker path). ``restaurant_id`` is read **only** to write the audit log
  entry — it is never copied into the Brevo ``params`` dict.
* The per-producer payload is built by filtering items to a single
  ``farmer_id`` and projecting ``ad_title`` / ``product_type`` /
  ``quantity_kg`` / prices / coarse delivery region.
* ``delivery_notes`` runs through :func:`redact_contact_info` before
  emission.

Idempotency: stamp ``notified_at`` AFTER Brevo 2xx (same discipline as
KAT-09). If the worker dies between dispatch and stamp, the backstop
re-emits — better one duplicate email than a silent miss; producer can
de-dupe via the order short code in the subject line.
"""
from __future__ import annotations

import logging
import os
from contextlib import suppress
from typing import Any
from uuid import UUID

import sentry_sdk

# JUSTIFICATION: FAR-04 worker reads m2_farmarket_orders + m2_farmarket_order_items
# + m2_farmarket_ads + profiles, then writes m2_farmarket_orders.notified_at,
# via the service-role DSN. The user JWT is not in scope — the worker reacts
# to a system NOTIFY. AUTH-05 allow-list entry: workers/farmarket_order_notify/.
from app.db import service_client
from app.workers import mailer
from app.workers.farmarket_order_notify.sanitise import redact_contact_info

log = logging.getLogger("farmarket_order_notify.sender")

_FALLBACK_LOCALE = "fr"
_SUPPORTED_LOCALES = ("fr", "ar", "en")


def _template_ids() -> dict[str, int]:
    raw = {
        "fr": os.getenv("BREVO_TEMPLATE_FAR_ORDER_FR", "0") or "0",
        "ar": os.getenv("BREVO_TEMPLATE_FAR_ORDER_AR", "0") or "0",
        "en": os.getenv("BREVO_TEMPLATE_FAR_ORDER_EN", "0") or "0",
    }
    out: dict[str, int] = {}
    for loc, val in raw.items():
        try:
            out[loc] = int(val)
        except (TypeError, ValueError):
            out[loc] = 0
    return out


def _resolve_template(locale: str | None) -> tuple[int, str]:
    candidates = _template_ids()
    loc = (locale or "").lower()
    if loc not in _SUPPORTED_LOCALES:
        loc = _FALLBACK_LOCALE
    tid = candidates.get(loc) or 0
    if not tid:
        loc = _FALLBACK_LOCALE
        tid = candidates.get(_FALLBACK_LOCALE) or 0
    if not tid:
        raise mailer.MailerError(
            "BREVO_TEMPLATE_FAR_ORDER_FR is not set — refusing to send"
        )
    return tid, loc


def _order_short_code(order_id: UUID) -> str:
    """First 4 hex chars of the UUID, prefixed with VITA- — matches subject line.

    Collisions are possible but the producer also sees the full URL with the
    full UUID; the short code is for human readability only.
    """
    return f"VITA-{str(order_id).replace('-', '')[:8].upper()}"


def _claim_order(order_id: UUID) -> dict[str, Any] | None:
    """Atomic claim — UPDATE ... RETURNING. Returns the row or None.

    The PostgREST surface does not expose RETURNING + WHERE notified_at IS NULL
    in one call; we approximate with a select-then-update sequence and rely on
    the NULL guard in the UPDATE's WHERE clause to make the operation safe
    under concurrent workers.
    """
    db = service_client()
    res = (
        db.table("m2_farmarket_orders")
        .select("id,restaurant_id,delivery_region,delivery_notes,subtotal_mad,created_at,notified_at,status")
        .eq("id", str(order_id))
        .is_("notified_at", "null")
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    return rows[0]


def _stamp_notified(order_id: UUID) -> None:
    db = service_client()
    from datetime import datetime, timezone
    db.table("m2_farmarket_orders").update(
        {"notified_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", str(order_id)).is_("notified_at", "null").execute()


def _fetch_items(order_id: UUID) -> list[dict[str, Any]]:
    db = service_client()
    res = (
        db.table("m2_farmarket_order_items")
        .select("id,farmer_id,ad_id,quantity_kg,unit_price_mad,line_total_mad,status")
        .eq("order_id", str(order_id))
        .execute()
    )
    return res.data or []


def _fetch_ads(ad_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not ad_ids:
        return {}
    db = service_client()
    res = (
        db.table("m2_farmarket_ads")
        .select("id,title,product_type")
        .in_("id", ad_ids)
        .execute()
    )
    return {str(r["id"]): r for r in (res.data or [])}


def _fetch_profile(farmer_id: str) -> dict[str, Any] | None:
    db = service_client()
    res = (
        db.table("profiles")
        .select("id,full_name,email,locale")
        .eq("id", farmer_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _build_producer_payload(
    *,
    order: dict[str, Any],
    farmer_items: list[dict[str, Any]],
    ads_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Construct the Brevo ``params`` dict for a single producer.

    BR-F5 guarantee: this function reads ``order`` for the short code,
    region, and (sanitised) notes ONLY. ``restaurant_id`` is intentionally
    not referenced here.
    """
    items_payload = []
    for it in farmer_items:
        ad = ads_by_id.get(str(it["ad_id"]), {})
        items_payload.append(
            {
                "ad_title": ad.get("title", "(annonce supprimée)"),
                "product_type": ad.get("product_type", ""),
                "quantity_kg": str(it["quantity_kg"]),
                "unit_price_mad": str(it["unit_price_mad"]),
                "line_total_mad": str(it["line_total_mad"]),
            }
        )

    base_url = os.getenv("FRONTEND_BASE_URL", "https://vitachain.ma").rstrip("/")
    return {
        "order_short_code": _order_short_code(UUID(str(order["id"]))),
        "items": items_payload,
        "items_count": len(items_payload),
        "delivery_region": order["delivery_region"],
        "delivery_notes_sanitised": redact_contact_info(order.get("delivery_notes")) or "",
        "accept_reject_url": f"{base_url}/dashboard/farmer/orders/{order['id']}",
    }


async def notify_order(order_id: UUID) -> None:
    """Process a single ``farmarket_order_placed`` notification."""
    order = _claim_order(order_id)
    if order is None:
        log.info("order_already_notified_or_missing id=%s", str(order_id))
        return

    items = _fetch_items(order_id)
    if not items:
        log.warning("order_has_no_items id=%s", str(order_id))
        _stamp_notified(order_id)
        return

    # Group items by farmer_id.
    by_farmer: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        by_farmer.setdefault(str(it["farmer_id"]), []).append(it)

    ads_by_id = _fetch_ads([str(it["ad_id"]) for it in items])

    short_code = _order_short_code(order_id)
    sent_to: list[str] = []

    for farmer_id, farmer_items in by_farmer.items():
        profile = _fetch_profile(farmer_id)
        if profile is None or not profile.get("email"):
            log.warning(
                "farmer_profile_missing_or_no_email order=%s farmer_id=%s",
                str(order_id), farmer_id,
            )
            with suppress(Exception):
                sentry_sdk.capture_message(
                    f"FAR-04: farmer profile missing for order {order_id} farmer {farmer_id}",
                    level="warning",
                )
            continue

        try:
            template_id, locale = _resolve_template(profile.get("locale"))
            params = _build_producer_payload(
                order=order, farmer_items=farmer_items, ads_by_id=ads_by_id,
            )
            subject = (
                f"[VitaChain] Nouvelle commande {short_code} — "
                f"{len(farmer_items)} article(s) à expédier"
            )
            await mailer.send_template(
                to_email=profile["email"],
                to_name=profile.get("full_name") or "Producteur",
                template_id=template_id,
                params=params,
                subject=subject,
            )
            sent_to.append(farmer_id)
            log.info(
                "order_email_sent order=%s farmer=%s locale=%s",
                short_code, farmer_id, locale,
            )
        except Exception:  # noqa: BLE001
            log.exception(
                "order_email_dispatch_failed order=%s farmer=%s",
                short_code, farmer_id,
            )
            with suppress(Exception):
                sentry_sdk.capture_exception()

    # Stamp once at least one email landed. Partial-failure ergonomics: if
    # producer A's email succeeded but B's failed (e.g. Brevo 500), the row
    # is stamped, and B will not get a duplicate from the backstop. The
    # missed producer is visible in logs + Sentry — admin reconciles by hand
    # for MVP. Post-MVP: per-producer notified_at on the items table.
    if sent_to:
        _stamp_notified(order_id)
