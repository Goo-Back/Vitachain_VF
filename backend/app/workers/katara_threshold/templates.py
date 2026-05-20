"""KAT-06 — locale catalogue + Brevo template id map.

Three locales for MVD per PRD §7.2: ``fr`` (P0), ``ar`` (P0), ``en`` (P1).
Darija / Tamazight (P2 / P3) inherit ``fr`` at runtime via :data:`FALLBACK_LOCALE`.

The HTML body lives in the Brevo dashboard; mirrors under
``infra/brevo-templates/kat06_threshold_alert/`` exist for re-creation only.
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
    "fr": _int_env("BREVO_TEMPLATE_KAT_THRESHOLD_FR"),
    "ar": _int_env("BREVO_TEMPLATE_KAT_THRESHOLD_AR"),
    "en": _int_env("BREVO_TEMPLATE_KAT_THRESHOLD_EN"),
}

LOCALISED_LABELS: dict[str, dict[str, str]] = {
    "fr": {
        "soil_moisture":     "Humidité du sol",
        "soil_temperature":  "Température du sol",
        "soil_ph":           "pH du sol",
        "soil_conductivity": "Conductivité du sol",
        "battery_level":     "Niveau de batterie",
    },
    "ar": {
        "soil_moisture":     "رطوبة التربة",
        "soil_temperature":  "درجة حرارة التربة",
        "soil_ph":           "حموضة التربة",
        "soil_conductivity": "ناقلية التربة",
        "battery_level":     "مستوى البطارية",
    },
    "en": {
        "soil_moisture":     "Soil moisture",
        "soil_temperature":  "Soil temperature",
        "soil_ph":           "Soil pH",
        "soil_conductivity": "Soil conductivity",
        "battery_level":     "Battery level",
    },
}

LOCALISED_UNITS: dict[str, str] = {
    "soil_moisture":     "%",
    "soil_temperature":  "°C",
    "soil_ph":           "",
    "soil_conductivity": "µS/cm",
    "battery_level":     "%",
}


def resolve_locale(raw: str | None) -> str:
    """Return a locale present in :data:`TEMPLATE_IDS`, falling back to FR."""
    locale = (raw or FALLBACK_LOCALE).lower()
    if locale not in LOCALISED_LABELS:
        return FALLBACK_LOCALE
    return locale
