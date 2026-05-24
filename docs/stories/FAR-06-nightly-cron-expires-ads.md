# FAR-06 — Nightly CRON expires ads older than 7 days

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** System (CRON worker)
> **Depends on:** [FAR-01](./FAR-01-farmer-creates-ad.md) (`m2_farmarket_ads` table + `expires_at` column + `m2_farmarket_ads_expiry_idx` index), [INF-07](./INF-07-nightly-db-backup.md) (nightly backup — confirmed before deploying any worker that writes irrecoverable state)
> **Unblocks:** [FAR-08](./FAR-08-admin-views-ads-leads.md) (admin view must see `EXPIRED` ads with the correct timestamp), [AUTH-07](./AUTH-07-rls-audit.md) (BR-F3 pgTAP row is currently `SKIP` — unblocks when FAR-06 migrates or the table is seeded with rows whose `expires_at` is in the past)
> **Acceptance:** BR-F3 — every `ACTIVE` ad whose `expires_at < now()` is set to `EXPIRED` by the worker; a Healthchecks.io heartbeat ping is sent after each successful sweep; the sweep runs at worker boot and then every 24 hours.

---

## 1. Purpose

FAR-01 stamps every new ad with `expires_at = now() + 7 days`. Without a worker to act on that column, ads stay `ACTIVE` forever — the 7-day window is just a value in the DB.

FAR-06 closes the loop: a long-lived asyncio process wakes once per day (and once at boot), issues a single atomic `UPDATE … WHERE status='ACTIVE' AND expires_at < now()`, and pings Healthchecks.io to confirm liveness. No email is sent to the farmer; the catalog's RLS policy `farmarket_ads_select_active` (`status = 'ACTIVE'`) then automatically hides expired ads from restaurateurs browsing FAR-02.

**Design decisions:**

- **Single atomic UPDATE** — no row-by-row loop. The query returns the count of affected rows in one round-trip. Concurrent worker restarts are safe: a row already `EXPIRED` is not matched by the `WHERE status='ACTIVE'` clause.
- **No Brevo email** — the PRD and business rules (BR-F3) require only a status flip. No notification to the farmer is specified for expiry. Farmers see their expired ads in the "Mes annonces" view (FAR-05), so they are not left wondering where their ad went.
- **Service-role connection** — the RLS comment in migration 0032 explicitly notes: *"The service-role CRON worker (FAR-06) bypasses RLS to flip status to EXPIRED."* The worker connects via the direct asyncpg `DATABASE_URL` (not the PostgREST pooler), which uses the Supabase postgres service-role credentials. No user JWT is involved.
- **No new migration** — `expires_at` (`timestamptz NOT NULL DEFAULT now() + interval '7 days'`), the `m2_farmarket_ads_expiry_idx` partial index (`ON m2_farmarket_ads (expires_at) WHERE status = 'ACTIVE'`), and the `EXPIRED` enum value are all already shipped in migration `0032_far01_farmarket_ads.sql`.
- **Configurable scan period** — `EXPIRY_SCAN_PERIOD_S` env var defaults to `86400` (24 h). Setting it to a smaller value (e.g. `300`) during local development allows fast iteration without waiting 24 h.

This story delivers:

- `backend/app/workers/farmarket_expiry/__init__.py` — empty package marker.
- `backend/app/workers/farmarket_expiry/sweeper.py` — sweep logic + heartbeat.
- `backend/app/workers/farmarket_expiry/__main__.py` — entry point (SIGINT/SIGTERM, Sentry, logging).
- `infra/docker-compose.yml` — new `farmarket_expiry_worker` service.
- `infra/.env.example` — two new keys (`HEALTHCHECKS_FAR_EXPIRY_PING_URL`, `EXPIRY_SCAN_PERIOD_S`).
- `backend/tests/test_far06_nightly_expiry.py` — unit tests for sweep logic and heartbeat.
- pgTAP cell `F-06a` appended to `db/tests/auth07_business_rules.sql`.
- `docs/spring-status.yml` update: `FAR-06.status → IN_REVIEW`.

---

## 2. Scope

### In scope

- Asyncio CRON worker with boot-time pass + 24 h periodic sweep.
- Atomic `UPDATE m2_farmarket_ads SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at < now()`.
- Healthchecks.io heartbeat ping after every successful sweep (including zero-row sweeps).
- Sentry error capture on sweep failure (worker continues the loop — it does not crash).
- Docker Compose service wired into `infra/docker-compose.yml`.
- pgTAP cell asserting `m2_farmarket_ads_expiry_idx` exists and the sweep SQL matches its predicate.
- Backend unit tests covering: zero-row sweep, multi-row sweep, Healthchecks ping suppressed when URL unset, sweep failure does not crash the loop.

### Out of scope

- Email notification to farmer on expiry → not in PRD / BR-F3.
- Re-activating an expired ad → FAR-05 explicitly marks this out-of-scope (post-MVD).
- Auto-deleting expired ads → ads are soft-deleted by the farmer (FAR-05) or by the admin (FAR-08); FAR-06 only flips to `EXPIRED`.
- Per-farmer configurable expiry window → all ads expire at 7 days for MVD.
- Backfill of ads that were `ACTIVE` before this worker was deployed → the `WHERE` clause handles them naturally on the first boot-time pass.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [FAR-01](./FAR-01-farmer-creates-ad.md) `DONE` | `public.m2_farmarket_ads` table, `expires_at` column, `m2_farmarket_ads_expiry_idx` partial index, and `EXPIRED` enum value must exist in the live DB. Verify: `\d public.m2_farmarket_ads` shows `expires_at` and `status` columns. |
| [INF-07](./INF-07-nightly-db-backup.md) `DONE` | Required before any worker that writes irrecoverable state is deployed to VPS. |
| `SUPABASE_DB_URL` available in VPS `.env` | Direct Postgres DSN on port `:5432` (not the pooler `:6543`). Already added by INF-07. |
| Migration `0032` applied | `select count(*) from information_schema.columns where table_name='m2_farmarket_ads' and column_name='expires_at'` returns `1`. |

---

## 4. Architecture Overview

```
farmarket_expiry_worker  (Docker container — vitachain/backend:latest)
        │
        ├── boot-time pass — immediate sweep on container start
        │     └── UPDATE m2_farmarket_ads SET status='EXPIRED'
        │           WHERE status='ACTIVE' AND expires_at < now()
        │           RETURNING id                     ← count rows
        │
        ├── heartbeat ping → HEALTHCHECKS_FAR_EXPIRY_PING_URL
        │
        └── sleep EXPIRY_SCAN_PERIOD_S (default 86400 s)
              └── repeat sweep + heartbeat
```

**Why bypass RLS?** The worker has no user context — it acts on behalf of the platform, not a specific farmer. The asyncpg connection uses the Supabase service-role DSN (`SUPABASE_DB_URL`), which connects as the `postgres` superuser and therefore bypasses all RLS policies. The `farmarket_ads_update_own` policy (which requires `auth.uid() = farmer_id`) would reject this sweep even if the worker held a fake JWT. Using the direct DSN is the correct and documented approach for system-level maintenance operations in this codebase (same pattern as `katara_offline_worker`).

**AUTH-05 compliance:** The `SUPABASE_DB_URL` is a Postgres DSN (not the Supabase PostgREST service role key). It does not appear in any frontend bundle and is routed exclusively through the backend container environment. The existing `scripts/check-secrets-boundary.sh` does not scan for `SUPABASE_DB_URL` by name (it targets `SUPABASE_SERVICE_ROLE_KEY`), so no new boundary-script entry is needed — but the `# JUSTIFICATION:` comment convention must be followed in `sweeper.py` (see §6.1).

---

## 5. Data Model Changes

No new migration is required. Everything was shipped in migration `0032_far01_farmarket_ads.sql`:

```sql
-- Already in 0032 — do NOT re-create.

-- expires_at column (FAR-06 CRON reads this):
expires_at  timestamptz  NOT NULL  DEFAULT (now() + interval '7 days')

-- Partial index (FAR-06 CRON: "ACTIVE ads past expiry". Partial — skips already-expired rows):
CREATE INDEX IF NOT EXISTS m2_farmarket_ads_expiry_idx
    ON public.m2_farmarket_ads (expires_at)
    WHERE status = 'ACTIVE';

-- EXPIRED enum value (already in public.m2_farmarket_ad_status):
-- 'ACTIVE' | 'EXPIRED' | 'DELETED'
```

**Index usage:** The `WHERE status = 'ACTIVE'` predicate in the sweep SQL exactly matches the partial index predicate. PostgreSQL uses `m2_farmarket_ads_expiry_idx` to cheaply locate qualifying rows — no full-table scan even with millions of rows.

---

## 6. Step-by-Step Implementation

### 6.1 `sweeper.py` — core sweep logic

Create [backend/app/workers/farmarket_expiry/sweeper.py](../../backend/app/workers/farmarket_expiry/sweeper.py):

```python
"""FAR-06 — nightly sweep that flips ACTIVE ads past their expiry to EXPIRED.

Design notes:
- One atomic UPDATE per pass; the WHERE clause is the entire business rule.
- Uses asyncpg direct connection (SUPABASE_DB_URL) to bypass RLS.
  # JUSTIFICATION: FAR-06 is a platform-level maintenance sweep with no user
  # context. The farmarket_ads_update_own RLS policy (auth.uid() = farmer_id)
  # correctly blocks this operation when called with a user JWT. The asyncpg
  # DSN (direct :5432, postgres superuser) is the documented pattern for
  # system workers in this codebase (see katara_offline, katara_diagnostic).
- Heartbeat ping to Healthchecks.io is sent ONLY after a successful sweep
  (even a zero-row sweep counts as successful). A failed sweep does NOT ping
  so Healthchecks detects the silence and alerts.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress
from datetime import datetime, timezone

import httpx
import sentry_sdk

log = logging.getLogger("farmarket_expiry.sweeper")

EXPIRY_SWEEP_SQL = """
    update public.m2_farmarket_ads
       set status    = 'EXPIRED',
           updated_at = now()
     where status    = 'ACTIVE'
       and expires_at < now()
    returning id
"""


async def _ping_heartbeat(client: httpx.AsyncClient) -> None:
    url = os.getenv("HEALTHCHECKS_FAR_EXPIRY_PING_URL")
    if not url:
        return
    with suppress(Exception):
        await client.get(url, timeout=5.0)
        log.debug("farmarket_expiry_heartbeat_pinged")


async def sweep_once(pool: "asyncpg.Pool") -> int:  # noqa: F821
    """One sweep pass. Returns the number of ads expired. Raises on DB error."""
    rows = await pool.fetch(EXPIRY_SWEEP_SQL)
    expired_count = len(rows)
    log.info("farmarket_expiry_sweep_done expired=%d", expired_count)
    return expired_count


async def run_sweeper(stop_event: asyncio.Event) -> None:
    """Main loop — owns the asyncpg pool, sweep tick, and heartbeat."""
    import asyncpg  # runtime import — keeps package import-safe in unit tests

    scan_period: float = float(os.getenv("EXPIRY_SCAN_PERIOD_S", "86400"))
    dsn = os.environ["DATABASE_URL"]

    pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=2,        # single-pass worker; 2 connections are more than enough
        command_timeout=15.0,
    )

    async with httpx.AsyncClient() as http_client:
        try:
            # Boot-time pass — expire any backlog immediately on (re)start.
            try:
                await sweep_once(pool)
                await _ping_heartbeat(http_client)
            except Exception:
                log.exception("farmarket_expiry_boot_pass_failed")
                with suppress(Exception):
                    sentry_sdk.capture_exception()

            while not stop_event.is_set():
                # Sleep up to scan_period; wake early if stop_event fires.
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=scan_period)
                    return  # stop was requested
                except asyncio.TimeoutError:
                    pass  # normal wakeup — time for the next sweep

                try:
                    await sweep_once(pool)
                    await _ping_heartbeat(http_client)
                except Exception:
                    log.exception("farmarket_expiry_sweep_pass_failed")
                    with suppress(Exception):
                        sentry_sdk.capture_exception()
                    # Do NOT ping heartbeat on failure — Healthchecks silence = alert.
                    # Continue the loop; next wakeup retries.
        finally:
            with suppress(Exception):
                await pool.close()
```

---

### 6.2 `__main__.py` — worker entry point

Create [backend/app/workers/farmarket_expiry/__main__.py](../../backend/app/workers/farmarket_expiry/__main__.py):

```python
"""FAR-06 — farmarket ad expiry worker entry point.

Run with:
    python -m app.workers.farmarket_expiry

In Docker, this command is wired into ``infra/docker-compose.yml`` under the
``farmarket_expiry_worker`` service.

Required env vars:
    DATABASE_URL                        — asyncpg DSN, direct :5432 (NOT pooler :6543)

Optional env vars:
    EXPIRY_SCAN_PERIOD_S                — sweep interval in seconds (default 86400 = 24 h)
    HEALTHCHECKS_FAR_EXPIRY_PING_URL    — Healthchecks.io ping URL (omit to disable)
    SENTRY_DSN                          — Sentry ingest DSN (INF-08)
    SENTRY_ENVIRONMENT                  — Sentry environment tag (default "prod")
    LOG_LEVEL                           — Python logging level (default "INFO")
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

import sentry_sdk
from dotenv import load_dotenv

from app.workers.farmarket_expiry.sweeper import run_sweeper

load_dotenv()

log = logging.getLogger("farmarket_expiry")


def _init_observability() -> None:
    dsn = os.getenv("SENTRY_DSN")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0")),
            environment=os.getenv("SENTRY_ENVIRONMENT", "prod"),
            release=os.getenv("GIT_SHA", "unknown"),
            server_name="farmarket-expiry-worker",
            send_default_pii=False,
        )

    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format=(
            '{"ts":"%(asctime)s","lvl":"%(levelname)s",'
            '"logger":"%(name)s","msg":"%(message)s"}'
        ),
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
        except (NotImplementedError, RuntimeError):
            signal.signal(sig, _on_signal)

    log.info("farmarket_expiry_worker_starting")
    try:
        await run_sweeper(stop_event=stop)
    finally:
        log.info("farmarket_expiry_worker_stopped")


if __name__ == "__main__":
    asyncio.run(_main())
```

---

### 6.3 `__init__.py` — package marker

Create [backend/app/workers/farmarket_expiry/__init__.py](../../backend/app/workers/farmarket_expiry/__init__.py):

```python
```

(Empty file — required for `python -m app.workers.farmarket_expiry` to resolve the package.)

---

### 6.4 Docker Compose service

In [infra/docker-compose.yml](../../infra/docker-compose.yml), add the `farmarket_expiry_worker` service after the `farmarket_lead_email_worker` block:

```yaml
  # ---------------------------------------------------------------------------
  # FAR-06 — FarMarket ad expiry worker.
  # CRON-style asyncio loop: runs at boot then every EXPIRY_SCAN_PERIOD_S
  # seconds (default 86400 = 24 h). Issues one atomic UPDATE per pass that
  # flips m2_farmarket_ads rows from ACTIVE → EXPIRED where expires_at < now().
  # Uses the direct DATABASE_URL (service-role postgres DSN) to bypass RLS —
  # documented pattern; see sweeper.py # JUSTIFICATION comment.
  # Single replica is safe: the WHERE clause is idempotent — already-EXPIRED
  # rows are never matched.
  # ---------------------------------------------------------------------------
  farmarket_expiry_worker:
    image: vitachain/backend:latest
    container_name: vita_farmarket_expiry_worker
    command: ["python", "-m", "app.workers.farmarket_expiry"]
    restart: unless-stopped
    depends_on:
      - backend
    environment:
      ENVIRONMENT: ${ENVIRONMENT:-prod}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
      GIT_SHA: ${GIT_SHA:-unknown}
      # FAR-06 connects via asyncpg direct :5432 DSN — service-role level,
      # bypasses RLS (see sweeper.py JUSTIFICATION). Never use the pooler
      # :6543 here — asyncpg needs a persistent session connection.
      DATABASE_URL: ${SUPABASE_DB_URL}
      EXPIRY_SCAN_PERIOD_S: ${EXPIRY_SCAN_PERIOD_S:-86400}
      HEALTHCHECKS_FAR_EXPIRY_PING_URL: ${HEALTHCHECKS_FAR_EXPIRY_PING_URL:-}
      SENTRY_DSN: ${SENTRY_DSN_BACKEND:-}
      SENTRY_ENVIRONMENT: ${SENTRY_ENVIRONMENT:-prod}
      SENTRY_TRACES_SAMPLE_RATE: ${SENTRY_TRACES_SAMPLE_RATE:-0.0}
    networks:
      - vita_net
    healthcheck:
      test: ["CMD-SHELL", "pgrep -f 'app.workers.farmarket_expiry' >/dev/null || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

---

### 6.5 `.env.example` additions

In [infra/.env.example](../../infra/.env.example), add after the `HEALTHCHECKS_FAR_LEAD_EMAIL_PING_URL` line:

```dotenv
# FAR-06 — nightly ad expiry worker
# Healthchecks.io ping URL — create a new check named "farmarket_expiry" with
# schedule "0 3 * * *" and a 26h grace period (covers a full 24h cycle + 2h slack).
# Leave blank to disable the ping (worker still runs; silence detection disabled).
HEALTHCHECKS_FAR_EXPIRY_PING_URL=
# Override scan period for local dev/testing. Default 86400 (24 h).
# Set to 300 (5 min) to see expiry fire quickly in dev.
EXPIRY_SCAN_PERIOD_S=86400
```

---

### 6.6 pgTAP cell — AUTH-07 assertion

Append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

```sql
-- ── FAR-06 cells ─────────────────────────────────────────────────────────────
-- Prerequisites: m2_farmarket_ads table must exist (FAR-01 must be merged).

do $guard_f06$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP FAR-06 cells — m2_farmarket_ads not yet created';
    return;
  end if;
end $guard_f06$;

-- F-06a: m2_farmarket_ads_expiry_idx partial index exists with the correct predicate.
-- This index is what makes the nightly CRON sweep efficient even at scale.
select is(
  (
    select count(*)::int
      from pg_indexes
     where schemaname = 'public'
       and tablename  = 'm2_farmarket_ads'
       and indexname  = 'm2_farmarket_ads_expiry_idx'
       and indexdef   ilike '%where%status%ACTIVE%'
  ),
  1,
  'F-06a: m2_farmarket_ads_expiry_idx partial index (WHERE status=ACTIVE) exists'
);

-- F-06b: FAR-06 sweep SQL correctly transitions ACTIVE → EXPIRED for past-expiry rows.
-- Seeds one ACTIVE ad with expires_at in the past, runs the sweep, asserts the flip.
do $seed_f06b$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP F-06b — m2_farmarket_ads not yet created';
    return;
  end if;

  insert into public.m2_farmarket_ads
      (id, farmer_id, title, description, product_type,
       price_mad, quantity_kg, region, status, expires_at)
  values
      ('f06ad000-0000-0000-0000-000000000001',
       '<FARMER_A_UUID>',
       'Tomates FAR-06 expiry test',
       'Description de test pour FAR-06 suffisamment longue.',
       'Tomates',
       2.50, 100.00,
       'Souss-Massa',
       'ACTIVE',
       now() - interval '1 day')   -- already past expiry
  on conflict (id) do nothing;
end $seed_f06b$;

-- Run the exact sweep SQL the worker issues (service-role context, no JWT needed).
update public.m2_farmarket_ads
   set status     = 'EXPIRED',
       updated_at  = now()
 where status     = 'ACTIVE'
   and expires_at < now();

select is(
  (
    select status::text
      from public.m2_farmarket_ads
     where id = 'f06ad000-0000-0000-0000-000000000001'
  ),
  'EXPIRED',
  'F-06b: sweep SQL transitions ACTIVE → EXPIRED for ads past expires_at'
);

-- F-06c: A not-yet-expired ACTIVE ad is NOT touched by the sweep.
do $seed_f06c$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP F-06c — m2_farmarket_ads not yet created';
    return;
  end if;

  insert into public.m2_farmarket_ads
      (id, farmer_id, title, description, product_type,
       price_mad, quantity_kg, region, status, expires_at)
  values
      ('f06ad000-0000-0000-0000-000000000002',
       '<FARMER_A_UUID>',
       'Courgettes FAR-06 future expiry',
       'Description de test pour FAR-06 futur suffisamment longue.',
       'Courgettes',
       3.00, 50.00,
       'Souss-Massa',
       'ACTIVE',
       now() + interval '3 days')   -- still valid
  on conflict (id) do nothing;
end $seed_f06c$;

select is(
  (
    select status::text
      from public.m2_farmarket_ads
     where id = 'f06ad000-0000-0000-0000-000000000002'
  ),
  'ACTIVE',
  'F-06c: ACTIVE ads not yet past expires_at are untouched by the sweep'
);
```

> Replace `<FARMER_A_UUID>` with the FARMER-A UUID from `db/tests/_auth07_seed.psql`. The cells run in the same `BEGIN…ROLLBACK` block as the rest of the file — no persistent data is written.

---

### 6.7 Backend unit tests

Create [backend/tests/test_far06_nightly_expiry.py](../../backend/tests/test_far06_nightly_expiry.py):

```python
"""FAR-06 — nightly ad expiry worker: unit tests for sweep logic and heartbeat."""
from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from unittest import mock

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakePool:
    """Minimal asyncpg pool stub."""

    def __init__(self, *, rows_returned: int) -> None:
        self._rows = [{"id": f"fake-id-{i}"} for i in range(rows_returned)]
        self.fetch_calls: list[str] = []
        self.closed = False

    async def fetch(self, sql: str) -> list[dict]:
        self.fetch_calls.append(sql)
        return self._rows

    async def close(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# sweep_once
# ---------------------------------------------------------------------------

class TestSweepOnce:
    @pytest.mark.asyncio
    async def test_zero_rows_returns_zero(self) -> None:
        from app.workers.farmarket_expiry.sweeper import sweep_once

        pool = _FakePool(rows_returned=0)
        count = await sweep_once(pool)  # type: ignore[arg-type]
        assert count == 0
        assert len(pool.fetch_calls) == 1

    @pytest.mark.asyncio
    async def test_five_rows_returns_five(self) -> None:
        from app.workers.farmarket_expiry.sweeper import sweep_once

        pool = _FakePool(rows_returned=5)
        count = await sweep_once(pool)  # type: ignore[arg-type]
        assert count == 5

    @pytest.mark.asyncio
    async def test_sql_contains_expiry_predicate(self) -> None:
        """The sweep SQL must target ACTIVE rows past expires_at — pins the WHERE clause."""
        from app.workers.farmarket_expiry.sweeper import EXPIRY_SWEEP_SQL

        sql = EXPIRY_SWEEP_SQL.lower()
        assert "status" in sql and "active" in sql
        assert "expires_at < now()" in sql
        assert "expired" in sql

    @pytest.mark.asyncio
    async def test_db_error_propagates(self) -> None:
        from app.workers.farmarket_expiry.sweeper import sweep_once

        class _BrokenPool:
            async def fetch(self, sql: str) -> list:
                raise RuntimeError("connection refused")

        with pytest.raises(RuntimeError, match="connection refused"):
            await sweep_once(_BrokenPool())  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# _ping_heartbeat
# ---------------------------------------------------------------------------

class TestPingHeartbeat:
    @pytest.mark.asyncio
    async def test_no_ping_when_url_unset(self) -> None:
        from app.workers.farmarket_expiry.sweeper import _ping_heartbeat

        mock_client = mock.AsyncMock()
        os.environ.pop("HEALTHCHECKS_FAR_EXPIRY_PING_URL", None)
        await _ping_heartbeat(mock_client)
        mock_client.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_ping_sent_when_url_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.workers.farmarket_expiry.sweeper import _ping_heartbeat

        monkeypatch.setenv("HEALTHCHECKS_FAR_EXPIRY_PING_URL", "https://hc.example.com/ping/abc")
        mock_client = mock.AsyncMock()
        await _ping_heartbeat(mock_client)
        mock_client.get.assert_called_once_with(
            "https://hc.example.com/ping/abc", timeout=5.0
        )

    @pytest.mark.asyncio
    async def test_ping_exception_is_suppressed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.workers.farmarket_expiry.sweeper import _ping_heartbeat

        monkeypatch.setenv("HEALTHCHECKS_FAR_EXPIRY_PING_URL", "https://hc.example.com/ping/abc")
        mock_client = mock.AsyncMock()
        mock_client.get.side_effect = Exception("network timeout")
        # Must not raise.
        await _ping_heartbeat(mock_client)


# ---------------------------------------------------------------------------
# run_sweeper — stop signal handling
# ---------------------------------------------------------------------------

class TestRunSweeperStops:
    @pytest.mark.asyncio
    async def test_stop_event_terminates_loop(self) -> None:
        """Setting stop_event causes run_sweeper to exit cleanly without a second sweep."""
        import asyncpg  # noqa: F401 — only imported to check monkeypatch path

        stop = asyncio.Event()
        sweep_count = 0

        async def _fake_sweep(pool):  # noqa: ANN001
            nonlocal sweep_count
            sweep_count += 1
            return 0

        async def _fake_create_pool(**kwargs):  # noqa: ANN001
            return _FakePool(rows_returned=0)

        with (
            mock.patch("asyncpg.create_pool", side_effect=_fake_create_pool),
            mock.patch(
                "app.workers.farmarket_expiry.sweeper.sweep_once",
                side_effect=_fake_sweep,
            ),
            mock.patch("app.workers.farmarket_expiry.sweeper._ping_heartbeat"),
        ):
            from app.workers.farmarket_expiry.sweeper import run_sweeper

            # Set stop immediately — the loop should run the boot pass then stop.
            stop.set()
            await run_sweeper(stop)

        # Boot-time pass fires once; the while loop exits immediately because
        # stop is already set.
        assert sweep_count == 1
```

---

## 7. Verification Checklist

- [ ] `backend/app/workers/farmarket_expiry/` package exists with `__init__.py`, `sweeper.py`, `__main__.py`.
- [ ] `python -m app.workers.farmarket_expiry --help` exits 0 (importable without `asyncpg` installed, because the import is deferred).
- [ ] `make -C backend test` green — all FAR-06 assertions in `test_far06_nightly_expiry.py`.
- [ ] `make -C db test-auth07` — F-06a, F-06b, F-06c all `ok` (not `SKIP`).
- [ ] `farmarket_expiry_worker` service appears in `docker compose config` output.
- [ ] **Local smoke (dev box)**:
  - [ ] Set `EXPIRY_SCAN_PERIOD_S=5` in `.env`.
  - [ ] Insert an ad row directly via psql with `expires_at = now() - interval '1 day'`.
  - [ ] Start worker: `docker compose up farmarket_expiry_worker`.
  - [ ] Within 5 seconds, confirm `status = 'EXPIRED'` in the DB.
  - [ ] The expired ad no longer appears in `GET /farmarket/catalog` (FAR-02 RLS).
- [ ] **Healthchecks.io (staging)**:
  - [ ] Create a Healthchecks.io check named `farmarket_expiry`, schedule `0 3 * * *`, grace period `26h`.
  - [ ] Set `HEALTHCHECKS_FAR_EXPIRY_PING_URL` to the check's ping URL in the staging `.env`.
  - [ ] Confirm a ping appears in Healthchecks.io within 60 seconds of worker start.
- [ ] **Catalog isolation**: Run `GET /farmarket/catalog` as a RESTAURANT user — expired ads do not appear (pre-existing `farmarket_ads_select_active` RLS policy handles this without any code change).
- [ ] **Idempotency**: Trigger a second sweep manually — already-`EXPIRED` rows are not re-processed (zero rows returned).
- [ ] `bash scripts/check-secrets-boundary.sh` exits 0 — no new `SUPABASE_SERVICE_ROLE_KEY` reference in frontend (this worker uses `DATABASE_URL` / `SUPABASE_DB_URL`, not the PostgREST service role key).

---

## 8. Deliverables

| Artifact | Location |
|---|---|
| Package marker | New file [backend/app/workers/farmarket_expiry/__init__.py](../../backend/app/workers/farmarket_expiry/__init__.py) |
| Sweep logic | New file [backend/app/workers/farmarket_expiry/sweeper.py](../../backend/app/workers/farmarket_expiry/sweeper.py) |
| Worker entry point | New file [backend/app/workers/farmarket_expiry/__main__.py](../../backend/app/workers/farmarket_expiry/__main__.py) |
| Docker Compose service | Added to [infra/docker-compose.yml](../../infra/docker-compose.yml) |
| `.env.example` additions | Updated [infra/.env.example](../../infra/.env.example) |
| Backend unit tests | New file [backend/tests/test_far06_nightly_expiry.py](../../backend/tests/test_far06_nightly_expiry.py) |
| AUTH-07 pgTAP cells | Appended to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | Flip `FAR-06.status → IN_REVIEW`, bump `summary.in_review` |

---

## 9. Business Rules Enforced

| Rule | Where enforced |
|---|---|
| **BR-F3**: Ads older than 7 days set to `EXPIRED` by nightly CRON | `EXPIRY_SWEEP_SQL` in `sweeper.py` — `WHERE status='ACTIVE' AND expires_at < now()` |
| **BR-F3**: Status flip is automatic (no farmer action required) | Worker runs on a timer — no HTTP trigger, no user interaction |
| **BR-F1 implicit**: Only `FARMER` role can create ads that become subject to expiry | Enforced by FAR-01 / RLS `farmarket_ads_insert_verified_farmer`; FAR-06 just acts on the downstream state |
| **Catalog freshness**: Expired ads not visible in FAR-02 browse | Pre-existing RLS `farmarket_ads_select_active` (`WHERE status='ACTIVE'`) — no new code |
| **AUTH-05**: Service-role DB credentials never exposed in frontend | Worker runs as a backend container only; `SUPABASE_DB_URL` is not a `NEXT_PUBLIC_` var and is excluded from the bundle scan |
| **Healthchecks heartbeat**: Silent failure detected | Ping sent ONLY on success; Healthchecks grace-period alert fires if worker crashes or freezes |

---

## 10. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| Worker crashes silently and ads never expire | Healthchecks.io alerts on missed ping (grace = 26 h). Sentry captures the exception. `restart: unless-stopped` in Docker Compose recovers from process crashes. | PRD §8.2 |
| `DATABASE_URL` pooler `:6543` used by mistake | Env var comment in `docker-compose.yml` explicitly warns against the pooler. The direct DSN is already in `.env` as `SUPABASE_DB_URL` (added by INF-07). | PRD §11 |
| Sweep races with FAR-05 farmer delete (same row) | Both operations touch `status`; the `updated_at` trigger fires in both cases. No conflict: the sweep only updates `ACTIVE` rows — a concurrent `DELETED` flip wins, the sweep just gets zero rows for that ad. No lost update. | PRD §13 R2 |
| Clock skew between VPS and Supabase Postgres | `expires_at < now()` uses DB-server time (`now()` in the UPDATE SQL), not the Python worker's wall clock. No skew possible — the comparison is entirely server-side. | — |
| Ads already expired before worker is deployed (backlog) | Boot-time pass runs immediately on container start — all stale `ACTIVE` rows are swept within seconds of the first deploy. | PRD §12 |

---

## 11. Time Estimate

| Sub-task | Estimate |
|---|---|
| `sweeper.py` — sweep logic + heartbeat | 30 min |
| `__main__.py` — entry point + observability | 20 min |
| `__init__.py` — package marker | 2 min |
| `docker-compose.yml` service block | 15 min |
| `.env.example` additions | 5 min |
| Backend unit tests (7 assertions) | 1 h |
| pgTAP cells F-06a/b/c | 30 min |
| Local smoke test (dev box) | 20 min |
| Staging Healthchecks.io verification | 20 min |
| **Total active work** | **~3.5 h** |

---

## 12. Definition of Done

1. Acceptance criterion met: every `ACTIVE` ad with `expires_at < now()` is set to `EXPIRED` by the worker within 24 hours (boot-time pass catches any immediate backlog).
2. `make -C backend test` green — all FAR-06 unit test assertions pass, no regressions in FAR-01/02/03/04/05 tests.
3. `make -C db test-auth07` — F-06a, F-06b, F-06c all `ok` (not `SKIP`).
4. `bash scripts/check-secrets-boundary.sh` exits 0 — no new service-role boundary violation.
5. `docker compose config` includes `farmarket_expiry_worker` service with `restart: unless-stopped`.
6. At least one successful sweep confirmed in staging logs and a corresponding Healthchecks.io ping recorded.
7. Expired ads no longer returned by `GET /farmarket/catalog` (catalog isolation verified against staging).
8. Verification checklist (§7) fully ticked.
9. Deliverables (§8) committed.
10. `docs/spring-status.yml` updated: `FAR-06.status → IN_REVIEW`, `summary.in_review` incremented.
11. Hand-off note posted — **FAR-08** (admin view must filter/display `EXPIRED` ads correctly) is unblocked; **AUTH-07** BR-F3 pgTAP row can now activate (remove `SKIP` guard once F-06b is green).
