"""KAT-08 — Gemini wrapper.

Uses ``gemini-1.5-flash`` against the free-tier endpoint (1.5 K req/day per
PRD §11.1, ~1 M token context — comfortably oversized for our ~2 KB input).
30 s wall-clock timeout per attempt + 429-aware retry (max 2 retries with
1 s / 2 s exponential back-off).

The SDK is imported lazily so unit tests on sibling modules (prompt builder,
aggregator) need not have ``google-generativeai`` installed.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

log = logging.getLogger("katara_diagnostic.gemini")

_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
_MAX_RETRIES = 2
_TIMEOUT_S = 30.0

_configured = False


class GeminiUnavailable(RuntimeError):
    """Raised when the Gemini SDK is not installed at runtime."""


class GeminiRateLimited(RuntimeError):
    """Raised when we've exhausted all retries against a 429."""


def _configure_once() -> Any:
    """Lazy-import + one-shot SDK configuration. Returns the SDK module."""
    global _configured
    try:
        import google.generativeai as genai  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover — only fires when dep missing
        raise GeminiUnavailable(
            "google-generativeai missing — install backend/requirements.in"
        ) from exc

    if not _configured:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is unset")
        genai.configure(api_key=api_key)
        _configured = True
    return genai


async def call_gemini(prompt: str) -> str:
    """Send a single-turn prompt; return the Markdown response text.

    Raises :class:`GeminiRateLimited` on persistent 429, :class:`GeminiUnavailable`
    if the SDK isn't installed, and the upstream SDK exception on any other
    error (the orchestrator catches and lands the row in FAILED).
    """
    genai = _configure_once()
    model = genai.GenerativeModel(_MODEL)

    backoff_s = 1.0
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = await asyncio.wait_for(
                asyncio.to_thread(model.generate_content, prompt),
                timeout=_TIMEOUT_S,
            )
            return (getattr(resp, "text", "") or "").strip()
        except Exception as exc:  # noqa: BLE001 — branch on the imported type
            if not _is_rate_limited(exc):
                raise
            last_exc = exc
            if attempt == _MAX_RETRIES:
                raise GeminiRateLimited(
                    f"gemini ResourceExhausted after {_MAX_RETRIES + 1} attempts"
                ) from exc
            log.warning(
                "gemini_rate_limited_retrying attempt=%d backoff_s=%.1f",
                attempt, backoff_s,
            )
            await asyncio.sleep(backoff_s)
            backoff_s *= 2

    # Unreachable — every loop iteration either returns or raises.
    raise GeminiRateLimited(
        "gemini ResourceExhausted — unreachable fallthrough"
    ) from last_exc


def _is_rate_limited(exc: BaseException) -> bool:
    """Match the Gemini SDK's ResourceExhausted regardless of import path."""
    name = type(exc).__name__
    if name in {"ResourceExhausted", "TooManyRequests"}:
        return True
    # Status-code probe — the SDK wraps HTTP errors in a few different classes
    # depending on transport (gRPC vs REST); 429 is universal.
    code = getattr(exc, "code", None)
    return code in (429, "RESOURCE_EXHAUSTED")
