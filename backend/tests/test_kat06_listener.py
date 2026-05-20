"""KAT-06 — listener unit tests.

Pure unit coverage of the payload parser + locale resolver. The full LISTEN
round-trip lives behind ``KAT06_E2E=1`` in
:mod:`tests.test_kat06_listener_e2e` (requires a staging Postgres + Brevo).
"""
from __future__ import annotations

import uuid

from app.workers.katara_threshold.listener import _parse_payload
from app.workers.katara_threshold.templates import resolve_locale


class TestParsePayload:
    def test_parses_well_formed_payload(self) -> None:
        dev, tel = uuid.uuid4(), uuid.uuid4()
        parsed = _parse_payload(f"{dev}|{tel}")
        assert parsed == (dev, tel)

    def test_returns_none_on_missing_separator(self) -> None:
        assert _parse_payload("not-a-uuid") is None

    def test_returns_none_on_non_uuid_halves(self) -> None:
        assert _parse_payload("garbage|alsogarbage") is None

    def test_returns_none_on_empty_string(self) -> None:
        assert _parse_payload("") is None

    def test_returns_none_on_none(self) -> None:
        assert _parse_payload(None) is None


class TestResolveLocale:
    def test_known_locale_passthrough(self) -> None:
        assert resolve_locale("fr") == "fr"
        assert resolve_locale("ar") == "ar"
        assert resolve_locale("en") == "en"

    def test_case_insensitive(self) -> None:
        assert resolve_locale("FR") == "fr"
        assert resolve_locale("Ar") == "ar"

    def test_unknown_locale_falls_back_to_fr(self) -> None:
        assert resolve_locale("dar") == "fr"
        assert resolve_locale("zh") == "fr"

    def test_none_falls_back_to_fr(self) -> None:
        assert resolve_locale(None) == "fr"
