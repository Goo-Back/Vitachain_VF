"""KAT-08 — OpenWeatherMap client cache behaviour (BR-K3).

The client is a SELECT-then-(maybe)-fetch-then-UPSERT flow. The tests below
inject a fake service_client whose .select() / .upsert() paths record
arguments, and stub httpx.get to detect HTTP usage.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch


class _SelectBuilder:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.eq_calls: list[tuple] = []

    def select(self, *a, **k): return self
    def eq(self, *a, **k):
        self.eq_calls.append(a)
        return self
    def limit(self, *a, **k): return self
    def execute(self):
        return SimpleNamespace(data=self.rows)


class _UpsertBuilder:
    def __init__(self):
        self.payloads: list[dict] = []

    def upsert(self, payload: dict, *a, **k):
        self.payloads.append(payload)
        return self
    def execute(self):
        return SimpleNamespace(data=[])


class _FakeClient:
    def __init__(self, rows: list[dict]):
        self._select = _SelectBuilder(rows)
        self.upsert  = _UpsertBuilder()

    def table(self, _name: str):
        # Both .select() and .upsert() are read off the same table() return —
        # we discriminate by which method gets called next.
        return _Dispatch(self._select, self.upsert)


class _Dispatch:
    def __init__(self, select_b, upsert_b):
        self._s = select_b
        self._u = upsert_b
    def select(self, *a, **k):
        return self._s.select(*a, **k)
    def upsert(self, *a, **k):
        return self._u.upsert(*a, **k)


def _patch_db(rows: list[dict]):
    fake = _FakeClient(rows)
    return fake, patch(
        "app.workers.katara_diagnostic.owm_client.service_client",
        return_value=fake,
    )


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def test_cache_hit_skips_http() -> None:
    """A row fresher than 3 h short-circuits the HTTP call."""
    from app.workers.katara_diagnostic import owm_client

    fresh = datetime.now(timezone.utc) - timedelta(hours=1)
    fake, db_patch = _patch_db([{
        "data": {"list": [{"main": {"temp": 22.0}}]},
        "fetched_at": _iso(fresh),
    }])

    def _boom(*a, **k):
        raise AssertionError("httpx.get must not be called on a cache hit")

    with db_patch, patch.object(owm_client.httpx, "get", _boom):
        out = owm_client.fetch_weather(33.59, -7.61)

    assert out == {"list": [{"main": {"temp": 22.0}}]}
    assert fake.upsert.payloads == [], "upsert must not run on a cache hit"


def test_cache_stale_triggers_fetch_and_upsert() -> None:
    """A row older than 3 h forces a fresh HTTP fetch + upsert."""
    from app.workers.katara_diagnostic import owm_client

    stale = datetime.now(timezone.utc) - timedelta(hours=5)
    fake, db_patch = _patch_db([{
        "data": {"list": [{"main": {"temp": 10.0}}]},
        "fetched_at": _iso(stale),
    }])
    fresh_payload = {"list": [{"main": {"temp": 19.5}}]}

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return fresh_payload

    with db_patch, \
         patch.dict(os.environ, {"OPENWEATHERMAP_API_KEY": "k"}, clear=False), \
         patch.object(owm_client.httpx, "get", return_value=_Resp()) as get_mock:
        out = owm_client.fetch_weather(33.59, -7.61)

    assert out == fresh_payload
    assert get_mock.call_count == 1
    assert fake.upsert.payloads, "stale cache must upsert"
    upserted: dict[str, Any] = fake.upsert.payloads[0]
    assert upserted["lat_q"] == 33.59
    assert upserted["lng_q"] == -7.61
    assert upserted["data"] == fresh_payload


def test_quantisation_collapses_neighbours_to_same_row() -> None:
    """Two requests in adjacent 0.001° cells map to the same 0.01° row."""
    from app.workers.katara_diagnostic.owm_client import _quantise
    assert _quantise(33.589) == 33.59
    assert _quantise(33.592) == 33.59
    assert _quantise(-7.612) == -7.61
    assert _quantise(-7.615) == -7.62  # boundary check — 0.005 rounds to even
    # Two near-coincident points should hit the same (lat_q, lng_q) PK:
    assert (_quantise(33.589), _quantise(-7.612)) == (33.59, -7.61)
    assert (_quantise(33.591), _quantise(-7.609)) == (33.59, -7.61)


def test_owm_5xx_propagates() -> None:
    """A 5xx raises out so the orchestrator can land FAILED owm_unavailable."""
    from app.workers.katara_diagnostic import owm_client

    fake, db_patch = _patch_db([])  # cache miss path

    class _Boom:
        def raise_for_status(self):
            import httpx
            raise httpx.HTTPStatusError("503", request=None, response=None)  # type: ignore[arg-type]
        def json(self): return {}

    with db_patch, \
         patch.dict(os.environ, {"OPENWEATHERMAP_API_KEY": "k"}, clear=False), \
         patch.object(owm_client.httpx, "get", return_value=_Boom()):
        import httpx as _httpx
        try:
            owm_client.fetch_weather(33.59, -7.61)
        except _httpx.HTTPStatusError:
            return
        raise AssertionError("expected HTTPStatusError to propagate")
