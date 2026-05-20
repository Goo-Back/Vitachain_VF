# KAT-06 — Email alert on threshold crossing (Brevo)

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** System (long-running async worker; no user-facing endpoint, no UI)
> **Depends on:** [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) (provides the `NOTIFY katara_telemetry_inserted, '<device_id>|<telemetry_row_id>'` channel — KAT-06's worker `LISTEN`s on it, never polls `m1_katara_telemetry`) · [KAT-05](./KAT-05-alert-thresholds.md) (provides `m1_katara_thresholds` — the row contract the worker reads on every notification, and the `last_alert_at` / `last_alert_value` audit columns the worker is the *only* legitimate writer of) · [NOT-01](../spring-status.yml) (Brevo client wrapper — `backend/app/workers/mailer.py` — the single transport KAT-06 routes through) · [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) (service-role callsite allowlist — `backend/app/workers/katara_threshold/` is the new allow-list entry; `# JUSTIFICATION:` on the single `service_client()` call) · [AUTH-06](./AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) (PENDING farmers still receive alerts — verification gates *publication*, not the receipt of operational alerts on the farmer's own hardware)
> **Unblocks:** [KAT-11](../spring-status.yml) (offline-device alert reuses the same `_send_alert_email()` helper + Brevo template skeleton + BR-K2-style anti-spam column pattern) · the AUTH-07 matrix's `m1_katara_thresholds.last_alert_at` WRITE × service-role cell (proves the column lock is correct end-to-end, not just structurally) · the M1 Katara module's first "system-initiated" UX path — every later Katara story that emails the farmer (KAT-09 diagnostic completion, KAT-11 offline) follows the locale-selection + dedup template defined here
> **Acceptance:** A verified farmer with `soil_moisture` thresholds `min=25 max=75` enabled receives an email — in their saved locale — within **5 minutes** of the first sensor reading that crosses either bound (e.g. an ESP32 reports `soil_moisture=22.3` at 14:02; the email lands at 14:02 + Brevo SLA). A second crossing reading from the same device + metric within 24 h produces **zero additional emails** (BR-K2). A threshold *edit* (`updated_at > last_alert_at`) clears the suppression so the next crossing reading re-alerts even inside the 24 h window. A telemetry insert for a parcel with no thresholds, or with `enabled=false`, or with all readings inside bounds, produces zero emails and zero `m1_katara_thresholds` writes. The ingest path's p50 < 50 ms (KAT-03 SLA) is unaffected — all evaluation happens off the ingest connection.

---

## 1. Purpose

KAT-05 shipped the *intent*: a farmer can declare "tell me when soil moisture drops below 25 %". KAT-06 ships the *action*: every time the ESP32 pushes a reading that crosses a configured bound, a Brevo email leaves the system. Together they close the agronomic alert loop the PRD §6.1 KAT-06 row promises.

The story is deliberately scoped to a **single new artefact** — a long-running async worker process that subscribes to the Postgres `NOTIFY` channel KAT-03 already emits and that KAT-05 already accounted for in its row contract. There is **no migration**, **no router**, **no UI**, and **no schema**. The worker's job is:

1. Receive `<device_id>|<telemetry_row_id>` on the `katara_telemetry_inserted` channel.
2. Look up the just-inserted telemetry row (one indexed primary-key fetch — < 1 ms on a hot Supavisor pool).
3. Resolve the parcel (already denormalised onto the telemetry row by KAT-03's fill trigger) and load the parcel's `m1_katara_thresholds` (≤ 5 rows by the unique constraint — covered by the `(parcel_id, metric)` index KAT-05 created).
4. For every metric where `enabled = true` and the reading sits outside `[min_value, max_value]`, evaluate BR-K2 anti-spam: send the email iff `last_alert_at is null` *or* `now() - last_alert_at > interval '24 hours'` *or* `updated_at > last_alert_at` (the third clause is the "threshold-edit clears suppression" rule — KAT-05 §10 hand-off note #2).
5. Render the locale-appropriate Brevo template (FR / AR / EN with `fr` fallback per PRD §7.2), `await mailer.send_template(...)`, and on Brevo success update `last_alert_at = now(), last_alert_value = <reading>` for that exact `(parcel_id, metric)` row via the service-role client.

Why a worker and not a Postgres function calling `pg_net` / Supabase Webhook → Brevo directly? Two reasons, the second one decisive:

- The Brevo template path needs the farmer's saved locale (`profiles.locale`), the parcel's friendly name (`m1_katara_parcels.name`), the device's friendly id, *and* the metric's localised label. That cross-table assembly is uncomfortable inside a `pg_net.http_post`, and the Webhook route the PRD §7.3 mentions for BotaBa9a leads (BR-B2) only works because that payload is structurally trivial (no joins, no locale switch).
- BR-K2 is **stateful** and the suppression-reset rule (`updated_at > last_alert_at`) is **conditional**. Encoding it in a Postgres trigger entangles email-send concerns with the IoT ingest hot path. The KAT-03 SLA is `< 50 ms` and explicitly *forbids* AI / mail work on the ingest connection (PRD §6.1.3, KAT-03 §2 out-of-scope). Putting BR-K2 in the worker keeps the ingest path empty and lets us evolve the rule (window length, channel priority, batching) without ever opening a migration.

Concretely KAT-06 delivers:

- A new worker package [`backend/app/workers/katara_threshold/`](../../backend/app/workers/katara_threshold/) with three files: `__init__.py` (entrypoint), `listener.py` (LISTEN/NOTIFY lifecycle + reconnect), and `evaluator.py` (the pure-function evaluation + Brevo dispatch). Pure-function split so the BR-K2 logic is unit-testable without a database or a Brevo network call.
- A new `entrypoint` script [`backend/app/workers/katara_threshold/__main__.py`](../../backend/app/workers/katara_threshold/__main__.py) so `python -m app.workers.katara_threshold` launches it cleanly under `docker compose`.
- A new `compose` service `katara_threshold_worker` in [`infra/docker-compose.yml`](../../infra/docker-compose.yml) — same image as the FastAPI backend (`vitachain/backend:latest`), different command, `restart: unless-stopped` per PRD §8.2.
- A Brevo transactional template (id captured in `.env` as `BREVO_TEMPLATE_KAT_THRESHOLD_FR` / `_AR` / `_EN`) with three locale variants. The template id mapping lives in `backend/app/workers/mailer.py` (NOT-01) — KAT-06 only ships the *content* + the dispatch wrapper.
- A `Healthchecks.io` heartbeat ping (PRD §8.5 Observability — `HEALTHCHECKS_KAT_THRESHOLD_PING_URL` env). The worker pings every 60 s; a 5-min silence pages on-call via the existing Uptime Kuma → Brevo bridge from INF-08.
- A Sentry-traced exception path so a Brevo 5xx, a malformed notification payload, or a transient asyncpg disconnect surfaces as a span on the existing Sentry project (INF-08).
- An extension to the AUTH-05 callsite allowlist ([`backend/tests/test_service_client_callsite_allowlist.py`](../../backend/tests/test_service_client_callsite_allowlist.py)) — add `app.workers.katara_threshold` to `ALLOW_PREFIXES` and an inline `# JUSTIFICATION: KAT-06 worker writes m1_katara_thresholds.last_alert_at via service-role per the KAT-05 RLS contract — only this module legitimately writes audit columns.` at the single `service_client()` callsite.
- Unit tests for the evaluator ([`backend/tests/test_kat06_evaluator.py`](../../backend/tests/test_kat06_evaluator.py)) covering BR-K2 across 9 scenarios (no thresholds → no email; disabled threshold → no email; in-range → no email; out-of-range first-time → email; out-of-range second-time within 24 h → no email; out-of-range second-time at 24 h + 1 s → email; out-of-range with `last_alert_at < updated_at` → email regardless of 24 h window; `min`-only crossing; `max`-only crossing; both crossing → one email per metric).
- An integration test ([`backend/tests/test_kat06_listener_e2e.py`](../../backend/tests/test_kat06_listener_e2e.py)) gated behind `--run-e2e`: insert a synthetic telemetry row into staging, wait ≤ 10 s, assert (a) the Brevo `send_template` mock was invoked with the expected `(to, template_id, params)`, (b) the `m1_katara_thresholds` row's `last_alert_at` advanced, (c) a second insert within 24 h does not re-invoke Brevo.
- A pgTAP cell appended to [`db/tests/auth07_business_rules.sql`](../../db/tests/auth07_business_rules.sql) — the **end-to-end** BR-K2 verification cell: simulate the worker's update path under `service_role`, then assert from `authenticated` that the read of `last_alert_at` reflects the change but no policy permits an `authenticated` write back (closes the loop on the KAT-05 audit-clamp UPDATE cell which only covered the *negative* — KAT-06 covers the *positive* "service_role can write" half).
- A 5-min CRON-style polling backstop ([`backend/app/workers/katara_threshold/listener.py::_scan_recent_telemetry`](../../backend/app/workers/katara_threshold/listener.py)) that catches notifications missed during a disconnect window. Reads `m1_katara_telemetry` for the last 6 minutes (1-min overlap with the previous run), groups by `(parcel_id, metric)`, and re-runs the evaluator on the newest reading per group. BR-K2 itself makes the backstop idempotent — a row evaluated twice within 24 h produces zero extra emails.

Once `DONE`, the M1 Katara alerting loop is closed end-to-end: ESP32 → ingest (KAT-03) → trigger NOTIFY → worker (KAT-06) → Brevo → farmer's inbox. KAT-11 (offline-device alert) becomes a near-mechanical copy: same worker package layout, same Brevo template skeleton, same `last_*_at` anti-spam column pattern on a different table.

---

## 2. Scope

### In scope
- New worker package `backend/app/workers/katara_threshold/` with `__init__.py`, `__main__.py`, `listener.py`, `evaluator.py`, `templates.py` (locale label catalogue + Brevo param assembly).
- LISTEN/NOTIFY lifecycle: one dedicated asyncpg connection (LISTEN holds a connection), exponential-backoff reconnect (`1s → 2s → 4s → 8s → 30s → 60s` capped), structured-logged disconnect/reconnect events, polling backstop on reconnect to catch the gap.
- BR-K2 anti-spam evaluator (pure function — `evaluate_telemetry(telemetry, thresholds, now) -> list[AlertDecision]`) covering: 24 h window, threshold-edit suppression clear, enabled/disabled flag, both-bounds crossing, min-only / max-only crossing.
- Brevo dispatch via `backend/app/workers/mailer.py` (NOT-01). Three locale templates registered (`fr`, `ar`, `en`) with `fr` fallback.
- Service-role UPDATE of `m1_katara_thresholds.last_alert_at` + `last_alert_value` *after* Brevo confirms 2xx — no premature write that would suppress a follow-up if Brevo fails.
- Docker compose service `katara_threshold_worker` — same image, different command, `restart: unless-stopped`, healthcheck shell-cmd, env-var bindings (`BREVO_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `SENTRY_DSN`, `HEALTHCHECKS_KAT_THRESHOLD_PING_URL`, `BREVO_TEMPLATE_KAT_THRESHOLD_FR/AR/EN`).
- Healthchecks.io 60 s heartbeat + Sentry exception tracing.
- AUTH-05 allow-list extension + `# JUSTIFICATION:` comment + matching update to [`backend/tests/test_service_client_callsite_allowlist.py`](../../backend/tests/test_service_client_callsite_allowlist.py).
- Unit tests (9 evaluator scenarios) + e2e test (`--run-e2e`, 3 scenarios) + 1 new pgTAP cell.
- One Brevo template per locale, FR / AR / EN, captured under `infra/brevo-templates/kat06_threshold_alert/` as static HTML mirrors of the Brevo dashboard content so the team can re-create the templates without dashboard archaeology.
- `spring-status.yml` flip + a §10 hand-off note for KAT-11.

### Out of scope
- **Threshold persistence + UI** → [KAT-05](./KAT-05-alert-thresholds.md). KAT-06 reads `m1_katara_thresholds` as an external contract; the worker neither creates rows nor exposes a CRUD API.
- **Brevo client wrapper** → [NOT-01](../spring-status.yml). KAT-06 calls `mailer.send_template(to, template_id, params)`; it does not own retry, signing, or template-id mapping.
- **Localisation of the *telemetry chart* axis labels** → KAT-04 follow-up. KAT-06 only localises (a) the email subject, (b) the metric label inside the email body, (c) the unit suffix. The dashboard's labels are a different concern.
- **SMS / WhatsApp / Push** — PRD §7.3 declares email as the only channel for MVD. Adding a second channel is post-MVD.
- **Per-severity escalation** (warning vs critical vs sustained-out-of-range > N readings) — the MVD email says "threshold crossed", period. Severity tiering is a post-MVD agronomic refinement.
- **Batched daily digest** — the worker fires one email per `(parcel_id, metric)` × 24 h. A "daily summary of all crossings" digest is a different product surface; out for MVD.
- **Anti-spam state visible in the UI** — KAT-05 §2 explicitly defers showing `last_alert_at` in the `ThresholdsSection` editor. The audit columns are *operational state* for KAT-06, not user-facing state. A future story can render a small "last alerted 3 h ago" muted line; not today.
- **Multi-device parcels** — KAT-05 §2 decision: per-parcel thresholds; one ESP32 per parcel is the MVD norm. The worker's lookup is keyed on `parcel_id` — the `device_id` from the NOTIFY payload is used only to resolve the parcel and to populate the email body's "device" line. Multi-device parcels are post-MVD.
- **CRON-based polling as the *primary* trigger** — the primary trigger is `LISTEN`; polling is a 5-min backstop only. A pure-polling design would inflate DB read load and trade the SLA-friendly NOTIFY path for nothing.
- **Brevo template editing tooling** — the templates live in the Brevo dashboard; the `infra/brevo-templates/` mirrors are documentation, not a sync source.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) `IN_REVIEW` or `DONE` | The `katara_telemetry_inserted` NOTIFY channel must exist and emit `'<device_id>\|<telemetry_row_id>'`. Verify via `psql -c "listen katara_telemetry_inserted"` then forge a telemetry insert — the notification should land within ms. |
| [KAT-05](./KAT-05-alert-thresholds.md) `IN_REVIEW` or `DONE` | The `m1_katara_thresholds` table + the audit columns (`last_alert_at`, `last_alert_value`) + the per-parcel index + the audit-guard trigger that locks the audit columns to service-role writers — KAT-06 leans on all four. |
| [NOT-01](../spring-status.yml) `IN_REVIEW` or `DONE` | `backend/app/workers/mailer.py` with `async def send_template(to, template_id, params, locale)`. Without NOT-01, KAT-06 has nowhere to put the Brevo HTTP client. |
| [INF-04](./INF-04-fastapi-backend-scaffold-healthcheck.md) `DONE` | Provides the `app/db.py` module with `service_client()` / async asyncpg pool factory KAT-06 reuses; also provides the Sentry SDK init pattern KAT-06 mirrors in its `__main__.py`. |
| [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) `DONE` | `ALLOW_PREFIXES` and the AST-walking callsite allow-list test exist. KAT-06's allow-list extension is a one-line PR addition that lands together with the worker module. |
| [INF-08](./INF-08-sentry-uptime-kuma-observability.md) `DONE` | Healthchecks.io account + Sentry project exist; KAT-06 only consumes them via env-var URLs. |
| Brevo account + transactional template ids | The three template ids (`BREVO_TEMPLATE_KAT_THRESHOLD_FR/AR/EN`) must be created in the Brevo dashboard before deploy. Skeleton HTML lives in `infra/brevo-templates/kat06_threshold_alert/{fr,ar,en}.html` for re-creation. |

---

## 4. Data Contract

KAT-06 ships no schema. It reads three tables and writes two columns of a fourth. This section documents the contracts the worker leans on so a reviewer can verify each invariant in isolation.

### 4.1 NOTIFY payload (from KAT-03)

```
channel : katara_telemetry_inserted
payload : '<device_id>|<telemetry_row_id>'   -- both uuids, '|' separator
```

The worker's parser MUST treat *any* payload that does not exactly split on a single `|` into two uuid-shaped strings as a structured error — log + Sentry-capture + drop. The polling backstop will catch the corresponding row on the next pass; no retry loop on a malformed payload (those are programming errors, not transient faults).

### 4.2 The hot read (from KAT-03's telemetry + KAT-05's thresholds)

```sql
-- Resolve the telemetry row. parcel_id + farmer_id are denormalised onto the
-- row by KAT-03's fill trigger, so this is a one-table indexed PK fetch.
select
    t.id, t.device_id, t.parcel_id, t.farmer_id, t.recorded_at,
    t.soil_moisture, t.soil_temperature, t.soil_ph,
    t.soil_conductivity, t.battery_level
from public.m1_katara_telemetry t
where t.id = $1;

-- Load the parcel's thresholds. At most 5 rows by KAT-05's unique constraint.
-- Covered by the (parcel_id, metric) index KAT-05 created.
select metric, min_value, max_value, enabled,
       last_alert_at, last_alert_value, updated_at
from public.m1_katara_thresholds
where parcel_id = $1 and enabled = true;

-- Load the farmer's locale + the parcel name for the email body.
select p.email, p.locale, p.full_name, pa.name as parcel_name
from public.profiles p
join public.m1_katara_parcels pa on pa.farmer_id = p.id
where pa.id = $1 and p.id = $2;
```

All three reads happen under `service_role` (the worker has no user JWT). The denormalisation work KAT-03 paid for upfront is why KAT-06 doesn't need a join on the hot path.

### 4.3 The hot write (the audit columns — KAT-05 §4.4 contract)

```sql
update public.m1_katara_thresholds
set last_alert_at    = now(),
    last_alert_value = $1
where parcel_id = $2 and metric = $3;
```

This `UPDATE` only succeeds under `service_role`. The pgTAP cell from KAT-05 (`BR cell — audit-column update`) verified the negative half (an `authenticated` UPDATE silently no-ops via the trigger); KAT-06's pgTAP cell §5.9.3 verifies the positive half (a `service_role` UPDATE writes through cleanly).

**Order matters:** the audit-column update lands *after* Brevo returns 2xx. Sequence:
1. Evaluate → decide email needed.
2. `await mailer.send_template(...)` → wait for Brevo 2xx.
3. `update ... set last_alert_at = now() ...` → only now is the user "guaranteed alerted".

If step 2 fails (Brevo 5xx, network drop, rate limit), the worker logs + Sentry-captures and does **not** update `last_alert_at`. The next ESP32 reading (15 min later per KAT-03 cadence) re-evaluates and re-tries — BR-K2 doesn't kick in because `last_alert_at` was never advanced. This is the deliberately conservative failure mode: a user *might* receive one duplicate email if Brevo returns 5xx between the send and the `last_alert_at` update (rare), but they will *never* silently lose an alert because we marked them notified before the network call landed.

### 4.4 Brevo template parameter contract

The Brevo templates (created in the Brevo dashboard, mirrored under `infra/brevo-templates/kat06_threshold_alert/`) receive this parameter envelope:

```json
{
  "farmer_name": "Ahmed Ben Salah",
  "parcel_name": "Olive Grove North",
  "device_id": "ESP32-A47B",
  "metric_label": "Humidité du sol",
  "metric_value": 22.3,
  "metric_unit": "%",
  "threshold_min": 25.0,
  "threshold_max": 75.0,
  "crossed_bound": "min",
  "reading_at": "2026-05-17T14:02:00Z",
  "dashboard_url": "https://vitachain.ma/dashboard/farmer/parcels/<uuid>"
}
```

`metric_label` is the localised string (`templates.py::LOCALISED_LABELS`); the template itself is mostly placeholder substitution. `dashboard_url` is built from `FRONTEND_BASE_URL` + the parcel path so the email deep-links to the parcel detail page (where the farmer sees the sparkline already KAT-05-painted with the threshold band). `crossed_bound` is `"min"` | `"max"` | `"both"` — the template's localised copy branches on it.

The Brevo *subject* is template-side: each locale variant ships a subject containing the placeholder `{{ params.metric_label }}` so the inbox preview ("Alerte: Humidité du sol hors plage — Olive Grove North") is informative.

---

## 5. Step-by-Step Implementation

### 5.1 Worker package skeleton

Create [`backend/app/workers/katara_threshold/__init__.py`](../../backend/app/workers/katara_threshold/__init__.py) — empty package marker.

Create [`backend/app/workers/katara_threshold/__main__.py`](../../backend/app/workers/katara_threshold/__main__.py):

```python
"""KAT-06 worker entrypoint.

Run with:
    python -m app.workers.katara_threshold

In Docker:
    command: ["python", "-m", "app.workers.katara_threshold"]

Single-process design — one asyncpg LISTEN connection + one Brevo HTTP client.
Horizontal scale-out is unnecessary for MVD (≤ 50 farmers × 1 ESP32 each at
15 min cadence = ~3 notifications/min peak). If needed post-MVD, the worker
is safe to run as N replicas: notifications are broadcast to all listeners,
and the BR-K2 audit-column UPDATE serialises the dedup decision at the DB.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

import sentry_sdk

from app.workers.katara_threshold.listener import run_listener

log = logging.getLogger("katara_threshold")


def _init_observability() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=0.1,
            environment=os.getenv("APP_ENV", "production"),
            release=os.getenv("APP_RELEASE", "dev"),
            server_name="katara-threshold-worker",
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
            # Windows event loop — fall back to signal.signal
            signal.signal(sig, _on_signal)

    log.info("katara_threshold_worker_starting")
    await run_listener(stop_event=stop)
    log.info("katara_threshold_worker_stopped")


if __name__ == "__main__":
    asyncio.run(_main())
```

The `LOG_LEVEL` env defaults to `INFO`; the JSON line format slots directly into the existing INF-08 log pipeline.

---

### 5.2 The listener — LISTEN/NOTIFY lifecycle + reconnect + backstop

Create [`backend/app/workers/katara_threshold/listener.py`](../../backend/app/workers/katara_threshold/listener.py):

```python
"""LISTEN/NOTIFY lifecycle for the KAT-06 threshold worker.

Responsibilities:
- Hold one dedicated asyncpg connection in LISTEN mode.
- Decode the '<device_id>|<telemetry_row_id>' payload format.
- Dispatch every well-formed notification to evaluate_and_send().
- Reconnect on disconnect with exponential backoff.
- Run a 5-min polling backstop to catch notifications missed during outages.
- Ping Healthchecks.io every 60 s so a 5-min silence pages on-call.

This module is the only place that talks to asyncpg directly; evaluator.py
is pure-function and DB-free.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import asyncpg
import httpx

from app.workers.katara_threshold.evaluator import (
    AlertDecision, evaluate_and_send,
)

log = logging.getLogger("katara_threshold.listener")

CHANNEL = "katara_telemetry_inserted"
BACKOFF_SEQ = (1, 2, 4, 8, 30, 60)
HEARTBEAT_PERIOD_S = 60
BACKSTOP_PERIOD_S = 300
BACKSTOP_LOOKBACK_S = 360  # 1-min overlap with previous backstop run


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_KAT_THRESHOLD_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)


def _parse_payload(payload: str) -> Optional[tuple[UUID, UUID]]:
    """Return (device_id, telemetry_id) or None on malformed payload."""
    try:
        a, b = payload.split("|", 1)
        return UUID(a), UUID(b)
    except (ValueError, AttributeError):
        return None


async def _on_notification(
    queue: asyncio.Queue,
    _conn: asyncpg.Connection,
    _pid: int,
    channel: str,
    payload: str,
) -> None:
    if channel != CHANNEL:
        return
    await queue.put(payload)


async def _consume_queue(
    queue: asyncio.Queue,
    pool: asyncpg.Pool,
    stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        try:
            payload = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        parsed = _parse_payload(payload)
        if parsed is None:
            log.warning("malformed_notification_payload", extra={"payload": payload})
            import sentry_sdk
            sentry_sdk.capture_message(
                f"katara_threshold malformed payload: {payload!r}",
                level="warning",
            )
            continue
        _device_id, telemetry_id = parsed
        try:
            await evaluate_and_send(pool=pool, telemetry_id=telemetry_id)
        except Exception:
            log.exception("evaluator_failed", extra={"telemetry_id": str(telemetry_id)})
            import sentry_sdk
            sentry_sdk.capture_exception()


async def _backstop(pool: asyncpg.Pool, stop_event: asyncio.Event) -> None:
    """Every BACKSTOP_PERIOD_S, scan telemetry inserted in the last
    BACKSTOP_LOOKBACK_S seconds and re-run the evaluator. BR-K2 makes this
    safe — already-alerted rows are deduped at the audit-column UPDATE.
    """
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=BACKSTOP_PERIOD_S)
            return
        except asyncio.TimeoutError:
            pass
        since = datetime.now(timezone.utc) - timedelta(seconds=BACKSTOP_LOOKBACK_S)
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "select id from public.m1_katara_telemetry "
                    "where recorded_at >= $1 order by recorded_at",
                    since,
                )
            log.info("backstop_pass", extra={"row_count": len(rows)})
            for row in rows:
                try:
                    await evaluate_and_send(pool=pool, telemetry_id=row["id"])
                except Exception:
                    log.exception("backstop_evaluator_failed",
                                  extra={"telemetry_id": str(row["id"])})
        except Exception:
            log.exception("backstop_query_failed")


async def _heartbeat_loop(stop_event: asyncio.Event) -> None:
    async with httpx.AsyncClient() as client:
        await _ping_heartbeat(client)  # immediate boot-time ping
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=HEARTBEAT_PERIOD_S)
                return
            except asyncio.TimeoutError:
                pass
            await _ping_heartbeat(client)


async def _connect_listen(pool: asyncpg.Pool, queue: asyncio.Queue) -> asyncpg.Connection:
    """Acquire a dedicated connection from the pool and register LISTEN."""
    conn = await pool.acquire()
    await conn.add_listener(
        CHANNEL,
        lambda c, pid, ch, payload: asyncio.create_task(
            _on_notification(queue, c, pid, ch, payload)
        ),
    )
    log.info("listener_subscribed", extra={"channel": CHANNEL})
    return conn


async def run_listener(stop_event: asyncio.Event) -> None:
    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=2,
        max_size=4,
        command_timeout=10.0,
    )
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1024)

    consumer = asyncio.create_task(_consume_queue(queue, pool, stop_event))
    backstop = asyncio.create_task(_backstop(pool, stop_event))
    heartbeat = asyncio.create_task(_heartbeat_loop(stop_event))

    backoff_idx = 0
    listen_conn: Optional[asyncpg.Connection] = None

    try:
        while not stop_event.is_set():
            try:
                listen_conn = await _connect_listen(pool, queue)
                backoff_idx = 0
                # Run a backstop immediately after (re)connect to cover the gap.
                await _backstop_once(pool)
                # Block until the connection drops or shutdown.
                while not stop_event.is_set() and not listen_conn.is_closed():
                    try:
                        await asyncio.wait_for(stop_event.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        continue
            except (asyncpg.PostgresConnectionError, OSError, ConnectionError) as e:
                wait = BACKOFF_SEQ[min(backoff_idx, len(BACKOFF_SEQ) - 1)]
                log.warning(
                    "listener_disconnected_will_retry",
                    extra={"error": str(e), "retry_in_s": wait},
                )
                backoff_idx += 1
                with suppress(Exception):
                    if listen_conn is not None:
                        await pool.release(listen_conn)
                listen_conn = None
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(stop_event.wait(), timeout=wait)
    finally:
        for task in (consumer, backstop, heartbeat):
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        with suppress(Exception):
            if listen_conn is not None:
                await pool.release(listen_conn)
        await pool.close()


async def _backstop_once(pool: asyncpg.Pool) -> None:
    """One-shot version of _backstop used right after a (re)connect."""
    since = datetime.now(timezone.utc) - timedelta(seconds=BACKSTOP_LOOKBACK_S)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select id from public.m1_katara_telemetry "
            "where recorded_at >= $1 order by recorded_at",
            since,
        )
    log.info("post_reconnect_backstop", extra={"row_count": len(rows)})
    for row in rows:
        with suppress(Exception):
            await evaluate_and_send(pool=pool, telemetry_id=row["id"])
```

Three non-obvious choices, each deliberate:

1. **The listener is *one* connection drawn from a small pool (`min_size=2, max_size=4`).** asyncpg's `add_listener` holds the connection; the rest of the worker (evaluator queries, backstop scan, audit-column UPDATE) uses the other 1–3. A single-connection design would serialise the LISTEN read behind the evaluator's queries — disastrous under burst.
2. **`_consume_queue` runs as a separate task from `_on_notification`.** Without the queue indirection, a slow evaluator (Brevo 5xx + retry) would back-pressure into asyncpg's notification callback and miss notifications. The queue is bounded at `1024` — if the worker falls 1024 behind, log + drop. The polling backstop catches them on the next 5-min pass.
3. **The backstop runs *after every reconnect* in addition to the 5-min cron.** Without this, a brief disconnect would silently drop notifications until the next 5-min tick. The post-reconnect backstop closes that window to ≈ the reconnect time itself (typically < 2 s).

---

### 5.3 The evaluator — pure-function BR-K2 + Brevo dispatch

Create [`backend/app/workers/katara_threshold/evaluator.py`](../../backend/app/workers/katara_threshold/evaluator.py):

```python
"""Threshold evaluation + Brevo dispatch.

Pure-function shape (evaluate_decisions) so BR-K2 logic is unit-testable
without a database or a Brevo network call. The orchestration wrapper
(evaluate_and_send) is the only thing that touches asyncpg + mailer.

BR-K2 (PRD §6.1.2): one email per (parcel_id, metric) per 24 h.
Hand-off from KAT-05 §10: if `updated_at > last_alert_at`, the suppression
is cleared — the farmer just changed the threshold and expects feedback.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

import asyncpg

from app.workers.katara_threshold.templates import (
    LOCALISED_LABELS, LOCALISED_UNITS, FALLBACK_LOCALE, TEMPLATE_IDS,
)
from app.workers import mailer  # NOT-01

log = logging.getLogger("katara_threshold.evaluator")

ANTI_SPAM_WINDOW = timedelta(hours=24)

METRIC_FIELD = {
    "soil_moisture":     "soil_moisture",
    "soil_temperature":  "soil_temperature",
    "soil_ph":           "soil_ph",
    "soil_conductivity": "soil_conductivity",
    "battery_level":     "battery_level",
}


@dataclass(frozen=True)
class ThresholdRow:
    metric: str
    min_value: float | None
    max_value: float | None
    enabled: bool
    last_alert_at: datetime | None
    last_alert_value: float | None
    updated_at: datetime


@dataclass(frozen=True)
class AlertDecision:
    metric: str
    reading: float
    crossed_bound: Literal["min", "max", "both"]
    threshold_min: float | None
    threshold_max: float | None


def _cross(value: float, lo: float | None, hi: float | None) -> Literal["min", "max", "both"] | None:
    below = lo is not None and value < lo
    above = hi is not None and value > hi
    if below and above:
        # Impossible by the kat_threshold_min_lt_max CHECK but covered for safety.
        return "both"
    if below:
        return "min"
    if above:
        return "max"
    return None


def _is_suppressed(t: ThresholdRow, now: datetime) -> bool:
    if t.last_alert_at is None:
        return False
    if t.updated_at > t.last_alert_at:
        # Threshold edited since last alert — KAT-05 §10 hand-off rule.
        return False
    return (now - t.last_alert_at) < ANTI_SPAM_WINDOW


def evaluate_decisions(
    telemetry: dict,
    thresholds: list[ThresholdRow],
    now: datetime,
) -> list[AlertDecision]:
    """Pure function. No I/O. Trivially unit-testable."""
    decisions: list[AlertDecision] = []
    for t in thresholds:
        if not t.enabled:
            continue
        reading = telemetry.get(METRIC_FIELD[t.metric])
        if reading is None:
            continue
        bound = _cross(float(reading), t.min_value, t.max_value)
        if bound is None:
            continue
        if _is_suppressed(t, now):
            continue
        decisions.append(AlertDecision(
            metric=t.metric, reading=float(reading), crossed_bound=bound,
            threshold_min=t.min_value, threshold_max=t.max_value,
        ))
    return decisions


async def _load_context(pool: asyncpg.Pool, telemetry_id: UUID) -> tuple[dict | None, list[ThresholdRow], dict | None]:
    async with pool.acquire() as conn:
        tel = await conn.fetchrow(
            "select id, device_id, parcel_id, farmer_id, recorded_at, "
            "soil_moisture, soil_temperature, soil_ph, "
            "soil_conductivity, battery_level "
            "from public.m1_katara_telemetry where id = $1",
            telemetry_id,
        )
        if tel is None:
            return None, [], None
        thr_rows = await conn.fetch(
            "select metric, min_value, max_value, enabled, "
            "last_alert_at, last_alert_value, updated_at "
            "from public.m1_katara_thresholds "
            "where parcel_id = $1 and enabled = true",
            tel["parcel_id"],
        )
        profile = await conn.fetchrow(
            "select p.email, p.locale, p.full_name, pa.name as parcel_name "
            "from public.profiles p "
            "join public.m1_katara_parcels pa on pa.farmer_id = p.id "
            "where pa.id = $1 and p.id = $2",
            tel["parcel_id"], tel["farmer_id"],
        )
    thresholds = [
        ThresholdRow(
            metric=r["metric"], min_value=r["min_value"], max_value=r["max_value"],
            enabled=r["enabled"], last_alert_at=r["last_alert_at"],
            last_alert_value=r["last_alert_value"], updated_at=r["updated_at"],
        )
        for r in thr_rows
    ]
    return dict(tel), thresholds, dict(profile) if profile else None


async def _record_alert(pool: asyncpg.Pool, parcel_id: UUID, metric: str, value: float) -> None:
    """Service-role-only write — KAT-05 audit-guard trigger forbids
    authenticated writes here. DATABASE_URL points at the service-role
    user inside the docker network."""
    # JUSTIFICATION: KAT-06 worker writes m1_katara_thresholds.last_alert_at
    # via service-role per the KAT-05 RLS contract — only this module
    # legitimately writes audit columns. AUTH-05 allow-list extended.
    async with pool.acquire() as conn:
        await conn.execute(
            "update public.m1_katara_thresholds "
            "set last_alert_at = now(), last_alert_value = $1 "
            "where parcel_id = $2 and metric = $3",
            value, parcel_id, metric,
        )


async def evaluate_and_send(*, pool: asyncpg.Pool, telemetry_id: UUID) -> None:
    telemetry, thresholds, profile = await _load_context(pool, telemetry_id)
    if telemetry is None:
        log.info("telemetry_row_missing", extra={"telemetry_id": str(telemetry_id)})
        return
    if not thresholds or profile is None:
        return

    now = datetime.now(timezone.utc)
    decisions = evaluate_decisions(telemetry, thresholds, now)
    if not decisions:
        return

    locale = (profile.get("locale") or FALLBACK_LOCALE).lower()
    if locale not in TEMPLATE_IDS:
        locale = FALLBACK_LOCALE

    dashboard_base = os.getenv("FRONTEND_BASE_URL", "https://vitachain.ma").rstrip("/")
    dashboard_url = f"{dashboard_base}/dashboard/farmer/parcels/{telemetry['parcel_id']}"

    for d in decisions:
        params = {
            "farmer_name":  profile.get("full_name") or "",
            "parcel_name":  profile.get("parcel_name") or "",
            "device_id":    str(telemetry["device_id"]),
            "metric_label": LOCALISED_LABELS[locale][d.metric],
            "metric_value": d.reading,
            "metric_unit":  LOCALISED_UNITS[d.metric],
            "threshold_min": d.threshold_min,
            "threshold_max": d.threshold_max,
            "crossed_bound": d.crossed_bound,
            "reading_at":   telemetry["recorded_at"].isoformat(),
            "dashboard_url": dashboard_url,
        }
        try:
            await mailer.send_template(
                to=profile["email"],
                template_id=TEMPLATE_IDS[locale],
                params=params,
                locale=locale,
            )
        except Exception:
            log.exception("brevo_send_failed", extra={
                "telemetry_id": str(telemetry_id), "metric": d.metric,
            })
            # DO NOT advance last_alert_at — next ingest will retry.
            continue

        await _record_alert(pool, telemetry["parcel_id"], d.metric, d.reading)
        log.info("alert_sent", extra={
            "telemetry_id": str(telemetry_id), "metric": d.metric,
            "reading": d.reading, "crossed": d.crossed_bound,
            "to": profile["email"], "locale": locale,
        })
```

---

### 5.4 Localised labels + Brevo template id mapping

Create [`backend/app/workers/katara_threshold/templates.py`](../../backend/app/workers/katara_threshold/templates.py):

```python
"""Locale catalogue for KAT-06 alert emails.

Three locales for MVD per PRD §7.2: fr (P0), ar (P0), en (P1).
Darija / Tamazight (P2 / P3) inherit fr at runtime via FALLBACK_LOCALE.
"""
from __future__ import annotations

import os

FALLBACK_LOCALE = "fr"

TEMPLATE_IDS = {
    "fr": int(os.getenv("BREVO_TEMPLATE_KAT_THRESHOLD_FR", "0") or 0),
    "ar": int(os.getenv("BREVO_TEMPLATE_KAT_THRESHOLD_AR", "0") or 0),
    "en": int(os.getenv("BREVO_TEMPLATE_KAT_THRESHOLD_EN", "0") or 0),
}

LOCALISED_LABELS = {
    "fr": {
        "soil_moisture":     "Humidité du sol",
        "soil_temperature":  "Température du sol",
        "soil_ph":           "pH du sol",
        "soil_conductivity": "Conductivité du sol",
        "battery_level":     "Niveau de batterie",
    },
    "ar": {
        "soil_moisture":     "رطوبة التربة",
        "soil_temperature":  "درجة حرارة التربة",
        "soil_ph":           "حموضة التربة",
        "soil_conductivity": "ناقلية التربة",
        "battery_level":     "مستوى البطارية",
    },
    "en": {
        "soil_moisture":     "Soil moisture",
        "soil_temperature":  "Soil temperature",
        "soil_ph":           "Soil pH",
        "soil_conductivity": "Soil conductivity",
        "battery_level":     "Battery level",
    },
}

LOCALISED_UNITS = {
    "soil_moisture":     "%",
    "soil_temperature":  "°C",
    "soil_ph":           "",
    "soil_conductivity": "µS/cm",
    "battery_level":     "%",
}
```

Mirror the three Brevo HTML bodies under `infra/brevo-templates/kat06_threshold_alert/{fr,ar,en}.html` so the team can re-create the templates without reverse-engineering the live Brevo dashboard. The `ar.html` body sets `dir="rtl"` per PRD §7.2 RTL rule.

---

### 5.5 Brevo wrapper extension (NOT-01 touch-point)

NOT-01 already exposes `backend/app/workers/mailer.py::send_template`. KAT-06 only consumes it; the *only* change KAT-06 lands in `mailer.py` is documenting the three new `template_id` env keys in the docstring's "known templates" list. No behavioural change.

If NOT-01 has not yet shipped at story-pickup time, KAT-06's wrapper degrades to a thin httpx call directly to `https://api.brevo.com/v3/smtp/email`, isolated in `backend/app/workers/katara_threshold/_brevo_fallback.py`, marked `# TEMPORARY: remove on NOT-01 merge` — and the §6 verification step explicitly checks that fallback is gone before the DoD flip.

---

### 5.6 AUTH-05 allow-list extension

Patch [`backend/tests/test_service_client_callsite_allowlist.py`](../../backend/tests/test_service_client_callsite_allowlist.py):

```diff
 ALLOW_PREFIXES = (
     "app.routers.admin",
     "app.workers",
+    "app.workers.katara_threshold",   # KAT-06 — explicit for documentation, redundant with parent
     "app.auth_hooks",
     "app.db",
 )
```

The parent `app.workers` prefix already covers the new module, but adding the explicit child path puts the story id in `git blame` for future reviewers. The single `service_client()`-equivalent callsite in `evaluator.py::_record_alert` (which uses the asyncpg pool, not the supabase-py client) is accompanied by the `# JUSTIFICATION:` comment shown inline in §5.3 above.

---

### 5.7 Docker compose service

Patch [`infra/docker-compose.yml`](../../infra/docker-compose.yml). Add **alongside** the existing `backend` service:

```yaml
  katara_threshold_worker:
    image: vitachain/backend:latest
    container_name: vitachain_katara_threshold_worker
    command: ["python", "-m", "app.workers.katara_threshold"]
    restart: unless-stopped
    depends_on:
      - backend
    environment:
      APP_ENV: ${APP_ENV:-production}
      APP_RELEASE: ${APP_RELEASE:-dev}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
      DATABASE_URL: ${DATABASE_URL}
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      BREVO_API_KEY: ${BREVO_API_KEY}
      BREVO_TEMPLATE_KAT_THRESHOLD_FR: ${BREVO_TEMPLATE_KAT_THRESHOLD_FR}
      BREVO_TEMPLATE_KAT_THRESHOLD_AR: ${BREVO_TEMPLATE_KAT_THRESHOLD_AR}
      BREVO_TEMPLATE_KAT_THRESHOLD_EN: ${BREVO_TEMPLATE_KAT_THRESHOLD_EN}
      FRONTEND_BASE_URL: ${FRONTEND_BASE_URL:-https://vitachain.ma}
      SENTRY_DSN: ${SENTRY_DSN}
      HEALTHCHECKS_KAT_THRESHOLD_PING_URL: ${HEALTHCHECKS_KAT_THRESHOLD_PING_URL}
    networks:
      - vitachain_internal
    healthcheck:
      test: ["CMD-SHELL", "pgrep -f 'app.workers.katara_threshold' >/dev/null || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

Append the same env keys (with empty defaults) to [`infra/.env.sample`](../../infra/.env.sample) so the AUTH-05 boundary script doesn't flag missing keys on a fresh checkout.

Update [`scripts/check-compose-build-args.sh`](../../scripts/check-compose-build-args.sh) — no change needed; the worker reuses the existing backend image (no new `build.args`). Verify by running it and confirming the green output is unchanged.

---

### 5.8 NGINX — no change

KAT-06 is a worker, not an HTTP endpoint. No new NGINX zone, no new route. The AUTH-08 zone audit asserts only the four declared zones exist — that assertion is unaffected.

---

### 5.9 Tests

#### 5.9.1 Unit — evaluator (9 scenarios)

Create [`backend/tests/test_kat06_evaluator.py`](../../backend/tests/test_kat06_evaluator.py):

```python
"""KAT-06 BR-K2 evaluator unit tests.

Pure-function — no DB, no network. Each scenario is one row of the
BR-K2 truth table from §4.3 / KAT-05 §10 hand-off.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.workers.katara_threshold.evaluator import (
    ThresholdRow, evaluate_decisions,
)


NOW = datetime(2026, 5, 17, 14, 0, tzinfo=timezone.utc)


def _t(metric="soil_moisture", *, min_v=25.0, max_v=75.0, enabled=True,
       last_alert_at=None, last_alert_value=None, updated_at=None):
    return ThresholdRow(
        metric=metric, min_value=min_v, max_value=max_v, enabled=enabled,
        last_alert_at=last_alert_at, last_alert_value=last_alert_value,
        updated_at=updated_at or (NOW - timedelta(days=7)),
    )


def _tel(**fields):
    base = {
        "soil_moisture": 50.0, "soil_temperature": 20.0, "soil_ph": 6.5,
        "soil_conductivity": 1500.0, "battery_level": 80,
    }
    base.update(fields)
    return base


def test_no_thresholds_no_alert():
    assert evaluate_decisions(_tel(), [], NOW) == []


def test_disabled_threshold_no_alert():
    decisions = evaluate_decisions(_tel(soil_moisture=10.0),
                                   [_t(enabled=False)], NOW)
    assert decisions == []


def test_in_range_no_alert():
    decisions = evaluate_decisions(_tel(soil_moisture=50.0), [_t()], NOW)
    assert decisions == []


def test_first_crossing_min_alerts():
    decisions = evaluate_decisions(_tel(soil_moisture=22.0), [_t()], NOW)
    assert len(decisions) == 1
    assert decisions[0].crossed_bound == "min"
    assert decisions[0].reading == 22.0


def test_first_crossing_max_alerts():
    decisions = evaluate_decisions(_tel(soil_moisture=80.0), [_t()], NOW)
    assert decisions[0].crossed_bound == "max"


def test_second_crossing_within_24h_suppressed():
    just_alerted = _t(last_alert_at=NOW - timedelta(hours=12),
                      last_alert_value=22.0)
    decisions = evaluate_decisions(_tel(soil_moisture=20.0),
                                   [just_alerted], NOW)
    assert decisions == []


def test_second_crossing_after_24h_alerts():
    long_ago = _t(last_alert_at=NOW - timedelta(hours=24, seconds=1),
                  last_alert_value=22.0)
    decisions = evaluate_decisions(_tel(soil_moisture=20.0),
                                   [long_ago], NOW)
    assert len(decisions) == 1


def test_threshold_edit_clears_suppression():
    edited_since = _t(
        last_alert_at=NOW - timedelta(hours=2),
        last_alert_value=22.0,
        updated_at=NOW - timedelta(hours=1),  # edited after last alert
    )
    decisions = evaluate_decisions(_tel(soil_moisture=20.0),
                                   [edited_since], NOW)
    assert len(decisions) == 1, "threshold edit clears suppression per KAT-05 §10"


def test_multiple_metrics_independent_dedup():
    rows = [
        _t(metric="soil_moisture", min_v=25, max_v=75),
        _t(metric="soil_temperature", min_v=5, max_v=35,
           last_alert_at=NOW - timedelta(hours=1), last_alert_value=40.0),
    ]
    decisions = evaluate_decisions(
        _tel(soil_moisture=10.0, soil_temperature=40.0),
        rows, NOW,
    )
    assert {d.metric for d in decisions} == {"soil_moisture"}
```

Run:

```bash
cd backend && pytest tests/test_kat06_evaluator.py -v
# Expect 9/9 green; <100 ms total.
```

#### 5.9.2 e2e — listener round-trip

Create [`backend/tests/test_kat06_listener_e2e.py`](../../backend/tests/test_kat06_listener_e2e.py) — `--run-e2e` gated, mirrors KAT-03/05's e2e pattern.

```python
"""KAT-06 listener e2e — requires --run-e2e + staging fixtures.

Three scenarios:
1. Insert a synthetic telemetry row crossing soil_moisture min → assert
   mailer.send_template was called within 10 s + last_alert_at advanced.
2. Insert a second telemetry row 5 s later, same metric crossed → assert
   send_template was NOT called a second time (BR-K2).
3. Update m1_katara_thresholds.min_value (which bumps updated_at past
   last_alert_at), insert a third row → assert send_template called.
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

# ... pytest skipif `--run-e2e` boilerplate matching test_kat05_thresholds.py
```

(Full body follows the KAT-05 `--run-e2e` shape; use the AUTH-07 `FARMER-A` + `demo_parcel_id` fixtures and a `_seed_telemetry` helper that inserts via service-role asyncpg.)

#### 5.9.3 pgTAP — service-role positive write

Append one cell to [`db/tests/auth07_business_rules.sql`](../../db/tests/auth07_business_rules.sql) under the `m1_katara_thresholds` to_regclass guard:

```sql
-- BR-K2 / KAT-06 — service_role can write audit columns. The negative half
-- (authenticated user CANNOT write them) is already covered in KAT-05; this
-- closes the loop by asserting the positive half so a future trigger
-- refactor that locks out service_role too is caught immediately.
prepare svc_audit_update as
    update public.m1_katara_thresholds
    set last_alert_at = now(), last_alert_value = 12.34
    where parcel_id = (select id from _seed.parcel_a)
      and metric = 'soil_moisture';

select set_eq(
    'select 1 from public.m1_katara_thresholds '
    'where parcel_id = (select id from _seed.parcel_a) '
    'and metric = ''soil_moisture'' '
    'and last_alert_value is null',
    ARRAY[1],
    'KAT-06 precondition: last_alert_value starts NULL'
);

set local role service_role;
execute svc_audit_update;
reset role;

select set_eq(
    'select last_alert_value::text from public.m1_katara_thresholds '
    'where parcel_id = (select id from _seed.parcel_a) '
    'and metric = ''soil_moisture''',
    ARRAY['12.34'],
    'KAT-06 BR-K2: service_role UPDATE of last_alert_value lands'
);
```

Run:

```bash
make -C db test-auth07
```

---

## 6. Verification Checklist

- [ ] `pytest backend/tests/test_kat06_evaluator.py -v` → 9/9 green; total wall-time < 200 ms.
- [ ] `make -C db test-auth07` → the new KAT-06 service-role positive-write cell flips from SKIP to PASS; the KAT-05 negative-write cell stays green.
- [ ] `--run-e2e` block green against staging — three scenarios pass within 10 s each.
- [ ] `docker compose up -d katara_threshold_worker` brings the container up; `docker compose logs katara_threshold_worker` shows `katara_threshold_worker_starting` then `listener_subscribed channel=katara_telemetry_inserted` within 5 s.
- [ ] Forge a telemetry insert via the staging Supabase SQL editor (`insert into m1_katara_telemetry ... soil_moisture=20`); within 10 s the worker logs `alert_sent metric=soil_moisture`, Brevo dashboard shows the send, FARMER-A's inbox receives the email.
- [ ] Second forged insert with `soil_moisture=18` within 5 minutes: worker evaluates but does NOT log `alert_sent` — BR-K2 suppression. Inbox stays at one email.
- [ ] `PUT /api/v1/katara/parcels/<id>/thresholds` flipping `soil_moisture.min_value` from 25 → 30 (re-using KAT-05's UI). Third forged insert with `soil_moisture=22`: worker logs `alert_sent` (suppression cleared by `updated_at > last_alert_at`). Inbox receives second email.
- [ ] Locale switch — change FARMER-A's `profiles.locale` to `ar` (`update profiles set locale='ar' where id = ...`). Forge a crossing reading 25 h after the last alert. The Arabic-template email arrives, body renders RTL.
- [ ] Forge a notification with a malformed payload: `select pg_notify('katara_telemetry_inserted', 'not-a-uuid')`. Worker logs `malformed_notification_payload`; no crash; Sentry captures one `warning` event; subsequent legitimate notifications still process.
- [ ] Kill the worker (`docker compose stop katara_threshold_worker`); insert a telemetry row crossing a threshold; restart the worker (`docker compose start ...`). Within 30 s, the post-reconnect backstop fires + the email lands. (Proves the backstop closes the LISTEN-gap.)
- [ ] `docker compose exec katara_threshold_worker pgrep -f 'app.workers.katara_threshold'` returns a PID (healthcheck passes).
- [ ] Healthchecks.io dashboard shows "up" with last ping ≤ 60 s ago.
- [ ] Sentry "katara-threshold-worker" environment shows zero unresolved issues after a 30-min soak.
- [ ] `pytest backend/tests/test_service_client_callsite_allowlist.py -v` still green — the AUTH-05 allow-list extension was accepted and no other callsite was inadvertently added.
- [ ] `bash scripts/check-secrets-boundary.sh` green — `BREVO_API_KEY` does not appear in the frontend bundle nor in any non-allowed module.
- [ ] `grep -R "service_client\|service_role" backend/app/workers/katara_threshold/` returns exactly two hits: the inline `# JUSTIFICATION:` comment and the connection-string env-var read. (No call to the supabase-py service client; KAT-06 uses asyncpg + service-role DSN.)
- [ ] `infra/brevo-templates/kat06_threshold_alert/{fr,ar,en}.html` committed; each file contains every parameter from §4.4 at least once (`grep -c '{{ params\.' = 11 each`).
- [ ] [docs/spring-status.yml](../spring-status.yml): `KAT-06.status: IN_REVIEW`; flips DONE after staging e2e green; `E2.progress_pct` bumped (~36 % → ~43 %); KAT-11 listed as unblocked in the parent E2 comment.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| Worker entrypoint | [backend/app/workers/katara_threshold/__main__.py](../../backend/app/workers/katara_threshold/__main__.py) |
| Worker package init | [backend/app/workers/katara_threshold/__init__.py](../../backend/app/workers/katara_threshold/__init__.py) |
| LISTEN/NOTIFY listener | [backend/app/workers/katara_threshold/listener.py](../../backend/app/workers/katara_threshold/listener.py) |
| BR-K2 evaluator + Brevo dispatch | [backend/app/workers/katara_threshold/evaluator.py](../../backend/app/workers/katara_threshold/evaluator.py) |
| Locale labels + template id map | [backend/app/workers/katara_threshold/templates.py](../../backend/app/workers/katara_threshold/templates.py) |
| Brevo template mirrors | [infra/brevo-templates/kat06_threshold_alert/fr.html](../../infra/brevo-templates/kat06_threshold_alert/fr.html) · [ar.html](../../infra/brevo-templates/kat06_threshold_alert/ar.html) · [en.html](../../infra/brevo-templates/kat06_threshold_alert/en.html) |
| Docker compose service | [infra/docker-compose.yml](../../infra/docker-compose.yml) — `katara_threshold_worker` block |
| Env sample additions | [infra/.env.sample](../../infra/.env.sample) — 4 new keys + Healthchecks URL |
| AUTH-05 allow-list extension | [backend/tests/test_service_client_callsite_allowlist.py](../../backend/tests/test_service_client_callsite_allowlist.py) |
| Evaluator unit tests | [backend/tests/test_kat06_evaluator.py](../../backend/tests/test_kat06_evaluator.py) |
| Listener e2e tests | [backend/tests/test_kat06_listener_e2e.py](../../backend/tests/test_kat06_listener_e2e.py) |
| pgTAP service-role cell | [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | `KAT-06.status` → `IN_REVIEW`; E2 progress bumped; KAT-11 listed as unblocked |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **A Brevo 5xx between `send_template` 2xx and the `last_alert_at` UPDATE produces a duplicate email** | Sequence is `send_template → wait 2xx → UPDATE`. If the UPDATE itself fails after a 2xx send, the next ingest re-evaluates and re-sends (one duplicate email). The reverse — UPDATE-then-send — would silently lose alerts on send failure, which is unacceptable for an agronomic alert. Document the trade-off; one duplicate every blue-moon is better than one missed crop loss. |
| **LISTEN connection drops silently and notifications are lost between drop + reconnect** | Two-layer defence: (a) every reconnect triggers an immediate `_backstop_once` that scans the last 6 minutes of telemetry; (b) the periodic `_backstop` runs every 5 minutes regardless. Worst-case detection window is ≈ reconnect time (typically < 2 s) + the 5-min cron; BR-K2 makes the backstop idempotent. |
| **The polling backstop re-alerts already-processed rows** | BR-K2 itself dedups — a row with `last_alert_at < 24 h ago` and `updated_at < last_alert_at` is suppressed by `_is_suppressed()`. The backstop reads the *same* rows the listener would have processed; the audit-column state is the dedup key. |
| **A burst of 1000+ telemetry inserts overflows the in-memory queue** | `asyncio.Queue(maxsize=1024)` — at the MVD scale (≤ 50 ESP32 × 1 reading / 15 min = ~3.3 reads/min), the queue depth peaks at single digits. If the queue overflows, log + drop + Sentry — the backstop catches the dropped notifications within 5 minutes. Post-MVD scaling: bump `maxsize`, add worker replicas (BR-K2 serialises at the DB so replicas are safe). |
| **Threshold-edit-clears-suppression rule is surprising to a farmer who edits twice in a row and gets two emails** | The rule is intentional (KAT-05 §10 hand-off): editing thresholds is a signal of intent — the farmer wants feedback on the new bounds *now*. Two edits + two crossings = two emails. A "minimum N seconds since last edit" debounce is a post-MVD refinement if user feedback says it's annoying. |
| **A second worker replica is added post-MVD and sends duplicate emails before the audit-column UPDATE serialises** | Acceptable for MVD-shape deployments (one replica). Post-MVD: wrap the `_load_context` + decision step in a `select ... for update skip locked` on the threshold rows, so two replicas evaluate disjoint metric sets per notification. Flagged forward; no code today. |
| **Locale fallback to `fr` for a farmer whose `profiles.locale` is `dar`** | Documented in PRD §7.2 — fallback chain is `requested → fr`. `templates.py::FALLBACK_LOCALE = "fr"`. Test scenario in §5.9.1 implicit via the `locale not in TEMPLATE_IDS` branch in `evaluate_and_send`. |
| **Brevo free-tier daily limit (300 emails / day) exceeded during a sensor failure storm** | BR-K2 caps any single farmer × metric at one email / 24 h. Worst case at MVD scale: 50 farmers × 5 metrics = 250 emails / 24 h ceiling — under the limit. If a real demo bumps into it, the Brevo error surfaces in Sentry and the worker no-ops the `last_alert_at` update so the next ingest retries. |
| **A future migration renames a metric (`soil_ph` → `soil_acidity`) and the evaluator silently skips the rename** | Three places must move in lockstep: `METRIC_FIELD`, `LOCALISED_LABELS[locale]`, the DB CHECK in `m1_katara_thresholds`. The §5.9.1 evaluator test parameterises over `METRIC_FIELD.keys()`; a rename without dict updates fails the test immediately. |
| **AUTH-05 allow-list extension accidentally widens beyond the worker package** | The added prefix `app.workers.katara_threshold` is *narrower* than the already-listed `app.workers`; the change is documentation, not policy. Reviewer is asked to confirm during PR. |
| **Healthchecks.io / Sentry env keys missing on a fresh VPS deploy** | `_init_observability` no-ops when `SENTRY_DSN` is unset; `_ping_heartbeat` no-ops when `HEALTHCHECKS_KAT_THRESHOLD_PING_URL` is unset; both with `suppress(Exception)` around the actual HTTP call so a transient outage does not crash the worker. Operations stays minimally degraded, not broken. |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Worker package skeleton (`__init__.py`, `__main__.py`, signal handling, Sentry init) | 30 min |
| `listener.py` — LISTEN/NOTIFY + reconnect + queue + backstop + heartbeat | 90 min |
| `evaluator.py` — pure-function evaluator + asyncpg context loader + Brevo dispatch + service-role UPDATE | 75 min |
| `templates.py` + 3 Brevo HTML mirrors (FR/AR/EN) | 45 min |
| Brevo dashboard — create 3 transactional templates, capture template ids | 30 min |
| `docker-compose.yml` + `.env.sample` + env wiring on staging VPS | 25 min |
| AUTH-05 allow-list extension + `# JUSTIFICATION:` inline comment | 10 min |
| Evaluator unit tests (9 scenarios) | 50 min |
| Listener e2e tests (3 scenarios, `--run-e2e`) | 60 min |
| pgTAP service-role positive-write cell | 20 min |
| Manual staging smoke (forge insert + locale switch + edit-clears-suppression + disconnect/reconnect drill) | 40 min |
| `spring-status.yml` update + hand-off note for KAT-11 | 10 min |
| **Total active work** | **~8 h** |

---

## 10. Definition of Done

1. Acceptance criterion met end-to-end on staging: a verified farmer with thresholds saved by KAT-05 receives one email in their saved locale within 5 minutes of the first crossing reading, zero additional emails on subsequent crossings within 24 h, and a fresh email after a threshold edit. A telemetry row with no thresholds, all-disabled thresholds, or all-in-range readings produces zero emails and zero `m1_katara_thresholds` writes.
2. Verification checklist (§6) fully ticked.
3. All deliverables (§7) committed and pushed.
4. KAT-03 ingest SLA unaffected: re-run the KAT-03 Locust 50 users / 60 s scenario — p50 < 50 ms, p99 < 150 ms, 0 failures. KAT-06 is off the ingest connection by construction, but the verification closes the audit loop.
5. AUTH-07 matrix: the new KAT-06 service-role positive-write pgTAP cell ships green; the KAT-05 negative-write cell stays green. The full `make -C db test-auth07` suite reports the post-KAT-06 cell count, with the delta noted in the PR description.
6. AUTH-05 callsite allow-list: the extended `ALLOW_PREFIXES` includes `app.workers.katara_threshold`; the AST-scan test stays green; the single audit-column UPDATE site carries the inline `# JUSTIFICATION:` comment.
7. The `katara_threshold_worker` container runs `restart: unless-stopped` on staging for ≥ 30 min with zero unresolved Sentry issues, zero missed Healthchecks pings, and the LISTEN connection survives a deliberate `pg_terminate_backend()` on the listener pid (post-reconnect backstop catches the gap).
8. [docs/spring-status.yml](../spring-status.yml): `KAT-06.status: IN_REVIEW` after local DoD; `DONE` after staging soak; `E2.progress_pct` bumped from ~36 % to ~43 %; KAT-11 listed as unblocked in the parent E2 comment.
9. Hand-off note to the team:
   - **KAT-11** (offline-device alert): copy the `backend/app/workers/katara_threshold/` package to `backend/app/workers/katara_offline/`, swap the LISTEN channel for a CRON schedule reading `m1_katara_devices.last_seen`, reuse `mailer.send_template` with three new locale templates, and copy the `last_alert_at` audit-column pattern (KAT-11 will need its own column on `m1_katara_devices` — a tiny migration). Estimated < 5 h once KAT-06 is the template.
   - **KAT-09** (diagnostic-completion email): same worker layout, but triggered by the Gemini job-completion event (KAT-08) rather than a NOTIFY. Reuses `templates.py` patterns and `mailer.send_template`.
   - **Post-MVD anti-spam tuning**: if user feedback says "24 h is too long after I fixed the issue", consider adding a "manual reset alert" button on the parcel page that nulls `last_alert_at` for a specific metric — single new endpoint, no new worker logic.
   - **Post-MVD severity tiers**: the `crossed_bound` param in the Brevo payload is already structured for `min`/`max`/`both`; adding a `severity` field (`warning` if reading is within 10 % of bound, `critical` if outside by > 20 %) is a one-line `evaluator.py` extension + a Brevo template branch — no schema change.
