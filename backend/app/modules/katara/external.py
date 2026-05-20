"""Parcel-scoped proxies over OpenWeatherMap and Sentinel Hub.

These two endpoints are the *only* surface the frontend uses to read weather
and NDVI data for a parcel. The actual API keys never leave the backend
container (AUTH-05) — the frontend treats this endpoint like any other
``/katara/parcels/{id}/*`` route.

Reuses the cached clients shipped for KAT-08:
  - :func:`app.workers.katara_diagnostic.owm_client.fetch_weather` — 3 h cache
  - :func:`app.workers.katara_diagnostic.sentinel_client.fetch_ndvi`       — 12 h cache
  - :func:`app.workers.katara_diagnostic.sentinel_client.fetch_ndvi_image` — uncached
    (a 512×512 PNG is too large to keep in the postgres NDVI cache table;
    two repeat hits cost two PUs which is acceptable for a hand-driven page).

Auth posture: the user-JWT client is used so RLS on
``m1_katara_parcels`` filters by ``farmer_id = auth.uid()`` — a parcel the
caller does not own is a 404. We never bounce off the service role here,
even though the worker does (the worker reads via service role because the
caches it writes are service-role-only by design — see AUTH-05 allow-list).
"""

from __future__ import annotations

import logging
from base64 import b64encode
from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.core.security import AuthUser, get_current_user, get_db_for_user
from app.modules.katara.schemas import (
    NdviResponse,
    WeatherCurrent,
    WeatherDaily,
    WeatherHourly,
    WeatherIconKind,
    WeatherResponse,
)
from app.workers.katara_diagnostic import owm_client, sentinel_client

# Mounted under /katara/parcels/{parcel_id}; the prefix matches the
# telemetry / thresholds / diagnostics routers so the path family stays
# discoverable from the OpenAPI sidebar.
router = APIRouter(
    prefix="/katara/parcels/{parcel_id}",
    tags=["katara"],
)

log = logging.getLogger("katara.external")

_PARCELS_TABLE = "m1_katara_parcels"

# Cache-Control: weather is allowed to be a couple of minutes stale on the
# wire even though the upstream cache TTL is much longer; the dashboard
# repaints often and we want the SSR fetch to hit the postgres cache rather
# than the browser cache the moment a farmer navigates between parcels.
_WEATHER_CACHE_CONTROL = "private, max-age=60"
_NDVI_CACHE_CONTROL = "private, max-age=300"


def _load_parcel(parcel_id: UUID, db: Client, user: AuthUser) -> dict[str, Any]:
    """Fetch the parcel row scoped to the caller's RLS context.

    Returns the raw row dict (with ``geojson``). Raises 404 if the parcel
    doesn't exist or isn't visible to the caller — never 403, so we don't
    leak existence of someone else's parcels.
    """
    res = (
        db.table(_PARCELS_TABLE)
        .select("id, geojson, name")
        .eq("id", str(parcel_id))
        .eq("farmer_id", str(user.id))
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="parcel_not_found",
        )
    return rows[0]


def _centroid(geojson: dict[str, Any]) -> tuple[float, float]:
    """Return ``(lat, lng)`` averaged over every ring vertex of the polygon.

    Not a true centroid (no area weighting) but it's robust to MultiPolygon
    holes, runs in microseconds, and the result is within ~tens of metres
    of the true centroid for the parcel sizes we're dealing with (< 50 ha).
    """
    geom = geojson
    if geom.get("type") == "Feature":
        geom = geom.get("geometry") or {}
    if geom.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("polygon_type_unsupported")

    coords: list[tuple[float, float]] = []
    if geom["type"] == "Polygon":
        for ring in geom.get("coordinates") or []:
            for c in ring:
                coords.append((c[1], c[0]))  # GeoJSON is lon,lat → reorder to lat,lng
    else:  # MultiPolygon
        for poly in geom.get("coordinates") or []:
            for ring in poly:
                for c in ring:
                    coords.append((c[1], c[0]))

    if not coords:
        raise ValueError("polygon_no_coordinates")
    lat = sum(c[0] for c in coords) / len(coords)
    lng = sum(c[1] for c in coords) / len(coords)
    return lat, lng


# ---------------------------------------------------------------------------
# OWM mapping helpers
# ---------------------------------------------------------------------------

def _icon_kind(owm_icon: str | None) -> WeatherIconKind:
    """Project OWM's 11-icon scheme to our 6-kind UI glyph set."""
    if not owm_icon:
        return "cloud"
    if owm_icon.startswith("01"):
        return "sun"
    if owm_icon[:2] in {"02", "03", "04"}:
        return "cloud"
    if owm_icon[:2] in {"09", "10"}:
        return "rain"
    if owm_icon.startswith("11"):
        return "storm"
    if owm_icon.startswith("13"):
        return "snow"
    if owm_icon.startswith("50"):
        return "fog"
    return "cloud"


def _compass(deg: float) -> str:
    """8-point compass label — matches the frontend's previous FR labels."""
    dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"]
    idx = int(round(deg / 45)) % 8
    return dirs[idx]


def _kmh_from_ms(ms: float) -> float:
    return round(ms * 3.6, 1)


# ---------------------------------------------------------------------------
# Weather endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/weather",
    response_model=WeatherResponse,
    summary="OpenWeatherMap forecast for a parcel (cached, KAT-08 reuse)",
)
async def get_parcel_weather(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> WeatherResponse:
    parcel = _load_parcel(parcel_id, db, user)

    try:
        lat, lng = _centroid(parcel["geojson"])
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"parcel_polygon_invalid:{exc}",
        ) from exc

    try:
        raw = owm_client.fetch_weather(lat=lat, lng=lng)
    except httpx.HTTPError as exc:
        log.warning("owm_unreachable parcel_id=%s err=%s", parcel_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="weather_upstream_unavailable",
        ) from exc

    bundle = _to_weather_response(parcel_id, parcel.get("name") or "", raw)
    return bundle


def _to_weather_response(
    parcel_id: UUID,
    fallback_label: str,
    raw: dict[str, Any],
) -> WeatherResponse:
    """Project the raw OWM ``/forecast`` payload into our structured bundle.

    OWM ``/forecast`` returns 3-hour slots for the next 5 days. The first
    slot is "now-ish"; we use it for ``current`` and the next 8 slots for
    the hourly strip (covers ~24 h).
    """
    city = (raw.get("city") or {}).get("name") or fallback_label

    slots: list[dict[str, Any]] = raw.get("list") or []
    if not slots:
        # Empty upstream response — surface as 502 (we got a 200 but no data,
        # behaves the same as an upstream outage from a user perspective).
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="weather_upstream_empty",
        )

    head = slots[0]
    head_main = head.get("main") or {}
    head_weather = (head.get("weather") or [{}])[0]
    head_wind = head.get("wind") or {}
    head_rain = head.get("rain") or {}

    current = WeatherCurrent(
        city_label=city,
        temp_c=float(head_main.get("temp") or 0),
        feels_like_c=float(head_main.get("feels_like") or 0),
        description=str(head_weather.get("description") or "—"),
        icon_kind=_icon_kind(head_weather.get("icon")),
        humidity_pct=int(head_main.get("humidity") or 0),
        wind_kmh=_kmh_from_ms(float(head_wind.get("speed") or 0)),
        wind_dir=_compass(float(head_wind.get("deg") or 0)),
        rain_mm_3h=float(head_rain.get("3h") or 0),
        temp_min_c=float(head_main.get("temp_min") or 0),
        temp_max_c=float(head_main.get("temp_max") or 0),
    )

    hourly = [
        WeatherHourly(
            iso=datetime.fromtimestamp(int(s.get("dt") or 0), tz=timezone.utc),
            temp_c=float((s.get("main") or {}).get("temp") or 0),
            icon_kind=_icon_kind(((s.get("weather") or [{}])[0]).get("icon")),
            pop_pct=int(round(float(s.get("pop") or 0) * 100)),
        )
        for s in slots[:8]
    ]

    # Aggregate slots into 5 daily buckets keyed by UTC date.
    daily_buckets: dict[str, list[dict[str, Any]]] = {}
    for s in slots:
        ts = int(s.get("dt") or 0)
        key = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        daily_buckets.setdefault(key, []).append(s)

    daily: list[WeatherDaily] = []
    for key in list(daily_buckets.keys())[:5]:
        bucket = daily_buckets[key]
        temps_min = [float((s.get("main") or {}).get("temp_min") or 0) for s in bucket]
        temps_max = [float((s.get("main") or {}).get("temp_max") or 0) for s in bucket]
        pops = [float(s.get("pop") or 0) for s in bucket]
        rains = [float((s.get("rain") or {}).get("3h") or 0) for s in bucket]
        # Icon at noon-ish is the cleanest "summary" glyph for the day.
        noon_slot = next(
            (
                s
                for s in bucket
                if 11
                <= datetime.fromtimestamp(int(s.get("dt") or 0), tz=timezone.utc).hour
                <= 14
            ),
            bucket[len(bucket) // 2],
        )
        daily.append(
            WeatherDaily(
                iso=datetime.fromisoformat(key).replace(tzinfo=timezone.utc),
                temp_min_c=min(temps_min),
                temp_max_c=max(temps_max),
                icon_kind=_icon_kind(((noon_slot.get("weather") or [{}])[0]).get("icon")),
                pop_pct=int(round(max(pops) * 100)),
                rain_mm=round(sum(rains), 1),
            )
        )

    return WeatherResponse(
        parcel_id=parcel_id,
        current=current,
        hourly=hourly,
        daily=daily,
        fetched_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# NDVI endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/ndvi",
    response_model=NdviResponse,
    summary="Latest cloud-free Sentinel-2 NDVI for a parcel (cached, KAT-08 reuse)",
)
async def get_parcel_ndvi(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> NdviResponse:
    parcel = _load_parcel(parcel_id, db, user)

    # Mean + acquisition date come straight out of the cached worker helper.
    try:
        summary = sentinel_client.fetch_ndvi(parcel_id, parcel["geojson"])
    except (httpx.HTTPError, RuntimeError) as exc:
        log.warning("ndvi_unreachable parcel_id=%s err=%s", parcel_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="ndvi_upstream_unavailable",
        ) from exc

    # The PNG fetch is best-effort: a fully-clouded fortnight returns a 4-band
    # all-transparent tile rather than failing, but a true 4xx/5xx from
    # Sentinel Hub leaves us with the mean only — we surface that distinctly
    # to the UI via ``image_data_url is None``.
    image_data_url: str | None = None
    try:
        png_bytes = sentinel_client.fetch_ndvi_image(parcel["geojson"])
        image_data_url = "data:image/png;base64," + b64encode(png_bytes).decode("ascii")
    except (httpx.HTTPError, ValueError) as exc:
        # Image is non-critical for agronomy decisions — log and proceed.
        log.info("ndvi_image_unavailable parcel_id=%s err=%s", parcel_id, exc)

    return NdviResponse(
        parcel_id=parcel_id,
        mean_ndvi=float(summary["mean_ndvi"]),
        acquisition_date=summary["acquisition_date"],
        image_data_url=image_data_url,
    )


__all__ = ["router"]
