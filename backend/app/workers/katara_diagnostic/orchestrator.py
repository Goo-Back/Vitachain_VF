"""KAT-08 — sequential gather + Gemini call + terminal state UPDATE.

Strict failure semantics: every exception lands the row in FAILED with a
prefixed ``error_detail`` (see §6.5 of the story for the taxonomy).
Nothing escapes this function unhandled; nothing leaves a row stuck in
PROCESSING. The orchestrator is deliberately **sequential** — Gemini's call
dominates the latency budget (~5-15 s), so the saving from concurrent
OWM / Sentinel / aggregate would be a sub-100 ms tail at the cost of
harder failure-mode reasoning.

Centroid resolution: KAT-01 stores ``geojson`` only — we derive the polygon
centroid client-side (simple vertex average; good enough for OWM's ~30 km
model resolution). A future migration adding ``centroid_lat`` /
``centroid_lng`` columns slots in via :func:`_pick_centroid` without
touching the rest of the orchestrator.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

import sentry_sdk

# JUSTIFICATION: parcel + profile reads via service_role. Both are also
# readable under a user JWT (RLS owner policies), but the worker has no user
# JWT in scope — it's reacting to a system NOTIFY. AUTH-05 allow-list entry:
# workers/.
from app.db import service_client
from app.workers.katara_diagnostic.gemini_client import (
    GeminiRateLimited,
    GeminiUnavailable,
    call_gemini,
)
from app.workers.katara_diagnostic.owm_client import fetch_weather
from app.workers.katara_diagnostic.prompts import build_prompt
from app.workers.katara_diagnostic.sentinel_client import fetch_ndvi
from app.workers.katara_diagnostic.telemetry_aggregator import fetch_7d_average
from app.workers.katara_diagnostic.updater import mark_completed, mark_failed

log = logging.getLogger("katara_diagnostic.orchestrator")


async def run_diagnostic(claimed_row: dict[str, Any]) -> None:
    """End-to-end pipeline for one claimed PROCESSING row.

    Never raises. Logs + Sentry-captures any unexpected exception and lands
    the row in FAILED via :func:`mark_failed`.
    """
    diag_id   = UUID(str(claimed_row["id"]))
    parcel_id = UUID(str(claimed_row["parcel_id"]))
    farmer_id = UUID(str(claimed_row["farmer_id"]))

    try:
        parcel = _fetch_parcel(parcel_id)
        if not parcel:
            mark_failed(diag_id, "parcel_not_found")
            return

        centroid = _pick_centroid(parcel)
        if centroid is None:
            mark_failed(diag_id, "parcel_missing_centroid")
            return
        lat, lng = centroid

        locale = _fetch_locale(farmer_id)

        # ----- OWM ----------------------------------------------------------
        try:
            owm = await asyncio.to_thread(fetch_weather, lat, lng)
        except Exception as exc:  # noqa: BLE001 — taxonomied below
            sentry_sdk.capture_exception(exc)
            log.exception("owm_unavailable id=%s", str(diag_id))
            mark_failed(diag_id, f"owm_unavailable: {exc!r}")
            return

        # ----- NDVI ---------------------------------------------------------
        try:
            ndvi = await asyncio.to_thread(
                fetch_ndvi, parcel_id, parcel.get("geojson") or {}
            )
        except Exception as exc:  # noqa: BLE001
            sentry_sdk.capture_exception(exc)
            log.exception("ndvi_unavailable id=%s", str(diag_id))
            mark_failed(diag_id, f"ndvi_unavailable: {exc!r}")
            return

        # ----- 7-day aggregate ---------------------------------------------
        try:
            sensor_7d = await asyncio.to_thread(fetch_7d_average, parcel_id)
        except Exception as exc:  # noqa: BLE001
            sentry_sdk.capture_exception(exc)
            log.exception("aggregator_failed id=%s", str(diag_id))
            mark_failed(diag_id, f"aggregator_failed: {exc!r}")
            return

        # ----- prompt build ------------------------------------------------
        try:
            prompt = build_prompt(
                parcel=parcel,
                owm=owm,
                ndvi=ndvi,
                sensor_7d=sensor_7d,
                locale=locale,
            )
        except Exception as exc:  # noqa: BLE001
            sentry_sdk.capture_exception(exc)
            log.exception("prompt_build_failed id=%s", str(diag_id))
            mark_failed(diag_id, f"prompt_build_failed: {exc!r}")
            return

        # ----- Gemini ------------------------------------------------------
        try:
            result_text = await call_gemini(prompt)
        except GeminiRateLimited as exc:
            sentry_sdk.capture_exception(exc)
            mark_failed(diag_id, f"gemini_rate_limited: {exc!r}")
            return
        except GeminiUnavailable as exc:
            sentry_sdk.capture_exception(exc)
            mark_failed(diag_id, f"gemini_unavailable: {exc!r}")
            return
        except Exception as exc:  # noqa: BLE001 — taxonomy
            sentry_sdk.capture_exception(exc)
            log.exception("gemini_failed id=%s", str(diag_id))
            mark_failed(diag_id, f"gemini_failed: {exc!r}")
            return

        if not result_text:
            mark_failed(diag_id, "gemini_empty_response")
            return

        mark_completed(diag_id, result_text)
        log.info(
            "diagnostic_completed id=%s parcel_id=%s locale=%s "
            "result_len=%d sensor_7d=%s",
            str(diag_id), str(parcel_id), locale,
            len(result_text),
            "no_data" if sensor_7d.get("no_sensor_data") else "ok",
        )

    except Exception as exc:  # noqa: BLE001 — last-resort guard
        sentry_sdk.capture_exception(exc)
        log.exception("orchestrator_unexpected id=%s", str(diag_id))
        # Best-effort terminal land — if mark_failed itself raises, Sentry
        # already has the original; we let it bubble to the consumer's
        # last-resort try/except in the listener.
        mark_failed(diag_id, f"orchestrator_unexpected: {exc!r}")


def _fetch_parcel(parcel_id: UUID) -> dict[str, Any] | None:
    db = service_client()
    res = (
        db.table("m1_katara_parcels")
        .select("id,name,crop_type,surface_area_ha,geojson")
        .eq("id", str(parcel_id))
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_locale(farmer_id: UUID) -> str:
    db = service_client()
    res = (
        db.table("profiles")
        .select("locale")
        .eq("id", str(farmer_id))
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return (rows[0].get("locale") if rows else None) or "fr"


def _pick_centroid(parcel: dict[str, Any]) -> tuple[float, float] | None:
    """Resolve the parcel centroid (lat, lng).

    Order of preference:
      1. ``centroid_lat`` / ``centroid_lng`` columns if they exist on the row
         (post-MVD migration anticipated by the story).
      2. Vertex-average centroid computed from ``geojson``. Good enough for
         OWM's coarse model resolution.
    """
    lat = parcel.get("centroid_lat")
    lng = parcel.get("centroid_lng")
    if lat is not None and lng is not None:
        try:
            return float(lat), float(lng)
        except (TypeError, ValueError):
            return None

    geojson = parcel.get("geojson")
    return _polygon_centroid(geojson) if isinstance(geojson, dict) else None


def _polygon_centroid(geojson: dict[str, Any]) -> tuple[float, float] | None:
    """Average vertex centroid for the first polygon ring.

    Accepts the three KAT-01 geojson shapes (raw Polygon, raw MultiPolygon,
    Feature wrapping either). The polygon-ring vertex average is a fast,
    dependency-free approximation that is well within OWM's ~30 km grid.
    """
    if geojson.get("type") == "Feature":
        geom = geojson.get("geometry") or {}
    else:
        geom = geojson

    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not isinstance(coords, list) or not coords:
        return None

    if gtype == "Polygon":
        ring = coords[0]
    elif gtype == "MultiPolygon":
        first_poly = coords[0]
        if not isinstance(first_poly, list) or not first_poly:
            return None
        ring = first_poly[0]
    else:
        return None

    if not isinstance(ring, list) or len(ring) < 3:
        return None

    # GeoJSON closes the ring by repeating the first vertex; drop the duplicate.
    cleaned = ring[:-1] if ring[0] == ring[-1] and len(ring) > 1 else ring
    try:
        lngs = [float(pt[0]) for pt in cleaned]
        lats = [float(pt[1]) for pt in cleaned]
    except (IndexError, TypeError, ValueError):
        return None
    if not lats or not lngs:
        return None
    return sum(lats) / len(lats), sum(lngs) / len(lngs)
