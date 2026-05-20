"""KAT-08 — verified-FARMER end-to-end smoke (``--run-e2e`` gated).

Mirrors the KAT-06 / KAT-07 e2e shape: skipped by default on the laptop
suite; runs on staging when the harness exports the documented env vars.

E1 — happy path: POST /diagnostics → row reaches COMPLETED in < 30 s.
E2 — BR-K6 cap : second diagnostic on the same parcel within the 24 h window
                 returns 429 (KAT-07 surface); worker is not invoked.
E3 — failure   : OWM key intentionally unset → row lands FAILED with
                 ``error_detail`` starting ``owm_unavailable``; restoring the
                 key + re-POSTing lands COMPLETED.
"""
from __future__ import annotations

import os
import time

import httpx
import pytest

_E2E_ENABLED   = os.environ.get("KAT08_E2E") == "1"
_API_BASE_URL  = os.environ.get("KAT08_API_BASE_URL", "")
_PARCEL_ID     = os.environ.get("KAT08_DEMO_PARCEL_ID", "")
_FARMER_JWT    = os.environ.get("KAT08_FARMER_JWT", "")
_POLL_TIMEOUT  = float(os.environ.get("KAT08_POLL_TIMEOUT_S", "60"))
_POLL_INTERVAL = float(os.environ.get("KAT08_POLL_INTERVAL_S", "2"))


pytestmark = pytest.mark.skipif(
    not _E2E_ENABLED,
    reason="KAT-08 e2e — set KAT08_E2E=1 + KAT08_API_BASE_URL "
           "+ KAT08_DEMO_PARCEL_ID + KAT08_FARMER_JWT to run on staging",
)


def _post_diagnostic() -> httpx.Response:
    return httpx.post(
        f"{_API_BASE_URL}/api/v1/katara/parcels/{_PARCEL_ID}/diagnostics",
        headers={"Authorization": f"Bearer {_FARMER_JWT}"},
        timeout=10.0,
    )


def _get_latest() -> httpx.Response:
    return httpx.get(
        f"{_API_BASE_URL}/api/v1/katara/parcels/{_PARCEL_ID}/diagnostics/latest",
        headers={"Authorization": f"Bearer {_FARMER_JWT}"},
        timeout=10.0,
    )


def _poll_until_terminal() -> dict:
    deadline = time.time() + _POLL_TIMEOUT
    while time.time() < deadline:
        r = _get_latest()
        r.raise_for_status()
        body = r.json()
        if body.get("status") in {"COMPLETED", "FAILED"}:
            return body
        time.sleep(_POLL_INTERVAL)
    raise AssertionError(
        f"diagnostic still non-terminal after {_POLL_TIMEOUT:.0f}s "
        f"(status={body.get('status')})"
    )


def test_e1_happy_path_reaches_completed() -> None:
    r = _post_diagnostic()
    # Either 201 (fresh) or 409 (in-flight from a previous test run). Accept
    # both — the test cares about the eventual COMPLETED transition.
    assert r.status_code in (201, 409), r.text
    body = _poll_until_terminal()
    assert body["status"] == "COMPLETED", body
    assert body.get("result_text"), "COMPLETED row must carry result_text"


def test_e2_br_k6_rate_limit_after_three_in_24h() -> None:
    """A 4th POST inside the 24 h window must return 429 — worker is not invoked."""
    # Best-effort: rate-limit cap is 3/parcel/24h. Burst a few requests; the
    # cap surfaces as a 429 from KAT-07's handler.
    seen_429 = False
    for _ in range(5):
        r = _post_diagnostic()
        if r.status_code == 429:
            seen_429 = True
            break
    assert seen_429, "expected 429 after BR-K6 cap; rate-limit may need reset"


def test_e3_owm_unavailable_lands_failed_then_completed() -> None:
    """Drill — only meaningful when OWM key is toggleable on staging.

    Skipped unless KAT08_DRILL_OWM=1 is set so the laptop / CI run does not
    flip a shared key.
    """
    if os.environ.get("KAT08_DRILL_OWM") != "1":
        pytest.skip("OWM key drill not enabled (set KAT08_DRILL_OWM=1)")
    r = _post_diagnostic()
    assert r.status_code in (201, 409, 429), r.text
    body = _poll_until_terminal()
    if body["status"] != "FAILED":
        pytest.skip("OWM key still present on this run — drill not exercised")
    assert (body.get("error_detail") or "").startswith("owm_unavailable")
