"""INF-08 — Sentry init + before_send scrubbing tests.

These tests do NOT contact Sentry. They exercise:
  * ``_scrub`` strips sensitive headers + body keys + email addresses
  * ``_scrub`` drops planted-test events in prod, keeps them elsewhere
  * ``init_observability`` is a no-op in dev/ci, even with a DSN set
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from fastapi import FastAPI

from app.core.config import get_settings
from app.core.observability import _scrub, init_observability


@pytest.fixture(autouse=True)
def _clean_env():
    """Snapshot + restore env vars our tests mutate."""
    keys = (
        "ENVIRONMENT",
        "SENTRY_DSN",
        "SENTRY_ENVIRONMENT",
        "SENTRY_TRACES_SAMPLE_RATE",
    )
    saved = {k: os.environ.get(k) for k in keys}
    yield
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    get_settings.cache_clear()


# -- _scrub --------------------------------------------------------------------


def test_scrub_strips_authorization_header():
    event = {
        "request": {
            "url": "https://vitachain.ma/api/v1/whatever",
            "headers": {"Authorization": "Bearer leaked-jwt", "X-Other": "ok"},
        }
    }
    out = _scrub(event, {})
    assert out is not None
    assert out["request"]["headers"]["Authorization"] == "[scrubbed]"
    assert out["request"]["headers"]["X-Other"] == "ok"


def test_scrub_strips_cookie_apikey_supabase_headers():
    event = {
        "request": {
            "url": "https://vitachain.ma/x",
            "headers": {
                "Cookie": "sb-access-token=abc",
                "apikey": "anon-leak",
                "X-Supabase-Auth": "service-role-leak",
            },
        }
    }
    out = _scrub(event, {})
    assert out is not None
    assert all(v == "[scrubbed]" for v in out["request"]["headers"].values())


def test_scrub_redacts_password_in_body():
    event = {
        "request": {
            "url": "https://vitachain.ma/api/v1/auth/login",
            "data": {"email": "u@example.com", "password": "hunter2"},
        }
    }
    out = _scrub(event, {})
    assert out is not None
    assert out["request"]["data"]["password"] == "[scrubbed]"
    assert out["request"]["data"]["email"] == "u@example.com"


def test_scrub_redacts_device_api_key_in_body():
    event = {
        "request": {
            "url": "https://vitachain.ma/api/v1/katara/ingest",
            "data": {"device_api_key": "kat-secret", "temperature": 4.2},
        }
    }
    out = _scrub(event, {})
    assert out is not None
    assert out["request"]["data"]["device_api_key"] == "[scrubbed]"
    assert out["request"]["data"]["temperature"] == 4.2


def test_scrub_masks_user_email_and_extra_strings():
    event = {
        "request": {"url": "https://x.y/z"},
        "user": {"email": "alice@example.com", "id": "u-1"},
        "extra": {"note": "contact bob@example.com about it", "n": 7},
    }
    out = _scrub(event, {})
    assert out is not None
    assert out["user"]["email"] == "***@***"
    assert "***@***" in out["extra"]["note"]
    assert "bob@example.com" not in out["extra"]["note"]
    assert out["extra"]["n"] == 7  # non-strings untouched


def test_scrub_drops_planted_test_event_in_prod():
    os.environ["ENVIRONMENT"] = "prod"
    os.environ["SUPABASE_URL"] = "https://example.supabase.co"
    get_settings.cache_clear()
    event = {"request": {"url": "https://vitachain.ma/api/v1/_sentry_test"}}
    assert _scrub(event, {}) is None


def test_scrub_keeps_planted_test_event_outside_prod():
    os.environ["ENVIRONMENT"] = "dev"
    get_settings.cache_clear()
    event = {"request": {"url": "https://staging.vitachain.ma/api/v1/_sentry_test"}}
    out = _scrub(event, {})
    assert out is not None  # staging/dev keeps the event so we can verify wiring


# -- init_observability -------------------------------------------------------


def test_init_observability_is_noop_in_dev():
    os.environ["ENVIRONMENT"] = "dev"
    os.environ["SENTRY_DSN"] = "https://abc@o0.ingest.sentry.io/1"
    get_settings.cache_clear()
    with patch("app.core.observability.sentry_sdk.init") as mock_init:
        init_observability(FastAPI())
    mock_init.assert_not_called()


def test_init_observability_is_noop_in_ci():
    os.environ["ENVIRONMENT"] = "ci"
    os.environ["SENTRY_DSN"] = "https://abc@o0.ingest.sentry.io/1"
    get_settings.cache_clear()
    with patch("app.core.observability.sentry_sdk.init") as mock_init:
        init_observability(FastAPI())
    mock_init.assert_not_called()


def test_init_observability_is_noop_when_dsn_unset():
    os.environ["ENVIRONMENT"] = "prod"
    os.environ.pop("SENTRY_DSN", None)
    get_settings.cache_clear()
    with patch("app.core.observability.sentry_sdk.init") as mock_init:
        init_observability(FastAPI())
    mock_init.assert_not_called()


def test_init_observability_initialises_in_prod_with_dsn():
    os.environ["ENVIRONMENT"] = "prod"
    os.environ["SENTRY_DSN"] = "https://abc@o0.ingest.sentry.io/1"
    os.environ["SENTRY_TRACES_SAMPLE_RATE"] = "0.05"
    get_settings.cache_clear()
    with patch("app.core.observability.sentry_sdk.init") as mock_init:
        init_observability(FastAPI())
    mock_init.assert_called_once()
    kwargs = mock_init.call_args.kwargs
    assert kwargs["dsn"] == "https://abc@o0.ingest.sentry.io/1"
    assert kwargs["traces_sample_rate"] == 0.05
    assert kwargs["profiles_sample_rate"] == 0.0
    assert kwargs["send_default_pii"] is False
    assert kwargs["before_send"] is _scrub
