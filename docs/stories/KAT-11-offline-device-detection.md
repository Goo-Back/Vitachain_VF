# KAT-11 — Offline device detection (> 1 h no ping) + alert

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Should
> **Status:** TODO
> **Actor:** System (long-running async worker; no user-facing endpoint, no UI)
> **Depends on:** [KAT-02](./KAT-02-esp32-device-pairing.md) (ships `public.m1_katara_devices` with the `status device_status NOT NULL` column whose `OFFLINE` enum variant KAT-11 is the *only* legitimate writer of, plus the `last_seen timestamptz` column the scan reads on every pass) · [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) (every ingest touches `last_seen = now()` and flips `status = 'ACTIVE'`; that ingest-side flip is the natural recovery path — KAT-11 never needs to write `OFFLINE → ACTIVE`, KAT-03 already does it on the next successful ping) · [KAT-06](./KAT-06-threshold-email-alerts.md) (ships the worker package layout, the docker-compose pattern, the Brevo dispatch wrapper signature, the Healthchecks.io heartbeat shape, and the AUTH-05 allow-list extension that KAT-11 copies almost line-for-line — `spring-status.yml` row literally calls KAT-11 a *"near-mechanical copy of KAT-06 worker layout swapping LISTEN for a CRON read of m1_katara_devices.last_seen"*) · [NOT-01](../spring-status.yml) (`backend/app/workers/mailer.py::send_template` — single Brevo transport) · [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) (callsite allowlist; KAT-11 adds one prefix + one `# JUSTIFICATION:` comment) · [INF-08](./INF-08-sentry-uptime-kuma-observability.md) (Healthchecks.io heartbeat + Sentry DSN)
> **Unblocks:** The M1 Katara reliability loop's *negative-signal* half — KAT-06 alerts on bad readings, KAT-11 alerts on *no* readings. Together they cover the two failure modes a farmer cannot debug themselves (out-of-range vs hardware silent). No Must-priority story in `spring-status.yml` depends on KAT-11; it is a Should-priority polish that materially improves demo-day confidence (a dead ESP32 mid-rehearsal would otherwise present as "the dashboard hasn't moved in 20 min" with no in-product signal).
> **Acceptance:** A verified FARMER whose ESP32 has been paired and `ACTIVE` (`m1_katara_devices.last_seen` written by KAT-03 within the last hour) stops sending telemetry. Within **65 minutes** of the last successful ingest (1 h SLA + ≤ 5 min CRON cadence), the farmer receives a Brevo email — in their saved locale — naming the silent device, the parcel it is paired to, and the timestamp of the last received reading. The `m1_katara_devices` row flips `status = 'OFFLINE'` and `last_offline_alert_at = now()`. A second CRON pass before the device recovers produces **zero additional emails** (24 h anti-spam window mirrored from BR-K2). When the device resumes ingest, KAT-03's existing `last_seen + status = 'ACTIVE'` write handles recovery — KAT-11 itself never writes `OFFLINE → ACTIVE`. A device that is `PENDING` (never paired) or `UNLINKED` (soft-detached, KAT-12) is **never** alerted on, regardless of `last_seen` age. The ingest path's p50 < 50 ms (KAT-03 SLA) is unaffected — KAT-11 is fully decoupled from the ingest hot path.

---

## 1. Purpose

KAT-03 wrote: every ESP32 ingest stamps `m1_katara_devices.last_seen = now()` and flips `status = 'ACTIVE'`. KAT-02 declared the matching enum variant `OFFLINE` and left a comment on the `status` column reading *"KAT-11 flips ACTIVE ↔ OFFLINE."*. KAT-06 set up the worker-package-+-mailer pattern that KAT-11 is contracted to copy. KAT-11's job is to close that loop: detect devices whose `last_seen` is older than 1 hour, flip their status to `OFFLINE`, and email the farmer who paired them.

The detection mechanism is **not** LISTEN/NOTIFY. KAT-06 listens for an *event* (a telemetry insert); KAT-11 listens for the **absence** of events — the only honest implementation is a periodic scan. Concretely: a CRON-style asyncio worker wakes every 5 minutes, runs one indexed query against `m1_katara_devices`, and dispatches one Brevo email per newly-silent device.

Why not Supabase `pg_cron` calling a Postgres function that hits Brevo through `pg_net`? Two reasons:

- The email needs the farmer's saved locale, the parcel's friendly name, and a localised "metric label-equivalent" (the device's friendly id + the duration since `last_seen`). That cross-table assembly + locale switch is uncomfortable inside a `pg_net.http_post`, exactly as KAT-06 §1 argued.
- KAT-06 already paid the cost of the worker package + docker-compose service + Healthchecks heartbeat + Sentry tracing + AUTH-05 allow-list machinery. KAT-11 reuses every piece — adding a *second* persistence mechanism (pg_cron) for one near-identical use case would double the operational surface for no win.

Concretely KAT-11 delivers:

- **One small migration** ([`db/migrations/00XX_kat11_offline_alert_column.sql`](../../db/migrations/)) adding `last_offline_alert_at timestamptz` to `m1_katara_devices`. No new table, no new index (the existing partial unique on `(parcel_id) where status <> 'UNLINKED'` already covers KAT-11's read pattern; the scan filters by `status = 'ACTIVE'` and `last_seen < now() - interval '1 hour'`, both of which the existing `(farmer_id)` and primary-key indexes serve fine for ≤ 50 demo devices). The AUTH-07 RLS matrix gets one new audit-column write cell (service-role-only).
- **One new worker package** [`backend/app/workers/katara_offline/`](../../backend/app/workers/katara_offline/) with `__init__.py`, `__main__.py`, and `scanner.py`. Structurally identical to KAT-06's `katara_threshold/` — `__main__.py` is a near-verbatim copy with the loop body swapped for the CRON scan. No `evaluator.py`/`listener.py` split needed because there is no NOTIFY payload to parse and no pure-function evaluator with branching logic to unit-test in isolation (the BR-K11-1 anti-spam check is a single SQL `WHERE` clause, not a derived state machine).
- **One new docker-compose service** `katara_offline_worker` in [`infra/docker-compose.yml`](../../infra/docker-compose.yml) — same image as the FastAPI backend (`vitachain/backend:latest`), different command, `restart: unless-stopped` per PRD §8.2.
- **Three Brevo transactional templates** (`BREVO_TEMPLATE_KAT_OFFLINE_FR/AR/EN`) mirroring KAT-06's locale rollout. Skeleton HTML committed under [`infra/brevo-templates/kat11_offline_alert/{fr,ar,en}.html`](../../infra/brevo-templates/).
- **A 60 s Healthchecks.io heartbeat** (`HEALTHCHECKS_KAT_OFFLINE_PING_URL`). Identical shape to KAT-06.
- **A Sentry-traced exception path** so a Brevo 5xx, asyncpg disconnect, or DB error surfaces on the existing project (INF-08).
- **An AUTH-05 callsite-allowlist extension** — add `app.workers.katara_offline` to `ALLOW_PREFIXES` + an inline `# JUSTIFICATION: KAT-11 worker writes m1_katara_devices.status + last_offline_alert_at via service-role per the audit-column contract — only this module legitimately writes these fields.` at the single `service_client()` callsite.
- **Unit tests** ([`backend/tests/test_kat11_scanner.py`](../../backend/tests/test_kat11_scanner.py)) covering the pure-function half (deciding which devices to alert from a given snapshot) and one integration test gated behind `--run-e2e` covering the SQL UPDATE + Brevo dispatch path end-to-end against staging.
- **One new pgTAP cell** in [`db/tests/auth07_business_rules.sql`](../../db/tests/auth07_business_rules.sql) verifying the *positive* half of the audit-column contract — service-role can write `status = 'OFFLINE'` and `last_offline_alert_at`, and `authenticated` cannot (paired with KAT-06's KAT-05-audit cell, this completes the audit-write matrix).
- **`spring-status.yml` flip** to `IN_REVIEW` and a §10 hand-off note clarifying recovery semantics.

Once `DONE`, the M1 reliability loop is closed end-to-end: ESP32 silent ≥ 1 h → KAT-11 scan flips status + emails farmer; ESP32 resumes → KAT-03 ingest flips status back to ACTIVE and stamps `last_seen` (no KAT-11 involvement). The dashboard's existing device-status chip (KAT-02 §1 in-scope) renders the live status with no further work.

---

## 2. Scope

### In scope

- New worker package `backend/app/workers/katara_offline/` with `__init__.py`, `__main__.py`, `scanner.py`, `templates.py` (locale label catalogue + Brevo param assembly — borrows `LOCALISED_LABELS`-style shape from KAT-06 `templates.py`).
- CRON scan loop: `asyncio.sleep(SCAN_PERIOD_S)` driven, never overlaps itself (single-task loop), structured-log start + count + duration each pass.
- BR-K11-1 anti-spam: at most one OFFLINE email per device per 24 h (mirrors BR-K2's 24 h window — symmetry across the M1 alerting surface is worth more than a per-rule tuning knob for MVD).
- The single hot SQL: indexed scan returning the (device_id, parcel_id, farmer_id, last_seen) tuples that should alert this pass; UPDATE the matching rows in one statement using `RETURNING` so the email worker receives the post-update row + the previous `last_seen` for the email body.
- Service-role-only writes to `m1_katara_devices.status` and `m1_katara_devices.last_offline_alert_at`. Order: UPDATE first (atomically claims the alert via the WHERE clause's anti-spam filter), then Brevo. Rationale §6.5 — opposite of KAT-06 because the scan re-runs every 5 min and a Brevo retry is a worse failure mode than a single missed email.
- Brevo dispatch via `backend/app/workers/mailer.py` (NOT-01). Three locale templates registered (`fr`, `ar`, `en`) with `fr` fallback.
- Migration `00XX_kat11_offline_alert_column.sql` adding `last_offline_alert_at timestamptz` to `m1_katara_devices`. No NOT NULL, no default — NULL means "never alerted".
- Docker compose service `katara_offline_worker` — same image, different command, `restart: unless-stopped`, env-var bindings.
- Healthchecks.io 60 s heartbeat + Sentry exception tracing.
- AUTH-05 allow-list extension + matching update to [`backend/tests/test_service_client_callsite_allowlist.py`](../../backend/tests/test_service_client_callsite_allowlist.py).
- Unit tests (5 scanner scenarios) + 1 e2e test (`--run-e2e`) + 1 new pgTAP cell.
- One Brevo template per locale, FR / AR / EN, captured under `infra/brevo-templates/kat11_offline_alert/` as static HTML mirrors.
- `spring-status.yml` flip + §10 hand-off note for KAT-12 (unlink interplay) and a post-MVD "recovery email" follow-up.

### Out of scope

- **Recovery email** ("your device is back online") — deliberately deferred. PRD §6.1 KAT-11 row asks only for the *offline* alert. The dashboard's device-status chip flips back to green on the next successful ingest (KAT-02's `device-status` Card + KAT-04's last-seen line). Adding a recovery email is a 2-line follow-up: clear `last_offline_alert_at` to NULL in KAT-03's ingest path when status transitions OFFLINE → ACTIVE, and trigger a "back online" mailer call. Out of MVD scope per §10 note #2.
- **Severity tiering** (warning at 1 h, critical at 24 h, dead-battery suspicion at 7 days) — one email, one threshold. Post-MVD agronomic refinement.
- **SMS / WhatsApp / Push** — PRD §7.3 declares email as the only channel for MVD.
- **Per-farmer threshold tuning** (e.g. "alert me only if silent for 4 h, not 1 h") — the 1 h bound is a product invariant per PRD §6.1 KAT-11. Future story can promote it to a `profiles.offline_alert_threshold_minutes` column.
- **Device-level CRUD on `last_offline_alert_at`** — the column is operational state, not user-facing. No UI, no API. KAT-13 history queries that include `last_offline_alert_at` are a separate concern.
- **Backfill of `last_offline_alert_at` for devices that are *currently* silent at deploy time** — the deploy may legitimately fire a wave of alerts for devices that have been silent for hours. Documented in §5.8 deploy checklist as expected; alternative would be a one-shot SQL `UPDATE m1_katara_devices SET last_offline_alert_at = now() WHERE last_seen < now() - interval '1 hour'` run *before* the worker starts. Owner's call at deploy time.
- **Coordination with multi-replica workers** — single-instance for MVD. If post-MVD horizontal scaling is needed, the atomic `UPDATE ... WHERE ... last_offline_alert_at IS NULL OR ...` clause already serialises the dedup decision at the DB; safe to run N replicas with no further change.
- **`UNLINKED` device cleanup** — KAT-12 owns the unlink flow. KAT-11 must simply *skip* UNLINKED rows in the scan; no further interaction.
- **`PENDING` device alerts** — a never-paired device cannot be "silent" in the operational sense. PENDING rows are filtered out of the scan.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-02](./KAT-02-esp32-device-pairing.md) `IN_REVIEW` or `DONE` | The `m1_katara_devices` table + `device_status` enum (with `OFFLINE` variant) + the `(parcel_id, farmer_id, status, last_seen)` shape. The migration in §5.1 adds *one* column to this table and depends on its existence. |
| [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) `IN_REVIEW` or `DONE` | Writes `last_seen = now()` and `status = 'ACTIVE'` on every ingest. Without it, no device row ever transitions out of `PENDING` and the scan finds nothing. KAT-03's `status` write is *also* the recovery path KAT-11 deliberately delegates to — verify in code review that KAT-03 flips `status` unconditionally on ingest (not only on `PENDING → ACTIVE`), otherwise an `OFFLINE → ACTIVE` transition silently rots. |
| [KAT-06](./KAT-06-threshold-email-alerts.md) `IN_REVIEW` or `DONE` | KAT-11 is a structural mirror. Reuses the `__main__.py` skeleton, the `_init_observability()` block, the docker-compose service shape, the Healthchecks heartbeat pattern, the AUTH-05 allow-list extension recipe, and the Brevo locale-template pattern from `templates.py`. If KAT-06 is not at least `IN_REVIEW`, KAT-11 should not start — the patterns it copies are not yet stable. |
| [NOT-01](../spring-status.yml) `IN_REVIEW` or `DONE` | `backend/app/workers/mailer.py::send_template`. KAT-11 calls it identically to KAT-06. |
| [INF-04](./INF-04-fastapi-backend-scaffold-healthcheck.md) `DONE` | Provides the asyncpg pool factory + Sentry init pattern KAT-11 mirrors. |
| [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) `DONE` | `ALLOW_PREFIXES` and the AST-walking callsite allow-list test. KAT-11 adds one prefix. |
| [INF-08](./INF-08-sentry-uptime-kuma-observability.md) `DONE` | Healthchecks.io account + Sentry project. |
| Three new Brevo template ids | Created in the Brevo dashboard *before* deploy. Stored in `.env` as `BREVO_TEMPLATE_KAT_OFFLINE_FR/AR/EN`. Skeleton HTML lives in `infra/brevo-templates/kat11_offline_alert/` for re-creation. |

KAT-11 has **no dependency on KAT-12**. The unlink flow is one-way: KAT-12 sets `status = 'UNLINKED'`; KAT-11's scan filters `status = 'ACTIVE'` so UNLINKED is naturally skipped. KAT-12 can land before or after KAT-11 with no contract change.

---

## 4. Data Contract

KAT-11 ships one schema change — a new column on an existing table — and reads/writes that table only.

### 4.1 Column addition

```sql
alter table public.m1_katara_devices
    add column if not exists last_offline_alert_at timestamptz;

comment on column public.m1_katara_devices.last_offline_alert_at is
    'KAT-11: timestamp of the most recent offline-detection email sent for this device. '
    'NULL = never alerted. Service-role write only; 24 h anti-spam window (BR-K11-1). '
    'Cleared back to NULL only on a post-MVD recovery flow (see KAT-11 §10 note #2).';
```

No NOT NULL constraint. No default. NULL is the meaningful "never alerted" state and the scan's anti-spam predicate reads `last_offline_alert_at IS NULL OR now() - last_offline_alert_at > interval '24 hours'`.

No new index. The scan's `WHERE status = 'ACTIVE' AND last_seen < now() - interval '1 hour'` runs against ≤ 50 demo rows; a sequential scan is bounded at single-digit milliseconds. Adding an index would be premature optimisation and would slow KAT-03's hot path (every ingest writes to `last_seen` and `status`).

### 4.2 The hot read + write (one statement)

```sql
update public.m1_katara_devices
   set status = 'OFFLINE',
       last_offline_alert_at = now()
 where status = 'ACTIVE'
   and last_seen is not null
   and last_seen < now() - interval '1 hour'
   and (last_offline_alert_at is null
        or now() - last_offline_alert_at > interval '24 hours')
returning id, device_id, parcel_id, farmer_id, last_seen;
```

The `WHERE` clause is the atomic claim — only rows that satisfy *all* of (still ACTIVE, has been seen at least once, silent for > 1 h, not alerted in the last 24 h) are flipped. The `RETURNING` clause hands the post-update row tuple to the application so the email body can include the `last_seen` timestamp without a follow-up SELECT.

The `last_seen is not null` clause is defensive — KAT-03 stamps `last_seen` on first ingest, so a `PENDING` row never crosses into `ACTIVE` without `last_seen` being set. But the `device_status` enum allows in principle that a future migration introduces an `ACTIVE`-without-`last_seen` state, and the predicate keeps the scan honest against that hypothetical.

### 4.3 The profile + parcel read (one statement, after UPDATE)

```sql
select p.email, p.locale, p.full_name, pa.name as parcel_name
  from public.profiles p
  join public.m1_katara_parcels pa on pa.farmer_id = p.id
 where pa.id = $1 and p.id = $2;
```

Same shape as KAT-06 §4.2. Read under `service_role`. Cached per pass — if multiple devices for the same farmer go offline simultaneously, deduplicate the profile fetch in application code (rare; the demo's worst case is 1 farmer × 1 device).

### 4.4 Brevo template parameter contract

The Brevo templates (created in the Brevo dashboard, mirrored under `infra/brevo-templates/kat11_offline_alert/`) receive this parameter envelope:

```json
{
  "farmer_name": "Ahmed Ben Salah",
  "parcel_name": "Olive Grove North",
  "device_id": "ESP32-A47B",
  "last_seen_at": "2026-05-17T13:02:00Z",
  "minutes_silent": 72,
  "dashboard_url": "https://vitachain.ma/dashboard/farmer/parcels/<uuid>"
}
```

- `minutes_silent` is computed application-side as `int((now - last_seen).total_seconds() / 60)`. Integer minutes is the right granularity for an email body — seconds are noise, hours hides the resolution at the alert boundary.
- `dashboard_url` is built from `FRONTEND_BASE_URL` + the parcel path so the email deep-links to the parcel detail page (where the farmer sees the device-status chip and the last-seen line).
- The Brevo *subject* is template-side: each locale variant ships a subject with the `{{ params.device_id }}` placeholder so the inbox preview ("Appareil ESP32-A47B silencieux — Olive Grove North") is informative.

### 4.5 BR-K11-1 — the anti-spam window

| Predicate | Meaning |
|---|---|
| `last_offline_alert_at IS NULL` | Device has never alerted offline. Send email. |
| `now() - last_offline_alert_at > interval '24 hours'` | Device was alerted, but more than 24 h ago. Re-alert. |
| Otherwise | Skip — alerted recently. |

The window mirrors BR-K2 from KAT-06 deliberately. Tuning per-rule is a post-MVD concern.

Recovery is **out of band**: KAT-03's ingest path sets `status = 'ACTIVE'` and `last_seen = now()` on the next successful telemetry, which makes the row drop out of KAT-11's WHERE clause permanently — `last_offline_alert_at` is not cleared, so even if the same device goes silent again 2 h later it won't re-alert. The 24 h window is the same dedup mechanism either way; a future recovery story (§10 note #2) can clear `last_offline_alert_at` on the OFFLINE → ACTIVE transition to make re-alerts more responsive.

---

## 5. Step-by-Step Implementation

### 5.1 Migration — add the audit column

Create [`db/migrations/00XX_kat11_offline_alert_column.sql`](../../db/migrations/) (replace `XX` with the next available migration number; check the migrations folder for the current high-water mark):

```sql
-- KAT-11: offline-device detection audit column.
--
-- Adds last_offline_alert_at to m1_katara_devices so the offline-detection
-- worker can dedup emails on a 24 h window (BR-K11-1, mirrors BR-K2).
--
-- No NOT NULL, no default. NULL = "never alerted".
-- Service-role write only; covered by the AUTH-07 RLS matrix's audit-column row.

alter table public.m1_katara_devices
    add column if not exists last_offline_alert_at timestamptz;

comment on column public.m1_katara_devices.last_offline_alert_at is
    'KAT-11: most recent offline-detection email timestamp. '
    'NULL = never alerted. Service-role write only.';
```

Apply with the existing migration runner (`make -C db migrate` or the project's equivalent — see INF-02 §x for the convention). Confirm idempotency: re-running the migration is a no-op via `add column if not exists`.

### 5.2 Worker package skeleton

Create [`backend/app/workers/katara_offline/__init__.py`](../../backend/app/workers/katara_offline/__init__.py) — empty package marker.

Create [`backend/app/workers/katara_offline/__main__.py`](../../backend/app/workers/katara_offline/__main__.py) — verbatim copy of KAT-06's `__main__.py` with two replacements:

```python
"""KAT-11 worker entrypoint.

Run with:
    python -m app.workers.katara_offline

In Docker:
    command: ["python", "-m", "app.workers.katara_offline"]

Single-process design — periodic scan + one Brevo HTTP client.
Detects ESP32 devices silent for > 1 h and alerts the owning farmer.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

import sentry_sdk

from app.workers.katara_offline.scanner import run_scanner

log = logging.getLogger("katara_offline")


def _init_observability() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=0.1,
            environment=os.getenv("APP_ENV", "production"),
            release=os.getenv("APP_RELEASE", "dev"),
            server_name="katara-offline-worker",
        )

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format='{"ts":"%(asctime)s","lvl":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
        stream=sys.stdout,
    )


async def _main() -> None:
    _init_observability()

    stop = asyncio.Event()

    def _on_signal(*_: object) -> None:
        log.info("shutdown_signal_received")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_signal)
        except NotImplementedError:
            signal.signal(sig, _on_signal)

    log.info("katara_offline_worker_starting")
    await run_scanner(stop_event=stop)
    log.info("katara_offline_worker_stopped")


if __name__ == "__main__":
    asyncio.run(_main())
```

Two textual diffs from KAT-06's `__main__.py`:
- `katara_threshold` → `katara_offline`
- `run_listener` → `run_scanner`

Everything else (signal handling, Sentry init, JSON log format) is identical and exists for the same reasons.

### 5.3 Scanner — CRON loop + atomic UPDATE + Brevo dispatch

Create [`backend/app/workers/katara_offline/scanner.py`](../../backend/app/workers/katara_offline/scanner.py):

```python
"""KAT-11 — Periodic scan for silent ESP32 devices.

Every SCAN_PERIOD_S seconds:
  1. UPDATE m1_katara_devices SET status = 'OFFLINE', last_offline_alert_at = now()
     WHERE status = 'ACTIVE' AND last_seen < now() - 1h
       AND (last_offline_alert_at IS NULL OR last_offline_alert_at < now() - 24h)
     RETURNING id, device_id, parcel_id, farmer_id, last_seen;
  2. For each returned row, fetch profile + parcel name and send Brevo email.

The UPDATE-first ordering is deliberate (see §6.5). The WHERE clause atomically
claims the alert; a concurrent worker replica running the same statement would
see zero rows because the first replica's UPDATE already flipped status.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import asyncpg
import httpx
import sentry_sdk

from app.workers.katara_offline.templates import (
    FALLBACK_LOCALE, TEMPLATE_IDS,
)
from app.workers import mailer  # NOT-01

log = logging.getLogger("katara_offline.scanner")

SCAN_PERIOD_S = 300                # 5 min CRON cadence
HEARTBEAT_PERIOD_S = 60
SILENCE_THRESHOLD = "1 hour"       # interpolated into the SQL interval literal
ANTI_SPAM_WINDOW = "24 hours"


SCAN_SQL = f"""
    update public.m1_katara_devices
       set status = 'OFFLINE',
           last_offline_alert_at = now()
     where status = 'ACTIVE'
       and last_seen is not null
       and last_seen < now() - interval '{SILENCE_THRESHOLD}'
       and (last_offline_alert_at is null
            or now() - last_offline_alert_at > interval '{ANTI_SPAM_WINDOW}')
    returning id, device_id, parcel_id, farmer_id, last_seen
"""

PROFILE_SQL = """
    select p.email, p.locale, p.full_name, pa.name as parcel_name
      from public.profiles p
      join public.m1_katara_parcels pa on pa.farmer_id = p.id
     where pa.id = $1 and p.id = $2
"""


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_KAT_OFFLINE_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)


async def _heartbeat_loop(stop_event: asyncio.Event) -> None:
    async with httpx.AsyncClient() as client:
        await _ping_heartbeat(client)
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=HEARTBEAT_PERIOD_S)
                return
            except asyncio.TimeoutError:
                pass
            await _ping_heartbeat(client)


async def _send_for_row(
    pool: asyncpg.Pool,
    row: asyncpg.Record,
    now: datetime,
) -> None:
    parcel_id: UUID = row["parcel_id"]
    farmer_id: UUID = row["farmer_id"]
    last_seen: datetime = row["last_seen"]
    device_id: str = row["device_id"]

    async with pool.acquire() as conn:
        profile = await conn.fetchrow(PROFILE_SQL, parcel_id, farmer_id)
    if profile is None:
        # Defensive: profile/parcel deleted between UPDATE and SELECT.
        # The row is already flipped to OFFLINE so the next pass won't re-alert.
        log.warning("offline_alert_profile_missing",
                    extra={"device_id": device_id, "parcel_id": str(parcel_id)})
        return

    locale = (profile["locale"] or FALLBACK_LOCALE).lower()
    if locale not in TEMPLATE_IDS:
        locale = FALLBACK_LOCALE

    dashboard_base = os.getenv("FRONTEND_BASE_URL", "https://vitachain.ma").rstrip("/")
    dashboard_url = f"{dashboard_base}/dashboard/farmer/parcels/{parcel_id}"
    minutes_silent = max(1, int((now - last_seen).total_seconds() // 60))

    params = {
        "farmer_name":    profile["full_name"] or "",
        "parcel_name":    profile["parcel_name"] or "",
        "device_id":      device_id,
        "last_seen_at":   last_seen.astimezone(timezone.utc).isoformat(),
        "minutes_silent": minutes_silent,
        "dashboard_url":  dashboard_url,
    }

    try:
        await mailer.send_template(
            to=profile["email"],
            template_id=TEMPLATE_IDS[locale],
            params=params,
            locale=locale,
        )
        log.info("offline_alert_sent",
                 extra={"device_id": device_id, "farmer_id": str(farmer_id),
                        "minutes_silent": minutes_silent, "locale": locale})
    except Exception:
        log.exception("offline_alert_brevo_failed",
                      extra={"device_id": device_id, "farmer_id": str(farmer_id)})
        sentry_sdk.capture_exception()
        # Note: status is already flipped to OFFLINE and last_offline_alert_at
        # is already stamped. A Brevo failure here means this user does not
        # receive this round's email. The 24 h anti-spam window prevents the
        # next pass from re-sending. Rationale: §6.5.


async def _scan_once(pool: asyncpg.Pool) -> int:
    """One CRON tick. Returns number of devices alerted."""
    started = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        rows = await conn.fetch(SCAN_SQL)

    if not rows:
        log.info("offline_scan_pass", extra={"alerted": 0})
        return 0

    # Send emails concurrently. Bounded fan-out: ≤ 50 demo devices in worst
    # case, so a plain gather() is safe. Post-MVD, swap for a semaphore.
    await asyncio.gather(
        *[_send_for_row(pool, row, started) for row in rows],
        return_exceptions=False,
    )
    log.info("offline_scan_pass", extra={"alerted": len(rows)})
    return len(rows)


async def run_scanner(stop_event: asyncio.Event) -> None:
    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=3,
        command_timeout=10.0,
    )

    heartbeat = asyncio.create_task(_heartbeat_loop(stop_event))

    try:
        # Run an immediate pass on boot so a restart-after-outage recovers
        # the silent-device backlog within seconds, not SCAN_PERIOD_S.
        with suppress(Exception):
            await _scan_once(pool)

        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=SCAN_PERIOD_S)
                return
            except asyncio.TimeoutError:
                pass
            try:
                await _scan_once(pool)
            except Exception:
                log.exception("offline_scan_pass_failed")
                sentry_sdk.capture_exception()
                # Continue the loop — next tick retries.
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat
        await pool.close()
```

Three non-obvious choices, each deliberate:

1. **`SCAN_SQL` is a single atomic `UPDATE ... RETURNING`.** A naïve two-step (`SELECT ... WHERE silent;` then `UPDATE ... SET status = 'OFFLINE'` for each) would race two replicas double-alerting the same device. The atomic claim closes that window — even with N workers running the same statement concurrently, only the row-locker wins each row.
2. **Status flip happens *before* Brevo dispatch.** Inverse of KAT-06 §5.3, and deliberately so: KAT-11 runs every 5 min and the worst failure mode is *re-alerting on Brevo retry* (annoying user-visible spam), not *silently missing an alert* (which the 24 h window guards anyway). Stamping `last_offline_alert_at` first means a Brevo 5xx costs the user *this* email but the next pass suppresses for 24 h — net effect: same user receives 0 or 1 email, never 2-N.
3. **Boot-time immediate pass.** A worker restart during a wave of offline devices should not wait 5 min to discover the backlog. The pre-loop `_scan_once` runs the scan once before entering the sleep cycle.

### 5.4 Templates module — locale fallback + Brevo template ids

Create [`backend/app/workers/katara_offline/templates.py`](../../backend/app/workers/katara_offline/templates.py):

```python
"""KAT-11 locale + Brevo template id catalogue.

Mirrors backend/app/workers/katara_threshold/templates.py structurally.
"""
from __future__ import annotations

import os

FALLBACK_LOCALE = "fr"

TEMPLATE_IDS: dict[str, int] = {
    "fr": int(os.environ["BREVO_TEMPLATE_KAT_OFFLINE_FR"]),
    "ar": int(os.environ["BREVO_TEMPLATE_KAT_OFFLINE_AR"]),
    "en": int(os.environ["BREVO_TEMPLATE_KAT_OFFLINE_EN"]),
}
```

The module reads env vars at import time so a missing template id surfaces immediately on worker boot (fail-fast), not on the first offline event hours later.

Brevo template skeletons live under [`infra/brevo-templates/kat11_offline_alert/{fr,ar,en}.html`](../../infra/brevo-templates/). Each file is the HTML mirror of the Brevo dashboard's template content — they are documentation, not a sync source. The subject lines (set in the Brevo dashboard) follow the pattern:

- `fr`: `Appareil {{ params.device_id }} silencieux — {{ params.parcel_name }}`
- `ar`: `الجهاز {{ params.device_id }} لا يستجيب — {{ params.parcel_name }}` (RTL handled by Brevo's HTML email rendering)
- `en`: `Device {{ params.device_id }} offline — {{ params.parcel_name }}`

### 5.5 Docker compose service

Edit [`infra/docker-compose.yml`](../../infra/docker-compose.yml). Add a new service mirroring `katara_threshold_worker` from KAT-06:

```yaml
  katara_offline_worker:
    image: vitachain/backend:latest
    restart: unless-stopped
    command: ["python", "-m", "app.workers.katara_offline"]
    depends_on:
      - postgres
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      BREVO_API_KEY: ${BREVO_API_KEY}
      BREVO_TEMPLATE_KAT_OFFLINE_FR: ${BREVO_TEMPLATE_KAT_OFFLINE_FR}
      BREVO_TEMPLATE_KAT_OFFLINE_AR: ${BREVO_TEMPLATE_KAT_OFFLINE_AR}
      BREVO_TEMPLATE_KAT_OFFLINE_EN: ${BREVO_TEMPLATE_KAT_OFFLINE_EN}
      FRONTEND_BASE_URL: ${FRONTEND_BASE_URL}
      SENTRY_DSN: ${SENTRY_DSN}
      HEALTHCHECKS_KAT_OFFLINE_PING_URL: ${HEALTHCHECKS_KAT_OFFLINE_PING_URL}
      APP_ENV: ${APP_ENV}
      APP_RELEASE: ${APP_RELEASE}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
```

Add the same env-var names to `infra/.env.example` (without values) and to the Bitwarden shared `.env` (with values) so production deploys do not boot-loop on missing template ids.

### 5.6 AUTH-05 allow-list extension

Edit [`backend/tests/test_service_client_callsite_allowlist.py`](../../backend/tests/test_service_client_callsite_allowlist.py). Add the new prefix to `ALLOW_PREFIXES`:

```python
ALLOW_PREFIXES = (
    "app.workers.katara_threshold",   # KAT-06
    "app.workers.katara_offline",     # KAT-11  ← new
    # ... other existing entries
)
```

At the single `service_client()` callsite inside [`backend/app/workers/katara_offline/scanner.py`](../../backend/app/workers/katara_offline/scanner.py) — note: the §5.3 implementation uses `asyncpg` directly via `DATABASE_URL`, so a Supabase service-key callsite only exists if the team chooses to route the UPDATE via the Supabase Python client. If a `service_client()` call is added at any point, place this `# JUSTIFICATION:` comment directly above it:

```python
# JUSTIFICATION: KAT-11 worker writes m1_katara_devices.status + last_offline_alert_at
# via service-role per the audit-column contract — only this module legitimately
# writes these fields. AUTH-05 allow-list extended.
```

The default §5.3 implementation does not need this comment because the asyncpg pool connects with `DATABASE_URL` (already service-role-scoped at the connection level — no `supabase.create_client(..., service_role_key)` callsite). Verify which path the team chose before submitting the PR.

### 5.7 AUTH-07 pgTAP cell

Append to [`db/tests/auth07_business_rules.sql`](../../db/tests/auth07_business_rules.sql):

```sql
-- KAT-11 cell — service_role can write m1_katara_devices.status = 'OFFLINE'
-- and last_offline_alert_at; authenticated cannot.

set role service_role;
update public.m1_katara_devices
   set status = 'OFFLINE', last_offline_alert_at = now()
 where id = (select id from public.m1_katara_devices limit 1);
-- Expect: 1 row updated, no error.

reset role;
set role authenticated;
update public.m1_katara_devices
   set status = 'OFFLINE', last_offline_alert_at = now()
 where id = (select id from public.m1_katara_devices limit 1);
-- Expect: 0 rows updated (silent no-op via the audit-guard trigger or RLS,
-- depending on whether KAT-02's RLS policy covers status writes at all).
-- Assert: post-condition row's status reverted by checking it equals the
-- service_role-set value.

reset role;
```

Wrap it in the project's pgTAP `plan()` + `ok(...)` macros following the convention used by the KAT-05/KAT-06 cells already in the file. Run with `make -C db test-auth07`; expect the cell to pass on a fresh DB after the §5.1 migration applies.

### 5.8 Deploy checklist

Before flipping `spring-status.yml` to `IN_REVIEW`:

1. **Brevo templates created** — three template ids exist in the Brevo dashboard, each with the §5.4 subject line + an HTML body using the §4.4 parameter envelope. Skeletons under `infra/brevo-templates/kat11_offline_alert/` committed.
2. **Env vars populated** — `.env` on the VPS contains `BREVO_TEMPLATE_KAT_OFFLINE_FR/AR/EN` + `HEALTHCHECKS_KAT_OFFLINE_PING_URL`. `.env.example` lists them without values.
3. **Healthchecks.io check created** — a new check named `katara_offline_worker_heartbeat` with a 5-minute grace period (allows for one missed 60 s ping). Webhook URL pasted into the env var.
4. **Migration applied** — `make -C db migrate` on staging, then on production. Confirm with `\d m1_katara_devices` that `last_offline_alert_at` exists.
5. **Backfill decision** — at deploy time, if any device has `last_seen < now() - 1 hour` AND `status = 'ACTIVE'`, the worker's first scan will email those farmers. If that is undesirable (e.g. deploy happens after a known multi-hour outage), pre-stamp the backfill: `UPDATE m1_katara_devices SET last_offline_alert_at = now() WHERE last_seen < now() - interval '1 hour' AND status = 'ACTIVE';` then start the worker. Decision noted in the PR description.
6. **Docker compose up** — `docker compose up -d katara_offline_worker` on staging. Confirm:
   - Healthchecks.io check turns green within 90 s.
   - Worker logs include `katara_offline_worker_starting` + a first `offline_scan_pass` line with `alerted: <n>` count.
7. **Smoke test** — force a device offline (unplug the demo ESP32) and wait > 1 h, OR temporarily lower `SILENCE_THRESHOLD` to `1 minute` on a staging-only branch and observe the alert arrive within ≤ 6 min.

### 5.9 `spring-status.yml` flip

Once §6 manual rehearsal passes and `pytest backend/tests/test_kat11_scanner.py` is green, edit `docs/spring-status.yml`:

```yaml
      - id: KAT-11
        title: Offline device detection (> 1h no ping) + alert
        priority: Should
        status: IN_REVIEW   # ← was TODO
        actor: System
        acceptance: "CRON detects silence; email sent to owner"
        depends_on: [KAT-02, KAT-03, KAT-06, NOT-01]
```

Update `progress_pct` on the E2 epic line accordingly (43 → 50 if KAT-11 is the 7th of 14 stories in IN_REVIEW). No other rows touched.

---

## 6. Design Decisions & Risks

### 6.1 Why CRON, not LISTEN/NOTIFY

The Postgres NOTIFY channel KAT-03 emits fires on *successful* ingest. KAT-11's trigger is the *absence* of ingests — there is no event to listen for. Two alternatives were considered:

- **Heartbeat-driven** — every device emits a NOTIFY when it pings; a worker tracks "most recent ping per device" in memory and flags devices whose ping is overdue. Problem: the worker's in-memory state is lost on restart, so a restart-after-outage misses the backlog. Solving that requires persisting the state, at which point you have rebuilt the `last_seen` column for no benefit.
- **`pg_cron` + `pg_net.http_post` to Brevo** — rejected for the same reasons KAT-06 §1 rejected the same approach for threshold alerts: the locale switch + parcel-name join + Brevo template params are uncomfortable in a Postgres function, and the operational machinery (Sentry tracing, Healthchecks heartbeat, AUTH-05 allow-list, docker logs) is duplicated.

A 5-minute CRON-style asyncio loop is the simplest correct design: stateless, restart-safe, observable via the same Sentry/Healthchecks surface as KAT-06.

### 6.2 Why a 5-minute scan period

- **1 minute** — overkill. The 1 h SLA tolerates up to 5-10 min of detection latency without a perceptible difference to the farmer (who is expected to check the dashboard, not refresh their inbox). A 1-min cadence is 5× the DB load for zero user-visible gain.
- **15 minutes** — undershoots the SLA. The PRD spec says "no ping for > 1 hour"; a 15-min cadence gives 75-min worst case, technically still within "more than an hour" but feels lazy.
- **5 minutes** — matches the demo-day reliability bar. Worst case detection: 1 h + 5 min = 65 min. Email lands within Brevo SLA (≤ 2 min per PRD §10.1) → farmer receives notification within ~67 min of the last ping. Comfortable.

The constant is `SCAN_PERIOD_S = 300` at the top of `scanner.py`; tuning post-staging is a one-line change.

### 6.3 Why 1 hour and not "configurable per farmer"

PRD §6.1 KAT-11 names "1 hour" as the threshold. Promoting it to a per-farmer setting requires:

- A `profiles.offline_alert_threshold_minutes int` column (migration).
- An admin or self-service UI in the farmer dashboard.
- Localised copy explaining the trade-off ("alert earlier means more false positives").
- A test surface — what does the scan do if the value is 0? -1? 1440?

None of that is in scope for MVD. The 1 h bound is a product invariant. The SQL interval literal lives in `scanner.py` as `SILENCE_THRESHOLD = "1 hour"`; the value is a compile-time constant.

### 6.4 Why a 24 h anti-spam window (BR-K11-1)

Mirroring KAT-06's BR-K2 across the M1 alerting surface keeps the user's mental model simple ("VitaChain emails me once a day per problem, max"). A shorter window — say 1 h — would mean a device that is silent for 24 h sends 24 emails, drowning the user in copies of the same information. A longer window — say 7 days — would mean a device that recovers and re-fails within the week silently misses the second alert.

24 h is also the natural cadence of the farmer's working day: they check the morning's alerts once, take action, and the system does not re-alert until tomorrow if the problem persists.

### 6.5 Why status flip *before* Brevo (opposite of KAT-06)

KAT-06 §4.3 explicitly sends Brevo *then* updates `last_alert_at`, on the reasoning "we'd rather send a duplicate than silently miss". KAT-11 deliberately inverts this.

The reason is the scan cadence. KAT-06 listens to NOTIFY — a row arrives, gets evaluated, emails out, audit column updated. If Brevo fails, the next *telemetry insert* (15 min later) re-triggers the evaluation, BR-K2 still suppresses if `last_alert_at` was advanced, and the user gets one duplicate at most. The 15-min cadence means the worst-case duplicate window is small.

KAT-11 runs every 5 min. If we sent Brevo *then* stamped `last_offline_alert_at`, a Brevo 5xx during one pass would mean the *next* pass — 5 min later — re-fires the alert. And the one after. And the one after. Up to 12 alerts per hour of Brevo flakiness for the same device. Stamping the audit column first means a Brevo 5xx costs *one* email this hour, not a flood.

The trade-off: KAT-11 may *silently miss* a single email if Brevo fails between the UPDATE and the `mailer.send_template` call. That is acceptable because:

- The dashboard's device-status chip (KAT-02 + KAT-04) is the in-product signal — the farmer who opens the app sees the OFFLINE badge regardless of email delivery.
- The 24 h window means the next pass at +24 h re-tries the email if the device is still silent.
- Healthchecks.io + Sentry will surface the Brevo failure to the on-call within minutes.

### 6.6 Why no recovery email

A device that comes back online is *good news*; the farmer is unlikely to thank the system for a "your device is back" email at 3 AM. Recovery is signalled in-product via the dashboard chip flipping back to ACTIVE on the next ingest. If post-MVD user research surfaces a real need for recovery notifications, the implementation is a 2-line addition to KAT-03's ingest path:

```python
# In KAT-03 ingest, on the status = 'ACTIVE' write:
if previous_status == 'OFFLINE':
    await mailer.send_template(template_id=BREVO_TEMPLATE_KAT_RECOVERY, ...)
    # Clear last_offline_alert_at so a fresh OFFLINE cycle re-alerts immediately
    # rather than waiting for the 24 h window.
```

Out of scope for KAT-11.

### 6.7 Failure modes and graceful degradation

| Failure | Behaviour | Recovery |
|---|---|---|
| Brevo 5xx between UPDATE and send | Status is flipped to OFFLINE but no email sent this pass. Logged + Sentry-captured. | Next pass at +24 h re-tries (BR-K11-1 window expired). Dashboard chip still shows OFFLINE. |
| Database disconnect mid-scan | Pass aborts. Sentry-captured. | Next pass at +5 min retries the full scan. UPDATE is idempotent — already-flipped rows skip the WHERE clause naturally. |
| Worker crashes | Docker `restart: unless-stopped` brings it back. | Boot-time immediate `_scan_once` recovers any backlog accumulated during downtime. Healthchecks.io pages on-call if downtime > 5 min. |
| `profiles` row deleted between UPDATE and SELECT | Profile fetch returns None; warning logged. | Status is already flipped to OFFLINE — the row is now silently OFFLINE with no email sent. Acceptable edge case (deleted farmer accounts are vanishingly rare in MVD). |
| Brevo template id mis-configured | Worker boots normally but every `mailer.send_template` raises. Sentry floods. | On-call sees the flood + fixes the env var + restarts the container. Boot-time immediate pass re-fires the alerts (status was already OFFLINE so the WHERE clause skips them — *they will not re-fire* unless the 24 h window has expired). This is a known sharp edge; the deploy checklist (§5.8) calls for verifying templates *before* enabling the worker. |

The last row is the only sharp edge: a mis-configured deploy can silently swallow the first wave of alerts. The 24 h window means a corrected deploy waits up to 24 h for the next natural alert opportunity per device. Mitigation: when fixing a template id in production, also run `UPDATE m1_katara_devices SET last_offline_alert_at = NULL WHERE status = 'OFFLINE' AND last_offline_alert_at > (deploy_time - interval '5 minutes')` to clear the suppression for the affected window.

### 6.8 Risk — interaction with KAT-12 (unlink) and KAT-13 (history)

- **KAT-12** soft-detaches devices by flipping `status = 'UNLINKED'`. KAT-11's WHERE clause filters `status = 'ACTIVE'`, so UNLINKED devices are naturally skipped. No interaction needed.
- **KAT-13** queries telemetry history regardless of device status. The `last_offline_alert_at` column does not appear in any KAT-13 surface. No interaction needed.

### 6.9 Risk — clock skew between worker and database

The scan SQL uses `now()` (database time) for both the silence threshold and the audit-column stamp. The application's `started = datetime.now(timezone.utc)` is only used for the `minutes_silent` computation in the email body — a minute or two of skew is invisible in the rendered "appareil silencieux depuis 73 minutes" copy. No NTP requirement beyond standard VPS hygiene.

---

## 7. Tests

### 7.1 Backend unit tests — `backend/tests/test_kat11_scanner.py`

The scanner has limited pure-function surface (the SQL is the logic), so most tests are integration-shaped with a mocked asyncpg pool. The five scenarios:

| # | Scenario | Expected |
|---|---|---|
| S1 | UPDATE returns 0 rows | `_scan_once` returns 0; no `mailer.send_template` call; log line `offline_scan_pass alerted=0` |
| S2 | UPDATE returns 1 row, profile present, locale `fr` | One `mailer.send_template` call with template id `BREVO_TEMPLATE_KAT_OFFLINE_FR`, params include `minutes_silent ≥ 60`, `dashboard_url` contains the parcel uuid |
| S3 | UPDATE returns 1 row, profile present, locale `xx` (unknown) | `mailer.send_template` called with FR template (fallback per §5.4) |
| S4 | UPDATE returns 1 row, profile lookup returns None | No `mailer.send_template` call; warning log `offline_alert_profile_missing` |
| S5 | UPDATE returns 2 rows, both profiles present, Brevo fails for the second | First `mailer.send_template` succeeds; second raises; Sentry capture invoked once; pass returns 2 (both rows already flipped to OFFLINE in the DB, regardless of email outcome) |

Use `pytest-asyncio` (already in INF-04's deps) + `unittest.mock.AsyncMock` for the asyncpg connection and the mailer. Sample S1:

```python
@pytest.mark.asyncio
async def test_s1_no_silent_devices(monkeypatch):
    pool = AsyncMock()
    conn = AsyncMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    conn.fetch.return_value = []

    send_mock = AsyncMock()
    monkeypatch.setattr("app.workers.katara_offline.scanner.mailer.send_template", send_mock)

    from app.workers.katara_offline.scanner import _scan_once
    alerted = await _scan_once(pool)

    assert alerted == 0
    assert send_mock.await_count == 0
```

### 7.2 Backend e2e test — `backend/tests/test_kat11_scanner_e2e.py` (gated behind `--run-e2e`)

```python
@pytest.mark.e2e
@pytest.mark.asyncio
async def test_kat11_end_to_end_offline_detection(staging_db, monkeypatch):
    """Insert a paired ACTIVE device with last_seen 2h ago, run one scan,
    assert: row flipped to OFFLINE, last_offline_alert_at stamped, Brevo
    called exactly once. Then run a second scan, assert: zero new emails."""

    send_mock = AsyncMock()
    monkeypatch.setattr("app.workers.katara_offline.scanner.mailer.send_template", send_mock)

    # Arrange: a device silent for 2h
    device_id = await _seed_silent_device(staging_db, last_seen_offset_hours=2)

    # Act 1: first scan
    from app.workers.katara_offline.scanner import _scan_once
    pool = await _open_pool()
    alerted = await _scan_once(pool)

    # Assert 1
    assert alerted == 1
    assert send_mock.await_count == 1

    row = await staging_db.fetchrow(
        "select status, last_offline_alert_at from m1_katara_devices where id = $1",
        device_id,
    )
    assert row["status"] == "OFFLINE"
    assert row["last_offline_alert_at"] is not None

    # Act 2: second scan (immediate, inside 24 h window)
    alerted2 = await _scan_once(pool)

    # Assert 2: no new email
    assert alerted2 == 0
    assert send_mock.await_count == 1  # unchanged
```

### 7.3 pgTAP cell — `db/tests/auth07_business_rules.sql`

See §5.7. Verifies the service-role-can-write / authenticated-cannot-write contract for `m1_katara_devices.status = 'OFFLINE'` and `last_offline_alert_at`.

### 7.4 Manual staging rehearsal

Run before flipping `spring-status.yml` to `IN_REVIEW`:

1. SSH to staging. `docker compose ps katara_offline_worker` shows the container running.
2. Confirm Healthchecks.io check is green.
3. As a verified FARMER on staging, pair a fresh ESP32 (or simulate one with `curl POST /api/v1/katara/ingest` per KAT-03 §x). Confirm `m1_katara_devices.last_seen` updates.
4. SSH into Postgres and force the silence:
   ```sql
   update m1_katara_devices
      set last_seen = now() - interval '2 hours'
    where device_id = 'ESP32-TEST';
   ```
5. Wait ≤ 5 min for the next scan, OR force one: `docker compose exec katara_offline_worker python -c "import asyncio; from app.workers.katara_offline.scanner import _scan_once, _open_pool; asyncio.run(_force_one())"` (small ad-hoc helper).
6. Confirm:
   - Email arrives in the farmer's inbox within Brevo SLA (≤ 2 min).
   - DB row: `select status, last_offline_alert_at from m1_katara_devices where device_id = 'ESP32-TEST';` → `OFFLINE`, non-null timestamp.
   - Worker logs show one `offline_alert_sent` line.
7. Send a fresh ingest for the same device. Confirm `status` flips back to `ACTIVE` (KAT-03's responsibility — verifies the recovery path).
8. Wait for next scan. Confirm no new email (device is ACTIVE again, scan skips it).
9. Force silence a second time within 24 h. Confirm: scan flips status to OFFLINE again but `mailer.send_template` is *not* called (BR-K11-1 anti-spam).

---

## 8. Observability

| Signal | Source | What it tells us |
|---|---|---|
| `katara_offline_worker_heartbeat` Healthchecks.io check | Worker `_ping_heartbeat` every 60 s | Worker liveness. 5-min silence → pages on-call. |
| `offline_scan_pass` log line | Worker `_scan_once` | Per-pass count of devices alerted. Anomalous spike (e.g. 20 devices at once) is investigated as a possible upstream outage. |
| `offline_alert_sent` / `offline_alert_brevo_failed` log lines | Worker `_send_for_row` | Per-device dispatch outcome. |
| Sentry exception captures | `_scan_once` outer `except` + `_send_for_row` Brevo failure path | Worker errors visible in INF-08's Sentry project. |
| `m1_katara_devices` direct queries | Manual SQL | `SELECT COUNT(*) FROM m1_katara_devices WHERE status = 'OFFLINE'` is the at-a-glance health metric. |

The Brevo dashboard's "transactional emails" log is the third-party-side verification: every `offline_alert_sent` log line should have a matching Brevo "delivered" event within 2 min.

---

## 9. Acceptance Verification Checklist

Run before flipping `spring-status.yml` to `IN_REVIEW`:

- [ ] Migration `00XX_kat11_offline_alert_column.sql` applied on staging; `\d m1_katara_devices` shows `last_offline_alert_at` column.
- [ ] `pytest backend/tests/test_kat11_scanner.py -v` — all 5 scenarios green.
- [ ] `pytest backend/tests/test_kat11_scanner_e2e.py --run-e2e` — passes on staging.
- [ ] `make -C db test-auth07` — new pgTAP cell green.
- [ ] `pytest backend/tests/test_service_client_callsite_allowlist.py` — passes with the new `katara_offline` prefix added.
- [ ] `docker compose up -d katara_offline_worker` on staging — container reaches `running` state within 30 s; logs show `katara_offline_worker_starting`.
- [ ] Healthchecks.io `katara_offline_worker_heartbeat` check goes green within 90 s.
- [ ] Three Brevo templates exist in the Brevo dashboard with the §5.4 subject lines.
- [ ] `infra/brevo-templates/kat11_offline_alert/{fr,ar,en}.html` skeleton files committed.
- [ ] `.env.example` updated with the four new env-var names; production `.env` has values.
- [ ] Manual staging rehearsal (§7.4) steps 1-9 all observed.
- [ ] No Sentry errors during a full scan cycle on staging.
- [ ] `spring-status.yml` KAT-11 row updated to `IN_REVIEW`; E2 epic `progress_pct` updated.

---

## 10. Hand-off Notes for Future Work

1. **KAT-12 (unlink/relink)** — KAT-12's flow flips `status = 'UNLINKED'`. KAT-11's scan already filters `status = 'ACTIVE'` so UNLINKED devices are naturally skipped. KAT-12 does **not** need to clear `last_offline_alert_at` on relink; the new device row created by KAT-12's relink path starts with `last_offline_alert_at = NULL` (column default) and behaves as a fresh pairing. If KAT-12 ever introduces an in-place "re-activate the same row" path (not currently planned), it must clear `last_offline_alert_at` to NULL so the device's next silent period re-alerts within the 24 h window.
2. **Recovery email (post-MVD)** — see §6.6. Two-line addition to KAT-03's ingest path: when `status` transitions OFFLINE → ACTIVE, send a Brevo "back online" template and clear `last_offline_alert_at = NULL`. The template skeleton can live under `infra/brevo-templates/kat11_recovery_alert/`. Estimated effort: 2 hours including template authoring.
3. **Per-farmer threshold** — promote `SILENCE_THRESHOLD` from a compile-time constant to a per-row override on `profiles` or `m1_katara_devices`. Requires a small UI change (the dashboard's device settings card) + a copy update to the email body. Estimated effort: 1 day including i18n.
4. **Severity tiering** — a second pass at `last_seen < now() - interval '24 hours'` could trigger a "critical" template (red instead of yellow). Useful once the farmer base exceeds the demo size and a 1 h silence is no longer noteworthy enough to disrupt the inbox.
5. **i18n of email subject** — KAT-11 puts the locale switch inside the Brevo template (each variant has its own subject line); this is consistent with KAT-06. A future i18n sweep that consolidates all email templates onto a single Brevo template + Mustache-rendered locale parameter is possible but requires a Brevo plan upgrade.
6. **Worker consolidation** — KAT-06 + KAT-11 are two near-identical worker containers. A post-MVD consolidation into a single `katara_alerts_worker` that listens on the NOTIFY channel *and* runs the CRON scan is straightforward (~half a day of refactoring). Not worth doing during MVD because each story shipping a clean, separate container is easier to reason about and roll back.
7. **AUTH-07 RLS matrix** — the matrix gains a new audit-column WRITE cell for `m1_katara_devices.status` × service-role and `m1_katara_devices.last_offline_alert_at` × service-role. The KAT-11 pgTAP cell (§5.7) covers both. Confirm the matrix doc (`docs/auth07-rls-matrix.md` or equivalent) is updated as part of the AUTH-07 audit story; it is not KAT-11's job to maintain that document.
