# KAT-09 — Async diagnostic processing: Brevo email on COMPLETED transition

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** System (long-running async worker; no user-facing endpoint, no UI)
> **Depends on:** [KAT-08](./KAT-08-diagnostic-owm-sentinel-gemini-worker.md) (produces the `COMPLETED` state transition + the `result_text` / `farmer_id` / `parcel_id` columns KAT-09 reads; hands off the NOTIFY channel contract in §10) · [NOT-01](../spring-status.yml) (`backend/app/workers/mailer.py` — the single Brevo transport KAT-09 routes through, exactly as KAT-06 did for threshold alerts)
> **Unblocks:** [KAT-10](../spring-status.yml) (KAT-10 adds the `useInterval` polling loop to `DiagnosticSection.tsx`; once KAT-09 is DONE the full farmer-visible flow — request → processing chip → result card → email — is complete) · [I18N-06](../spring-status.yml) (the AR/EN Brevo template variants KAT-09 registers as env keys are the surface I18N-06 populates) · the AUTH-07 matrix's `m1_katara_diagnostics` NOTIFY UPDATE cell (the `AFTER UPDATE` trigger this story ships introduces a new database function that the matrix's D-15 cell verifies)
> **Acceptance:** A verified farmer who requested a diagnostic (KAT-07) receives a Brevo email — in their saved locale — within **30 s end-to-end** of the `m1_katara_diagnostics` row transitioning to `COMPLETED` (KAT-08). The email contains: the parcel name, a summary line ("Your agronomic diagnostic is ready"), and the full `result_text` rendered as formatted HTML. If the worker restarts mid-send, the `notified_at IS NULL` backstop ensures the email is delivered exactly once per diagnostic (no double-send). No email is sent on `FAILED` — the farmer resubmits a new request. The ingest path (KAT-03 SLA < 50 ms) is unaffected — this worker subscribes to a separate NOTIFY channel and holds no ingest-path connection.

---

## 1. Purpose

KAT-08 closes the AI side of the diagnostic pipeline — it picks up a `PENDING` row, calls OWM + Sentinel + Gemini, and writes `status='COMPLETED'`, `result_text=<markdown>`. KAT-09 closes the **notification side**: it detects that COMPLETED transition and dispatches the email that tells the farmer their analysis is ready.

The split is the same discipline applied in KAT-05 → KAT-06: persist first, notify second. Each boundary is a stable contract. KAT-08 deliberately does not own the email (§2 out-of-scope, and explicitly stated in its §10 hand-off) so KAT-09 is a **pure addition** — it adds one DB trigger, one `notified_at` column, one worker package, and three Brevo template references. It touches no existing router, no frontend file, and no other worker.

Concretely KAT-09 delivers:

- **DB migration `0024_kat09_diagnostic_completed_notify.sql`** — two changes on `m1_katara_diagnostics`:
  1. An `ALTER TABLE ... ADD COLUMN notified_at TIMESTAMPTZ` — the idempotency anchor. `NULL` means the email has not yet been sent; a timestamp means it has. The backstop poll filters on `notified_at IS NULL`. No RLS change needed; the column inherits the table's owner-read / service-write policy.
  2. An `AFTER UPDATE` trigger `m1_katara_diagnostics_notify_completed` that fires `pg_notify('katara_diagnostic_completed', new.id::text)` **only when** `old.status IS DISTINCT FROM 'COMPLETED' AND new.status = 'COMPLETED'`. The trigger fires exactly once per diagnostic and never on a FAILED transition.
- **Worker package `backend/app/workers/katara_diagnostic_email/`** — slim version of the `katara_diagnostic` package shape (KAT-08 §1), containing:
  - `__init__.py`, `__main__.py` — Sentry init, JSON logging, signal handlers, `python -m app.workers.katara_diagnostic_email` entrypoint.
  - `listener.py` — LISTEN/NOTIFY on `katara_diagnostic_completed`; identical reconnect logic and `asyncio.Queue(maxsize=256)` pattern; 60 s backstop that polls `m1_katara_diagnostics WHERE status='COMPLETED' AND notified_at IS NULL AND completed_at > now() - interval '30 minutes'`.
  - `sender.py` — `send_diagnostic_email(diagnostic_id)` — fetches the row + farmer profile + parcel name, converts `result_text` Markdown to HTML, calls `mailer.send_template(...)`, and on Brevo 2xx writes `notified_at = now()` via service_role.
- **Docker Compose service `katara_diagnostic_email_worker`** — `vitachain/backend:latest` image, `command: ["python", "-m", "app.workers.katara_diagnostic_email"]`, `restart: unless-stopped`, env-var bindings for Brevo templates + `HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL`.
- **AUTH-05 allow-list** — `workers/katara_diagnostic_email/` prefix added to `_ALLOWED_PREFIXES` in `backend/tests/test_service_client_callsite_allowlist.py`.
- **Brevo template stubs** — three locale HTML files under `infra/brevo-templates/kat09_diagnostic_completion/{fr,ar,en}.html` as recreatable mirrors.
- **Backend tests** — `backend/tests/test_kat09_sender.py` (unit, 5 scenarios) + `backend/tests/test_kat09_listener_e2e.py` (integration, `--run-e2e` gated, 2 scenarios).
- **pgTAP cell D-15** appended to `db/tests/auth07_business_rules.sql` — verifies the NOTIFY trigger fires on PROCESSING→COMPLETED and does **not** fire on PROCESSING→FAILED.
- **`spring-status.yml` flip** — KAT-09 from `TODO` to `IN_REVIEW` + §10 hand-off note for KAT-10.

Once `DONE`, the full KAT-07 → KAT-08 → KAT-09 async loop is closed: farmer requests → worker processes → farmer receives email with the result.

---

## 2. Scope

### In scope

- DB migration `0024_kat09_diagnostic_completed_notify.sql` — `notified_at TIMESTAMPTZ` column + `AFTER UPDATE` NOTIFY trigger on `m1_katara_diagnostics`.
- Worker package `backend/app/workers/katara_diagnostic_email/` — four files: `__init__.py`, `__main__.py`, `listener.py`, `sender.py`.
- LISTEN on `katara_diagnostic_completed`; 30-minute backstop window; `notified_at IS NULL` idempotency guard.
- Brevo dispatch for FR (P0 baseline per PRD §7.2). AR/EN template ids registered in `.env.example` as stubs; dispatch hook in place (I18N-06 fills the template content).
- `result_text` Markdown → HTML conversion using `mistune` (lightweight pure-Python renderer; already in `requirements.in` if KAT-07 added it for the frontend card, otherwise added here).
- `notified_at = now()` write **after** Brevo 2xx — never before (same discipline as KAT-06's `last_alert_at` write).
- Docker Compose service + env-var bindings + Healthchecks heartbeat.
- AUTH-05 allow-list extension.
- Backend unit tests (5 scenarios) + e2e test (`--run-e2e`, 2 scenarios).
- pgTAP cell D-15.
- Brevo template stubs (FR/AR/EN HTML mirrors under `infra/brevo-templates/kat09_diagnostic_completion/`).
- `spring-status.yml` flip + hand-off note for KAT-10.

### Out of scope

- **Frontend polling loop** → [KAT-10](../spring-status.yml). `DiagnosticSection.tsx` already renders the status chip and result card from the initial server prop; KAT-10 adds the `useInterval` so the farmer sees `PROCESSING → COMPLETED` without a page refresh. KAT-09 ships **no `.tsx` file**.
- **AR/EN Brevo template HTML content** → [I18N-06](../spring-status.yml). KAT-09 registers the template-id env keys and writes the dispatch `locale → template_id` map; the populated AR/EN HTML files land in I18N-06.
- **Email on FAILED** — the farmer is not emailed on failure. The COMPLETED-only trigger design is intentional: the next diagnostic request resets the flow, and admin Sentry triage handles failures internally. Post-MVD, a "diagnostic failed, try again" nudge email can be added by extending the trigger's `WHEN` clause and adding a FAILED Brevo template.
- **Rich Markdown rendering beyond `<pre>` fallback** — `mistune` produces clean HTML; more elaborate styling (syntax highlighting, chart embeds) is post-MVD.
- **SMS / WhatsApp / Push** — PRD §7.3 declares email as the only channel for MVD.
- **Per-step status emails** (e.g. "your diagnostic is now PROCESSING") — a single "result ready" email is sufficient for MVD. Intermediate-state emails are a UX refinement for post-MVD.
- **`notified_at` visible in the UI** — the `notified_at` column is operational state for the backstop, not user-facing state. A future story can render a "Emailed at 14:07" line below the result card.
- **Retry logic for Brevo 5xx** — a transient Brevo failure leaves `notified_at = NULL`; the backstop's 30-minute window picks it up on the next poll cycle. Explicit HTTP retry with back-off inside `sender.py` is added if the first staging drill shows Brevo flakiness.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-08](./KAT-08-diagnostic-owm-sentinel-gemini-worker.md) `IN_REVIEW` or `DONE` | `m1_katara_diagnostics` table exists with `status`, `result_text`, `farmer_id`, `parcel_id`, `completed_at` columns. The `PROCESSING → COMPLETED` transition (KAT-08's `mark_completed`) is the event this story's trigger fires on. KAT-08 §10 explicitly reserves the `katara_diagnostic_completed` NOTIFY channel for KAT-09. |
| [NOT-01](../spring-status.yml) `IN_REVIEW` or `DONE` | `backend/app/workers/mailer.py` with `async def send_template(to: str, template_id: int, params: dict, locale: str) -> None`. Without NOT-01, KAT-09 has nowhere to put the Brevo HTTP call. |
| [INF-04](./INF-04-fastapi-backend-scaffold-healthcheck.md) `DONE` | `app.db.service_client()` + `app.core.logging.configure_json_logging()` + the backend base image. Mirrors the KAT-06 and KAT-08 entrypoint patterns. |
| [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) `DONE` | Callsite allowlist test exists; KAT-09 extends `_ALLOWED_PREFIXES` with `app/workers/katara_diagnostic_email/`. |
| [AUTH-07](./AUTH-07-rls-audit-business-rule-test-suite.md) `IN_REVIEW` | KAT-09's D-15 cell extends the matrix. The earlier D-1..D-14 cells (KAT-07 + KAT-08 blocks) must be present. |
| Brevo account + transactional template ids | Three template ids — `BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR`, `BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR`, `BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN` — created in the Brevo dashboard before deploy. FR template is the P0 requirement; AR/EN stubs can point to the FR id temporarily until I18N-06. Template skeleton HTML mirrors live under `infra/brevo-templates/kat09_diagnostic_completion/`. |
| Healthchecks.io check | One check `KAT_DIAGNOSTIC_EMAIL_WORKER_HEARTBEAT`, period 5 min, grace 2 min. Wired in INF-08; this story adds the env-var binding `HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL`. |
| `mistune` in `requirements.in` | Pure-Python Markdown-to-HTML renderer. If not yet present (KAT-07 may have added it for the frontend card), add `mistune>=3.0,<4.0`. |

---

## 4. Data Contract

### 4.1 Schema addition — `notified_at` column

```sql
alter table public.m1_katara_diagnostics
    add column if not exists notified_at timestamptz;
```

- `NULL` → email not yet sent (initial state for all rows, including rows written before KAT-09 deploys).
- Non-null timestamp → email dispatched; the worker will not re-send for this row.
- **RLS**: no change needed. The column inherits the table's existing policies — owner SELECT, admin SELECT, no authenticated UPDATE. The `notified_at` write goes through service_role exactly like the KAT-08 `mark_completed` writes.
- **Backfill**: existing COMPLETED rows (from staging testing of KAT-08) have `notified_at = NULL`. The backstop will attempt to send them on the worker's first boot. This is intentional: KAT-08 staging runs should email the test FARMER account, confirming the full pipeline. Production rows will not exist before KAT-09 deploys.

### 4.2 NOTIFY trigger — `katara_diagnostic_completed`

```
channel  : katara_diagnostic_completed
payload  : '<diagnostic_uuid_text>'
fires on : AFTER UPDATE on m1_katara_diagnostics
when     : old.status IS DISTINCT FROM 'COMPLETED' AND new.status = 'COMPLETED'
```

The `WHEN` clause is precise: it fires once per row, on the first and only time `status` enters `COMPLETED`. It does **not** fire on:
- `FAILED` transitions
- Admin-only column edits on an already-COMPLETED row (e.g. correcting `result_text` for the "Smoke & Mirrors" fallback — the `old.status` would already be `COMPLETED`, failing the `IS DISTINCT FROM` test)
- Re-insertion of an identical status (no-op UPDATEs where old = new)

This design was specified explicitly in KAT-08 §10 hand-off note #1 so KAT-09 owns its own NOTIFY channel cleanly and the AUTH-07 matrix entry for the trigger is unambiguous.

### 4.3 Row fields the worker consumes

All fields are already present on `m1_katara_diagnostics` after KAT-07 + KAT-08:

| Field | Source story | Used in KAT-09 for |
|---|---|---|
| `id` | KAT-07 | NOTIFY payload; service_role UPDATE target for `notified_at` |
| `farmer_id` | KAT-07 (fill trigger) | Join to `profiles` for `email` + `locale` |
| `parcel_id` | KAT-07 (fill trigger) | Join to `m1_katara_parcels` for `name` |
| `result_text` | KAT-08 (`mark_completed`) | Markdown source for the email body |
| `status` | KAT-08 (`mark_completed`) | Backstop filter (`= 'COMPLETED'`) |
| `completed_at` | KAT-08 (`mark_completed`) | Backstop window (`> now() - interval '30 minutes'`) |
| `notified_at` | **KAT-09** (this story) | Idempotency guard (`IS NULL`) |

KAT-09 needs **no new columns** beyond `notified_at`.

### 4.4 Idempotency contract

The worker guarantees at-most-one email per diagnostic via the following invariant:

```
notified_at IS NULL         → eligible for send
notified_at IS NOT NULL     → skip
```

The `notified_at` write is **always after** the Brevo `send_template` 2xx response. This means:

- If the worker crashes after sending but before writing `notified_at`: the backstop will retry → Brevo may send a duplicate. This is the only non-idempotent window, and it is the same trade-off KAT-06 accepts for `last_alert_at`. For MVD scale (50 farmers, rare restarts) this is acceptable.
- If Brevo returns a 4xx: the worker logs the error, does **not** write `notified_at`, and lets the backstop retry. The farmer receives the email eventually (not double).
- If the worker is restarted mid-send: the `notified_at IS NULL` filter in the backstop catches the row and retries.

Post-MVD, a two-phase write (`notified_at = 'PENDING'` before send, `notified_at = now()` after) would eliminate the duplicate window — not needed at MVD scale.

---

## 5. Step-by-Step Implementation

### 5.1 DB migration `0024_kat09_diagnostic_completed_notify.sql`

Create `db/migrations/0024_kat09_diagnostic_completed_notify.sql`:

```sql
-- =============================================================================
-- 0024 — M1 Katara: KAT-09 diagnostic COMPLETED notification trigger.
-- Story: KAT-09 (docs/stories/KAT-09-async-diagnostic-brevo-email-on-completion.md)
--
-- Adds:
--   1. notified_at TIMESTAMPTZ column on m1_katara_diagnostics — idempotency
--      anchor for the email worker (NULL = unsent, non-null = dispatched).
--   2. AFTER UPDATE trigger that emits NOTIFY 'katara_diagnostic_completed'
--      exactly once, on the first PROCESSING → COMPLETED transition.
-- =============================================================================

-- ─── (1) notified_at column ─────────────────────────────────────────────────

alter table public.m1_katara_diagnostics
    add column if not exists notified_at timestamptz;

comment on column public.m1_katara_diagnostics.notified_at is
    'KAT-09 — Timestamp of Brevo email dispatch. NULL = email not yet sent. '
    'Worker writes this after Brevo 2xx; NULL guard prevents double-send on restart.';

-- ─── (2) NOTIFY trigger on COMPLETED transition ─────────────────────────────

create or replace function public.m1_katara_diagnostics_notify_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform pg_notify(
        'katara_diagnostic_completed',
        new.id::text
    );
    return new;
end;
$$;

drop trigger if exists m1_katara_diagnostics_notify_completed
    on public.m1_katara_diagnostics;
create trigger m1_katara_diagnostics_notify_completed
    after update on public.m1_katara_diagnostics
    for each row
    when (old.status is distinct from 'COMPLETED' and new.status = 'COMPLETED')
    execute function public.m1_katara_diagnostics_notify_completed();
```

Run after migration `0023_kat08_diagnostic_notify_and_caches.sql`. The `ALTER TABLE ADD COLUMN IF NOT EXISTS` form is safe to apply multiple times.

---

### 5.2 Worker package layout

```
backend/app/workers/katara_diagnostic_email/
    __init__.py
    __main__.py     # entrypoint — Sentry init, JSON logging, signal handlers
    listener.py     # LISTEN/NOTIFY on katara_diagnostic_completed + 30-min backstop
    sender.py       # fetch row → Markdown → HTML → Brevo → notified_at write
```

This is the slimmest worker in the codebase: one channel, one action, no external API calls beyond Brevo. The shape mirrors `katara_threshold/` (KAT-06) deliberately.

---

### 5.3 `__main__.py` — entrypoint

Create `backend/app/workers/katara_diagnostic_email/__main__.py`:

```python
"""KAT-09 — Diagnostic completion email worker entrypoint.

Mirrors the katara_threshold __main__ from KAT-06 and the
katara_diagnostic __main__ from KAT-08.
"""
from __future__ import annotations

import asyncio
import os
import signal
import sys

import sentry_sdk

from app.core.logging import configure_json_logging
from app.workers.katara_diagnostic_email.listener import run_listener

_log = configure_json_logging("katara_diagnostic_email")


def _init_sentry() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        _log.info("sentry_dsn_unset_skipping_init")
        return
    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=0.1,
        environment=os.getenv("VITACHAIN_ENV", "staging"),
        release=os.getenv("VITACHAIN_RELEASE", "unset"),
    )


def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    stop = asyncio.Event()

    def _on_signal(signame: str) -> None:
        _log.info("signal_received", extra={"signal": signame})
        stop.set()

    if sys.platform == "win32":
        signal.signal(signal.SIGINT,  lambda *_: _on_signal("SIGINT"))
        signal.signal(signal.SIGTERM, lambda *_: _on_signal("SIGTERM"))
    else:
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _on_signal, sig.name)
    loop.create_task(_supervise(stop))


async def _supervise(stop: asyncio.Event) -> None:
    await stop.wait()
    for task in asyncio.all_tasks():
        if task is not asyncio.current_task():
            task.cancel()


def main() -> None:
    _init_sentry()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _install_signal_handlers(loop)
    try:
        loop.run_until_complete(run_listener())
    except asyncio.CancelledError:
        _log.info("worker_shutdown_clean")
    finally:
        loop.close()


if __name__ == "__main__":
    main()
```

---

### 5.4 `listener.py` — LISTEN/NOTIFY + backstop

Create `backend/app/workers/katara_diagnostic_email/listener.py`:

```python
"""KAT-09 listener — LISTEN on katara_diagnostic_completed + 30-min backstop.

Hot path: LISTEN/NOTIFY for sub-second pickup after KAT-08 writes COMPLETED.
Backstop: polls for notified_at IS NULL rows within a 30-minute window to
catch notifications missed during a worker restart.
"""
from __future__ import annotations

import asyncio
import os
from uuid import UUID

import asyncpg
import sentry_sdk

from app.core.logging import get_logger
from app.workers.katara_diagnostic_email.sender import send_diagnostic_email

_log = get_logger(__name__)

_CHANNEL              = "katara_diagnostic_completed"
_BACKSTOP_INTERVAL_S  = 60
_BACKSTOP_WINDOW_MIN  = 30
_QUEUE_MAXSIZE        = 256
_RECONNECT_BACKOFF_S  = (1, 2, 4, 8, 30, 60)
_HEALTHCHECK_INTERVAL = 60


async def run_listener() -> None:
    queue: asyncio.Queue[UUID] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
    asyncio.create_task(_consumer(queue))
    asyncio.create_task(_backstop_loop(queue))
    asyncio.create_task(_healthcheck_loop())
    backoff_idx = 0
    while True:
        try:
            conn = await asyncpg.connect(os.environ["DATABASE_URL"])
            await conn.add_listener(_CHANNEL, _on_notify(queue))
            _log.info("listener_connected", extra={"channel": _CHANNEL})
            await _backstop_once(queue)  # catch rows missed during reconnect
            backoff_idx = 0
            await _stay_alive(conn)
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            delay = _RECONNECT_BACKOFF_S[
                min(backoff_idx, len(_RECONNECT_BACKOFF_S) - 1)
            ]
            backoff_idx += 1
            _log.warning(
                "listener_reconnect",
                extra={"delay_s": delay, "error": repr(exc)},
            )
            await asyncio.sleep(delay)


def _on_notify(queue: asyncio.Queue[UUID]):
    def _handler(_conn, _pid, _channel, payload: str) -> None:
        try:
            uid = UUID(payload)
        except ValueError as exc:
            sentry_sdk.capture_exception(exc)
            _log.warning("listener_bad_payload", extra={"payload": payload})
            return
        try:
            queue.put_nowait(uid)
        except asyncio.QueueFull:
            _log.warning("listener_queue_full_dropping", extra={"id": str(uid)})
    return _handler


async def _stay_alive(conn: asyncpg.Connection) -> None:
    while not conn.is_closed():
        await asyncio.sleep(30)


async def _consumer(queue: asyncio.Queue[UUID]) -> None:
    while True:
        diag_id = await queue.get()
        try:
            await send_diagnostic_email(diag_id)
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            _log.exception("sender_unhandled", extra={"id": str(diag_id)})


async def _backstop_loop(queue: asyncio.Queue[UUID]) -> None:
    while True:
        await asyncio.sleep(_BACKSTOP_INTERVAL_S)
        await _backstop_once(queue)


async def _backstop_once(queue: asyncio.Queue[UUID]) -> None:
    """Poll for COMPLETED rows with notified_at IS NULL within the backstop window."""
    from app.db import service_client  # JUSTIFICATION: KAT-09 worker reads service_role
    import asyncio
    db = service_client()
    from datetime import datetime, timedelta, timezone
    since = (
        datetime.now(timezone.utc) - timedelta(minutes=_BACKSTOP_WINDOW_MIN)
    ).isoformat()
    res = (
        db.table("m1_katara_diagnostics")
        .select("id")
        .eq("status", "COMPLETED")
        .is_("notified_at", "null")
        .gte("completed_at", since)
        .order("completed_at", desc=False)
        .limit(16)
        .execute()
    )
    for row in (res.data or []):
        try:
            queue.put_nowait(UUID(row["id"]))
        except asyncio.QueueFull:
            break


async def _healthcheck_loop() -> None:
    import httpx
    url = os.getenv("HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL")
    if not url:
        return
    while True:
        await asyncio.sleep(_HEALTHCHECK_INTERVAL)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.get(url)
        except Exception:
            pass  # healthcheck failure is informational only
```

---

### 5.5 `sender.py` — fetch + render + dispatch

Create `backend/app/workers/katara_diagnostic_email/sender.py`:

```python
"""KAT-09 — Fetch diagnostic row, render Markdown, dispatch Brevo email.

Writes notified_at AFTER a Brevo 2xx — never before (mirrors KAT-06's
last_alert_at discipline so a Brevo failure leaves the row eligible for retry).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import UUID

import mistune
import sentry_sdk

from app.core.logging import get_logger
from app.db import service_client  # JUSTIFICATION: KAT-09 worker writes notified_at via service_role
from app.workers.mailer import send_template

_log = get_logger(__name__)

_FALLBACK_LOCALE = "fr"

_TEMPLATE_IDS: dict[str, int | None] = {
    "fr": int(os.getenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR", "0") or 0) or None,
    "ar": int(os.getenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR", "0") or 0) or None,
    "en": int(os.getenv("BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN", "0") or 0) or None,
}

_md = mistune.create_markdown(
    escape=False,
    plugins=["strikethrough"],
)


def _resolve_template(locale: str) -> int:
    tid = _TEMPLATE_IDS.get(locale) or _TEMPLATE_IDS.get(_FALLBACK_LOCALE)
    if not tid:
        raise RuntimeError(
            f"BREVO_TEMPLATE_KAT_DIAGNOSTIC_{_FALLBACK_LOCALE.upper()} is not set"
        )
    return tid


async def send_diagnostic_email(diagnostic_id: UUID) -> None:
    db = service_client()

    # 1. Fetch the diagnostic row (guard: skip if already notified)
    diag_res = (
        db.table("m1_katara_diagnostics")
        .select("id,farmer_id,parcel_id,result_text,notified_at")
        .eq("id", str(diagnostic_id))
        .eq("status", "COMPLETED")
        .is_("notified_at", "null")
        .limit(1)
        .execute()
    )
    rows = diag_res.data or []
    if not rows:
        _log.info(
            "sender_skip_already_notified_or_not_found",
            extra={"id": str(diagnostic_id)},
        )
        return
    diag = rows[0]

    # 2. Fetch farmer email + locale
    profile_res = (
        db.table("profiles")
        .select("email,locale")
        .eq("id", diag["farmer_id"])
        .limit(1)
        .execute()
    )
    profile = (profile_res.data or [{}])[0]
    email  = profile.get("email", "")
    locale = profile.get("locale") or _FALLBACK_LOCALE
    if not email:
        _log.warning("sender_no_email", extra={"farmer_id": diag["farmer_id"]})
        return

    # 3. Fetch parcel name
    parcel_res = (
        db.table("m1_katara_parcels")
        .select("name")
        .eq("id", diag["parcel_id"])
        .limit(1)
        .execute()
    )
    parcel_name = ((parcel_res.data or [{}])[0]).get("name", "—")

    # 4. Convert Markdown result_text → HTML
    result_html = _md(diag.get("result_text") or "")

    # 5. Dispatch via NOT-01 mailer
    template_id = _resolve_template(locale)
    await send_template(
        to=email,
        template_id=template_id,
        params={
            "parcel_name":   parcel_name,
            "result_html":   result_html,
            "diagnostic_id": str(diagnostic_id),
        },
        locale=locale,
    )
    sentry_sdk.add_breadcrumb(
        category="kat09",
        message="diagnostic_email_sent",
        data={"id": str(diagnostic_id), "locale": locale},
    )

    # 6. Mark as notified (after Brevo 2xx — idempotency anchor)
    db.table("m1_katara_diagnostics").update({
        "notified_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", str(diagnostic_id)).is_("notified_at", "null").execute()

    _log.info("diagnostic_email_sent", extra={"id": str(diagnostic_id), "locale": locale})
```

The service_role UPDATE at step 6 is filtered on `notified_at IS NULL` — a concurrent worker racing to send the same notification will either find `notified_at` already set (and therefore returned 0 rows earlier at step 1, skipping early) or both workers will attempt the UPDATE and only one will produce a net change (Supabase returns affected rows; the loser's UPDATE is a no-op). The race window is bounded by the `asyncio.Queue` consumer's serial processing of each UUID; at single-replica MVD, the race is impossible via NOTIFY.

---

### 5.6 Docker Compose service

Append to `infra/docker-compose.yml`:

```yaml
  katara_diagnostic_email_worker:
    image: vitachain/backend:latest
    command: ["python", "-m", "app.workers.katara_diagnostic_email"]
    restart: unless-stopped
    depends_on:
      - backend
    environment:
      DATABASE_URL:                                ${DATABASE_URL}
      SUPABASE_URL:                                ${SUPABASE_URL}
      SUPABASE_SERVICE_KEY:                        ${SUPABASE_SERVICE_KEY}
      BREVO_API_KEY:                               ${BREVO_API_KEY}
      BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR:            ${BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR}
      BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR:            ${BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR}
      BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN:            ${BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN}
      SENTRY_DSN:                                  ${SENTRY_DSN}
      HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL:  ${HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL}
      VITACHAIN_ENV:                               ${VITACHAIN_ENV}
    healthcheck:
      test: ["CMD-SHELL", "pgrep -f 'app.workers.katara_diagnostic_email' > /dev/null"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Append to `infra/.env.example`:

```
# KAT-09 — Diagnostic completion email worker
# Brevo template IDs — create once in the Brevo dashboard; see
# infra/brevo-templates/kat09_diagnostic_completion/{fr,ar,en}.html for HTML source.
# AR and EN can temporarily point to the FR id until I18N-06 ships.
# Bitwarden source: "VitaChain Brevo template IDs"
BREVO_TEMPLATE_KAT_DIAGNOSTIC_FR=
BREVO_TEMPLATE_KAT_DIAGNOSTIC_AR=
BREVO_TEMPLATE_KAT_DIAGNOSTIC_EN=
HEALTHCHECKS_KAT_DIAGNOSTIC_EMAIL_PING_URL=
```

---

### 5.7 AUTH-05 callsite allow-list

In `backend/tests/test_service_client_callsite_allowlist.py`, extend `_ALLOWED_PREFIXES`:

```python
_ALLOWED_PREFIXES = (
    "app/workers/katara_threshold/",
    "app/workers/katara_diagnostic/",
    "app/workers/katara_diagnostic_email/",  # ← KAT-09: notified_at write + backstop read
    "app/workers/mailer.py",
    # ...existing entries...
)
```

---

### 5.8 Brevo template stubs

Create three static HTML mirrors under `infra/brevo-templates/kat09_diagnostic_completion/`:

**`fr.html`** — French template (P0):

```html
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Votre diagnostic agronomique est prêt</title></head>
<body>
  <h2>Diagnostic IA — {{ params.parcel_name }}</h2>
  <p>Votre diagnostic agronomique personnalisé est prêt. Voici les résultats :</p>
  <div style="background:#f9f9f9;padding:16px;border-left:4px solid #4CAF50;">
    {{ params.result_html }}
  </div>
  <p style="color:#999;font-size:12px;">
    Diagnostic #{{{ params.diagnostic_id }}} — VitaChain Katara
  </p>
</body>
</html>
```

**`ar.html`** — Arabic template stub (P0 visual requirement; I18N-06 populates full content):

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>تشخيصك الزراعي جاهز</title></head>
<body>
  <!-- I18N-06: replace with full Arabic content -->
  <h2>التشخيص الزراعي — {{ params.parcel_name }}</h2>
  <div style="background:#f9f9f9;padding:16px;border-right:4px solid #4CAF50;">
    {{ params.result_html }}
  </div>
</body>
</html>
```

**`en.html`** — English template stub (P1; I18N-06 populates):

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Your agronomic diagnostic is ready</title></head>
<body>
  <!-- I18N-06: replace with full English content -->
  <h2>AI Diagnostic — {{ params.parcel_name }}</h2>
  <div style="background:#f9f9f9;padding:16px;border-left:4px solid #4CAF50;">
    {{ params.result_html }}
  </div>
</body>
</html>
```

> **Brevo variable syntax** — Brevo transactional templates use `{{ params.key }}` (Handlebars-style). Confirm the correct syntax against the active Brevo plan before copying these stubs to the dashboard.

---

### 5.9 `mistune` dependency

If not already present, add to `backend/requirements.in`:

```
mistune>=3.0,<4.0
```

Then regenerate the lockfile:

```
pip-compile backend/requirements.in -o backend/requirements.txt
```

---

## 6. Design Decisions & Risks

### 6.1 Why a separate worker and not an extension of `katara_diagnostic`?

The KAT-08 worker is CPU-bound on the Gemini step (30 s per diagnostic, asyncio.to_thread). Adding the Brevo dispatch inside the same orchestrator would:

1. Bind the email SLA to Gemini processing time — if Gemini is slow (approaching the 30 s p95 target), the email goes late.
2. Create a single point of failure for both the AI step and the notification step — a Brevo error would obscure a successful Gemini result.
3. Make it impossible to send a retroactive email (e.g. a farmer who had their notification suppressed or who joined a new email address).

A separate worker is four files and one compose service. The additional complexity is negligible; the isolation benefit is real.

### 6.2 Why `notified_at` instead of a separate `notifications` table?

A dedicated `notifications` table would be correct post-MVD (supporting multiple channel types, retry metadata, delivery receipts). For a single email per diagnostic, a nullable column is the simplest possible idempotency mechanism — no join, no extra table in the AUTH-07 matrix, no migration complexity. The `notified_at` column is semantically identical to KAT-06's `last_alert_at` on `m1_katara_thresholds`, which has proven sufficient.

### 6.3 Why the 30-minute backstop window, not 24 hours?

The KAT-08 SLA is `completed_at` within 30 s. A farmer waiting for their email expects it within 2 minutes (PRD §10.1). A 30-minute backstop window covers:

- Worker restart after a crash (SIGKILL during deploy, container OOM).
- asyncpg reconnect gap (NOTIFY messages lost during disconnect are not buffered by Postgres).
- Transient Brevo 5xx (the worker will retry within the next 60 s backstop cycle).

Beyond 30 minutes, the probability that the farmer is still watching their inbox for this particular diagnostic is low. A missed notification beyond 30 minutes should trigger a Sentry alert (the Healthchecks heartbeat silence page handles this) and manual investigation.

### 6.4 Why Markdown → HTML in the worker, not in the Brevo template?

Brevo templates use Handlebars-style variable substitution — they render raw strings, not Markdown. The only options are:

1. Send raw Markdown and wrap it in `<pre>` — readable but ugly.
2. Convert to HTML in the worker and inject it as `result_html` — the template wraps it in a styled `<div>`.
3. Let Brevo do it via a custom filter — Brevo does not offer Markdown filters.

Option 2 was chosen per the KAT-08 §10 hand-off note. `mistune` is the lightest Python Markdown library (no C extensions, pure Python, zero transitive deps). The conversion adds < 1 ms to the send path — negligible compared to the Brevo HTTP call (~200–800 ms).

### 6.5 End-to-end SLA breakdown

| Leg | Target | Component |
|---|---|---|
| KAT-08 `mark_completed` → trigger fires → NOTIFY emitted | < 5 ms | Postgres trigger |
| NOTIFY received by worker asyncpg connection | < 100 ms | asyncpg listener + asyncio.Queue |
| `send_diagnostic_email` fetch + render | < 50 ms | Supabase REST (2-3 queries) + mistune |
| Brevo `send_template` HTTP call | < 500 ms | Brevo transactional API (p50) |
| Brevo internal delivery | < 60 s | Brevo SLA (typically < 5 s) |
| **Total (trigger → inbox)** | **< 2 min** | PRD §10.1 target |

The 30 s end-to-end acceptance criterion in `spring-status.yml` refers to the **trigger → worker send** leg (verifiable on staging), not the Brevo delivery time (outside VitaChain's control).

### 6.6 FAILED diagnostic: no email (deliberate)

The NOTIFY trigger's `WHEN` clause strictly gates on `new.status = 'COMPLETED'`. A `FAILED` transition does not fire it. The reasoning:

- A FAILED diagnostic typically means an external API was unavailable (OWM, Sentinel, Gemini). The farmer can retry; the error is transient. An email saying "your diagnostic failed" would prompt a support request, not a corrective action.
- The farmer's UI already shows the FAILED chip via KAT-10's polling loop. That is the correct UX surface for a failure.
- Post-MVD, a "try again" nudge email for diagnostics stuck in FAILED for > 1 h can be added as a separate scheduled worker.

---

## 7. Tests

### 7.1 `test_kat09_sender.py` (unit, no network)

| # | Scenario | Expected |
|---|---|---|
| S1 | `send_diagnostic_email(id)` on a COMPLETED + `notified_at=NULL` row, all mocks succeed | `mailer.send_template` called once with correct `to`, `template_id`, `params.parcel_name`; `notified_at` UPDATE issued after Brevo call |
| S2 | Row already has `notified_at` set (concurrent worker) | `send_template` not called; `notified_at` UPDATE not issued (step-1 guard returns 0 rows) |
| S3 | `profiles` row has `locale='ar'` | `template_id = _TEMPLATE_IDS['ar']` resolved; fallback to FR if `_TEMPLATE_IDS['ar']` is None |
| S4 | Unsupported locale (`'zgh'`) | Falls back to FR template id (PRD §7.2) |
| S5 | `mailer.send_template` raises a transient exception | Exception propagates out; `notified_at` is **not** written (backstop will retry); Sentry capture occurs in listener consumer |

### 7.2 `test_kat09_listener_e2e.py` (`--run-e2e` gated)

| # | Scenario | Expected |
|---|---|---|
| E1 | Live KAT-08 worker completes a diagnostic on staging (triggered by a verified FARMER POST) | Within 30 s of `completed_at`, the test farmer's inbox contains an email with the correct `parcel_name` and non-empty `result_html`; `notified_at` IS NOT NULL on the row |
| E2 | Worker restarted mid-send (simulated by `SIGKILL` after Brevo call but before `notified_at` write, using a test hook) | Backstop poll within 60 s finds `notified_at IS NULL` and re-dispatches; **exactly one email** received by the test inbox (verified via Brevo API activity log) |

### 7.3 pgTAP cell D-15 — `db/tests/auth07_business_rules.sql`

Append a `KAT-09 — NOTIFY trigger` block:

| Cell | Operation | Expected |
|---|---|---|
| D-15a | service_role UPDATE `status='COMPLETED'` on a PROCESSING row | Trigger fires; `pg_notify('katara_diagnostic_completed', ...)` call visible via `LISTEN` in the same test transaction |
| D-15b | service_role UPDATE `status='FAILED'` on a PROCESSING row | Trigger does **not** fire (WHEN clause `new.status = 'COMPLETED'` is false) |
| D-15c | service_role UPDATE non-status column (`result_text='x'`) on an already-COMPLETED row | Trigger does **not** fire (`old.status IS DISTINCT FROM 'COMPLETED'` is false) |

> **pgTAP limitation**: `pg_notify` side-effects are not directly observable in a rolled-back transaction. Use `pg_listening_channels()` + a `pg_notify` call assertion via `pg_notification_queue_usage()` delta, or rely on the `WHEN` clause inspection pattern from the KAT-03 test suite. The primary value of D-15 is documenting the WHEN clause contract, not live notification delivery.

---

## 8. Observability

| Signal | Where | Detail |
|---|---|---|
| Sentry breadcrumb `diagnostic_email_sent` | Per-send; category `kat09` | Carries `id` + `locale`; visible in any error event's breadcrumb trail |
| Sentry exception capture | `listener.py` consumer, `sender.py` if Brevo raises | Tagged with `diagnostic_id` for correlation with KAT-08 traces |
| Healthchecks.io | `KAT_DIAGNOSTIC_EMAIL_WORKER_HEARTBEAT`; period 5 min, grace 2 min | The `_healthcheck_loop` pings every 60 s; a 5-min silence pages on-call via INF-08's Telegram/Discord bridge |
| Logs (JSON stdout) | `listener_connected`, `listener_reconnect`, `sender_skip_already_notified_or_not_found`, `sender_no_email`, `diagnostic_email_sent`, `listener_queue_full_dropping` | Each carries `id` field for correlation |
| Brevo activity log | Brevo dashboard → "Transactional emails" | Manual verification; lists every send with template id + recipient + delivery status. Demo-day pre-flight checklist item |

---

## 9. Acceptance Verification Checklist

Run on staging before flipping `spring-status.yml` to `IN_REVIEW`:

- [ ] `make -C db push` applies `0024_kat09_diagnostic_completed_notify.sql` cleanly; `notified_at` column visible in Supabase table editor
- [ ] NOTIFY trigger confirmed: `psql -c "LISTEN katara_diagnostic_completed"` in one terminal; `UPDATE m1_katara_diagnostics SET status='COMPLETED' WHERE id=<a-staging-PROCESSING-row>` in another → notification lands within ms
- [ ] NOTIFY trigger does NOT fire: `UPDATE m1_katara_diagnostics SET status='FAILED' WHERE id=<a-PROCESSING-row>` → no notification on the LISTEN terminal
- [ ] `docker compose up -d katara_diagnostic_email_worker` boots; logs show `listener_connected channel=katara_diagnostic_completed` within 5 s
- [ ] Full pipeline e2e: verified FARMER POSTs `/api/v1/katara/parcels/{id}/diagnostics` (KAT-07) → KAT-08 worker reaches COMPLETED (< 30 s) → email received in test inbox (< 30 s of COMPLETED; < 2 min total per PRD §10.1 target)
- [ ] Email body contains: parcel name, rendered HTML from `result_text` (not raw Markdown), diagnostic ID
- [ ] `notified_at` IS NOT NULL on the row after email delivery
- [ ] Backstop idempotency: set `notified_at = NULL` manually on a COMPLETED row, wait 60 s → email re-sent; set `notified_at` back to a timestamp, wait 60 s → no second email
- [ ] `pytest backend/tests/test_kat09_sender.py -v` — all 5 scenarios green
- [ ] `pytest backend/tests/test_kat09_listener_e2e.py --run-e2e -v` — E1 green (E2 optional for staging drill)
- [ ] `make -C db test-auth07` — D-15 cells green
- [ ] `test_service_client_callsite_allowlist.py` green (allow-list extended)
- [ ] Healthchecks.io `KAT_DIAGNOSTIC_EMAIL_WORKER_HEARTBEAT` showing green pings

---

## 10. Hand-off Notes for KAT-10

KAT-10 (diagnostic status polling — the `useInterval` loop in `DiagnosticSection.tsx`) builds on the following contracts:

1. **`GET /diagnostics/latest` is stable** — the endpoint was defined in KAT-07 and has been stable since. KAT-10 only adds a `useInterval` hook that calls `fetchLatestDiagnostic(parcelId)` every 5 s while the latest status is `PENDING` or `PROCESSING`.
2. **Status chip transitions to display** — `DiagnosticSection.tsx` already renders status chips (`PENDING` → yellow, `PROCESSING` → blue spinner, `COMPLETED` → green, `FAILED` → red). KAT-10 does not change the rendering logic; it only adds the polling lifecycle.
3. **`notified_at` is not a frontend concern** — KAT-10 does not need to read or display `notified_at`. The farmer knows the email is coming because the status chip shows `COMPLETED`.
4. **Stop polling condition** — the interval should clear when status reaches a terminal state (`COMPLETED` or `FAILED`) to avoid unnecessary API calls. The existing `fetchLatestDiagnostic` server action is already suitable; KAT-10 can use `useSWR` with a `refreshInterval` that returns `0` on terminal status, or a manual `useInterval` with a `clearInterval` on the terminal check.
5. **Demo-day scenario** — Scenario A from PRD §12 ends with "Receive advice email". The visible demo path is: FARMER clicks **Demander un diagnostic** → status chip updates live to PROCESSING (KAT-10) → COMPLETED chip appears → email arrives on the demo phone. KAT-09 owns the email leg; KAT-10 owns the chip animation. They are independent and can be reviewed in parallel once KAT-07 is DONE.
