"""FAR-04 — strip identifier-shaped strings from free-text resto input.

This is belt-and-suspenders for the BR-F5 anonymisation guarantee. The
restaurant policy in FAR-03 already tells operators not to write contact
info into ``delivery_notes``, but resto staff are humans. Before the worker
forwards the text into a Brevo email body destined for a producer, it
regex-redacts known email and Moroccan-phone patterns so the producer never
sees them.

The patterns are intentionally conservative — false positives (e.g. a
6-digit postal-style string getting redacted because it matches our
permissive regex) are preferable to a leaked phone number.
"""
from __future__ import annotations

import re

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(
    r"(?:\+212|00212)\s?\d{9}"      # international form
    r"|"
    r"\b0[5-7]\d{8}\b"              # local Moroccan mobile / landline
)


def redact_contact_info(text: str | None) -> str | None:
    """Return ``text`` with email and Moroccan phone patterns replaced.

    Returns ``None`` if the input is ``None`` or whitespace-only.
    """
    if text is None:
        return None
    stripped = text.strip()
    if not stripped:
        return None
    redacted = _EMAIL_RE.sub("[email redacted]", stripped)
    redacted = _PHONE_RE.sub("[phone redacted]", redacted)
    return redacted
