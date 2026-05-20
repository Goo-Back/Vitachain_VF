# KAT-07 — Farmer requests AI agronomic diagnostic

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** FARMER (authenticated + VERIFIED)
> **Depends on:** [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) (telemetry history exists — the 7-day aggregate KAT-08 will feed to Gemini; KAT-07 opens the table and the endpoint KAT-08 reads row IDs from) · [AUTH-06](./AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) (`verification_status = VERIFIED` gate — same pattern as parcel creation; a PENDING farmer sees the button but it is disabled)
> **Unblocks:** [KAT-08](../spring-status.yml) (reads `m1_katara_diagnostics` for PENDING rows and the parcel's sensor 7d average; KAT-08 adds no schema — it only updates status + result columns that KAT-07 defines) · [KAT-09](../spring-status.yml) (Brevo email on COMPLETED — the `farmer_id` + `parcel_id` + `result_text` columns KAT-09 reads are all in KAT-07's table) · [KAT-10](../spring-status.yml) (status polling UI — `GET /diagnostics/latest` defined here is the endpoint KAT-10's `useInterval` hook polls) · the AUTH-07 matrix's `m1_katara_diagnostics` SELECT/INSERT cells (owner-read + verified-insert RLS; service-role UPDATE cell gated on KAT-08 merge)
> **Acceptance:** A verified farmer opens `/dashboard/farmer/parcels/[id]`, scrolls to the **Diagnostic IA** section, clicks **Demander un diagnostic**, and within 2 s sees the button switch to a *PENDING* status chip. A second click within the same pending/processing window returns a `409 Conflict` with detail `diagnostic_already_in_progress` — the button is disabled so the second click is impossible in the normal UI, but the backend enforces it independently. A fourth request within 24 hours returns `429 Too Many Requests` (BR-K6). An unverified farmer sees the button disabled with a tooltip; the `POST` endpoint returns `403 verification_required` if bypassed via API. The `GET /diagnostics/latest` endpoint returns the row created by the `POST` — status `PENDING`, `result_text null`. No Gemini call, no email, no polling loop are part of this story.

---

## 1. Purpose

KAT-04 shipped the historical telemetry charts. KAT-07 opens the AI diagnostic pipeline: it persists the farmer's *intent* ("analyze my parcel") as a `PENDING` row and exposes the `GET /latest` endpoint that the rest of the pipeline reads from.

This story is deliberately scoped to **persistence + request surface only**. The reason for the split across KAT-07 → KAT-08 → KAT-09 → KAT-10 is the same logic that split KAT-05 (persist thresholds) from KAT-06 (evaluate + email): each downstream story needs a stable table contract and API contract to be designed against. Shipping KAT-07 first means KAT-08 can be reviewed without touching the schema, and KAT-10 can be reviewed without touching the worker.

Concretely KAT-07 delivers:

- **DB migration `0022_kat07_ai_diagnostics.sql`** — one table (`m1_katara_diagnostics`), two business-rule triggers (farmer_id auto-fill + audit-guard that locks status/result columns to service_role writes), four RLS policies (owner SELECT, admin SELECT, verified-owner INSERT, no authenticated UPDATE — transitions belong to the KAT-08/09 worker via service_role).
- **FastAPI router `backend/app/modules/katara/diagnostics.py`** mounted at `/api/v1/katara/parcels/{parcel_id}/diagnostics`, with two endpoints:
  - `POST /` — verifies the farmer, enforces BR-K5 (no in-flight diagnostic) and BR-K6 (max 3/parcel/24 h), inserts a PENDING row, returns `DiagnosticOut`.
  - `GET /latest` — returns the single most-recent diagnostic row for the parcel (any status), or `404` if none exists. This is the contract KAT-10 polls.
- **Pydantic schemas** `DiagnosticOut` and `DiagnosticStatus` appended to `backend/app/modules/katara/schemas.py`.
- **Frontend `DiagnosticSection.tsx`** — a static client component that renders the **Demander un diagnostic IA** button (disabled when: not verified, latest status is PENDING or PROCESSING, or no telemetry exists yet). Displays the last diagnostic's status as a colour-coded chip and, when COMPLETED, renders `result_text` in an expandable card. No polling interval yet — the initial status is server-fetched by the page; KAT-10 wires up the live polling loop.
- **Server action `diagnostic-actions.ts`** — `requestDiagnostic(parcelId)` (calls `POST /`) and `fetchLatestDiagnostic(parcelId)` (calls `GET /latest`).
- **Page integration** — `page.tsx` fetches `fetchLatestDiagnostic(id)` alongside the existing telemetry/thresholds fetches and passes it as `initialDiagnostic` to `DiagnosticSection`.
- **Backend tests** `backend/tests/test_kat07_diagnostics.py` — happy path POST returns 201 + PENDING row; BR-K5 second POST returns 409; BR-K6 fourth POST within 24 h returns 429; unverified POST returns 403; GET /latest 404 on empty; GET /latest 200 after POST; a FARMER-B GET returns 404 (RLS isolation).
- **pgTAP cells** appended to `db/tests/auth07_business_rules.sql` — four SELECT cells (owner reads own, FARMER-B blocked, RESTAURANT blocked, CITIZEN blocked) and one INSERT cell (verified FARMER inserts own → PENDING; service_role UPDATE of status → succeeds; authenticated UPDATE of status → silently no-ops via trigger).
- **`spring-status.yml` flip** — KAT-07 status from `TODO` to `IN_REVIEW` + a §10 hand-off note for KAT-08 (table contract + endpoint contract it depends on).

Once `DONE`, KAT-08 has a stable `PENDING` row to pick up, KAT-10 has a stable polling endpoint, and the parcel detail page has a visible entry point for the AI diagnostic flow — even before the AI itself is wired.

---

## 2. Scope

### In scope

- DB migration `0022_kat07_ai_diagnostics.sql` — table, triggers, RLS, index on `(parcel_id, requested_at DESC)` for the `GET /latest` indexed lookup, CHECK constraint on status enum.
- FastAPI router `backend/app/modules/katara/diagnostics.py` — two endpoints (`POST /`, `GET /latest`), mounted via the katara include chain in `backend/app/main.py`.
- Pydantic schemas `DiagnosticStatus` (Literal enum) and `DiagnosticOut` appended to `backend/app/modules/katara/schemas.py`.
- BR-K5 enforcement (409 if latest row is PENDING or PROCESSING) and BR-K6 enforcement (429 if ≥ 3 PENDING+PROCESSING+COMPLETED rows within 24 h for the parcel) — both checked server-side on `POST`.
- Frontend: `frontend/src/app/dashboard/farmer/parcels/[id]/DiagnosticSection.tsx` — button + status chip + COMPLETED result card. Disabled states for unverified farmer and in-flight diagnostic.
- Frontend: `frontend/src/app/dashboard/farmer/parcels/[id]/diagnostic-actions.ts` — `requestDiagnostic` + `fetchLatestDiagnostic`.
- Page integration: `page.tsx` calls `fetchLatestDiagnostic(id)` server-side; passes `initialDiagnostic` prop to `DiagnosticSection`.
- Backend unit + e2e tests; pgTAP BR cells.
- `spring-status.yml` flip.

### Out of scope

- **Gemini API call + OWM + Sentinel data assembly** → [KAT-08](../spring-status.yml). KAT-07 only inserts a `PENDING` row; it never calls any external API.
- **Status update to PROCESSING/COMPLETED/FAILED** — those transitions belong to the KAT-08/09 worker via service_role. The audit-guard trigger in this migration blocks `authenticated` from writing `status`, `result_text`, `error_detail`, `started_at`, `completed_at`.
- **Brevo email on COMPLETED** → [KAT-09](../spring-status.yml). The `result_text` column KAT-09 reads is defined here, but KAT-07 never touches it.
- **Live polling (useInterval / WebSocket)** → [KAT-10](../spring-status.yml). `DiagnosticSection` renders the initial status from the server prop; it does not start a polling loop.
- **Diagnostic history list** (all previous diagnostics per parcel) — `GET /latest` is sufficient for MVD; a full history endpoint is post-MVD.
- **Admin diagnostic view** — admin can read via RLS; an admin dashboard page is out for MVD.
- **Per-metric diagnostic (only soil moisture, or only pH)** — the diagnostic is parcel-wide. Metric-scoped diagnostics are a post-MVD agronomic refinement.
- **Retry / requeue UI** — a FAILED diagnostic is informational. The farmer can request a new one (subject to BR-K5/K6). There is no "retry" button; the button is re-enabled when `status = FAILED`.
- **Result display beyond plain text** — the COMPLETED result card renders `result_text` as pre-formatted prose (Gemini returns Markdown; the card uses a lightweight MD renderer or `<pre>`). Rich visualisations (charts keyed to the diagnostic text) are post-MVD.
- **Idempotency-Key header** — the `POST` is idempotent at the BR-K5 layer (duplicate in-flight → 409); a client-side idempotency header is post-MVD (PRD §6.4.3 architectural note is for payment endpoints, not diagnostic requests).

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-04](./KAT-04-dashboard-realtime-historical-charts.md) `IN_REVIEW` or `DONE` | `m1_katara_telemetry` exists and has data. Migration 0022 references `m1_katara_parcels.id` (from migration 0016); it does not FK into `m1_katara_telemetry` but KAT-08 will need the 7d aggregate view that KAT-04 created. Apply order: 0016 → 0022 (parcels before diagnostics). |
| [AUTH-06](./AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) `IN_REVIEW` or `DONE` | `require_verified("FARMER")` from `app.core.security` is the write gate on `POST /diagnostics`. Without AUTH-06, the dependency is not in `ALLOW_PREFIXES` and tests will fail. |
| [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) `DONE` | `trg_enforce_rls_on_public_tables` event trigger. Migration 0022 follows the same disable-create-enable pattern as 0016/0021. |
| [INF-04](./INF-04-fastapi-backend-scaffold-healthcheck.md) `DONE` | `app.core.security` (`get_current_user`, `get_db_for_user`, `get_service_client`, `require_verified`) and `app.db` (`service_client()`) already exist. |
| AUTH-07 matrix `IN_REVIEW` | The four `m1_katara_diagnostics` SELECT cells + INSERT cell are currently absent; KAT-07's pgTAP additions introduce them. The service-role UPDATE cell is added by KAT-08. |
| Parcel with at least one telemetry reading | The `POST` does **not** gate on telemetry existence (KAT-08 will handle the empty-history edge case gracefully). The prerequisite is only for a realistic test fixture — a PENDING row on a parcel with no data is valid, KAT-08 will include `no_telemetry_data` context in the Gemini prompt. |

---

## 4. Data Contract

### 4.1 Table shape — `public.m1_katara_diagnostics`

```sql
create table public.m1_katara_diagnostics (
    id              uuid        primary key default gen_random_uuid(),
    parcel_id       uuid        not null references public.m1_katara_parcels(id) on delete cascade,
    farmer_id       uuid        not null references public.profiles(id) on delete cascade,
    status          text        not null default 'PENDING',
    result_text     text,                  -- filled by KAT-09 worker (service_role)
    error_detail    text,                  -- filled on FAILED (service_role)
    requested_at    timestamptz not null default now(),
    started_at      timestamptz,           -- set by KAT-08 worker on pickup
    completed_at    timestamptz,           -- set by KAT-09 worker on completion/failure

    constraint kat_diagnostic_status_known check (
        status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
    )
);
```

**No `created_at` / `updated_at`** — `requested_at` / `started_at` / `completed_at` are the semantic timestamps for this table. Adding generic `created_at` on top would be redundant and would require the audit-guard trigger to preserve it.

**`farmer_id`** — auto-filled by the `m1_katara_diagnostics_fill_farmer_id` BEFORE INSERT trigger (mirrors the KAT-05 pattern). The `POST` endpoint never sends `farmer_id` in the INSERT payload; it is resolved from the parcel row.

**`result_text`** — `text` (nullable); filled by KAT-09 after Gemini returns. The column is intentionally unstructured (Gemini returns Markdown prose). Post-MVD a `result_json jsonb` column can be added alongside it for machine-readable advice without breaking the existing text path.

**`error_detail`** — brief engineer-facing message for FAILED rows. Not shown to the farmer in the UI (they see "Le diagnostic a échoué — veuillez réessayer."); used by Sentry and admin review.

### 4.2 Indexes

```sql
-- GET /latest — one indexed DESC scan, LIMIT 1. Covered by both parcel_id and requested_at.
create index kat_diagnostics_parcel_latest_idx
    on public.m1_katara_diagnostics (parcel_id, requested_at desc);

-- BR-K6 count — count rows within 24h for a given parcel.
-- The parcel_latest_idx above also satisfies this (same leading column); no extra index needed.
```

### 4.3 Status state machine

```
  [POST by farmer]
        │
        ▼
    PENDING  ──(KAT-08 picks up)──►  PROCESSING
                                          │
                                ┌─────────┴─────────┐
                    (Gemini OK) │                   │ (any failure)
                                ▼                   ▼
                           COMPLETED             FAILED
```

Only the KAT-08/09 worker (service_role) transitions out of PENDING. The audit-guard trigger silently no-ops any `authenticated` UPDATE to `status` — the test in §7 verifies the positive (service_role writes) and the negative (authenticated does not).

### 4.4 RLS summary

| Operation | Who | Condition |
|---|---|---|
| SELECT | `authenticated` | `farmer_id = auth.uid()` OR `public.is_admin()` |
| INSERT | `authenticated` | `farmer_id = auth.uid()` AND `has_role('FARMER')` AND `verification_status = 'VERIFIED'` |
| UPDATE | `service_role` only | Audit-guard trigger blocks `authenticated` writes to status/result columns |
| DELETE | nobody (by design) | Diagnostic history is immutable; a FAILED row stays for audit trail |

### 4.5 BR-K5 and BR-K6 enforcement — server-side only

Neither rule is enforced at the DB layer (no trigger, no constraint). Both are checked in the `POST /diagnostics` handler before the INSERT:

```python
# BR-K5 — no in-flight diagnostic
latest = _fetch_latest(db, parcel_id)
if latest and latest["status"] in ("PENDING", "PROCESSING"):
    raise HTTPException(409, "diagnostic_already_in_progress")

# BR-K6 — max 3 diagnostics per parcel per 24h
count_24h = _count_recent(db, parcel_id, hours=24)
if count_24h >= 3:
    raise HTTPException(429, "diagnostic_rate_limit_exceeded")
```

Why server-side and not a DB constraint? BR-K5 is a state-machine guard (depends on the current status value, not a structural invariant), and BR-K6 is a time-window aggregate that no single-row CHECK can express. A `UNIQUE(parcel_id)` partial index on `status IN ('PENDING', 'PROCESSING')` would enforce BR-K5 at the DB layer but would require a deferred constraint and a trigger to unset it on transition — more moving parts than the handler check for a rule the worker already owns (the worker is the only entity that changes status). The handler check is fast (two indexed reads) and the endpoint is human-initiated (not high-frequency IoT), so the slight race window is acceptable for MVD.

---

## 5. Step-by-Step Implementation

### 5.1 DB migration `0022_kat07_ai_diagnostics.sql`

Create `db/migrations/0022_kat07_ai_diagnostics.sql`:

```sql
-- =============================================================================
-- 0022 — M1 Katara: AI diagnostic request table (KAT-07).
-- Story: KAT-07 (docs/stories/KAT-07-ai-diagnostic-request.md)
--
-- One table (m1_katara_diagnostics), farmer_id auto-fill trigger, audit-guard
-- trigger that locks status/result/error/timestamps to service_role, and four
-- RLS policies. No schema is added by KAT-08/09 — those stories only update
-- rows via service_role.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

create table if not exists public.m1_katara_diagnostics (
    id              uuid        primary key default gen_random_uuid(),
    parcel_id       uuid        not null
        references public.m1_katara_parcels(id) on delete cascade,
    farmer_id       uuid        not null
        references public.profiles(id) on delete cascade,
    status          text        not null default 'PENDING',
    result_text     text,
    error_detail    text,
    requested_at    timestamptz not null default now(),
    started_at      timestamptz,
    completed_at    timestamptz,

    constraint kat_diagnostic_status_known check (
        status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
    )
);

alter table public.m1_katara_diagnostics enable row level security;
alter table public.m1_katara_diagnostics force row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

create index if not exists kat_diagnostics_parcel_latest_idx
    on public.m1_katara_diagnostics (parcel_id, requested_at desc);

comment on table public.m1_katara_diagnostics is
    'KAT-07 — one row per AI diagnostic request. '
    'status/result_text/error_detail/started_at/completed_at are '
    'service-role-only via trigger clamp — KAT-08/09 worker is the sole '
    'legitimate writer of those columns.';

-- ─── Triggers ────────────────────────────────────────────────────────────────

create or replace function public.m1_katara_diagnostics_fill_farmer_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.farmer_id is null then
        select farmer_id into new.farmer_id
          from public.m1_katara_parcels
         where id = new.parcel_id;
    end if;
    return new;
end;
$$;

drop trigger if exists m1_katara_diagnostics_fill_farmer_id
    on public.m1_katara_diagnostics;
create trigger m1_katara_diagnostics_fill_farmer_id
    before insert on public.m1_katara_diagnostics
    for each row execute function public.m1_katara_diagnostics_fill_farmer_id();

-- Audit-guard: only service_role may write status/result columns.
-- authenticated writers (a buggy frontend, a confused test) are silently
-- clamped back to the INSERT-time values rather than raising, so a partial
-- save of unrelated fields (not possible with current schema but future-proof)
-- never fails because the status column was in the payload.
create or replace function public.m1_katara_diagnostics_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_role text;
begin
    v_role := coalesce(
        current_setting('request.jwt.claim.role', true),
        current_setting('role', true)
    );

    if v_role = 'service_role' or current_user = 'service_role' then
        return new;
    end if;

    -- Non-service writers: clamp all audit columns back to their old values.
    if tg_op = 'UPDATE' then
        new.status        := old.status;
        new.result_text   := old.result_text;
        new.error_detail  := old.error_detail;
        new.started_at    := old.started_at;
        new.completed_at  := old.completed_at;
        new.parcel_id     := old.parcel_id;
        new.farmer_id     := old.farmer_id;
        new.requested_at  := old.requested_at;
    elsif tg_op = 'INSERT' then
        -- Force status to PENDING regardless of what the payload said.
        new.status        := 'PENDING';
        new.result_text   := null;
        new.error_detail  := null;
        new.started_at    := null;
        new.completed_at  := null;
    end if;
    return new;
end;
$$;

drop trigger if exists m1_katara_diagnostics_audit_guard
    on public.m1_katara_diagnostics;
create trigger m1_katara_diagnostics_audit_guard
    before insert or update on public.m1_katara_diagnostics
    for each row execute function public.m1_katara_diagnostics_audit_guard();

-- ─── RLS policies ────────────────────────────────────────────────────────────

drop policy if exists "kat_diagnostics_select_own" on public.m1_katara_diagnostics;
create policy "kat_diagnostics_select_own"
    on public.m1_katara_diagnostics for select to authenticated
    using (auth.uid() = farmer_id);

drop policy if exists "kat_diagnostics_select_admin" on public.m1_katara_diagnostics;
create policy "kat_diagnostics_select_admin"
    on public.m1_katara_diagnostics for select to authenticated
    using (public.is_admin());

drop policy if exists "kat_diagnostics_insert_verified_own"
    on public.m1_katara_diagnostics;
create policy "kat_diagnostics_insert_verified_own"
    on public.m1_katara_diagnostics for insert to authenticated
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
    );

-- No UPDATE policy for authenticated — all status transitions go through
-- service_role (KAT-08/09 worker). The audit-guard trigger would clamp an
-- authenticated UPDATE anyway, but having no UPDATE policy means the RLS
-- engine rejects the attempt before the trigger even fires.
-- No DELETE policy — diagnostic history is immutable.
```

---

### 5.2 Pydantic schemas (append to `schemas.py`)

Append to [`backend/app/modules/katara/schemas.py`](../../backend/app/modules/katara/schemas.py):

```python
# ── KAT-07 — AI diagnostic request models ─────────────────────────────────────
from typing import Literal  # already imported above; shown here for locality

DiagnosticStatus = Literal["PENDING", "PROCESSING", "COMPLETED", "FAILED"]


class DiagnosticOut(BaseModel):
    id: UUID
    parcel_id: UUID
    farmer_id: UUID
    status: DiagnosticStatus
    result_text: str | None = None
    error_detail: str | None = None
    requested_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
```

`error_detail` is included in the response model because the `GET /latest` endpoint is also used by admin; the frontend hides it from farmers (rendering a generic "failed" message instead).

---

### 5.3 FastAPI router `backend/app/modules/katara/diagnostics.py`

Create [`backend/app/modules/katara/diagnostics.py`](../../backend/app/modules/katara/diagnostics.py):

```python
"""KAT-07 — AI diagnostic request endpoints.

POST /api/v1/katara/parcels/{parcel_id}/diagnostics
    Create a PENDING diagnostic row. Enforces:
      BR-K5 — 409 if the latest row is PENDING or PROCESSING.
      BR-K6 — 429 if ≥ 3 diagnostics exist for this parcel in the past 24h.
    Requires verification_status = VERIFIED (AUTH-06 gate).

GET /api/v1/katara/parcels/{parcel_id}/diagnostics/latest
    Return the most-recent diagnostic row, or 404 if none.
    Used by KAT-10 polling and by the initial server-side fetch in page.tsx.
    Requires authenticated FARMER (owner) — RLS scopes the result.

No service-role on either path. RLS is the security boundary; the
verification gate on POST is a UX nicety (clear 403 instead of opaque RLS-empty).
The KAT-08/09 worker transitions status via service_role only.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.core.security import (
    AuthUser,
    get_current_user,
    get_db_for_user,
    require_verified,
)
from app.modules.katara.schemas import DiagnosticOut

router = APIRouter(
    prefix="/katara/parcels/{parcel_id}/diagnostics",
    tags=["katara"],
)

_DIAGNOSTICS_TABLE = "m1_katara_diagnostics"
_PARCELS_TABLE     = "m1_katara_parcels"

_IN_FLIGHT_STATUSES = ("PENDING", "PROCESSING")
_RATE_LIMIT_MAX     = 3      # BR-K6: max diagnostics per parcel per window
_RATE_LIMIT_HOURS   = 24


def _verify_parcel_owner(db: Client, parcel_id: UUID) -> None:
    res = (
        db.table(_PARCELS_TABLE)
        .select("id")
        .eq("id", str(parcel_id))
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "parcel_not_found")


def _fetch_latest_row(db: Client, parcel_id: UUID) -> dict | None:
    res = (
        db.table(_DIAGNOSTICS_TABLE)
        .select("*")
        .eq("parcel_id", str(parcel_id))
        .order("requested_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _count_recent(db: Client, parcel_id: UUID, hours: int) -> int:
    since = (
        datetime.now(timezone.utc) - timedelta(hours=hours)
    ).isoformat()
    res = (
        db.table(_DIAGNOSTICS_TABLE)
        .select("id", count="exact")
        .eq("parcel_id", str(parcel_id))
        .gte("requested_at", since)
        .execute()
    )
    return res.count or 0


@router.post(
    "",
    response_model=DiagnosticOut,
    status_code=status.HTTP_201_CREATED,
)
async def request_diagnostic(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> DiagnosticOut:
    _verify_parcel_owner(db, parcel_id)

    # BR-K5 — block if a diagnostic is already in flight for this parcel.
    latest = _fetch_latest_row(db, parcel_id)
    if latest and latest["status"] in _IN_FLIGHT_STATUSES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "diagnostic_already_in_progress",
        )

    # BR-K6 — rate-limit: max 3 requests per parcel per 24h.
    if _count_recent(db, parcel_id, hours=_RATE_LIMIT_HOURS) >= _RATE_LIMIT_MAX:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "diagnostic_rate_limit_exceeded",
        )

    inserted = (
        db.table(_DIAGNOSTICS_TABLE)
        .insert({"parcel_id": str(parcel_id)})
        .execute()
    )
    if not inserted.data:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "diagnostic_create_failed",
        )
    return DiagnosticOut(**inserted.data[0])


@router.get("/latest", response_model=DiagnosticOut)
async def get_latest_diagnostic(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> DiagnosticOut:
    """Return the most recent diagnostic row, or 404 if none exists.

    RLS scopes the result to the parcel owner and admins — no explicit
    farmer_id filter needed, but the parcel existence check fires first
    so the error is always 404 (not an empty payload) for mismatched parcels.
    """
    _verify_parcel_owner(db, parcel_id)
    row = _fetch_latest_row(db, parcel_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no_diagnostic_found")
    return DiagnosticOut(**row)
```

---

### 5.4 Mount the router

In [`backend/app/main.py`](../../backend/app/main.py), add the diagnostics router alongside the existing katara sub-routers:

```python
from app.modules.katara.diagnostics import router as katara_diagnostics_router
# ...
app.include_router(katara_diagnostics_router, prefix="/api/v1")
```

The include pattern mirrors how `katara_thresholds_router` was added for KAT-05.

---

### 5.5 Frontend — `diagnostic-actions.ts`

Create [`frontend/src/app/dashboard/farmer/parcels/[id]/diagnostic-actions.ts`](../../frontend/src/app/dashboard/farmer/parcels/[id]/diagnostic-actions.ts):

```typescript
"use server";

import { cookies } from "next/headers";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export interface DiagnosticOut {
  id: string;
  parcel_id: string;
  farmer_id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  result_text: string | null;
  error_detail: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
}

async function _getAccessToken(): Promise<string | null> {
  const jar = await cookies();
  // Next.js + Supabase SSR cookie pattern — same as telemetry-actions.ts
  const raw = jar.get("sb-access-token")?.value ?? null;
  return raw;
}

export async function fetchLatestDiagnostic(
  parcelId: string
): Promise<DiagnosticOut | null> {
  const token = await _getAccessToken();
  if (!token) return null;

  const res = await fetch(
    `${BACKEND}/api/v1/katara/parcels/${parcelId}/diagnostics/latest`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json() as Promise<DiagnosticOut>;
}

export async function requestDiagnostic(
  parcelId: string,
  accessToken: string
): Promise<{ ok: true; data: DiagnosticOut } | { ok: false; error: string }> {
  const res = await fetch(
    `${BACKEND}/api/v1/katara/parcels/${parcelId}/diagnostics`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (res.ok) {
    return { ok: true, data: (await res.json()) as DiagnosticOut };
  }
  let error = "diagnostic_request_failed";
  try {
    const body = (await res.json()) as { detail?: string };
    error = body.detail ?? error;
  } catch {
    // ignore parse failure
  }
  return { ok: false, error };
}
```

`requestDiagnostic` accepts `accessToken` as a parameter (instead of reading from cookies) because the button click happens client-side — the page already passes `session.access_token` down to other client components (see `ParcelTelemetryAndThresholds` and `ThresholdsSection`); this component follows the same pattern.

---

### 5.6 Frontend — `DiagnosticSection.tsx`

Create [`frontend/src/app/dashboard/farmer/parcels/[id]/DiagnosticSection.tsx`](../../frontend/src/app/dashboard/farmer/parcels/[id]/DiagnosticSection.tsx):

```typescript
"use client";

import { useState, useTransition } from "react";

import type { DiagnosticOut } from "./diagnostic-actions";
import { requestDiagnostic } from "./diagnostic-actions";

interface Props {
  parcelId: string;
  accessToken: string;
  isVerified: boolean;
  initialDiagnostic: DiagnosticOut | null;
  hasTelemetry: boolean;
}

const STATUS_CHIP: Record<
  DiagnosticOut["status"],
  { label: string; className: string }
> = {
  PENDING:    { label: "En attente",   className: "bg-yellow-100 text-yellow-800" },
  PROCESSING: { label: "En cours…",    className: "bg-blue-100 text-blue-800" },
  COMPLETED:  { label: "Complété",     className: "bg-emerald-100 text-emerald-800" },
  FAILED:     { label: "Échec",        className: "bg-red-100 text-red-800" },
};

export function DiagnosticSection({
  parcelId,
  accessToken,
  isVerified,
  initialDiagnostic,
  hasTelemetry,
}: Props) {
  // KAT-10 will replace this static prop with a live-polled value.
  const [diagnostic, setDiagnostic] = useState<DiagnosticOut | null>(
    initialDiagnostic
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inFlight =
    diagnostic?.status === "PENDING" || diagnostic?.status === "PROCESSING";

  const canRequest =
    isVerified && hasTelemetry && !inFlight && !isPending;

  function handleRequest() {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await requestDiagnostic(parcelId, accessToken);
      if (result.ok) {
        setDiagnostic(result.data);
      } else {
        setErrorMsg(result.error);
      }
    });
  }

  const chip = diagnostic ? STATUS_CHIP[diagnostic.status] : null;

  return (
    <section className="mt-8 rounded-xl border border-neutral-200 p-6">
      <h2 className="text-lg font-semibold">Diagnostic IA</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Analyse de vos données capteurs, météo et satellite par l&apos;IA agronomique.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={handleRequest}
          disabled={!canRequest}
          title={
            !isVerified
              ? "Compte non vérifié"
              : !hasTelemetry
              ? "Aucune donnée capteur disponible"
              : inFlight
              ? "Un diagnostic est déjà en cours"
              : undefined
          }
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium
                     text-white transition hover:bg-emerald-700
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Envoi…" : "Demander un diagnostic IA"}
        </button>

        {chip && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5
                        text-xs font-medium ${chip.className}`}
          >
            {chip.label}
          </span>
        )}
      </div>

      {errorMsg && (
        <p className="mt-2 text-sm text-red-600">
          {errorMsg === "diagnostic_already_in_progress"
            ? "Un diagnostic est déjà en cours pour cette parcelle."
            : errorMsg === "diagnostic_rate_limit_exceeded"
            ? "Limite journalière atteinte (3 diagnostics / 24h)."
            : "Une erreur est survenue. Veuillez réessayer."}
        </p>
      )}

      {diagnostic?.status === "COMPLETED" && diagnostic.result_text && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-emerald-700">
            Voir le résultat
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-50
                          p-4 text-sm text-neutral-800">
            {diagnostic.result_text}
          </pre>
        </details>
      )}

      {diagnostic?.status === "FAILED" && (
        <p className="mt-3 text-sm text-red-600">
          Le diagnostic a échoué. Vous pouvez en demander un nouveau.
        </p>
      )}
    </section>
  );
}
```

**Notes on the component design:**
- `useTransition` (not `useState` + manual loading flag) gives React 18 concurrent-safe pending state with zero boilerplate. The `isPending` flag drives the button text and disabling during the POST.
- The `diagnostic` state starts from `initialDiagnostic` (server-fetched). KAT-10 will wrap this component (or lift the state to `ParcelTelemetryAndThresholds`) and replace `diagnostic` with a polled value; the component's internal `setDiagnostic` is also used on POST success so the chip updates immediately without waiting for the first poll tick.
- `hasTelemetry` is derived server-side (`initialTelemetry !== null && initialTelemetry.latest !== null`) — if a parcel has no paired device the button is disabled with an explanatory tooltip, because a diagnostic with no sensor data would be low-quality.
- `error_detail` is never rendered to the farmer; only `errorMsg` (the `detail` string from the API) appears, and it is mapped to friendly French copy.

---

### 5.7 Page integration — `page.tsx`

Add to [`frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx`](../../frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx):

```typescript
// At the top, add the import:
import { DiagnosticSection } from "./DiagnosticSection";
import { fetchLatestDiagnostic } from "./diagnostic-actions";

// Inside the page component, after fetchThresholds:
const initialDiagnostic = await fetchLatestDiagnostic(id).catch(() => null);

// In the JSX, after <ParcelTelemetryAndThresholds .../>:
{session && (
  <DiagnosticSection
    parcelId={parcel.id}
    accessToken={session.access_token}
    isVerified={isVerified}
    initialDiagnostic={initialDiagnostic}
    hasTelemetry={initialTelemetry?.latest != null}
  />
)}
```

`fetchLatestDiagnostic` is wrapped in `.catch(() => null)` — same pattern as the `fetchInitialTelemetry` try/catch in the existing page; a transient backend error leaves the diagnostic section in its "no previous diagnostic" empty state rather than crashing the page render.

---

## 6. Design Decisions & Risks

### 6.1 Why no rate-limit at the DB layer?

BR-K6 (max 3/parcel/24h) is a COUNT over a time window — no single-row or row-pair DB constraint can express it. The alternatives are a trigger that runs the COUNT on every INSERT (works but serialises all diagnostic inserts across parcels on the row-lock) or an application-level check. Application-level wins: the `POST` endpoint is human-initiated (not IoT-frequency), so the race window (two concurrent POSTs from two browser tabs by the same farmer within milliseconds) is accepted for MVD. The 409/429 responses are idempotent from the user's perspective; the worst outcome is one extra PENDING row that KAT-08 will pick up anyway.

### 6.2 Why `requested_at` rather than `created_at`?

The standard `created_at` column on other tables serves as a DB-side audit timestamp. For diagnostics, the **semantic** timestamps (`requested_at`, `started_at`, `completed_at`) carry the agronomic meaning (e.g., "the 7d sensor average window ends at `requested_at`"). Adding a separate `created_at` would duplicate `requested_at` by definition. If an observer needs to know when the row was inserted, `requested_at` is the answer.

### 6.3 Why `GET /latest` and not `GET /{diagnostic_id}`?

KAT-10's polling loop needs "what is the current state of the most-recent diagnostic?" — not "what is the state of diagnostic UUID X?". If the farmer navigates away and comes back, the frontend does not track the UUID; it re-fetches `/latest`. A `/latest` endpoint also means the page.tsx server fetch is a single idiomatic call rather than a two-step "fetch list, pick first". A per-ID GET can be added post-MVD if admin needs to deep-link to a specific diagnostic.

### 6.4 FAILED row and the re-request flow

When a diagnostic fails (FAILED status), BR-K5 allows a new request (the in-flight check only gates on PENDING/PROCESSING). The `DiagnosticSection` button is re-enabled on FAILED, so the farmer can immediately retry. The FAILED row stays in the table (no DELETE); the next `GET /latest` will return the *new* PENDING row because the `ORDER BY requested_at DESC LIMIT 1` picks the freshest one.

### 6.5 `hasTelemetry` flag

Disabling the button when no telemetry exists is a UX gate, not a security gate. KAT-08 will handle the empty-history edge case in the Gemini prompt (including a `no_sensor_data_available` context clause). The disable is so a farmer with a brand-new parcel and no paired device doesn't see a button that would produce a low-confidence diagnostic. If the team decides to allow it, remove the `hasTelemetry` check from both the page and the component — the backend has no corresponding enforcement.

---

## 7. Tests

### 7.1 Backend unit tests — `backend/tests/test_kat07_diagnostics.py`

| # | Scenario | Expected |
|---|---|---|
| T1 | Verified FARMER POST to own parcel → | `201`, status=`PENDING`, `result_text=null` |
| T2 | Repeat POST while first is PENDING → | `409 diagnostic_already_in_progress` |
| T3 | POST while latest is PROCESSING → | `409 diagnostic_already_in_progress` |
| T4 | POST while latest is COMPLETED → | `201` (new PENDING row created) |
| T5 | POST while latest is FAILED → | `201` (re-request allowed) |
| T6 | 4th POST within 24h (3 already exist, any status) → | `429 diagnostic_rate_limit_exceeded` |
| T7 | Unverified FARMER POST → | `403 verification_required` |
| T8 | RESTAURANT POST → | `403 role_not_allowed` |
| T9 | POST to a parcel owned by another farmer → | `404 parcel_not_found` (RLS scopes the parcel check) |
| T10 | GET /latest when no diagnostics exist → | `404 no_diagnostic_found` |
| T11 | GET /latest after T1 POST → | `200`, same row id, status=`PENDING` |
| T12 | FARMER-B GET /latest on FARMER-A's parcel → | `404` (RLS blocks) |
| T13 | service_role UPDATE of status to COMPLETED → | UPDATE succeeds; GET /latest shows COMPLETED |
| T14 | authenticated PATCH of status → | status unchanged (audit-guard clamps silently) |

T13 and T14 cover the positive and negative halves of the audit-guard trigger — the same pattern KAT-06's pgTAP cells proved for `m1_katara_thresholds.last_alert_at`.

### 7.2 pgTAP cells — `db/tests/auth07_business_rules.sql`

Append a `KAT-07 — m1_katara_diagnostics` section with the standard AUTH-07 matrix cells:

| Cell | Role | Operation | Expected |
|---|---|---|---|
| D-1 | FARMER-A (owner) | SELECT own rows | Sees own rows |
| D-2 | FARMER-B | SELECT FARMER-A's rows | 0 rows (RLS blocks) |
| D-3 | RESTAURANT | SELECT | 0 rows |
| D-4 | CITIZEN | SELECT | 0 rows |
| D-5 | FARMER-A (VERIFIED) | INSERT (status omitted → PENDING) | Succeeds |
| D-6 | FARMER-A (VERIFIED) | INSERT with status='COMPLETED' | Inserts but audit-guard clamps to PENDING |
| D-7 | service_role | UPDATE status → PROCESSING | Succeeds |
| D-8 | FARMER-A (authenticated) | UPDATE status → COMPLETED | Row unchanged (audit-guard) |

---

## 8. Observability

This story adds no new Sentry traces or Healthchecks.io heartbeats — both are KAT-08/09 worker concerns. KAT-07 uses the standard FastAPI Sentry integration already wired by INF-08 (`sentry_sdk.init` in `app/main.py`): the `POST /diagnostics` and `GET /diagnostics/latest` routes are automatically traced by the Sentry FastAPI middleware; any 5xx from the `_count_recent` or `_fetch_latest_row` calls surfaces as a span on the existing Sentry project without additional code.

The only new env variable this story introduces is none — the Gemini key, OWM key, and Sentinel credentials are KAT-08 concerns.

---

## 9. Acceptance Verification Checklist

Run these manually on staging before flipping `spring-status.yml` to `IN_REVIEW`:

- [ ] `POST /api/v1/katara/parcels/{id}/diagnostics` as verified FARMER → `201`, body has `status: "PENDING"`, `result_text: null`
- [ ] Second immediate POST → `409 diagnostic_already_in_progress`
- [ ] `GET /api/v1/katara/parcels/{id}/diagnostics/latest` → same row, `status: "PENDING"`
- [ ] Unverified FARMER POST via `curl -H "Authorization: Bearer <token>"` → `403 verification_required`
- [ ] FARMER-B GET /latest on FARMER-A's parcel → `404`
- [ ] Service-role Supabase dashboard UPDATE of `status` to `COMPLETED` on the row → `GET /latest` returns `status: "COMPLETED"`
- [ ] `pytest backend/tests/test_kat07_diagnostics.py -v` — all 14 scenarios green
- [ ] `make -C db test-auth07` — D-1 through D-8 cells green
- [ ] Parcel detail page: **Diagnostic IA** section visible below ThresholdsSection
- [ ] Button disabled when `isVerified=false`; tooltip reads "Compte non vérifié"
- [ ] Button disabled when latest status is PENDING; chip shows "En attente" (yellow)
- [ ] Clicking button switches to "Envoi…" (useTransition pending), then chip appears

---

## 10. Hand-off Notes for KAT-08

KAT-08 (which assembles the Gemini payload from OWM + Sentinel + 7d sensor average) builds on the following contracts shipped here:

1. **Table contract**: `m1_katara_diagnostics` with columns `id`, `parcel_id`, `farmer_id`, `status`, `result_text`, `error_detail`, `started_at`, `completed_at`. The worker queries `WHERE status = 'PENDING' ORDER BY requested_at ASC LIMIT 1` to pick up the oldest pending job (FIFO).
2. **Status transitions**: The worker UPDATEs under service_role: `PENDING → PROCESSING` on pickup, `PROCESSING → COMPLETED` (+ `result_text`, `completed_at`) on success, `PROCESSING → FAILED` (+ `error_detail`, `completed_at`) on any exception.
3. **Rate-limit boundary**: KAT-07 enforces BR-K6 at request time. The worker does not re-check it; a PENDING row in the table is a valid work order.
4. **`GET /latest` endpoint**: KAT-10 polls this endpoint every N seconds to surface live status. KAT-08 needs no polling endpoint of its own; updating the DB row is sufficient — KAT-10 reads it.
5. **Sensor data join**: KAT-08 will query `m1_katara_telemetry` (the view introduced by KAT-04) for the 7-day average using `parcel_id` from the diagnostics row. If no telemetry rows exist, KAT-08 must include a `no_sensor_data` context note in the Gemini prompt rather than erroring; the `FAILED` path is for Gemini/OWM/Sentinel transport failures, not missing historical data.
6. **BR-K3 (OWM cache ≥ 3h)**: Defined as KAT-08's responsibility. KAT-07 has no caching layer.
