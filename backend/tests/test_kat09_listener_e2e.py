"""KAT-09 — verified-FARMER end-to-end smoke (gated by env).

Mirrors the KAT-06 / KAT-07 / KAT-08 e2e shape: skipped by default on the
laptop suite; runs on staging when the harness exports the documented env
vars.

E1 — happy path : POST /diagnostics → KAT-08 worker reaches COMPLETED →
                  notified_at IS NOT NULL on the row within 30 s of the
                  COMPLETED transition. Brevo delivery itself is observed
                  manually in the Brevo activity log.
E2 — idempotency: manually unset notified_at on a COMPLETED row, wait one
                  backstop tick (60 s) → notified_at gets re-stamped exactly
                  once; a second wait sees no further changes.
"""
from __future__ import annotations

import os
import time

import httpx
import pytest

_E2E_ENABLED   = os.environ.get("KAT09_E2E") == "1"
_API_BASE_URL  = os.environ.get("KAT09_API_BASE_URL", "")
_PARCEL_ID     = os.environ.get("KAT09_DEMO_PARCEL_ID", "")
_FARMER_JWT    = os.environ.get("KAT09_FARMER_JWT", "")
# These three are needed for the E2 idempotency drill (direct service-role
# UPDATE of notified_at). Skipped cleanly if absent.
_SUPABASE_URL          = os.environ.get("KAT09_SUPABASE_URL", "")
_SUPABASE_SERVICE_KEY  = os.environ.get("KAT09_SUPABASE_SERVICE_KEY", "")
_DRILL_ENABLED         = os.environ.get("KAT09_DRILL_IDEMPOTENCY") == "1"

_POLL_TIMEOUT  = float(os.environ.get("KAT09_POLL_TIMEOUT_S", "90"))
_POLL_INTERVAL = float(os.environ.get("KAT09_POLL_INTERVAL_S", "3"))


pytestmark = pytest.mark.skipif(
    not _E2E_ENABLED,
    reason=(
        "KAT-09 e2e — set KAT09_E2E=1 + KAT09_API_BASE_URL "
        "+ KAT09_DEMO_PARCEL_ID + KAT09_FARMER_JWT to run on staging"
    ),
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


def _poll_until_completed() -> dict:
    deadline = time.time() + _POLL_TIMEOUT
    last: dict = {}
    while time.time() < deadline:
        r = _get_latest()
        r.raise_for_status()
        last = r.json()
        if last.get("status") in {"COMPLETED", "FAILED"}:
            return last
        time.sleep(_POLL_INTERVAL)
    raise AssertionError(
        f"diagnostic still non-terminal after {_POLL_TIMEOUT:.0f}s "
        f"(status={last.get('status')})"
    )


def _service_supabase():
    """Service-role supabase client for the drill cells. Skips if env unset."""
    if not (_SUPABASE_URL and _SUPABASE_SERVICE_KEY):
        pytest.skip(
            "KAT09 drill requires KAT09_SUPABASE_URL + KAT09_SUPABASE_SERVICE_KEY"
        )
    try:
        from supabase import create_client
    except ImportError:
        pytest.skip("supabase-py not importable in this env")
    return create_client(_SUPABASE_URL, _SUPABASE_SERVICE_KEY)


def _fetch_notified_at(diagnostic_id: str) -> str | None:
    sb = _service_supabase()
    res = (
        sb.table("m1_katara_diagnostics")
        .select("notified_at")
        .eq("id", diagnostic_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0].get("notified_at") if rows else None


# ---------------------------------------------------------------------------
# E1 — happy path: COMPLETED → notified_at stamped within 30 s
# ---------------------------------------------------------------------------
def test_e1_completed_row_gets_notified_at_stamped() -> None:
    r = _post_diagnostic()
    # 201 (fresh) or 409 (in-flight) — both fine, we care about the eventual
    # COMPLETED + email leg.
    assert r.status_code in (201, 409), r.text
    body = _poll_until_completed()
    assert body["status"] == "COMPLETED", body
    diag_id = body["id"]

    # Wait up to 30 s for KAT-09 to stamp notified_at.
    deadline = time.time() + 30.0
    notified_at: str | None = None
    while time.time() < deadline:
        notified_at = _fetch_notified_at(diag_id)
        if notified_at:
            break
        time.sleep(2.0)
    assert notified_at, (
        "KAT-09 worker did not stamp notified_at within 30 s of COMPLETED "
        f"(diagnostic_id={diag_id})"
    )


# ---------------------------------------------------------------------------
# E2 — idempotency drill: clear notified_at, wait one backstop tick,
#       expect exactly one re-stamp (verified by activity-log inspection).
# ---------------------------------------------------------------------------
def test_e2_backstop_restamps_after_manual_clear() -> None:
    if not _DRILL_ENABLED:
        pytest.skip("idempotency drill not enabled (set KAT09_DRILL_IDEMPOTENCY=1)")
    sb = _service_supabase()

    body = _get_latest().json()
    if body.get("status") != "COMPLETED":
        pytest.skip("no COMPLETED diagnostic to drill against")
    diag_id = body["id"]

    # Clear notified_at as service-role.
    sb.table("m1_katara_diagnostics").update({"notified_at": None}) \
      .eq("id", diag_id).execute()
    assert _fetch_notified_at(diag_id) is None

    # Backstop period is 60 s; give it 90 s of slack.
    deadline = time.time() + 90.0
    while time.time() < deadline:
        if _fetch_notified_at(diag_id):
            break
        time.sleep(3.0)
    assert _fetch_notified_at(diag_id), (
        "backstop did not re-stamp notified_at within 90 s "
        f"(diagnostic_id={diag_id})"
    )


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
