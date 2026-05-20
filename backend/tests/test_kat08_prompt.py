"""KAT-08 — Gemini prompt builder (FR baseline, locale dispatch + fallback)."""
from __future__ import annotations


def _parcel():
    return {
        "name": "Champ-Est",
        "crop_type": "tomato",
        "surface_area_ha": 1.25,
    }


def _owm():
    return {
        "list": [
            {
                "main": {"temp": 21.4, "humidity": 55, "temp_max": 28.0, "temp_min": 15.0},
                "weather": [{"description": "ciel dégagé"}],
                "rain": {"3h": 0.0},
            },
            {
                "main": {"temp": 22.1, "humidity": 60, "temp_max": 29.0, "temp_min": 16.0},
                "weather": [{"description": "ciel dégagé"}],
                "rain": {"3h": 1.2},
            },
        ],
    }


def _ndvi():
    return {"mean_ndvi": 0.74, "acquisition_date": "2026-05-14"}


def _sensor_full():
    return {
        "no_sensor_data": False,
        "sample_count":   672,
        "avg_moisture":   52.3,
        "avg_temperature": 22.1,
        "avg_ph":          6.8,
        "avg_ec":          1234,
        "avg_battery":     78,
    }


def test_fr_template_renders_all_five_metrics() -> None:
    from app.workers.katara_diagnostic.prompts import build_prompt

    out = build_prompt(
        parcel=_parcel(), owm=_owm(), ndvi=_ndvi(),
        sensor_7d=_sensor_full(), locale="fr",
    )
    assert "Champ-Est"               in out
    assert "tomato"                  in out
    assert "Humidité du sol"         in out
    assert "Température du sol"      in out
    assert "pH du sol"               in out
    assert "Conductivité (EC)"       in out
    assert "batterie capteur"        in out
    assert "NDVI moyen : 0.74"       in out
    assert "2026-05-14"              in out
    # Memory-drift guard — the SENSOR section must not relabel its rows back
    # to atmospheric metrics. The OWM section below it legitimately renders
    # atmospheric humidity ("Humidité moyenne de l'air"), which is a
    # different signal, so we partition the prompt before checking.
    sensor_block = out.split("## Météo", 1)[0].lower()
    for stale in (
        "humidité de l'air",
        "température de l'air",
        "humidité air",
        "température air",
    ):
        assert stale not in sensor_block, (
            f"stale label {stale!r} leaked into the sensor block"
        )


def test_no_sensor_data_branch_renders_french_fallback_copy() -> None:
    from app.workers.katara_diagnostic.prompts import build_prompt

    out = build_prompt(
        parcel=_parcel(), owm=_owm(), ndvi=_ndvi(),
        sensor_7d={"no_sensor_data": True}, locale="fr",
    )
    assert "Aucune donnée capteur disponible" in out
    # The sensor-section labels must NOT appear when no_sensor_data is True.
    assert "pH du sol moyen"       not in out
    assert "Conductivité (EC)"     not in out


def test_unsupported_locale_falls_back_to_fr() -> None:
    """PRD §7.2 — dar / zgh inherit FR at runtime."""
    from app.workers.katara_diagnostic.prompts import build_prompt

    out = build_prompt(
        parcel=_parcel(), owm=_owm(), ndvi=_ndvi(),
        sensor_7d=_sensor_full(), locale="zgh",
    )
    # FR-only phrases — proves the FR template rendered.
    assert "Réponds uniquement en français" in out


def test_missing_ar_template_falls_back_to_fr() -> None:
    """Defensive — I18N-06 may land AR / EN at different times."""
    from app.workers.katara_diagnostic.prompts import build_prompt

    out = build_prompt(
        parcel=_parcel(), owm=_owm(), ndvi=_ndvi(),
        sensor_7d=_sensor_full(), locale="ar",
    )
    # As long as I18N-06 has not shipped diagnostic_ar.j2 this will be the
    # FR fallback. When I18N-06 lands, this test should be flipped to assert
    # the AR-specific copy and the fallback is exercised by a dedicated
    # negative test.
    assert "Réponds uniquement en français" in out


def test_none_locale_falls_back_to_fr() -> None:
    from app.workers.katara_diagnostic.prompts import build_prompt

    out = build_prompt(
        parcel=_parcel(), owm=_owm(), ndvi=_ndvi(),
        sensor_7d=_sensor_full(), locale=None,
    )
    assert "Réponds uniquement en français" in out
