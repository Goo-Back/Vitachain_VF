"""INF-08 — Sentry init.

Idempotent: called once from ``app.main:create_app()``. No-ops in dev/ci so a
developer's KeyError doesn't burn the team's monthly event budget.

The ``before_send`` hook is the *backend half* of the AUTH-05 PII boundary —
Sentry's project-level scrubbing is layer 2; this is layer 1, applied in-process
before any event leaves the host.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import sentry_sdk
from fastapi import FastAPI
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.httpx import HttpxIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from app.core.config import get_settings

_EMAIL_RE = re.compile(r"[A-Za-z0-9._-]+@[A-Za-z0-9.-]+")
_SENSITIVE_HEADERS = frozenset(
    {"authorization", "cookie", "x-supabase-auth", "apikey", "x-api-key"}
)
_SENSITIVE_BODY_KEYS = frozenset(
    {
        "password",
        "current_password",
        "new_password",
        "service_role_key",
        "apikey",
        "api_key",
        "device_api_key",  # KAT-03 — never log this in clear
    }
)


def _scrub(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any] | None:
    """``before_send`` hook — drop secrets before they leave the process."""
    request = event.get("request") or {}

    url = request.get("url") or ""
    if url.endswith("/api/v1/_sentry_test"):
        if get_settings().environment == "prod":
            return None

    headers = request.get("headers")
    if isinstance(headers, dict):
        for k in list(headers.keys()):
            if k.lower() in _SENSITIVE_HEADERS:
                headers[k] = "[scrubbed]"

    data = request.get("data")
    if isinstance(data, dict):
        for k in list(data.keys()):
            if k.lower() in _SENSITIVE_BODY_KEYS:
                data[k] = "[scrubbed]"

    user = event.get("user")
    if isinstance(user, dict):
        email = user.get("email")
        if isinstance(email, str):
            user["email"] = _EMAIL_RE.sub("***@***", email)

    extra = event.get("extra")
    if isinstance(extra, dict):
        for k, v in list(extra.items()):
            if isinstance(v, str):
                extra[k] = _EMAIL_RE.sub("***@***", v)

    return event


def init_observability(_app: FastAPI) -> None:
    """Wire Sentry into the FastAPI app. No-op in dev/ci or when DSN is unset."""
    s = get_settings()
    if s.environment in ("dev", "ci"):
        return
    if not s.sentry_dsn:
        return

    sentry_sdk.init(
        dsn=s.sentry_dsn.get_secret_value(),
        environment=s.sentry_environment,
        release=s.git_sha,
        traces_sample_rate=s.sentry_traces_sample_rate,
        profiles_sample_rate=0.0,
        send_default_pii=False,
        before_send=_scrub,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
            HttpxIntegration(),
            LoggingIntegration(
                level=logging.INFO,
                event_level=logging.ERROR,
            ),
        ],
    )
