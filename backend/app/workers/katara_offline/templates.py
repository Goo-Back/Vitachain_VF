"""KAT-11 — locale catalogue + Brevo template id map.

Three locales for MVD per PRD §7.2: ``fr`` (P0), ``ar`` (P0), ``en`` (P1).
Darija / Tamazight (P2 / P3) inherit ``fr`` at runtime via
:data:`FALLBACK_LOCALE`.

Mirrors the shape of :mod:`app.workers.katara_threshold.templates` so
operators only learn the pattern once. The HTML body lives in the Brevo
dashboard; mirrors under ``infra/brevo-templates/kat11_offline_alert/``
exist for re-creation only.
"""
from __future__ import annotations

import os

FALLBACK_LOCALE = "fr"


def _int_env(name: str) -> int:
    raw = os.getenv(name, "")
    try:
        return int(raw) if raw else 0
    except ValueError:
        return 0


TEMPLATE_IDS: dict[str, int] = {
    "fr": _int_env("BREVO_TEMPLATE_KAT_OFFLINE_FR"),
    "ar": _int_env("BREVO_TEMPLATE_KAT_OFFLINE_AR"),
    "en": _int_env("BREVO_TEMPLATE_KAT_OFFLINE_EN"),
}


def resolve_locale(raw: str | None) -> str:
    """Return a locale present in :data:`TEMPLATE_IDS`, falling back to FR."""
    locale = (raw or FALLBACK_LOCALE).lower()
    if locale not in TEMPLATE_IDS:
        return FALLBACK_LOCALE
    return locale
