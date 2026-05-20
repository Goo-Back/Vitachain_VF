"""Smoke tests covering INF-04 acceptance + the unblocking surface for later stories."""

from __future__ import annotations

import pytest

from app.core.config import Settings, get_settings


@pytest.mark.anyio
async def test_healthz_returns_ok(client):
    r = await client.get("/api/v1/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "backend"
    assert "version" in body


@pytest.mark.anyio
async def test_module_healthz_routes_all_load(client):
    for module in ("katara", "farmarket", "secondserve", "botabaqa", "notifications"):
        r = await client.get(f"/api/v1/{module}/healthz")
        assert r.status_code == 200, module
        assert r.json()["module"] == module


@pytest.mark.anyio
async def test_request_id_round_trips_when_provided(client):
    r = await client.get("/api/v1/healthz", headers={"X-Request-Id": "test-abc"})
    assert r.headers.get("X-Request-Id") == "test-abc"


@pytest.mark.anyio
async def test_request_id_generated_when_missing(client):
    r = await client.get("/api/v1/healthz")
    rid = r.headers.get("X-Request-Id")
    assert rid is not None and len(rid) >= 16  # uuid4 hex = 32 chars


@pytest.mark.anyio
async def test_version_returns_commit(client):
    r = await client.get("/api/v1/version")
    assert r.status_code == 200
    assert "commit" in r.json()


@pytest.mark.anyio
async def test_unknown_route_returns_json_404(client):
    r = await client.get("/api/v1/nonexistent")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


@pytest.mark.anyio
async def test_docs_exposed_in_dev(client):
    # Default ENVIRONMENT=dev → docs are reachable.
    r = await client.get("/api/v1/openapi.json")
    assert r.status_code == 200
    paths = r.json()["paths"]
    assert "/api/v1/healthz" in paths
    assert "/api/v1/katara/healthz" in paths


def test_cors_origins_parses_csv_env(monkeypatch):
    """Regression: pydantic-settings used to JSON-decode list[str] env vars
    before our validator could split the CSV. The compose env passes
    ``CORS_ALLOW_ORIGINS=http://vitachain.ma`` (no commas, not JSON), which
    must be accepted as a single-element list.
    """
    get_settings.cache_clear()
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "http://vitachain.ma")
    s = Settings()  # type: ignore[call-arg]
    assert s.cors_allow_origins == ["http://vitachain.ma"]

    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "http://a.test, http://b.test")
    s = Settings()  # type: ignore[call-arg]
    assert s.cors_allow_origins == ["http://a.test", "http://b.test"]
