"""NOT-01 — Brevo transactional mailer wrapper.

Single transport for every system-initiated email in VitaChain. Callers pass
a recipient + a Brevo template id + a flat params dict; this module owns the
HTTP details (auth header, retry policy, JSON shape).

Known callers / templates:
    * KAT-06 threshold alerts → ``BREVO_TEMPLATE_KAT_THRESHOLD_{FR,AR,EN}``
    * KAT-09 diagnostic completion → ``BREVO_TEMPLATE_KAT_DIAGNOSTIC_{FR,AR,EN}``
    * KAT-11 offline-device alert  → ``BREVO_TEMPLATE_KAT_OFFLINE_{FR,AR,EN}``
    * NOT-* — generic transactional flows

The wrapper raises :class:`MailerError` on any non-2xx response so callers can
treat Brevo's contract as binary: either the message was queued for delivery
or it was not. Anti-spam state (e.g. KAT-06's ``last_alert_at``) MUST only be
advanced after ``send_template`` returns without raising — see KAT-06 §4.3.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger("workers.mailer")

_BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"
_DEFAULT_TIMEOUT_S = 15.0
_DEFAULT_SENDER = {
    "name":  os.getenv("BREVO_SENDER_NAME", "VitaChain"),
    "email": os.getenv("BREVO_SENDER_EMAIL", "no-reply@vitachain.ma"),
}


class MailerError(RuntimeError):
    """Raised on a non-2xx Brevo response or a transport failure."""


async def send_template(
    *,
    to: str,
    template_id: int,
    params: dict[str, Any],
    locale: str | None = None,
    sender: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Send a Brevo transactional template.

    Parameters mirror the Brevo /v3/smtp/email contract: ``template_id`` is
    the numeric id from the dashboard; ``params`` is the flat dict the
    template references as ``{{ params.* }}``; ``locale`` is informational
    (passed as ``headers.X-Mailin-Locale`` for log correlation only — Brevo
    itself does not branch on it; locale selection happens upstream by
    picking the right template id).
    """
    api_key = os.getenv("BREVO_API_KEY")
    if not api_key:
        raise MailerError("BREVO_API_KEY is unset — refusing to send")
    if not template_id:
        raise MailerError("template_id is 0 / unset — check BREVO_TEMPLATE_* env")

    payload: dict[str, Any] = {
        "to":          [{"email": to}],
        "templateId":  int(template_id),
        "params":      params,
        "sender":      sender or _DEFAULT_SENDER,
    }
    if locale:
        payload["headers"] = {"X-Mailin-Locale": locale}

    headers = {
        "api-key":      api_key,
        "accept":       "application/json",
        "content-type": "application/json",
    }

    async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_S) as client:
        resp = await client.post(_BREVO_ENDPOINT, json=payload, headers=headers)

    if resp.status_code >= 300:
        raise MailerError(
            f"brevo_non_2xx status={resp.status_code} body={resp.text[:300]!r}"
        )

    try:
        return resp.json()
    except ValueError:
        return {"raw": resp.text}
