"""Database client factories — AUTH-04 / AUTH-05.

Two and only two ways for the backend to reach Postgres:

* :func:`service_client` — service-role JWT. **Bypasses RLS.** Reserved for
  admin operations (ADM-02 approve, AUTH-06 set ``verification_status``,
  on-signup post-processing) and trusted system writes (KAT-03 telemetry
  ingest, NOT-* mailer triggers). Every call site must carry an inline
  ``# JUSTIFICATION:`` comment naming why a user JWT cannot be used.

* :func:`user_scoped_client` — the caller's bearer JWT is forwarded to
  PostgREST. RLS evaluates as the ``authenticated`` role with the user's
  ``sub`` and ``user_role`` claims. This is the default for every
  domain-facing route. Use it via :func:`app.core.security.get_db_for_user`.

If you find yourself reaching for :func:`service_client` from a user-facing
endpoint to "fix" a permission denied, the RLS policy is the bug, not the
client choice. See ``docs/runbook.md`` §AUTH-04 RLS contract.

AUTH-05 call-site allow-list
----------------------------
``service_client()`` may only be referenced from these module prefixes
(enforced mechanically by ``backend/tests/test_service_client_callsite_allowlist.py``,
which walks the AST of every ``.py`` file under ``backend/app/``):

* ``routers/admin/`` — admin endpoints (ADM-*)
* ``workers/``       — async workers (NOT-01 mailer, KAT-09 diagnostic, …)
* ``auth_hooks/``    — Supabase Auth on-signup post-processing
* ``db.py``          — this file (the definition itself)

Every call site must also carry an inline ``# JUSTIFICATION:`` comment, e.g.::

    # JUSTIFICATION: AUTH-06 verification flip — no user JWT can set
    # profiles.verification_status because the column gates the RLS policy
    # that reads it. Admin-only mutation.
    client = service_client()

Adding a new caller? Either extend ``ALLOW_PREFIXES`` in the test file
(reviewed in the same PR), or — almost always preferable — refactor to use
``Depends(get_db_for_user)`` and let RLS evaluate the user JWT.
"""

from __future__ import annotations

from functools import lru_cache

import httpx
from supabase import Client, ClientOptions, create_client

from app.core.config import get_settings


@lru_cache(maxsize=1)
def _shared_http_client() -> httpx.Client:
    # One httpx.Client shared across every create_client() call.
    # Without this, supabase-py builds a new httpx.Client per call which
    # loads the OS certificate store each time (~188 ms on Windows).  With 8+
    # concurrent requests on a page load, that serialised cost pushed total
    # event-loop blocking past the frontend's 10-second AbortSignal timeout.
    #
    # retries=1: transparent retry when the connection pool hands out a stale
    # socket that Supabase's server already closed (WinError 10054 / ECONNRESET).
    # keepalive_expiry=20: proactively discard idle connections after 20 s —
    # shorter than Supabase's ~30 s idle timeout so we never reuse dead sockets.
    transport = httpx.HTTPTransport(retries=1)
    return httpx.Client(
        transport=transport,
        timeout=httpx.Timeout(30.0),
    )


def _client_options(**kwargs) -> ClientOptions:
    return ClientOptions(
        httpx_client=_shared_http_client(),
        auto_refresh_token=False,
        persist_session=False,
        **kwargs,
    )


def service_client() -> Client:
    """Service-role client. Bypasses RLS. Justify each call site."""
    s = get_settings()
    return create_client(
        str(s.supabase_url),
        s.supabase_service_role_key.get_secret_value(),
        options=_client_options(),
    )


def user_scoped_client(bearer_token: str) -> Client:
    """User-JWT client. RLS fires. The default for domain endpoints.

    The ``apikey`` header still carries the anon key (PostgREST requires it
    on every request). The user's JWT goes into ``Authorization`` via
    ``postgrest.auth(token)``, which is what RLS evaluates.

    Raises :class:`ValueError` on an empty token rather than silently falling
    back to the anon role — a fail-loud against the most common AUTH-04
    regression.
    """
    if not bearer_token:
        raise ValueError("empty bearer token — refusing to fall back to anon role")

    s = get_settings()
    if not s.supabase_anon_key:
        raise RuntimeError(
            "SUPABASE_ANON_KEY is unset — user_scoped_client requires the "
            "published anon key so PostgREST accepts the request. See AUTH-04."
        )

    client = create_client(str(s.supabase_url), s.supabase_anon_key, options=_client_options())
    client.postgrest.auth(bearer_token)
    # supabase-py v2 / storage3: postgrest.auth() only sets the JWT on the
    # PostgREST sub-client. The storage sub-client keeps a separate _headers
    # dict that is copied into each SyncBucketProxy on every from_() call.
    # _request() then merges _headers into the per-call headers, so this is
    # the only place that actually reaches the Storage API.
    client.storage._headers["Authorization"] = f"Bearer {bearer_token}"
    return client
