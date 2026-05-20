"""KAT-08 — atomic PENDING → PROCESSING claim.

Pure-function tests with a fake service_client. The supabase-py builder is
chainable, so we mimic the surface (.table().update().eq().eq().execute()).
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest


class _FakeBuilder:
    """Records the chain of .table/.update/.eq calls and returns ``rows``."""

    def __init__(self, rows: list[dict]):
        self._rows = rows
        self.calls: list[tuple[str, tuple, dict]] = []

    def _record(self, name: str, *args: object, **kw: object) -> "_FakeBuilder":
        self.calls.append((name, args, kw))
        return self

    def table(self, *a, **k):   return self._record("table",   *a, **k)
    def update(self, *a, **k):  return self._record("update",  *a, **k)
    def eq(self, *a, **k):      return self._record("eq",      *a, **k)
    def execute(self):
        self.calls.append(("execute", (), {}))
        return SimpleNamespace(data=self._rows)


def _patch_service_client(builder: _FakeBuilder):
    return patch(
        "app.workers.katara_diagnostic.claimer.service_client",
        return_value=builder,
    )


def test_claim_pending_returns_row_on_success() -> None:
    from app.workers.katara_diagnostic.claimer import claim_pending

    diag_id = uuid4()
    builder = _FakeBuilder(rows=[{
        "id":         str(diag_id),
        "parcel_id":  str(uuid4()),
        "farmer_id":  str(uuid4()),
        "status":     "PROCESSING",
        "started_at": "2026-05-17T12:00:00+00:00",
    }])
    with _patch_service_client(builder):
        out = asyncio.run(claim_pending(diag_id))
    assert out is not None
    assert out["status"] == "PROCESSING"

    # The UPDATE must be filtered by both id AND status='PENDING' so a row
    # already claimed by a sibling worker (or in a terminal state) is a no-op.
    eq_args = [args for name, args, _ in builder.calls if name == "eq"]
    assert ("id", str(diag_id))    in eq_args
    assert ("status", "PENDING")   in eq_args


def test_claim_pending_returns_none_on_lost_race() -> None:
    """Second worker on the same row sees zero rows back."""
    from app.workers.katara_diagnostic.claimer import claim_pending

    builder = _FakeBuilder(rows=[])
    with _patch_service_client(builder):
        out = asyncio.run(claim_pending(uuid4()))
    assert out is None


def test_claim_pending_returns_none_on_already_processing() -> None:
    """A row that's already PROCESSING falls out of the WHERE clause."""
    from app.workers.katara_diagnostic.claimer import claim_pending

    # Empty rows simulates Supabase returning [] when the filter doesn't match.
    builder = _FakeBuilder(rows=[])
    with _patch_service_client(builder):
        out = asyncio.run(claim_pending(uuid4()))
    assert out is None


def test_claim_pending_returns_none_on_already_completed() -> None:
    from app.workers.katara_diagnostic.claimer import claim_pending

    builder = _FakeBuilder(rows=[])
    with _patch_service_client(builder):
        out = asyncio.run(claim_pending(uuid4()))
    assert out is None


def test_claim_pending_sets_started_at() -> None:
    """The UPDATE payload must set started_at to a non-empty ISO-8601 stamp."""
    from app.workers.katara_diagnostic.claimer import claim_pending

    diag_id = uuid4()
    builder = _FakeBuilder(rows=[{
        "id": str(diag_id), "status": "PROCESSING",
        "parcel_id": str(uuid4()), "farmer_id": str(uuid4()),
        "started_at": "2026-05-17T12:00:00+00:00",
    }])
    with _patch_service_client(builder):
        asyncio.run(claim_pending(diag_id))

    update_calls = [args for name, args, _ in builder.calls if name == "update"]
    assert update_calls, "no .update() call recorded"
    payload = update_calls[0][0]
    assert payload["status"] == "PROCESSING"
    assert isinstance(payload["started_at"], str)
    assert payload["started_at"]  # non-empty


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
