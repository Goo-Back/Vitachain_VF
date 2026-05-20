"""KAT-09 — fetch diagnostic row, render Markdown, dispatch Brevo email.

Writes ``notified_at`` AFTER a Brevo 2xx — never before (mirrors KAT-06's
``last_alert_at`` discipline so a Brevo failure leaves the row eligible for
the backstop retry). The pre-send guard in step 1 filters on
``notified_at IS NULL`` so a concurrent worker that already won the race
returns 0 rows here and skips silently.
"""
from __future__ import annotations

import logging
import os
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import mistune
import sentry_sdk

# JUSTIFICATION: KAT-09 worker reads m1_katara_diagnostics + profiles +
# m1_katara_parcels for the Brevo payload and writes
# m1_katara_diagnostics.notified_at via the service-role DSN. The user JWT is
# not in scope here — the worker reacts to a system NOTIFY. AUTH-05
# allow-list entry: workers/katara_diagnostic_email/.
from app.db import service_client
from app.workers import mailer

log = logging.getLogger("katara_diagnostic_email.sender")

# PRD §7.2 — FR is the P0 baseline; AR/EN templates are stubs until I18N-06.
_FALLBACK_LOCALE = "fr"
_SUPPORTED_LOCALES = ("fr", "ar", "en")


def _template_ids() -> dict[str, int]:
    """Resolve Brevo template ids from env at call time (test-friendly)."""
    raw = {
        "fr": os.getenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR", "0") or "0",
        "ar": os.getenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR", "0") or "0",
        "en": os.getenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN", "0") or "0",
    }
    out: dict[str, int] = {}
    for loc, val in raw.items():
        try:
            out[loc] = int(val)
        except (TypeError, ValueError):
            out[loc] = 0
    return out


# mistune 3.x — pure-Python Markdown renderer. `escape=False` lets Gemini's
# emphasis/headings/lists pass through as HTML; result_text is system-
# generated (never user input) so the XSS surface is zero.
_md = mistune.create_markdown(escape=False, plugins=["strikethrough"])


def _resolve_template(locale: str | None) -> tuple[int, str]:
    """Return (template_id, resolved_locale). Falls back to FR per PRD §7.2."""
    candidates = _template_ids()
    loc = (locale or "").lower()
    if loc not in _SUPPORTED_LOCALES:
        loc = _FALLBACK_LOCALE
    tid = candidates.get(loc) or 0
    if not tid:
        # Locale-specific template not configured — fall back to FR.
        loc = _FALLBACK_LOCALE
        tid = candidates.get(_FALLBACK_LOCALE) or 0
    if not tid:
        raise mailer.MailerError(
            "BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR is not set — refusing to send"
        )
    return tid, loc


def _render_markdown(result_text: str | None) -> str:
    if not result_text:
        return ""
    rendered = _md(result_text)
    return rendered if isinstance(rendered, str) else str(rendered)


def _fetch_diagnostic(diagnostic_id: UUID) -> dict[str, Any] | None:
    """COMPLETED + notified_at IS NULL row, or None if already notified / missing."""
    db = service_client()
    res = (
        db.table("m1_katara_diagnostics")
        .select("id,farmer_id,parcel_id,result_text,notified_at,status")
        .eq("id", str(diagnostic_id))
        .eq("status", "COMPLETED")
        .is_("notified_at", "null")
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_profile(farmer_id: str) -> dict[str, Any]:
    db = service_client()
    res = (
        db.table("profiles")
        .select("email,locale,full_name")
        .eq("id", farmer_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else {}


def _fetch_parcel_name(parcel_id: str) -> str:
    db = service_client()
    res = (
        db.table("m1_katara_parcels")
        .select("name")
        .eq("id", parcel_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return (rows[0].get("name") if rows else None) or "—"


def _mark_notified(diagnostic_id: UUID) -> int:
    """Stamp notified_at = now() — filtered on notified_at IS NULL.

    Returns the number of rows affected (0 if a concurrent worker beat us).
    """
    db = service_client()
    res = (
        db.table("m1_katara_diagnostics")
        .update({"notified_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", str(diagnostic_id))
        .is_("notified_at", "null")
        .execute()
    )
    return len(res.data or [])


async def send_diagnostic_email(diagnostic_id: UUID) -> None:
    """End-to-end send for one diagnostic.

    Never raises on the happy path. Brevo / DB errors surface to the caller
    (the listener consumer's last-resort try/except) so they get Sentry-
    captured and the row stays eligible for the backstop retry — exactly the
    KAT-06 ``last_alert_at`` discipline.
    """
    # 1. Fetch the diagnostic — pre-send guard for notified_at IS NULL.
    diag = _fetch_diagnostic(diagnostic_id)
    if diag is None:
        log.info(
            "sender_skip_already_notified_or_not_found id=%s",
            str(diagnostic_id),
        )
        return

    # 2. Profile (email + locale).
    farmer_id = diag.get("farmer_id")
    if not farmer_id:
        log.warning("sender_missing_farmer_id id=%s", str(diagnostic_id))
        return
    profile = _fetch_profile(str(farmer_id))
    email = (profile.get("email") or "").strip()
    if not email:
        log.warning(
            "sender_no_email id=%s farmer_id=%s",
            str(diagnostic_id), str(farmer_id),
        )
        return
    locale_raw = profile.get("locale")

    # 3. Parcel name.
    parcel_id = diag.get("parcel_id")
    parcel_name = _fetch_parcel_name(str(parcel_id)) if parcel_id else "—"

    # 4. Render Markdown → HTML.
    result_html = _render_markdown(diag.get("result_text"))

    # 5. Resolve template + dispatch via NOT-01 mailer.
    template_id, locale = _resolve_template(locale_raw)
    params = {
        "farmer_name":   profile.get("full_name") or "",
        "parcel_name":   parcel_name,
        "result_html":   result_html,
        "diagnostic_id": str(diagnostic_id),
    }

    await mailer.send_template(
        to=email,
        template_id=template_id,
        params=params,
        locale=locale,
    )
    with suppress(Exception):
        sentry_sdk.add_breadcrumb(
            category="kat09",
            message="diagnostic_email_sent",
            data={"id": str(diagnostic_id), "locale": locale},
        )

    # 6. Stamp notified_at — idempotency anchor for the backstop.
    affected = _mark_notified(diagnostic_id)
    log.info(
        "diagnostic_email_sent id=%s locale=%s notified_rows=%d",
        str(diagnostic_id), locale, affected,
    )
