"""KAT-08 — atomic PENDING → PROCESSING claim.

A single ``UPDATE ... WHERE status='PENDING' RETURNING *`` is the only legal
transition out of PENDING. If two workers race for the same row (single
replica today, contract supports N), exactly one UPDATE returns a row;
losers see an empty result and silently exit — idempotent.

The supabase-py client returns the affected rows via ``Prefer: return=representation``
by default, matching the contract the KAT-06 evaluator already relies on for
``last_alert_at``.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

# JUSTIFICATION: KAT-08 worker writes m1_katara_diagnostics.status / started_at
# via service-role per the KAT-07 audit-guard contract — that trigger silently
# clamps non-service writers, so this worker is the only legitimate writer of
# the PENDING → PROCESSING transition. AUTH-05 allow-list entry: workers/.
from app.db import service_client

log = logging.getLogger("katara_diagnostic.claimer")


async def claim_pending(diagnostic_id: UUID) -> dict[str, Any] | None:
    """Try to claim a PENDING row. Returns the post-claim row or ``None``.

    The UPDATE is filtered on ``status='PENDING'`` so a row already claimed
    by a sibling worker (or already terminal) returns no rows — we exit
    silently and the consumer continues with the next notification.

    Parameters
    ----------
    diagnostic_id:
        The ``m1_katara_diagnostics.id`` published on the NOTIFY channel.
    """
    db = service_client()
    res = (
        db.table("m1_katara_diagnostics")
        .update(
            {
                "status":     "PROCESSING",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", str(diagnostic_id))
        .eq("status", "PENDING")
        .execute()
    )
    rows = res.data or []
    if not rows:
        log.info(
            "claim_lost_or_terminal id=%s "
            "(another worker won, or row already terminal)",
            str(diagnostic_id),
        )
        return None
    return rows[0]
