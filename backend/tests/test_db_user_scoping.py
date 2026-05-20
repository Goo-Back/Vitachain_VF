"""AUTH-04 — user-scoped Supabase client factory coverage.

Pure unit tests: ``supabase.create_client`` is patched so nothing reaches
the network. The contract under test is:

* :func:`user_scoped_client` calls ``client.postgrest.auth(token)`` exactly
  once with the passed-in string.
* :func:`user_scoped_client` refuses an empty token (fail-loud against the
  silent anon-role fallback that AUTH-04 exists to prevent).
* Two distinct tokens produce two distinct client instances (no shared
  session state — the factory must not cache).
* :func:`service_client` does NOT call ``postgrest.auth`` — the service-role
  key is set at the ``create_client`` level via the ``apikey`` header.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.db import service_client, user_scoped_client


def test_user_scoped_client_calls_postgrest_auth():
    fake = MagicMock()
    with patch("app.db.create_client", return_value=fake) as creator:
        out = user_scoped_client("the-bearer-token")

    creator.assert_called_once()
    fake.postgrest.auth.assert_called_once_with("the-bearer-token")
    assert out is fake


def test_user_scoped_client_rejects_empty_token():
    with pytest.raises(ValueError, match="empty bearer token"):
        user_scoped_client("")


def test_two_users_get_independent_clients():
    # side_effect=lambda *_, **__: MagicMock() returns a fresh mock per call.
    with patch("app.db.create_client", side_effect=lambda *_a, **_kw: MagicMock()):
        a = user_scoped_client("token-a")
        b = user_scoped_client("token-b")
    assert a is not b
    # Each got its own auth() call with its own token.
    a.postgrest.auth.assert_called_once_with("token-a")
    b.postgrest.auth.assert_called_once_with("token-b")


def test_service_client_does_not_call_postgrest_auth():
    fake = MagicMock()
    with patch("app.db.create_client", return_value=fake) as creator:
        out = service_client()

    creator.assert_called_once()
    fake.postgrest.auth.assert_not_called()
    assert out is fake


def test_user_scoped_client_uses_anon_key_not_service_role():
    # The second positional arg to create_client is the apikey. AUTH-04
    # requires it to be the anon key (the user's JWT carries privilege, not
    # the apikey). If this ever flips to the service-role key, every
    # request silently bypasses RLS regardless of the JWT.
    fake = MagicMock()
    with patch("app.db.create_client", return_value=fake) as creator:
        user_scoped_client("any-token")
    args, _ = creator.call_args
    # args = (url, anon_key)
    assert args[1] == "test-anon-key", (
        "user_scoped_client must pass the anon key as the apikey — never service-role"
    )


def test_user_scoped_client_raises_when_anon_key_missing(monkeypatch):
    # Simulate a misconfigured deploy where SUPABASE_ANON_KEY was not set.
    monkeypatch.setenv("SUPABASE_ANON_KEY", "")
    from app.core.config import get_settings

    get_settings.cache_clear()

    with pytest.raises(RuntimeError, match="SUPABASE_ANON_KEY"):
        user_scoped_client("non-empty-token")
