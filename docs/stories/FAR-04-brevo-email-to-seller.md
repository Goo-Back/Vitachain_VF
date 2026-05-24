> ⚠️ **OBSOLETE — REWRITE IN PROGRESS (2026-05-24)** ⚠️
>
> The lead-email-with-buyer-contact flow described below has been removed:
> migration 0039 drops `m2_farmarket_leads` and the NOTIFY trigger;
> `backend/app/workers/farmarket_lead_email/` is deleted; the compose
> service `farmarket_lead_email_worker` is removed (Phase A of the
> FarMarket pivot). FarMarket now operates as a logistics intermediary —
> the new FAR-04 will deliver an *anonymised* order notification to the
> producer with zero buyer identifiers (no name, phone, email, or
> address).
>
> This file is retained only as historical context until the new FAR-04
> spec is written. **Do not implement anything below.**

# FAR-04 — Brevo email to seller with buyer contact details  [OBSOLETE]

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** System (triggered by FAR-03 lead insert)
> **Depends on:** [FAR-03](./FAR-03-restaurateur-contacts-seller.md) (`m2_farmarket_leads` table + lead insert), [NOT-01](./NOT-01-brevo-transactional-mailer.md) (`app.workers.mailer` transport + `BREVO_API_KEY`)
> **Unblocks:** [FAR-08](./FAR-08-admin-views-ads-leads.md) (admin lead dashboard — now includes email delivery state via `notified_at`)
> **Acceptance:** Seller (farmer) receives a Brevo email containing the buyer's phone number, message, name, and email within 2 minutes of the FAR-03 contact form submission. BR-F4 enforced: Brevo API key never in frontend; all email work in the FastAPI backend worker.

---

## 1. Purpose

FAR-03 persists a lead row when a restaurateur submits the contact form. FAR-04 closes the notification loop: the farmer (seller) receives a transactional email with the buyer's full contact details so they can follow up directly and close a deal — eliminating the middleman.

This story delivers:

- Migration `0035_far04_farmarket_lead_notify.sql` — adds `notified_at` to `m2_farmarket_leads` + an AFTER INSERT trigger that fires `NOTIFY farmarket_lead_created, '<lead_id>'`.
- New worker package `backend/app/workers/farmarket_lead_email/` with `sender.py`, `listener.py`, `templates.py`, `__init__.py`, and `__main__.py`.
- Backend unit tests `backend/tests/test_far04_brevo_email_to_seller.py`.
- pgTAP cells F-04a through F-04c appended to `db/tests/auth07_business_rules.sql`.
- `infra/docker-compose.yml` — new `farmarket-lead-email` service (one-line addition alongside other workers).
- `.env.example` — three new `BREVO_TEMPLATE_FAR_LEAD_*` keys.

---

## 2. Scope

### In scope

- Migration 0035 — `notified_at` column + `m2_farmarket_notify_lead_created()` trigger function + AFTER INSERT trigger.
- `farmarket_lead_email` worker — LISTEN/NOTIFY + 30-minute backstop + heartbeat.
- `sender.py` — fetch lead + ad + farmer profile + buyer profile → Brevo dispatch → stamp `notified_at`.
- `templates.py` — template ID resolution (FR / AR / EN) with FR fallback.
- `listener.py` — LISTEN on `farmarket_lead_created` channel with exponential-backoff reconnect.
- `__main__.py` — asyncio entry point.
- Backend unit tests (sender schema + role gate).
- pgTAP cells pinning the NOTIFY trigger + `notified_at` column contract.
- `infra/docker-compose.yml` worker service entry.

### Out of scope

- Admin lead status updates (PENDING → CONTACTED / CLOSED) → **FAR-08**.
- Rate-limiting one email per buyer-per-ad → post-MVD hardening.
- Brevo delivery receipt / bounce tracking → post-MVD.
- In-app notification to seller → post-MVD.
- Real-time lead count badge on farmer dashboard → post-MVD.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [FAR-03](./FAR-03-restaurateur-contacts-seller.md) `DONE` | `public.m2_farmarket_leads` table + RLS must exist. Migration 0034 applied. |
| [NOT-01](./NOT-01-brevo-transactional-mailer.md) `DONE` | `app.workers.mailer.send_template` available; `BREVO_API_KEY` configured in `.env`. |
| [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) `DONE` | `service_client()` allow-list must include `workers/farmarket_lead_email/` before the PR merges. |
| Migration 0034 applied | No gap before 0035. |
| Brevo templates created | `BREVO_TEMPLATE_FAR_LEAD_FR` (mandatory), `_AR`, `_EN` (stubs OK). |

---

## 4. Architecture Overview

```
POST /api/v1/farmarket/ads/{ad_id}/leads   (FAR-03 handler)
        │
        │  DB INSERT → m2_farmarket_leads
        │
        ▼
 trg_far04_notify_lead_created  (AFTER INSERT trigger)
        │
        │  NOTIFY farmarket_lead_created, '<lead_id>'
        │
        ▼
 workers/farmarket_lead_email/listener.py
        │
        │  _parse_payload(lead_id)
        ▼
 workers/farmarket_lead_email/sender.py :: send_lead_email(lead_id)
        ├── service_client() → SELECT lead row (notified_at IS NULL guard)
        ├── service_client() → SELECT m2_farmarket_ads (farmer_id, title, product_type)
        ├── service_client() → SELECT profiles (farmer email, locale, full_name)
        ├── service_client() → SELECT profiles (buyer email, full_name)
        ├── mailer.send_template(to=farmer_email, template_id=..., params={...})
        └── service_client() → UPDATE notified_at = now() (idempotency anchor)
```

**Delivery guarantee**: LISTEN/NOTIFY is near-real-time (< 1 s lag on the same host). The 30-minute backstop re-scans `notified_at IS NULL` rows to catch notifications missed during a worker restart or DB connection drop. This combination guarantees at-least-once delivery within 2 minutes under normal conditions.

**BR-F4 satisfied**: The Brevo API key lives in `BREVO_API_KEY` env var, read inside `app.workers.mailer` — never in frontend code or the FAR-03 router.

---

## 5. Data Model Changes

### 5.1 New column on `m2_farmarket_leads`

| Column | Type | Default | Notes |
|---|---|---|---|
| `notified_at` | `timestamptz` | `NULL` | Stamped by the worker after Brevo 2xx. `NULL` = not yet emailed. Idempotency anchor: worker filters on `notified_at IS NULL` to skip already-sent leads. |

### 5.2 New trigger function and trigger

| Object | Type | Notes |
|---|---|---|
| `public.m2_farmarket_notify_lead_created()` | `RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER` | Fires `NOTIFY farmarket_lead_created, NEW.id::text`. |
| `trg_far04_notify_lead_created` | `AFTER INSERT ON m2_farmarket_leads FOR EACH ROW` | Executes the function above. |

---

## 6. Step-by-Step Implementation

### 6.1 Migration 0035 — `notified_at` column + NOTIFY trigger

Create [db/migrations/0035_far04_farmarket_lead_notify.sql](../../db/migrations/0035_far04_farmarket_lead_notify.sql):

```sql
-- =============================================================================
-- 0035 — M2 FarMarket: lead-created NOTIFY trigger + notified_at column.
-- Story:  FAR-04 (docs/stories/FAR-04-brevo-email-to-seller.md)
--
-- Adds notified_at to m2_farmarket_leads so the farmarket_lead_email worker
-- can use it as an idempotency anchor (worker only sends when NULL).
--
-- The AFTER INSERT trigger fires NOTIFY farmarket_lead_created with the new
-- lead UUID as payload. The worker's listener picks it up and dispatches the
-- Brevo email to the farmer (seller).
--
-- SECURITY DEFINER on the trigger function is required so the function can
-- call pg_notify() even when the caller is the authenticated role (PostgREST).
-- search_path is locked to public, pg_temp to prevent search-path attacks.
-- =============================================================================

-- ── 1. Add notified_at ────────────────────────────────────────────────────────

alter table public.m2_farmarket_leads
    add column if not exists notified_at timestamptz;

-- Index used by the backstop scan: unnotified leads in the last 30 min.
create index if not exists m2_farmarket_leads_unnotified_idx
    on public.m2_farmarket_leads (created_at desc)
    where notified_at is null;

-- ── 2. NOTIFY trigger function ────────────────────────────────────────────────

create or replace function public.m2_farmarket_notify_lead_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform pg_notify('farmarket_lead_created', new.id::text);
    return new;
end;
$$;

-- Only the trigger itself needs EXECUTE — revoke from all other roles.
revoke execute on function public.m2_farmarket_notify_lead_created() from public;

-- ── 3. Attach trigger ─────────────────────────────────────────────────────────

drop trigger if exists trg_far04_notify_lead_created on public.m2_farmarket_leads;
create trigger trg_far04_notify_lead_created
    after insert on public.m2_farmarket_leads
    for each row
    execute function public.m2_farmarket_notify_lead_created();
```

Apply:

```bash
supabase db push
```

Verify in the Supabase Dashboard:
- `m2_farmarket_leads` now has a `notified_at` column (nullable `timestamptz`).
- One new index `m2_farmarket_leads_unnotified_idx` listed on the table.
- Trigger `trg_far04_notify_lead_created` listed under `m2_farmarket_leads` triggers.

---

### 6.2 Worker package — directory structure

Create the following files under [backend/app/workers/farmarket_lead_email/](../../backend/app/workers/farmarket_lead_email/):

```
backend/app/workers/farmarket_lead_email/
├── __init__.py
├── __main__.py
├── templates.py
├── sender.py
└── listener.py
```

---

### 6.3 `__init__.py`

Create [backend/app/workers/farmarket_lead_email/\_\_init\_\_.py](../../backend/app/workers/farmarket_lead_email/__init__.py):

```python
"""FAR-04 — farmarket_lead_email worker package."""
```

---

### 6.4 `templates.py` — Brevo template ID resolution

Create [backend/app/workers/farmarket_lead_email/templates.py](../../backend/app/workers/farmarket_lead_email/templates.py):

```python
"""FAR-04 — Brevo template ID resolution for farmarket.lead emails.

Env vars:
    BREVO_TEMPLATE_FAR_LEAD_FR  (required — P0 locale per PRD §7.2)
    BREVO_TEMPLATE_FAR_LEAD_AR  (stub OK for MVD)
    BREVO_TEMPLATE_FAR_LEAD_EN  (stub OK for MVD)

Fallback chain: requested_locale → fr (PRD §7.2 — never raise for unsupported).
"""
from __future__ import annotations

import os

from app.workers.mailer import MailerError

_SUPPORTED_LOCALES = ("fr", "ar", "en")
_FALLBACK_LOCALE = "fr"

_TEMPLATE_ENV: dict[str, str] = {
    "fr": "BREVO_TEMPLATE_FAR_LEAD_FR",
    "ar": "BREVO_TEMPLATE_FAR_LEAD_AR",
    "en": "BREVO_TEMPLATE_FAR_LEAD_EN",
}


def resolve_template(locale: str | None) -> tuple[int, str]:
    """Return ``(template_id, resolved_locale)``.

    Falls back to FR when the requested locale is unsupported or its template
    env var is unset. Raises :class:`~app.workers.mailer.MailerError` only when
    the FR fallback template is also unset — this is a hard misconfiguration.
    """
    loc = (locale or "").lower().strip()
    if loc not in _SUPPORTED_LOCALES:
        loc = _FALLBACK_LOCALE

    env_key = _TEMPLATE_ENV.get(loc, _TEMPLATE_ENV[_FALLBACK_LOCALE])
    raw = os.getenv(env_key, "") or ""
    try:
        tid = int(raw)
    except (ValueError, TypeError):
        tid = 0

    if not tid:
        # Locale-specific template not configured — fall back to FR.
        loc = _FALLBACK_LOCALE
        raw_fr = os.getenv(_TEMPLATE_ENV[_FALLBACK_LOCALE], "") or ""
        try:
            tid = int(raw_fr)
        except (ValueError, TypeError):
            tid = 0

    if not tid:
        raise MailerError(
            "BREVO_TEMPLATE_FAR_LEAD_FR is not set — refusing to send lead email"
        )

    return tid, loc
```

---

### 6.5 `sender.py` — email payload assembly + dispatch

Create [backend/app/workers/farmarket_lead_email/sender.py](../../backend/app/workers/farmarket_lead_email/sender.py):

```python
"""FAR-04 — fetch lead + ad + profiles, dispatch Brevo email, stamp notified_at.

Idempotency contract mirrors KAT-09:
  1. Fetch the lead row filtered on ``notified_at IS NULL``. If already stamped
     (a concurrent worker won the race), return silently.
  2. Send via NOT-01 mailer.
  3. Stamp ``notified_at = now()`` also filtered on ``notified_at IS NULL``.
     If another worker stamped it between steps 1 and 3, the UPDATE affects
     0 rows — which is fine; only one email was sent (step 2 is idempotent
     because Brevo deduplicates on message-id within a short window).
"""
from __future__ import annotations

import logging
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import sentry_sdk

# JUSTIFICATION: FAR-04 worker reads m2_farmarket_leads + m2_farmarket_ads +
# profiles for the Brevo payload and writes m2_farmarket_leads.notified_at via
# the service-role DSN. The user JWT is not in scope here — the worker reacts
# to a system NOTIFY. AUTH-05 allow-list entry: workers/farmarket_lead_email/.
from app.db import service_client
from app.workers import mailer
from app.workers.farmarket_lead_email.templates import resolve_template

log = logging.getLogger("farmarket_lead_email.sender")

_LEADS_TABLE = "m2_farmarket_leads"
_ADS_TABLE   = "m2_farmarket_ads"
_PROFILES    = "profiles"


def _fetch_lead(lead_id: UUID) -> dict[str, Any] | None:
    """Return the lead row if ``notified_at IS NULL``, else None (already sent)."""
    db = service_client()
    res = (
        db.table(_LEADS_TABLE)
        .select("id, ad_id, buyer_id, message, buyer_phone, notified_at")
        .eq("id", str(lead_id))
        .is_("notified_at", "null")
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_ad(ad_id: str) -> dict[str, Any]:
    db = service_client()
    res = (
        db.table(_ADS_TABLE)
        .select("farmer_id, title, product_type")
        .eq("id", ad_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else {}


def _fetch_profile(user_id: str) -> dict[str, Any]:
    db = service_client()
    res = (
        db.table(_PROFILES)
        .select("email, full_name, locale")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else {}


def _stamp_notified(lead_id: UUID) -> int:
    """Set ``notified_at = now()``, filtered on ``notified_at IS NULL``.

    Returns the number of rows affected (0 if a concurrent worker beat us).
    """
    db = service_client()
    res = (
        db.table(_LEADS_TABLE)
        .update({"notified_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", str(lead_id))
        .is_("notified_at", "null")
        .execute()
    )
    return len(res.data or [])


async def send_lead_email(lead_id: UUID) -> None:
    """End-to-end send for one contact lead.

    Never raises on the happy path. Brevo / DB errors propagate to the
    listener's consumer task, which Sentry-captures them and leaves the row
    eligible for the backstop retry — the same discipline as KAT-06/KAT-09.
    """
    # 1. Pre-send guard — skip if already notified.
    lead = _fetch_lead(lead_id)
    if lead is None:
        log.info("sender_skip_already_notified_or_not_found id=%s", str(lead_id))
        return

    # 2. Fetch ad — we need farmer_id, title, product_type.
    ad_id = lead.get("ad_id")
    if not ad_id:
        log.warning("sender_missing_ad_id lead_id=%s", str(lead_id))
        return
    ad = _fetch_ad(str(ad_id))
    farmer_id = ad.get("farmer_id")
    if not farmer_id:
        log.warning("sender_missing_farmer_id lead_id=%s ad_id=%s", str(lead_id), ad_id)
        return

    # 3. Farmer profile — email, locale, full name.
    farmer = _fetch_profile(str(farmer_id))
    farmer_email = (farmer.get("email") or "").strip()
    if not farmer_email:
        log.warning(
            "sender_no_farmer_email lead_id=%s farmer_id=%s",
            str(lead_id), str(farmer_id),
        )
        return
    farmer_locale = farmer.get("locale")

    # 4. Buyer profile — email, full name (supplemental info for the farmer).
    buyer_id = lead.get("buyer_id")
    buyer: dict[str, Any] = _fetch_profile(str(buyer_id)) if buyer_id else {}

    # 5. Resolve Brevo template for the farmer's locale.
    template_id, locale = resolve_template(farmer_locale)

    params: dict[str, Any] = {
        "farmer_name":   farmer.get("full_name") or "",
        "ad_title":      ad.get("title") or "",
        "product_type":  ad.get("product_type") or "",
        "buyer_name":    buyer.get("full_name") or "",
        "buyer_email":   buyer.get("email") or "",
        "buyer_phone":   lead.get("buyer_phone") or "",
        "buyer_message": lead.get("message") or "",
        "lead_id":       str(lead_id),
    }

    # 6. Dispatch via NOT-01 mailer transport.
    await mailer.send_template(
        to=farmer_email,
        template_id=template_id,
        params=params,
        locale=locale,
    )

    with suppress(Exception):
        sentry_sdk.add_breadcrumb(
            category="far04",
            message="lead_email_sent",
            data={"lead_id": str(lead_id), "locale": locale},
        )

    # 7. Stamp notified_at — idempotency anchor for the backstop.
    affected = _stamp_notified(lead_id)
    log.info(
        "lead_email_sent lead_id=%s locale=%s notified_rows=%d",
        str(lead_id), locale, affected,
    )
```

---

### 6.6 `listener.py` — LISTEN/NOTIFY lifecycle + backstop

Create [backend/app/workers/farmarket_lead_email/listener.py](../../backend/app/workers/farmarket_lead_email/listener.py):

```python
"""FAR-04 — LISTEN/NOTIFY lifecycle + 30-minute backstop.

Subscribes to the ``farmarket_lead_created`` channel emitted by migration
0035's AFTER INSERT trigger. Decodes the lead UUID payload and delegates to
:func:`~app.workers.farmarket_lead_email.sender.send_lead_email`.

Reliability layers:
  * LISTEN/NOTIFY — near-real-time (< 1 s on same host).
  * Post-reconnect backstop (:func:`_backstop_once`) — closes the NOTIFY gap
    that occurs when the asyncpg LISTEN connection drops. Postgres does NOT
    buffer NOTIFY messages across dropped listeners.
  * Periodic backstop (:func:`_backstop_loop`) — every 60 s, re-scans the
    last 30 minutes of leads with ``notified_at IS NULL``. Idempotent thanks
    to the ``notified_at IS NULL`` guard in :func:`send_lead_email`.
  * Heartbeat — 60-second ping to ``HEALTHCHECKS_FAR_LEAD_EMAIL_PING_URL``.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any
from uuid import UUID

import httpx

if TYPE_CHECKING:
    import asyncpg

from app.workers.farmarket_lead_email.sender import send_lead_email

log = logging.getLogger("farmarket_lead_email.listener")

CHANNEL             = "farmarket_lead_created"
BACKOFF_SEQ: tuple[int, ...] = (1, 2, 4, 8, 30, 60)
HEARTBEAT_PERIOD_S  = 60
BACKSTOP_PERIOD_S   = 60
BACKSTOP_WINDOW_MIN = 30
BACKSTOP_LIMIT      = 32
QUEUE_MAX           = 256


def _parse_payload(payload: str | None) -> UUID | None:
    if not payload:
        return None
    try:
        return UUID(payload.strip())
    except (ValueError, AttributeError):
        return None


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_FAR_LEAD_EMAIL_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)


async def _wait_or_stop(stop_event: asyncio.Event, timeout: float) -> bool:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=timeout)
        return True
    except asyncio.TimeoutError:
        return False


async def _heartbeat_loop(stop_event: asyncio.Event) -> None:
    async with httpx.AsyncClient() as client:
        await _ping_heartbeat(client)
        while not stop_event.is_set():
            if await _wait_or_stop(stop_event, HEARTBEAT_PERIOD_S):
                return
            await _ping_heartbeat(client)


async def _consume_queue(
    queue: asyncio.Queue[str],
    stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        try:
            payload = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue

        lead_id = _parse_payload(payload)
        if lead_id is None:
            log.warning("malformed_notification_payload payload=%r", payload)
            with suppress(Exception):
                import sentry_sdk
                sentry_sdk.capture_message(
                    f"farmarket_lead_email malformed payload: {payload!r}",
                    level="warning",
                )
            continue

        try:
            await send_lead_email(lead_id)
        except Exception:
            log.exception("sender_unhandled lead_id=%s", str(lead_id))
            with suppress(Exception):
                import sentry_sdk
                sentry_sdk.capture_exception()


async def _scan_unnotified_ids() -> list[UUID]:
    """Backstop scan — leads with ``notified_at IS NULL`` in the last 30 min."""
    from app.db import service_client
    # JUSTIFICATION: FAR-04 backstop scans m2_farmarket_leads via service_role
    # to find unnotified rows. User JWT not available here — AUTH-05
    # allow-list entry: workers/farmarket_lead_email/.
    db = service_client()
    since = (
        datetime.now(timezone.utc) - timedelta(minutes=BACKSTOP_WINDOW_MIN)
    ).isoformat()
    res = (
        db.table("m2_farmarket_leads")
        .select("id")
        .is_("notified_at", "null")
        .gte("created_at", since)
        .order("created_at", desc=False)
        .limit(BACKSTOP_LIMIT)
        .execute()
    )
    out: list[UUID] = []
    for row in (res.data or []):
        try:
            out.append(UUID(str(row["id"])))
        except (KeyError, ValueError):
            continue
    return out


async def _backstop_once(queue: asyncio.Queue[str]) -> None:
    try:
        ids = await _scan_unnotified_ids()
    except Exception:
        log.exception("backstop_query_failed")
        return
    log.info("backstop_pass row_count=%d", len(ids))
    for lead_id in ids:
        try:
            queue.put_nowait(str(lead_id))
        except asyncio.QueueFull:
            log.warning("backstop_queue_full dropping_remaining=%d", len(ids))
            return


async def _backstop_loop(queue: asyncio.Queue[str], stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        if await _wait_or_stop(stop_event, BACKSTOP_PERIOD_S):
            return
        await _backstop_once(queue)


def _make_notification_handler(queue: asyncio.Queue[str]) -> Any:
    def _handler(
        _conn: "asyncpg.Connection",
        _pid: int,
        channel: str,
        payload: str,
    ) -> None:
        if channel != CHANNEL:
            return
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            log.warning("notification_queue_full dropping=%r", payload)

    return _handler


async def _hold_listen_connection(
    conn: "asyncpg.Connection", stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set() and not conn.is_closed():
        if await _wait_or_stop(stop_event, 5.0):
            return


async def run_listener(stop_event: asyncio.Event) -> None:
    """Top-level loop. Owns asyncpg pool + consumer / backstop / heartbeat."""
    import asyncpg

    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=2,
        max_size=4,
        command_timeout=10.0,
    )
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_MAX)

    consumer  = asyncio.create_task(_consume_queue(queue, stop_event))
    backstop  = asyncio.create_task(_backstop_loop(queue, stop_event))
    heartbeat = asyncio.create_task(_heartbeat_loop(stop_event))

    backoff_idx = 0
    listen_conn: "asyncpg.Connection | None" = None
    handler = _make_notification_handler(queue)

    try:
        while not stop_event.is_set():
            try:
                listen_conn = await pool.acquire()
                await listen_conn.add_listener(CHANNEL, handler)
                log.info("listener_subscribed channel=%s", CHANNEL)
                backoff_idx = 0
                await _backstop_once(queue)
                await _hold_listen_connection(listen_conn, stop_event)
            except (asyncpg.PostgresConnectionError, OSError, ConnectionError) as exc:
                wait_s = BACKOFF_SEQ[min(backoff_idx, len(BACKOFF_SEQ) - 1)]
                log.warning(
                    "listener_disconnected_will_retry error=%s retry_in_s=%d",
                    exc, wait_s,
                )
                backoff_idx += 1
                await _wait_or_stop(stop_event, wait_s)
            finally:
                if listen_conn is not None:
                    with suppress(Exception):
                        await listen_conn.remove_listener(CHANNEL, handler)
                    with suppress(Exception):
                        await pool.release(listen_conn)
                    listen_conn = None
    finally:
        for task in (consumer, backstop, heartbeat):
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
        with suppress(Exception):
            await pool.close()
```

---

### 6.7 `__main__.py` — asyncio entry point

Create [backend/app/workers/farmarket_lead_email/\_\_main\_\_.py](../../backend/app/workers/farmarket_lead_email/__main__.py):

```python
"""FAR-04 — farmarket_lead_email worker entry point.

Run with:
    python -m app.workers.farmarket_lead_email

Required env vars:
    DATABASE_URL                    — asyncpg DSN (direct :5432, NOT pooler :6543)
    BREVO_API_KEY                   — BR-F4: backend only
    BREVO_TEMPLATE_FAR_LEAD_FR      — Brevo template ID (integer) for FR locale
    BREVO_TEMPLATE_FAR_LEAD_AR      — Brevo template ID for AR (stub 0 OK for MVD)
    BREVO_TEMPLATE_FAR_LEAD_EN      — Brevo template ID for EN (stub 0 OK for MVD)
    BREVO_SENDER_NAME               — optional, defaults to "VitaChain"
    BREVO_SENDER_EMAIL              — optional, defaults to "no-reply@vitachain.ma"
    HEALTHCHECKS_FAR_LEAD_EMAIL_PING_URL  — optional heartbeat ping URL
    SENTRY_DSN                      — optional Sentry DSN (INF-08)
"""
from __future__ import annotations

import asyncio
import logging
import signal

log = logging.getLogger("farmarket_lead_email")


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _setup_sentry() -> None:
    import os
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return
    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration
    sentry_sdk.init(
        dsn=dsn,
        integrations=[LoggingIntegration(level=logging.WARNING, event_level=logging.ERROR)],
        environment=os.getenv("SENTRY_ENVIRONMENT", "prod"),
        traces_sample_rate=0.0,
    )


async def _main() -> None:
    from app.workers.farmarket_lead_email.listener import run_listener

    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop_event.set)

    log.info("farmarket_lead_email_worker_starting")
    await run_listener(stop_event)
    log.info("farmarket_lead_email_worker_stopped")


if __name__ == "__main__":
    _setup_logging()
    _setup_sentry()
    asyncio.run(_main())
```

---

### 6.8 AUTH-05 allow-list update

In [backend/app/db.py](../../backend/app/db.py), add `workers/farmarket_lead_email/` to the `service_client()` caller allow-list comment:

```python
# AUTH-05 allow-list — modules permitted to call service_client():
#   routers/admin/
#   workers/katara_threshold/
#   workers/katara_diagnostic/
#   workers/katara_diagnostic_email/
#   workers/katara_offline/
#   workers/notifications_mailer/
#   workers/farmarket_lead_email/          ← FAR-04 addition
```

Also add a `# JUSTIFICATION:` inline comment at the `service_client()` call site in `sender.py` (already included in §6.5 above).

---

### 6.9 Docker Compose — new worker service

In [infra/docker-compose.yml](../../infra/docker-compose.yml), add the following service alongside the other workers:

```yaml
  farmarket-lead-email:
    build:
      context: ../backend
    image: vitachain/backend:latest
    command: ["python", "-m", "app.workers.farmarket_lead_email"]
    restart: unless-stopped
    networks: [vita_net]
    env_file: [.env]
    depends_on: [db]
```

> **Note:** `db` here refers to the Supabase-proxied database alias if you have one in your compose file. Use the same `depends_on` pattern as `katara-diagnostic-email`.

---

### 6.10 Environment variables

Append to [infra/.env.example](../../infra/.env.example):

```dotenv
# ── FAR-04 — FarMarket lead email templates ────────────────────────────────────
# Brevo transactional template IDs (integers from the Brevo dashboard).
# FR is mandatory (P0 locale, PRD §7.2). AR and EN can be set to 0 until i18n.
BREVO_TEMPLATE_FAR_LEAD_FR=
BREVO_TEMPLATE_FAR_LEAD_AR=0
BREVO_TEMPLATE_FAR_LEAD_EN=0

# Heartbeat URL for the farmarket-lead-email worker (Healthchecks.io).
HEALTHCHECKS_FAR_LEAD_EMAIL_PING_URL=
```

---

### 6.11 Brevo template — required params

Create (or configure in the Brevo dashboard) a template with the following `{{ params.* }}` variables:

| Param | Description | Example |
|---|---|---|
| `farmer_name` | Farmer's full name | `Ahmed Ouali` |
| `ad_title` | Ad headline | `Tomates rondes — Souss-Massa` |
| `product_type` | Product type | `Tomates` |
| `buyer_name` | Restaurateur's full name | `Fatima Benali` |
| `buyer_email` | Restaurateur's email (for reply-to context) | `fatima@restaurant-la-medina.ma` |
| `buyer_phone` | Moroccan phone number | `0612345678` |
| `buyer_message` | Contact message from the form | `Bonjour, je suis intéressée…` |
| `lead_id` | Lead UUID (for admin tracing) | `a1b2c3d4-…` |

**Recommended subject** (FR): `Nouvelle demande de contact pour « {{ params.ad_title }} »`

---

### 6.12 AUTH-07 pgTAP cells

Append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

```sql
-- ── FAR-04 cells ─────────────────────────────────────────────────────────────
-- Prerequisites: m2_farmarket_leads table must exist (FAR-03 must be merged).
-- Tests: notified_at column present, trigger exists, NOTIFY fires on INSERT.

do $guard$
begin
  if to_regclass('public.m2_farmarket_leads') is null then
    raise notice 'SKIP FAR-04 cells — m2_farmarket_leads not yet created';
    return;
  end if;
end $guard$;

-- F-04a: notified_at column exists and is nullable.
select is(
  (
    select data_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'm2_farmarket_leads'
       and column_name  = 'notified_at'
  ),
  'timestamp with time zone',
  'F-04a: m2_farmarket_leads.notified_at exists as timestamptz'
);

select is(
  (
    select is_nullable
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'm2_farmarket_leads'
       and column_name  = 'notified_at'
  ),
  'YES',
  'F-04a: m2_farmarket_leads.notified_at is nullable (NULL = not yet emailed)'
);

-- F-04b: trigger trg_far04_notify_lead_created is attached to the table.
select is(
  (
    select count(*)::int
      from information_schema.triggers
     where event_object_schema = 'public'
       and event_object_table  = 'm2_farmarket_leads'
       and trigger_name        = 'trg_far04_notify_lead_created'
       and event_manipulation  = 'INSERT'
       and action_timing       = 'AFTER'
  ),
  1,
  'F-04b: AFTER INSERT trigger trg_far04_notify_lead_created exists'
);

-- F-04c: a fresh lead INSERT leaves notified_at NULL (worker stamps it, not the trigger).
do $seed_f04c$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP F-04c — m2_farmarket_ads not yet created';
    return;
  end if;

  insert into public.m2_farmarket_ads
      (id, farmer_id, title, description, product_type, price_mad, quantity_kg, region)
  values
      ('f04ad000-0000-0000-0000-000000000001',
       '<FARMER_A_UUID>',
       'Tomates FAR-04 test', 'Description test.', 'Tomates', 2.50, 100.00, 'Souss-Massa')
  on conflict (id) do nothing;
end $seed_f04c$;

select is(
  (
    select notified_at
      from public.m2_farmarket_leads
     where id = (
       insert into public.m2_farmarket_leads
           (ad_id, buyer_id, message, buyer_phone)
       values
           ('f04ad000-0000-0000-0000-000000000001',
            '<RESTAURANT_UUID>',
            'Message test FAR-04, suffisamment long.',
            '0612345678')
       returning id
     )
  ),
  null::timestamptz,
  'F-04c: notified_at is NULL immediately after INSERT (worker stamps it later)'
);
```

> Replace `<FARMER_A_UUID>` and `<RESTAURANT_UUID>` with the UUIDs from `db/tests/_auth07_seed.psql`.

---

### 6.13 Backend unit tests

Create [backend/tests/test_far04_brevo_email_to_seller.py](../../backend/tests/test_far04_brevo_email_to_seller.py):

```python
"""FAR-04 — farmarket_lead_email: template resolution + sender unit tests."""

from __future__ import annotations

import os
import unittest.mock as mock
from uuid import UUID

import pytest

from app.workers.farmarket_lead_email.templates import resolve_template
from app.workers.mailer import MailerError


class TestResolveTemplate:
    def test_fr_template_returned_for_fr_locale(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BREVO_TEMPLATE_FAR_LEAD_FR", "42")
        tid, loc = resolve_template("fr")
        assert tid == 42
        assert loc == "fr"

    def test_ar_template_returned_for_ar_locale(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BREVO_TEMPLATE_FAR_LEAD_FR", "42")
        monkeypatch.setenv("BREVO_TEMPLATE_FAR_LEAD_AR", "43")
        tid, loc = resolve_template("ar")
        assert tid == 43
        assert loc == "ar"

    def test_falls_back_to_fr_for_unsupported_locale(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BREVO_TEMPLATE_FAR_LEAD_FR", "42")
        monkeypatch.delenv("BREVO_TEMPLATE_FAR_LEAD_DAR", raising=False)
        tid, loc = resolve_template("dar")
        assert tid == 42
        assert loc == "fr"

    def test_falls_back_to_fr_when_ar_unset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BREVO_TEMPLATE_FAR_LEAD_FR", "42")
        monkeypatch.delenv("BREVO_TEMPLATE_FAR_LEAD_AR", raising=False)
        tid, loc = resolve_template("ar")
        assert tid == 42
        assert loc == "fr"

    def test_raises_when_fr_template_unset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("BREVO_TEMPLATE_FAR_LEAD_FR", raising=False)
        with pytest.raises(MailerError, match="BREVO_TEMPLATE_FAR_LEAD_FR"):
            resolve_template("fr")

    def test_none_locale_defaults_to_fr(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BREVO_TEMPLATE_FAR_LEAD_FR", "99")
        tid, loc = resolve_template(None)
        assert tid == 99
        assert loc == "fr"

    def test_empty_string_locale_defaults_to_fr(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("BREVO_TEMPLATE_FAR_LEAD_FR", "99")
        tid, loc = resolve_template("")
        assert tid == 99
        assert loc == "fr"


class TestSendLeadEmailSkipsAlreadyNotified:
    @pytest.mark.asyncio
    async def test_skips_when_lead_not_found(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """send_lead_email returns silently when notified_at is already set."""
        from app.workers.farmarket_lead_email import sender

        fake_lead_id = UUID("00000000-0000-0000-0000-000000000001")

        with mock.patch.object(sender, "_fetch_lead", return_value=None):
            # Must not raise — just logs and returns.
            await sender.send_lead_email(fake_lead_id)

    @pytest.mark.asyncio
    async def test_skips_when_ad_has_no_farmer_id(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.workers.farmarket_lead_email import sender

        fake_lead_id = UUID("00000000-0000-0000-0000-000000000002")
        fake_lead = {
            "id": str(fake_lead_id),
            "ad_id": "ad-uuid",
            "buyer_id": "buyer-uuid",
            "message": "Test message.",
            "buyer_phone": "0612345678",
            "notified_at": None,
        }

        with (
            mock.patch.object(sender, "_fetch_lead", return_value=fake_lead),
            mock.patch.object(sender, "_fetch_ad", return_value={}),  # no farmer_id
        ):
            await sender.send_lead_email(fake_lead_id)

    @pytest.mark.asyncio
    async def test_skips_when_farmer_has_no_email(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.workers.farmarket_lead_email import sender

        fake_lead_id = UUID("00000000-0000-0000-0000-000000000003")
        fake_lead = {
            "id": str(fake_lead_id),
            "ad_id": "ad-uuid",
            "buyer_id": "buyer-uuid",
            "message": "Test message.",
            "buyer_phone": "0612345678",
            "notified_at": None,
        }
        fake_ad = {"farmer_id": "farmer-uuid", "title": "Tomates", "product_type": "Tomates"}

        with (
            mock.patch.object(sender, "_fetch_lead", return_value=fake_lead),
            mock.patch.object(sender, "_fetch_ad", return_value=fake_ad),
            mock.patch.object(sender, "_fetch_profile", return_value={}),  # no email
        ):
            await sender.send_lead_email(fake_lead_id)


class TestSendLeadEmailHappyPath:
    @pytest.mark.asyncio
    async def test_calls_mailer_and_stamps_notified_at(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.workers.farmarket_lead_email import sender

        monkeypatch.setenv("BREVO_TEMPLATE_FAR_LEAD_FR", "55")

        fake_lead_id = UUID("00000000-0000-0000-0000-000000000004")
        fake_lead = {
            "id": str(fake_lead_id),
            "ad_id": "ad-uuid",
            "buyer_id": "buyer-uuid",
            "message": "Je suis intéressé(e) par vos produits.",
            "buyer_phone": "0612345678",
            "notified_at": None,
        }
        fake_ad = {
            "farmer_id": "farmer-uuid",
            "title": "Tomates rondes",
            "product_type": "Tomates",
        }
        fake_farmer = {"email": "ahmed@farm.ma", "full_name": "Ahmed Ouali", "locale": "fr"}
        fake_buyer  = {"email": "fatima@rest.ma", "full_name": "Fatima Benali", "locale": "fr"}

        sent_params: list[dict] = []

        async def fake_send_template(**kwargs: object) -> dict:
            sent_params.append(dict(kwargs))
            return {"messageId": "test-id"}

        with (
            mock.patch.object(sender, "_fetch_lead", return_value=fake_lead),
            mock.patch.object(sender, "_fetch_ad", return_value=fake_ad),
            mock.patch.object(sender, "_fetch_profile", side_effect=[fake_farmer, fake_buyer]),
            mock.patch.object(sender.mailer, "send_template", side_effect=fake_send_template),
            mock.patch.object(sender, "_stamp_notified", return_value=1),
        ):
            await sender.send_lead_email(fake_lead_id)

        assert len(sent_params) == 1
        call = sent_params[0]
        assert call["to"] == "ahmed@farm.ma"
        assert call["template_id"] == 55
        assert call["params"]["buyer_phone"] == "0612345678"
        assert call["params"]["buyer_email"] == "fatima@rest.ma"
        assert call["params"]["ad_title"] == "Tomates rondes"
        assert call["params"]["lead_id"] == str(fake_lead_id)
```

---

## 7. Verification Checklist

- [ ] `supabase db push` applied migration 0035 without errors.
- [ ] `m2_farmarket_leads` has a `notified_at` column (nullable `timestamptz`) in the Supabase Dashboard.
- [ ] Trigger `trg_far04_notify_lead_created` is listed on `m2_farmarket_leads` (AFTER INSERT).
- [ ] `make -C backend test` green — all FAR-04 assertions in `test_far04_brevo_email_to_seller.py`.
- [ ] `make -C db test-auth07` — F-04a, F-04b, F-04c all `ok` (not SKIP).
- [ ] `BREVO_TEMPLATE_FAR_LEAD_FR` is set in `.env` with a valid integer template ID.
- [ ] Worker starts cleanly: `python -m app.workers.farmarket_lead_email` logs `listener_subscribed channel=farmarket_lead_created`.
- [ ] **End-to-end happy path** (staging):
  - [ ] RESTAURANT user submits the contact form for an active ad.
  - [ ] Lead row inserted with `notified_at IS NULL`.
  - [ ] Within 2 minutes, the farmer's email inbox receives the Brevo template email.
  - [ ] Email contains correct: ad title, buyer phone, buyer message, buyer name.
  - [ ] `notified_at` is stamped on the lead row in `m2_farmarket_leads`.
- [ ] **Idempotency**: Re-running the worker backstop does NOT send a duplicate email (lead row has `notified_at IS NOT NULL`).
- [ ] **BR-F4 verification**: `bash scripts/check-frontend-bundle.sh` after `npm run build` — no `BREVO` token found in the frontend bundle.
- [ ] **AUTH-05 compliance**: `bash scripts/check-secrets-boundary.sh` exits 0 — `service_client()` not found outside the allow-list.
- [ ] No Sentry errors during the end-to-end happy path.
- [ ] `HEALTHCHECKS_FAR_LEAD_EMAIL_PING_URL` receives a heartbeat within 60 seconds of worker start (optional but recommended for demo day).

---

## 8. Deliverables

| Artifact | Location |
|---|---|
| Migration — `notified_at` + NOTIFY trigger | [db/migrations/0035_far04_farmarket_lead_notify.sql](../../db/migrations/0035_far04_farmarket_lead_notify.sql) |
| Worker package | [backend/app/workers/farmarket_lead_email/](../../backend/app/workers/farmarket_lead_email/) |
| `templates.py` — Brevo template resolution | [backend/app/workers/farmarket_lead_email/templates.py](../../backend/app/workers/farmarket_lead_email/templates.py) |
| `sender.py` — email assembly + dispatch | [backend/app/workers/farmarket_lead_email/sender.py](../../backend/app/workers/farmarket_lead_email/sender.py) |
| `listener.py` — LISTEN/NOTIFY + backstop | [backend/app/workers/farmarket_lead_email/listener.py](../../backend/app/workers/farmarket_lead_email/listener.py) |
| `__main__.py` — asyncio entry point | [backend/app/workers/farmarket_lead_email/__main__.py](../../backend/app/workers/farmarket_lead_email/__main__.py) |
| Backend tests | [backend/tests/test_far04_brevo_email_to_seller.py](../../backend/tests/test_far04_brevo_email_to_seller.py) |
| AUTH-07 pgTAP cells | Appended to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| Docker Compose service entry | Added to [infra/docker-compose.yml](../../infra/docker-compose.yml) |
| `.env.example` additions | [infra/.env.example](../../infra/.env.example) — 4 new keys |
| AUTH-05 allow-list comment | Updated in [backend/app/db.py](../../backend/app/db.py) |
| `spring-status.yml` update | Flip `FAR-04.status` → `IN_REVIEW`, bump `summary.in_review` |

---

## 9. Business Rules Enforced

| Rule | Where enforced |
|---|---|
| **BR-F4**: Brevo API key only on backend | `BREVO_API_KEY` read in `app.workers.mailer` — never imported in frontend code; AUTH-05 boundary script verifies this in CI |
| **BR-F4**: All email triggers through FastAPI backend | Email dispatched by `farmarket_lead_email` worker (part of the backend container), not the FAR-03 router or any frontend path |
| **Idempotency**: at most one email per lead | `notified_at IS NULL` guard in `_fetch_lead()` + `_stamp_notified()` filter — concurrent workers both pass the fetch, at most one stamps |
| **Delivery SLA**: < 2 min after lead insert | LISTEN/NOTIFY fires within 1 s of INSERT; Brevo queues for delivery within < 2 min combined |
| **AUTH-05**: service-role scoped to workers/ | `service_client()` calls carry `# JUSTIFICATION:` comment; AUTH-05 AST allow-list includes `workers/farmarket_lead_email/` |

---

## 10. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| Worker restarts miss a NOTIFY (Postgres does not buffer) | Post-reconnect `_backstop_once` re-scans the last 30 min immediately; periodic `_backstop_loop` runs every 60 s — idempotent thanks to `notified_at IS NULL` guard | PRD §8.2 |
| Brevo API key rotated mid-demo | `BREVO_API_KEY` in VPS `.env` only; rotation = `docker compose restart farmarket-lead-email` (< 30 s) | PRD §13 R5 |
| Farmer has no email in profiles (edge case) | Sender logs `sender_no_farmer_email` and returns; Sentry captures if configured; lead stays `notified_at IS NULL` so the backstop retries — but will keep skipping. Admin can see the unnotified lead via FAR-08. | PRD §13 |
| Duplicate emails (race between LISTEN path and backstop) | `_stamp_notified` issues `UPDATE … WHERE notified_at IS NULL`; only one UPDATE can win — second sets 0 rows. Brevo has its own dedup on message-id for the short window where two sends fire before the stamp. Practically impossible under single-worker deploy. | PRD §13 R3 |
| `notified_at` stamp succeeds but Brevo silently drops the email | Brevo dashboard shows the sent attempt. For MVD: manual re-send from the Brevo dashboard using the `lead_id` param for tracing. Post-MVD: webhook receipt confirmation. | PRD §14 |
| Trigger fires but worker is down (demo day) | Backstop starts on worker restart and catches all `notified_at IS NULL` rows within 30 min. For demo day: start worker ≥ 5 min before scenario C begins. | PRD §12 Phase 4 |

---

## 11. Time Estimate

| Sub-task | Estimate |
|---|---|
| Migration 0035 (`notified_at` + trigger) | 30 min |
| `templates.py` (locale resolution) | 30 min |
| `sender.py` (fetch + dispatch + stamp) | 1.5 h |
| `listener.py` (LISTEN/NOTIFY + backstop) | 1 h |
| `__main__.py` + Docker Compose entry | 30 min |
| Backend unit tests | 1 h |
| AUTH-07 pgTAP cells | 30 min |
| Brevo template creation (FR) | 30 min |
| End-to-end staging verification | 1 h |
| **Total active work** | **~7 h** |

---

## 12. Definition of Done

1. Acceptance criterion met: RESTAURANT submits contact form → farmer receives Brevo email within 2 minutes containing correct ad title, buyer phone, buyer message, buyer email, and buyer name.
2. `notified_at` is stamped on the lead row after Brevo 2xx; subsequent worker backstop passes do NOT re-send.
3. Worker restart scenario: killing and restarting the worker during the 30-minute backstop window still results in exactly one email delivered.
4. BR-F4 verified: `bash scripts/check-frontend-bundle.sh` exits 0 (no Brevo token in frontend bundle).
5. AUTH-05 verified: `bash scripts/check-secrets-boundary.sh` exits 0 (no `service_client()` leak outside allow-list).
6. `make -C backend test` green — all FAR-04 test assertions pass, no regressions.
7. `make -C db test-auth07` — F-04a, F-04b, F-04c all `ok`.
8. Verification checklist (§7) fully ticked.
9. Deliverables (§8) committed.
10. `docs/spring-status.yml` updated and committed.
11. Hand-off note posted — **FAR-08** (admin lead dashboard, now includes `notified_at` for email delivery state) is now unblocked.
