"""KAT-09 — sender unit tests (no network).

Pins the §4.4 idempotency contract + the §5.5 dispatch contract:

  S1  Happy path — Brevo called once, notified_at stamped AFTER 2xx.
  S2  Pre-send guard — already-notified row is silently skipped (no Brevo).
  S3  AR locale — resolves to the AR template id.
  S4  Unsupported locale ("zgh") — falls back to FR.
  S5  Brevo failure — exception propagates; notified_at is NOT written.

All Supabase + Brevo calls are patched. The sender's branch logic is the
unit under test; the listener consumer's last-resort try/except is exercised
by test_kat09_listener_e2e.py on staging.
"""
from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _diag(diag_id: UUID, farmer_id: UUID, parcel_id: UUID,
          notified: bool = False, result_text: str = "## Diagnostic\nOK") -> dict[str, Any]:
    return {
        "id":          str(diag_id),
        "farmer_id":   str(farmer_id),
        "parcel_id":   str(parcel_id),
        "result_text": result_text,
        "notified_at": "2026-05-17T10:00:00+00:00" if notified else None,
        "status":      "COMPLETED",
    }


class _FakeQuery:
    """Minimal supabase-py PostgREST chain stub.

    Builds a description of the chain (`.table('x').select('id').eq(...).execute()`)
    so the sender's per-table call shapes are pinned by the test, and returns a
    pre-seeded payload from a single `_responses` mapping keyed by table.
    """

    def __init__(self, table: str, responses: dict[str, list[dict[str, Any]]],
                 updates_recorder: list[dict[str, Any]] | None = None):
        self._table = table
        self._responses = responses
        self._is_update = False
        self._update_payload: dict[str, Any] = {}
        self._updates_recorder = updates_recorder

    # All chain methods return self (PostgREST builder pattern)
    def select(self, *_a, **_k):       return self
    def eq(self, *_a, **_k):           return self
    def is_(self, *_a, **_k):          return self
    def gte(self, *_a, **_k):          return self
    def order(self, *_a, **_k):        return self
    def limit(self, *_a, **_k):        return self

    def update(self, payload: dict[str, Any]):
        self._is_update = True
        self._update_payload = payload
        return self

    def execute(self):
        resp = MagicMock()
        if self._is_update:
            if self._updates_recorder is not None:
                self._updates_recorder.append({"table": self._table,
                                                "payload": self._update_payload})
            resp.data = [{"id": "row"}]  # supabase returns affected rows
        else:
            resp.data = list(self._responses.get(self._table, []))
        return resp


def _fake_db(responses: dict[str, list[dict[str, Any]]],
             updates_recorder: list[dict[str, Any]] | None = None) -> MagicMock:
    """Build a fake supabase client whose .table(name) returns a _FakeQuery."""
    db = MagicMock()
    db.table.side_effect = lambda name: _FakeQuery(name, responses, updates_recorder)
    return db


def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# S1 — happy path
# ---------------------------------------------------------------------------
def test_s1_happy_path_dispatches_and_marks_notified(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.workers.katara_diagnostic_email import sender

    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR", "111")
    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR", "222")
    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN", "333")

    diag_id, farmer_id, parcel_id = uuid4(), uuid4(), uuid4()
    updates: list[dict[str, Any]] = []
    responses = {
        "m1_katara_diagnostics": [_diag(diag_id, farmer_id, parcel_id)],
        "profiles":              [{"email": "f@x.test", "locale": "fr",
                                    "full_name": "Test Farmer"}],
        "m1_katara_parcels":     [{"name": "Parcelle Nord"}],
    }
    fake_db = _fake_db(responses, updates)

    send_calls: list[dict[str, Any]] = []

    async def _fake_send(*, to, template_id, params, locale):
        send_calls.append({"to": to, "template_id": template_id,
                            "params": params, "locale": locale})
        return {"messageId": "abc"}

    with patch.object(sender, "service_client", return_value=fake_db), \
         patch.object(sender.mailer, "send_template", _fake_send):
        _run(sender.send_diagnostic_email(diag_id))

    assert len(send_calls) == 1
    call = send_calls[0]
    assert call["to"] == "f@x.test"
    assert call["template_id"] == 111
    assert call["locale"] == "fr"
    assert call["params"]["parcel_name"] == "Parcelle Nord"
    assert call["params"]["diagnostic_id"] == str(diag_id)
    assert "<h" in call["params"]["result_html"] or "<p" in call["params"]["result_html"]

    # notified_at UPDATE happened, and was filtered on notified_at IS NULL
    notify_writes = [u for u in updates if "notified_at" in u["payload"]]
    assert len(notify_writes) == 1


# ---------------------------------------------------------------------------
# S2 — already-notified row is silently skipped
# ---------------------------------------------------------------------------
def test_s2_already_notified_skips_brevo_and_update(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.workers.katara_diagnostic_email import sender

    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR", "111")

    diag_id = uuid4()
    updates: list[dict[str, Any]] = []
    # Pre-send guard filters on notified_at IS NULL — return [] to simulate.
    responses: dict[str, list[dict[str, Any]]] = {"m1_katara_diagnostics": []}
    fake_db = _fake_db(responses, updates)

    send_calls: list[dict[str, Any]] = []

    async def _fake_send(*, to, template_id, params, locale):
        send_calls.append({"to": to})
        return {"messageId": "x"}

    with patch.object(sender, "service_client", return_value=fake_db), \
         patch.object(sender.mailer, "send_template", _fake_send):
        _run(sender.send_diagnostic_email(diag_id))

    assert send_calls == []
    assert [u for u in updates if "notified_at" in u["payload"]] == []


# ---------------------------------------------------------------------------
# S3 — AR locale resolves to the AR template id
# ---------------------------------------------------------------------------
def test_s3_ar_locale_resolves_to_ar_template(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.workers.katara_diagnostic_email import sender

    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR", "111")
    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR", "222")

    diag_id, farmer_id, parcel_id = uuid4(), uuid4(), uuid4()
    responses = {
        "m1_katara_diagnostics": [_diag(diag_id, farmer_id, parcel_id)],
        "profiles":              [{"email": "f@x.test", "locale": "ar",
                                    "full_name": ""}],
        "m1_katara_parcels":     [{"name": "P"}],
    }
    fake_db = _fake_db(responses)

    captured: dict[str, Any] = {}

    async def _fake_send(*, to, template_id, params, locale):
        captured.update({"template_id": template_id, "locale": locale})
        return {}

    with patch.object(sender, "service_client", return_value=fake_db), \
         patch.object(sender.mailer, "send_template", _fake_send):
        _run(sender.send_diagnostic_email(diag_id))

    assert captured["template_id"] == 222
    assert captured["locale"] == "ar"


# ---------------------------------------------------------------------------
# S4 — unsupported locale falls back to FR
# ---------------------------------------------------------------------------
def test_s4_unsupported_locale_falls_back_to_fr(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.workers.katara_diagnostic_email import sender

    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR", "111")
    # No AR/EN set.

    diag_id, farmer_id, parcel_id = uuid4(), uuid4(), uuid4()
    responses = {
        "m1_katara_diagnostics": [_diag(diag_id, farmer_id, parcel_id)],
        "profiles":              [{"email": "f@x.test", "locale": "zgh",
                                    "full_name": ""}],
        "m1_katara_parcels":     [{"name": "P"}],
    }
    fake_db = _fake_db(responses)

    captured: dict[str, Any] = {}

    async def _fake_send(*, to, template_id, params, locale):
        captured.update({"template_id": template_id, "locale": locale})
        return {}

    with patch.object(sender, "service_client", return_value=fake_db), \
         patch.object(sender.mailer, "send_template", _fake_send):
        _run(sender.send_diagnostic_email(diag_id))

    assert captured["template_id"] == 111
    assert captured["locale"] == "fr"


# ---------------------------------------------------------------------------
# S5 — Brevo failure propagates and notified_at is NOT written
# ---------------------------------------------------------------------------
def test_s5_brevo_failure_propagates_without_marking_notified(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.workers.katara_diagnostic_email import sender
    from app.workers.mailer import MailerError

    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR", "111")

    diag_id, farmer_id, parcel_id = uuid4(), uuid4(), uuid4()
    updates: list[dict[str, Any]] = []
    responses = {
        "m1_katara_diagnostics": [_diag(diag_id, farmer_id, parcel_id)],
        "profiles":              [{"email": "f@x.test", "locale": "fr",
                                    "full_name": ""}],
        "m1_katara_parcels":     [{"name": "P"}],
    }
    fake_db = _fake_db(responses, updates)

    async def _fake_send(**_k):
        raise MailerError("brevo_non_2xx status=503")

    with patch.object(sender, "service_client", return_value=fake_db), \
         patch.object(sender.mailer, "send_template", _fake_send):
        with pytest.raises(MailerError):
            _run(sender.send_diagnostic_email(diag_id))

    # The audit write must NOT have happened — leaves the row eligible for
    # the backstop's next retry cycle.
    notify_writes = [u for u in updates if "notified_at" in u["payload"]]
    assert notify_writes == []


# ---------------------------------------------------------------------------
# S6 — no email on profile silently returns (no Brevo, no audit write)
# ---------------------------------------------------------------------------
def test_s6_missing_email_skips_silently(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.workers.katara_diagnostic_email import sender

    monkeypatch.setenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR", "111")

    diag_id, farmer_id, parcel_id = uuid4(), uuid4(), uuid4()
    updates: list[dict[str, Any]] = []
    responses = {
        "m1_katara_diagnostics": [_diag(diag_id, farmer_id, parcel_id)],
        "profiles":              [{"email": "", "locale": "fr", "full_name": ""}],
        "m1_katara_parcels":     [{"name": "P"}],
    }
    fake_db = _fake_db(responses, updates)

    send_calls: list[Any] = []

    async def _fake_send(**_k):
        send_calls.append(1)
        return {}

    with patch.object(sender, "service_client", return_value=fake_db), \
         patch.object(sender.mailer, "send_template", _fake_send):
        _run(sender.send_diagnostic_email(diag_id))

    assert send_calls == []
    assert [u for u in updates if "notified_at" in u["payload"]] == []


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
