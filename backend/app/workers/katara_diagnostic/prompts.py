"""KAT-08 — locale-aware Gemini prompt builder.

P0 baseline is French (PRD §7.2). The dispatch already understands ``fr / ar
/ en``; this story ships the FR template only. AR + EN drop in via I18N-06
without touching this module — the template loader checks for the localised
file and falls back to FR when missing. Darija / Tamazight (``dar`` / ``zgh``)
are P2 / P3, also fall back to FR.

Templates live in :file:`templates/diagnostic_<locale>.j2` next to this
module; ``autoescape`` is enabled defensively even though the Gemini prompt
is a text channel — a stray ``<script>`` in the data path would surface as a
prompt-injection vector otherwise.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, TemplateNotFound, select_autoescape

log = logging.getLogger("katara_diagnostic.prompts")

_TEMPLATE_DIR = Path(__file__).parent / "templates"
_FALLBACK_LOCALE = "fr"
_SUPPORTED = {"fr", "ar", "en"}  # ar / en land in I18N-06; fr ships in KAT-08.

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(enabled_extensions=("j2",)),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _resolve_locale(locale: str | None) -> str:
    """Normalise to a supported locale; everything else falls back to FR."""
    if not locale:
        return _FALLBACK_LOCALE
    code = locale.strip().lower().split("-", 1)[0]
    return code if code in _SUPPORTED else _FALLBACK_LOCALE


def build_prompt(
    *,
    parcel: dict[str, Any],
    owm: dict[str, Any],
    ndvi: dict[str, Any],
    sensor_7d: dict[str, Any],
    locale: str | None,
) -> str:
    """Render the Gemini prompt as Markdown-ready plain text.

    Always returns a non-empty string. Unsupported locales fall back to FR;
    missing template files also fall back to FR (defensive — I18N-06 may
    land AR / EN at different times). Raises ``TemplateNotFound`` only if
    the FR file itself is missing, which is a packaging bug.
    """
    resolved = _resolve_locale(locale)
    template_name = f"diagnostic_{resolved}.j2"
    try:
        template = _env.get_template(template_name)
    except TemplateNotFound:
        log.warning(
            "prompt_template_missing locale=%s falling_back_to=%s",
            resolved, _FALLBACK_LOCALE,
        )
        template = _env.get_template(f"diagnostic_{_FALLBACK_LOCALE}.j2")

    return template.render(
        parcel=parcel,
        owm=owm,
        ndvi=ndvi,
        sensor_7d=sensor_7d,
    )
