"""KAT-08 — Sentinel NDVI client cache + API-key auth (BR-K7)."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4


class _SelectBuilder:
    def __init__(self, rows: list[dict]):
        self.rows = rows
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return SimpleNamespace(data=self.rows)


class _UpsertBuilder:
    def __init__(self):
        self.payloads: list[dict] = []
    def upsert(self, payload, *a, **k):
        self.payloads.append(payload)
        return self
    def execute(self): return SimpleNamespace(data=[])


class _Dispatch:
    def __init__(self, s, u):
        self._s, self._u = s, u
    def select(self, *a, **k): return self._s.select(*a, **k)
    def upsert(self, *a, **k): return self._u.upsert(*a, **k)


class _FakeClient:
    def __init__(self, rows: list[dict]):
        self._s = _SelectBuilder(rows)
        self.upsert = _UpsertBuilder()
    def table(self, _name): return _Dispatch(self._s, self.upsert)


def _patch_db(rows):
    fake = _FakeClient(rows)
    return fake, patch(
        "app.workers.katara_diagnostic.sentinel_client.service_client",
        return_value=fake,
    )


def _polygon():
    return {
        "type": "Polygon",
        "coordinates": [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
    }



def test_cache_hit_skips_http() -> None:
    from app.workers.katara_diagnostic import sentinel_client

    fresh = datetime.now(timezone.utc) - timedelta(hours=2)
    fake, db_patch = _patch_db([{
        "mean_ndvi": 0.742,
        "acquisition_date": "2026-05-14",
        "fetched_at": fresh.isoformat(),
    }])

    def _boom(*a, **k):
        raise AssertionError("httpx must not be called on a cache hit")

    with db_patch, \
         patch.object(sentinel_client.httpx, "post", _boom):
        out = sentinel_client.fetch_ndvi(uuid4(), _polygon())

    assert out["mean_ndvi"] == 0.742
    assert out["acquisition_date"] == "2026-05-14"
    assert fake.upsert.payloads == []


def test_cache_miss_fetches_and_upserts() -> None:
    from app.workers.katara_diagnostic import sentinel_client

    fake, db_patch = _patch_db([])  # cache miss

    process_resp = SimpleNamespace(
        raise_for_status=lambda: None,
        content=b"fake-tiff-bytes",
    )

    with db_patch, \
         patch.dict(os.environ, {"SENTINEL_HUB_API_KEY": "test-api-key"}, clear=False), \
         patch.object(sentinel_client.httpx, "post", return_value=process_resp), \
         patch.object(sentinel_client, "_mean_ndvi_from_tiff", return_value=0.512):
        parcel_id = uuid4()
        out = sentinel_client.fetch_ndvi(parcel_id, _polygon())

    assert abs(out["mean_ndvi"] - 0.512) < 1e-6
    assert fake.upsert.payloads, "cache miss must upsert"
    upserted = fake.upsert.payloads[0]
    assert upserted["parcel_id"] == str(parcel_id)
    assert abs(float(upserted["mean_ndvi"]) - 0.512) < 1e-3
    assert "acquisition_date" in upserted


def test_api_key_sent_in_auth_header() -> None:
    """ApiKey is forwarded in the Authorization header to the Process API."""
    from app.workers.katara_diagnostic import sentinel_client

    fake, db_patch = _patch_db([])
    captured: list[dict] = []

    def _post(url, *a, headers=None, **k):
        captured.append({"url": url, "headers": headers or {}})
        return SimpleNamespace(raise_for_status=lambda: None, content=b"fake")

    with db_patch, \
         patch.dict(os.environ, {"SENTINEL_HUB_API_KEY": "my-plak-key"}, clear=False), \
         patch.object(sentinel_client.httpx, "post", side_effect=_post), \
         patch.object(sentinel_client, "_mean_ndvi_from_tiff", return_value=0.3):
        sentinel_client.fetch_ndvi(uuid4(), _polygon())

    assert captured, "httpx.post was never called"
    assert captured[0]["headers"].get("Authorization") == "ApiKey my-plak-key"


def test_polygon_for_sentinel_unwraps_feature() -> None:
    """KAT-01 accepts Feature{Polygon} — the Sentinel body needs the inner geom."""
    from app.workers.katara_diagnostic.sentinel_client import _polygon_for_sentinel

    feature = {
        "type": "Feature",
        "properties": {},
        "geometry": _polygon(),
    }
    assert _polygon_for_sentinel(feature) == _polygon()
    # Raw polygon is passed through.
    assert _polygon_for_sentinel(_polygon()) == _polygon()


def test_mean_ndvi_handles_all_nan_array() -> None:
    """Full cloud cover (every pixel NaN) returns 0.0 — no division-by-zero."""
    import io

    try:
        import numpy as np
        import tifffile
    except ImportError:
        import pytest
        pytest.skip("numpy / tifffile not installed in this env")

    arr = np.full((4, 4), float("nan"), dtype="float32")
    buf = io.BytesIO()
    tifffile.imwrite(buf, arr)
    from app.workers.katara_diagnostic.sentinel_client import _mean_ndvi_from_tiff
    assert _mean_ndvi_from_tiff(buf.getvalue()) == 0.0
