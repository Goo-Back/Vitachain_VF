"""KAT-08 — orchestrator failure-mode taxonomy.

Each test pins one row of the §6.5 error table: the orchestrator must land
the diagnostic in FAILED with the documented ``error_detail`` prefix, never
leave a row stuck in PROCESSING, and never raise.
"""
from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import pytest


def _claimed(parcel_id, farmer_id):
    return {
        "id":        str(uuid4()),
        "parcel_id": str(parcel_id),
        "farmer_id": str(farmer_id),
        "status":    "PROCESSING",
    }


def _parcel_with_polygon():
    return {
        "id": str(uuid4()),
        "name": "Test Parcel",
        "crop_type": "tomato",
        "surface_area_ha": 1.0,
        "geojson": {
            "type": "Polygon",
            "coordinates": [[[-7.61, 33.59], [-7.60, 33.59],
                             [-7.60, 33.60], [-7.61, 33.60], [-7.61, 33.59]]],
        },
    }


def _parcel_no_centroid():
    return {
        "id": str(uuid4()),
        "name": "Bad Parcel",
        "crop_type": "tomato",
        "surface_area_ha": 1.0,
        "geojson": {"type": "Polygon", "coordinates": []},  # no usable ring
    }


def _patches(
    *,
    parcel: dict[str, Any] | None,
    locale: str = "fr",
    fetch_weather_side: Any = None,
    fetch_ndvi_side:    Any = None,
    fetch_7d_side:      Any = None,
    call_gemini_side:   Any = None,
    completed_calls: list,
    failed_calls: list,
):
    """Install all the side-effect patches the orchestrator depends on."""
    from app.workers.katara_diagnostic import orchestrator

    def _mark_completed(diag_id, text):
        completed_calls.append((diag_id, text))

    def _mark_failed(diag_id, detail):
        failed_calls.append((diag_id, detail))

    cm = []
    cm.append(patch.object(orchestrator, "_fetch_parcel", return_value=parcel))
    cm.append(patch.object(orchestrator, "_fetch_locale", return_value=locale))

    def _side(value):
        if callable(value):
            return value
        if isinstance(value, Exception):
            def _raise(*a, **k): raise value  # noqa: E306
            return _raise
        return lambda *a, **k: value

    cm.append(patch.object(orchestrator, "fetch_weather",
                           side_effect=_side(fetch_weather_side)))
    cm.append(patch.object(orchestrator, "fetch_ndvi",
                           side_effect=_side(fetch_ndvi_side)))
    cm.append(patch.object(orchestrator, "fetch_7d_average",
                           side_effect=_side(fetch_7d_side)))

    async def _gemini(prompt):
        if isinstance(call_gemini_side, Exception):
            raise call_gemini_side
        if callable(call_gemini_side):
            return call_gemini_side(prompt)
        return call_gemini_side

    cm.append(patch.object(orchestrator, "call_gemini", _gemini))
    cm.append(patch.object(orchestrator, "mark_completed", _mark_completed))
    cm.append(patch.object(orchestrator, "mark_failed",    _mark_failed))
    return cm


def _enter(patches):
    """Enter all context managers; return the list so callers can stop()."""
    for p in patches:
        p.start()


def _exit(patches):
    for p in patches:
        p.stop()


def _run(claimed):
    from app.workers.katara_diagnostic.orchestrator import run_diagnostic
    asyncio.run(run_diagnostic(claimed))


# ---------------------------------------------------------------------------
# Or1 — happy path
# ---------------------------------------------------------------------------
def test_happy_path_lands_completed() -> None:
    completed, failed = [], []
    patches = _patches(
        parcel=_parcel_with_polygon(),
        fetch_weather_side={"list": [{"main": {"temp": 22, "humidity": 55,
                                                "temp_max": 28, "temp_min": 15},
                                       "weather": [{"description": "ok"}],
                                       "rain": {"3h": 0.0}}]},
        fetch_ndvi_side={"mean_ndvi": 0.74, "acquisition_date": "2026-05-14"},
        fetch_7d_side={"no_sensor_data": True},
        call_gemini_side="## Diagnostic\nOK",
        completed_calls=completed, failed_calls=failed,
    )
    _enter(patches)
    try:
        _run(_claimed(uuid4(), uuid4()))
    finally:
        _exit(patches)
    assert failed == []
    assert len(completed) == 1
    assert "Diagnostic" in completed[0][1]


# ---------------------------------------------------------------------------
# Or2 — OWM 503
# ---------------------------------------------------------------------------
def test_owm_503_lands_failed_with_owm_unavailable() -> None:
    completed, failed = [], []
    patches = _patches(
        parcel=_parcel_with_polygon(),
        fetch_weather_side=RuntimeError("HTTP 503 from OWM"),
        completed_calls=completed, failed_calls=failed,
    )
    _enter(patches)
    try:
        _run(_claimed(uuid4(), uuid4()))
    finally:
        _exit(patches)
    assert completed == []
    assert len(failed) == 1
    assert failed[0][1].startswith("owm_unavailable")


# ---------------------------------------------------------------------------
# Or3 — Sentinel error
# ---------------------------------------------------------------------------
def test_sentinel_error_lands_failed_with_ndvi_unavailable() -> None:
    completed, failed = [], []
    patches = _patches(
        parcel=_parcel_with_polygon(),
        fetch_weather_side={"list": [{"main": {"temp": 22, "humidity": 55,
                                                "temp_max": 28, "temp_min": 15},
                                       "weather": [{"description": "ok"}],
                                       "rain": {"3h": 0.0}}]},
        fetch_ndvi_side=RuntimeError("sentinel auth failure"),
        completed_calls=completed, failed_calls=failed,
    )
    _enter(patches)
    try:
        _run(_claimed(uuid4(), uuid4()))
    finally:
        _exit(patches)
    assert completed == []
    assert failed[0][1].startswith("ndvi_unavailable")


# ---------------------------------------------------------------------------
# Or4 — Gemini ResourceExhausted after retries
# ---------------------------------------------------------------------------
def test_gemini_rate_limited_lands_failed() -> None:
    from app.workers.katara_diagnostic.gemini_client import GeminiRateLimited

    completed, failed = [], []
    patches = _patches(
        parcel=_parcel_with_polygon(),
        fetch_weather_side={"list": [{"main": {"temp": 22, "humidity": 55,
                                                "temp_max": 28, "temp_min": 15},
                                       "weather": [{"description": "ok"}],
                                       "rain": {"3h": 0.0}}]},
        fetch_ndvi_side={"mean_ndvi": 0.5, "acquisition_date": "2026-05-14"},
        fetch_7d_side={"no_sensor_data": True},
        call_gemini_side=GeminiRateLimited("429"),
        completed_calls=completed, failed_calls=failed,
    )
    _enter(patches)
    try:
        _run(_claimed(uuid4(), uuid4()))
    finally:
        _exit(patches)
    assert completed == []
    assert failed[0][1].startswith("gemini_rate_limited")


# ---------------------------------------------------------------------------
# Or5 — Gemini empty response
# ---------------------------------------------------------------------------
def test_gemini_empty_response_lands_failed() -> None:
    completed, failed = [], []
    patches = _patches(
        parcel=_parcel_with_polygon(),
        fetch_weather_side={"list": [{"main": {"temp": 22, "humidity": 55,
                                                "temp_max": 28, "temp_min": 15},
                                       "weather": [{"description": "ok"}],
                                       "rain": {"3h": 0.0}}]},
        fetch_ndvi_side={"mean_ndvi": 0.5, "acquisition_date": "2026-05-14"},
        fetch_7d_side={"no_sensor_data": True},
        call_gemini_side="",
        completed_calls=completed, failed_calls=failed,
    )
    _enter(patches)
    try:
        _run(_claimed(uuid4(), uuid4()))
    finally:
        _exit(patches)
    assert completed == []
    assert failed[0][1] == "gemini_empty_response"


# ---------------------------------------------------------------------------
# Or6 — parcel missing centroid (no usable polygon)
# ---------------------------------------------------------------------------
def test_parcel_missing_centroid_lands_failed_without_calls() -> None:
    completed, failed = [], []
    sentinels = {"owm": 0, "ndvi": 0, "gem": 0}

    def _no_owm(*a, **k):
        sentinels["owm"] += 1
        raise AssertionError("owm must not be called when centroid is missing")

    def _no_ndvi(*a, **k):
        sentinels["ndvi"] += 1
        raise AssertionError("ndvi must not be called when centroid is missing")

    async def _no_gem(prompt):
        sentinels["gem"] += 1
        raise AssertionError("gemini must not be called when centroid is missing")

    from app.workers.katara_diagnostic import orchestrator
    patches = [
        patch.object(orchestrator, "_fetch_parcel", return_value=_parcel_no_centroid()),
        patch.object(orchestrator, "_fetch_locale", return_value="fr"),
        patch.object(orchestrator, "fetch_weather",    side_effect=_no_owm),
        patch.object(orchestrator, "fetch_ndvi",       side_effect=_no_ndvi),
        patch.object(orchestrator, "fetch_7d_average", side_effect=_no_ndvi),
        patch.object(orchestrator, "call_gemini",      _no_gem),
        patch.object(orchestrator, "mark_completed",
                     lambda d, t: completed.append((d, t))),
        patch.object(orchestrator, "mark_failed",
                     lambda d, m: failed.append((d, m))),
    ]
    _enter(patches)
    try:
        _run(_claimed(uuid4(), uuid4()))
    finally:
        _exit(patches)

    assert completed == []
    assert failed[0][1] == "parcel_missing_centroid"
    assert sentinels == {"owm": 0, "ndvi": 0, "gem": 0}


# ---------------------------------------------------------------------------
# Or7 — parcel not found in DB
# ---------------------------------------------------------------------------
def test_parcel_not_found_lands_failed() -> None:
    completed, failed = [], []
    patches = _patches(
        parcel=None,
        completed_calls=completed, failed_calls=failed,
    )
    _enter(patches)
    try:
        _run(_claimed(uuid4(), uuid4()))
    finally:
        _exit(patches)
    assert completed == []
    assert failed[0][1] == "parcel_not_found"


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
