"""KAT-08 — Sentinel Hub NDVI client with BR-K7 12-hour read-through cache.

OAuth2 client-credentials flow (token cached in-process for its ~1 h TTL),
followed by a Process API call with the standard NDVI evalscript over the
parcel polygon. Returns ``{"mean_ndvi": float, "acquisition_date": str}``.

Sentinel-2 revisit cadence is ~5 days, so a 12 h cache is a generous
freshness budget — we mostly recompute when the polygon changes or a clear
granule lands.

The mean is computed Python-side from the float32 TIFF response. ``numpy`` /
``tifffile`` are optional at import time (the worker container has them; CI
runs that don't exercise this module — e.g. unit tests on the prompt
builder — keep importing cheap). If the deps are absent and a real fetch is
attempted, we surface a clean ``RuntimeError`` the orchestrator catches.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import httpx
import sentry_sdk

# JUSTIFICATION: cache table is service_role-write-only. AUTH-05 allow-list
# entry: workers/.
from app.db import service_client

log = logging.getLogger("katara_diagnostic.sentinel")

# Endpoints are configurable so the same client works against either Sentinel
# Hub deployment. Defaults target the standalone Sentinel Hub; set the two env
# vars below to switch to the free Copernicus Data Space Ecosystem (CDSE):
#   SENTINEL_HUB_BASE_URL=https://sh.dataspace.copernicus.eu
#   SENTINEL_HUB_TOKEN_URL=https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token
# (CDSE's token endpoint lives on a different host than its Process base, which
# is why the token URL is its own var rather than derived from the base.)
#
# Read lazily (not at import time): app.main loads backend/.env into
# os.environ *after* importing the katara routers, which import this module
# transitively — a module-level os.environ.get() here would freeze on the
# hardcoded default before .env ever applies, silently ignoring a configured
# CDSE endpoint.
def _process_url() -> str:
    base = os.environ.get("SENTINEL_HUB_BASE_URL", "https://services.sentinel-hub.com").rstrip("/")
    return f"{base}/api/v1/process"


def _token_url() -> str:
    base = os.environ.get("SENTINEL_HUB_BASE_URL", "https://services.sentinel-hub.com").rstrip("/")
    return os.environ.get("SENTINEL_HUB_TOKEN_URL", f"{base}/oauth/token")

_CACHE_TTL          = timedelta(hours=12)
_PROCESS_TIMEOUT_S  = 20.0
_TOKEN_TIMEOUT_S    = 15.0
# Sentinel Hub access tokens live ~1 h; refresh a minute early so we never
# fire a Process call with a token that expires mid-flight.
_TOKEN_REFRESH_MARGIN_S = 60.0

# In-process OAuth token cache (access_token + monotonic-ish expiry epoch).
# Shared across fetch_ndvi / fetch_ndvi_image so one token covers both. A
# worker restart simply re-mints on first use — no persistence needed.
_token_cache: dict[str, Any] = {"access_token": None, "expires_at": 0.0}
# Widen the granule search window so we don't return zero on a single cloudy day.
_GRANULE_LOOKBACK_DAYS = 14

# Standard NDVI evalscript — (B08 - B04) / (B08 + B04), masked by Sentinel-2's
# dataMask layer to drop NaNs from off-image and cloud-marked pixels.
_NDVI_EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "dataMask"],
    output: { bands: 1, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  return [ndvi * s.dataMask];
}
"""

# RGBA evalscript used by ``fetch_ndvi_image`` — same NDVI math, but mapped to
# the canonical agronomy ramp (brown → yellow → green) for visualisation.
# Lives next to ``_NDVI_EVALSCRIPT`` so both stay in sync the day Sentinel-2
# adds a new dataMask convention.
_NDVI_RGBA_EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "dataMask"],
    output: { bands: 4 }
  };
}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [0, 0, 0, 0];
  const ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 1e-6);
  if (ndvi < 0)    return [0.66, 0.55, 0.35, 1];
  if (ndvi < 0.2)  return [0.93, 0.85, 0.55, 1];
  if (ndvi < 0.4)  return [0.78, 0.86, 0.42, 1];
  if (ndvi < 0.6)  return [0.43, 0.76, 0.30, 1];
  return                [0.18, 0.52, 0.18, 1];
}
"""

def _get_oauth_credentials() -> tuple[str, str]:
    client_id     = os.environ.get("SENTINEL_HUB_CLIENT_ID")
    client_secret = os.environ.get("SENTINEL_HUB_CLIENT_SECRET")
    if not client_id or not client_secret:
        # Clear, catchable config error → the /ndvi endpoint already maps
        # RuntimeError to 502 (ndvi_upstream_unavailable); a bare KeyError
        # would slip past that and surface as an opaque 500.
        #
        # NOTE: Sentinel Hub's Process API authenticates with an OAuth2
        # *client_credentials* pair (created under Dashboard → User settings →
        # OAuth clients), NOT a raw "API key" — a bare PLAK Planet key is
        # rejected with 401. See _get_access_token below.
        raise RuntimeError(
            "SENTINEL_HUB_CLIENT_ID / SENTINEL_HUB_CLIENT_SECRET are not configured"
        )
    return client_id, client_secret


def _get_access_token() -> str:
    """Return a valid Sentinel Hub OAuth2 bearer token, minting on demand.

    Tokens are cached in-process until ~1 min before their advertised
    ``expires_in``. Raises ``RuntimeError`` (missing creds) or
    ``httpx.HTTPError`` (auth endpoint down / bad creds) — both already map
    to 502 ``ndvi_upstream_unavailable`` upstream.
    """
    now = time.time()
    cached = _token_cache.get("access_token")
    if cached and now < _token_cache.get("expires_at", 0.0):
        return cached

    client_id, client_secret = _get_oauth_credentials()
    resp = httpx.post(
        _token_url(),
        data={
            "grant_type":    "client_credentials",
            "client_id":     client_id,
            "client_secret": client_secret,
        },
        timeout=_TOKEN_TIMEOUT_S,
    )
    resp.raise_for_status()
    payload = resp.json()
    token = payload["access_token"]
    expires_in = float(payload.get("expires_in", 3600))
    _token_cache["access_token"] = token
    _token_cache["expires_at"]   = now + max(expires_in - _TOKEN_REFRESH_MARGIN_S, 0.0)
    log.info("sentinel_oauth_token_minted ttl_s=%s", expires_in)
    return token


def _polygon_for_sentinel(geojson: dict[str, Any]) -> dict[str, Any]:
    """Extract the Polygon / MultiPolygon shape from any of the accepted
    KAT-01 geojson shapes (raw Polygon / MultiPolygon / Feature wrapping one).

    KAT-01 §2 accepts ``Feature{Polygon|MultiPolygon}`` or the raw geometry.
    """
    if not isinstance(geojson, dict):
        raise ValueError("parcel.geojson must be a dict")
    if geojson.get("type") == "Feature":
        inner = geojson.get("geometry")
        if not isinstance(inner, dict):
            raise ValueError("Feature.geometry missing")
        return inner
    return geojson


def fetch_ndvi(parcel_id: UUID, polygon_geojson: dict[str, Any]) -> dict[str, Any]:
    """Return the cached or freshly-computed mean NDVI for a parcel polygon."""
    db = service_client()
    cached = (
        db.table("m1_katara_ndvi_cache")
        .select("mean_ndvi,acquisition_date,fetched_at")
        .eq("parcel_id", str(parcel_id))
        .limit(1)
        .execute()
    )
    row = (cached.data or [None])[0]
    if row and _is_fresh(row["fetched_at"]):
        sentry_sdk.add_breadcrumb(category="ndvi", message="cache_hit")
        log.info("ndvi_cache_hit parcel_id=%s", str(parcel_id))
        return {
            "mean_ndvi":        float(row["mean_ndvi"]),
            "acquisition_date": str(row["acquisition_date"]),
        }

    sentry_sdk.add_breadcrumb(category="ndvi", message="cache_miss")
    log.info("ndvi_cache_miss parcel_id=%s", str(parcel_id))

    today = datetime.now(timezone.utc).date()
    window_from = today - timedelta(days=_GRANULE_LOOKBACK_DAYS)
    geometry = _polygon_for_sentinel(polygon_geojson)

    body: dict[str, Any] = {
        "input": {
            "bounds": {
                "geometry":   geometry,
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/EPSG/0/4326",
                },
            },
            "data": [
                {
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {
                            "from": f"{window_from}T00:00:00Z",
                            "to":   f"{today}T23:59:59Z",
                        },
                        "mosaickingOrder": "leastCC",
                    },
                }
            ],
        },
        "evalscript": _NDVI_EVALSCRIPT,
        "output": {
            "width":  64,
            "height": 64,
            "responses": [
                {"identifier": "default", "format": {"type": "image/tiff"}},
            ],
        },
    }
    resp = httpx.post(
        _process_url(),
        json=body,
        headers={
            "Authorization": f"Bearer {_get_access_token()}",
            "Accept":        "image/tiff",
        },
        timeout=_PROCESS_TIMEOUT_S,
    )
    resp.raise_for_status()
    mean = _mean_ndvi_from_tiff(resp.content)

    # mosaickingOrder=leastCC mosaics the best-clear granule across the window;
    # the exact acquisition date isn't returned in the response body, so we
    # surface "today" as the freshness anchor and Gemini phrases the date as
    # "vu le ...". A future story can switch to Sentinel's STAT API to expose
    # the granule timestamp explicitly.
    acquisition_date = today.isoformat()

    db.table("m1_katara_ndvi_cache").upsert(
        {
            "parcel_id":        str(parcel_id),
            "mean_ndvi":        round(mean, 3),
            "acquisition_date": acquisition_date,
            "fetched_at":       datetime.now(timezone.utc).isoformat(),
        }
    ).execute()
    return {"mean_ndvi": mean, "acquisition_date": acquisition_date}


def _is_fresh(fetched_at_iso: str | None) -> bool:
    if not fetched_at_iso:
        return False
    try:
        fetched_at = datetime.fromisoformat(fetched_at_iso.replace("Z", "+00:00"))
    except ValueError:
        return False
    return fetched_at > datetime.now(timezone.utc) - _CACHE_TTL


def _mean_ndvi_from_tiff(tiff_bytes: bytes) -> float:
    """Compute the mean of the single-band float32 TIFF, skipping NaNs."""
    try:
        import io

        import numpy as np
        import tifffile
    except ImportError as exc:  # pragma: no cover — surfaced as ndvi_unavailable
        raise RuntimeError(
            "tifffile/numpy missing — install backend/requirements.in "
            "(KAT-08 worker dep)"
        ) from exc

    arr = tifffile.imread(io.BytesIO(tiff_bytes))
    arr = np.asarray(arr, dtype="float32")
    valid = arr[~np.isnan(arr)]
    # When dataMask zeroed every pixel (full cloud cover over the polygon) we
    # still see a finite array of zeros; the mean of zeros is 0.0 which is
    # an honest signal to Gemini ("végétation très faible / non détectée").
    if valid.size == 0:
        return 0.0
    return float(valid.mean())


# ── NDVI image (visualisation) ────────────────────────────────────────────
# A separate fetcher from ``fetch_ndvi`` because the agronomy worker only
# needs the mean (it's cheaper to download a 64×64 TIFF), whereas the
# dashboard "Satellite" page renders a 512×512 RGBA PNG so the farmer can
# eyeball heterogeneity inside the parcel.
#
# Not cached server-side — the upstream cache header carries it, and a
# 512×512 PNG (~50 KB) is too large to keep in the postgres NDVI cache
# table without bloating it. Two repeat hits cost two PUs; acceptable.

def fetch_ndvi_image(polygon_geojson: dict[str, Any]) -> bytes:
    """Return the latest cloud-free NDVI tile as a PNG byte-string.

    Same lookback / mosaicking posture as :func:`fetch_ndvi` so a farmer
    seeing a non-zero mean on the diagnostic also sees a coloured tile on
    the Satellite page (and vice-versa — both fail together on a fully
    clouded fortnight).
    """
    token = _get_access_token()
    today = datetime.now(timezone.utc).date()
    window_from = today - timedelta(days=_GRANULE_LOOKBACK_DAYS)
    geometry = _polygon_for_sentinel(polygon_geojson)

    body: dict[str, Any] = {
        "input": {
            "bounds": {
                "geometry":   geometry,
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/EPSG/0/4326",
                },
            },
            "data": [
                {
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {
                            "from": f"{window_from}T00:00:00Z",
                            "to":   f"{today}T23:59:59Z",
                        },
                        "mosaickingOrder": "leastCC",
                    },
                }
            ],
        },
        "evalscript": _NDVI_RGBA_EVALSCRIPT,
        "output": {
            "width":  512,
            "height": 512,
            "responses": [
                {"identifier": "default", "format": {"type": "image/png"}},
            ],
        },
    }
    resp = httpx.post(
        _process_url(),
        json=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept":        "image/png",
        },
        timeout=_PROCESS_TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.content
