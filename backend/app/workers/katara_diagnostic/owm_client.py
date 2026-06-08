"""KAT-08 — OpenWeatherMap client with BR-K3 3-hour read-through cache.

Lat/lng are quantised to 0.01° (~1.1 km at this latitude) so neighbouring
parcels in the same village share a cache row. The quantisation grid is
finer than OWM's underlying ECMWF model resolution (~30 km), so we lose no
agronomic signal but multiply our free-tier call budget by the village
clustering factor.

Endpoint: ``GET /data/2.5/forecast`` — current conditions + 5-day forecast at
3-hour granularity. Free tier: 60 calls/min, 1 M calls/month — three orders
of magnitude over MVD demand.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import sentry_sdk

# JUSTIFICATION: cache table is service_role-only (no authenticated INSERT
# policy by design). AUTH-05 allow-list entry: workers/.
from app.db import service_client

log = logging.getLogger("katara_diagnostic.owm")

_OWM_URL  = "https://api.openweathermap.org/data/2.5/forecast"
_CACHE_TTL = timedelta(hours=3)
_HTTP_TIMEOUT_S = 10.0


def _quantise(coord: float) -> float:
    """Round to 2 decimal places (0.01° ≈ 1.1 km grid)."""
    return round(float(coord), 2)


def fetch_weather(lat: float, lng: float) -> dict[str, Any]:
    """Return the OWM forecast payload for ``(lat, lng)``.

    Cache-hit path: zero HTTP. Cache-miss path: one HTTP call + one cache
    upsert. Raises on OWM 4xx/5xx — the orchestrator catches and lands the
    row in FAILED with ``owm_unavailable``.
    """
    lat_q, lng_q = _quantise(lat), _quantise(lng)
    db = service_client()
    cached = (
        db.table("m1_katara_owm_cache")
        .select("data,fetched_at")
        .eq("lat_q", lat_q)
        .eq("lng_q", lng_q)
        .limit(1)
        .execute()
    )
    row = (cached.data or [None])[0]
    if row and _is_fresh(row["fetched_at"]):
        sentry_sdk.add_breadcrumb(category="owm", message="cache_hit")
        log.info("owm_cache_hit lat_q=%s lng_q=%s", lat_q, lng_q)
        return row["data"]

    sentry_sdk.add_breadcrumb(category="owm", message="cache_miss")
    log.info("owm_cache_miss lat_q=%s lng_q=%s", lat_q, lng_q)

    api_key = os.environ.get("OPENWEATHERMAP_API_KEY")
    if not api_key:
        # Raise a clear, catchable config error instead of a bare KeyError so
        # the /weather endpoint maps it to 502 (weather_upstream_unavailable)
        # rather than leaking an opaque 500.
        raise RuntimeError("OPENWEATHERMAP_API_KEY is not configured")
    resp = httpx.get(
        _OWM_URL,
        params={
            "lat":   lat,
            "lon":   lng,
            "appid": api_key,
            "units": "metric",
        },
        timeout=_HTTP_TIMEOUT_S,
    )
    resp.raise_for_status()
    data = resp.json()

    db.table("m1_katara_owm_cache").upsert(
        {
            "lat_q":      lat_q,
            "lng_q":      lng_q,
            "data":       data,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    ).execute()
    return data


def _is_fresh(fetched_at_iso: str | None) -> bool:
    if not fetched_at_iso:
        return False
    try:
        # Supabase returns ISO-8601 timestamptz, e.g. "2026-05-17T12:34:56+00:00"
        # or "2026-05-17T12:34:56.789Z" — handle both shapes.
        fetched_at = datetime.fromisoformat(fetched_at_iso.replace("Z", "+00:00"))
    except ValueError:
        return False
    return fetched_at > datetime.now(timezone.utc) - _CACHE_TTL
