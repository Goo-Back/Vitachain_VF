"""KAT-08 — terminal-state UPDATE helpers.

Both filter on ``status='PROCESSING'`` so a row already terminated by an
admin override (e.g. a manual ``status='COMPLETED', result_text='Démonstration
pré-enregistrée'`` set via the Supabase dashboard — the Risk Register R5
"Smoke & Mirrors" fallback) is never silently overwritten.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

# JUSTIFICATION: KAT-08 worker writes m1_katara_diagnostics terminal columns
# (status / result_text / error_detail / completed_at) via service-role per
# the KAT-07 audit-guard contract — non-service writers are silently clamped
# back to OLD values. AUTH-05 allow-list entry: workers/.
from app.db import service_client

log = logging.getLogger("katara_diagnostic.updater")

_ERROR_DETAIL_MAX = 1000


def mark_completed(diagnostic_id: UUID, result_text: str) -> None:
    """Land a COMPLETED transition. PROCESSING-gated."""
    db = service_client()
    res = (
        db.table("m1_katara_diagnostics")
        .update(
            {
                "status":       "COMPLETED",
                "result_text":  result_text,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", str(diagnostic_id))
        .eq("status", "PROCESSING")
        .execute()
    )
    if not (res.data or []):
        log.warning(
            "mark_completed_no_op id=%s "
            "(admin override or another worker beat us)",
            str(diagnostic_id),
        )


def mark_failed(diagnostic_id: UUID, error_detail: str) -> None:
    """Land a FAILED transition. PROCESSING-gated. ``error_detail`` is capped."""
    db = service_client()
    res = (
        db.table("m1_katara_diagnostics")
        .update(
            {
                "status":       "FAILED",
                "error_detail": error_detail[:_ERROR_DETAIL_MAX],
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", str(diagnostic_id))
        .eq("status", "PROCESSING")
        .execute()
    )
    if not (res.data or []):
        log.warning(
            "mark_failed_no_op id=%s "
            "(admin override or another worker beat us)",
            str(diagnostic_id),
        )
