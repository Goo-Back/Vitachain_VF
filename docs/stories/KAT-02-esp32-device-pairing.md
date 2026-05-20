# KAT-02 — Farmer pairs an ESP32 to a parcel via device API key

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** FARMER (verified)
> **Depends on:** [KAT-01](./KAT-01-farmer-registers-parcel.md) (parcel must exist) · [AUTH-06](./AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) (verification gate) · [AUTH-04](./AUTH-04-enable-rls-on-rls-on-sensitive-tables.md) (RLS helpers)
> **Unblocks:** [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) (telemetry endpoint needs `api_key_hash` to validate against), [KAT-11](./KAT-11-offline-device-detection.md) (`last_seen` column), [KAT-12](./KAT-12-unlink-relink-device.md) (unlink/relink flow)
> **Acceptance:** Device linked; BR-K1 enforced (1 ESP32 ↔ 1 parcel at a time).

---

## 1. Purpose

A **device** is the physical bridge between a farmer's field and the VitaChain backend. KAT-01 created the parcel container; KAT-02 lets a verified farmer attach an ESP32 to that container and gives the device the credentials it needs to push telemetry in KAT-03.

This story delivers:

- The `public.m1_katara_devices` table with RLS, a `device_status` enum, and the `BR-K1` uniqueness constraint that forbids the same parcel from holding two active devices.
- A FastAPI pairing flow on `/api/v1/katara/parcels/{parcel_id}/devices` that **generates a server-side API key**, returns the plaintext **exactly once**, and persists only a bcrypt hash.
- A helper `public.verify_device_api_key()` SQL function — constant-time compare via `pgcrypto.crypt()` — that KAT-03's < 50 ms ingest path will call.
- A minimal frontend pairing UI on the parcel detail page: shows the generated key in a single-use modal with a copy button + "you will not see this again" warning.
- Smoke tests covering BR-K1 (two devices on one parcel → 409), cross-farmer isolation (FARMER-B cannot pair a device on FARMER-A's parcel), PENDING-farmer block (403), and a positive `verify_device_api_key()` round-trip.

Once this story is `DONE`, the AUTH-07 RLS matrix block for `m1_katara_devices` activates (the existing `to_regclass()` guard flips off the SKIP notices), and KAT-03 can be started.

---

## 2. Scope

### In scope
- Migration `0017_kat02_katara_devices.sql` — enum + table + indexes + RLS + `verify_device_api_key()` helper.
- FastAPI sub-router `backend/app/modules/katara/devices.py` — pair, list, rotate-key, unpair (delete only when no telemetry rows exist — full unlink/relink with history preservation is **KAT-12**).
- Pydantic schemas in `backend/app/modules/katara/schemas.py` (extend the existing module — do not create a parallel file).
- API-key generation utility in `backend/app/core/api_keys.py` (`vk_` + 32 hex; bcrypt hash; constant-time verify wrapper).
- Frontend: pairing button on parcel detail page → POST → modal that shows the plaintext key once + a "copied / I have saved it" confirm step that closes the modal.
- Frontend: device list card on parcel detail page (`device_id`, masked key suffix, `status`, `last_seen`).
- Tests: BR-K1 (DB-level + endpoint-level), RLS isolation, key never returned on list/get, bcrypt round-trip via `verify_device_api_key()`.

### Out of scope
- Telemetry ingestion → **KAT-03** (this story produces the credentials KAT-03 will validate; it does not create the `/ingest` endpoint).
- Offline detection / `last_seen` updates from heartbeats → **KAT-11** (column exists but is only ever written by KAT-03 once telemetry lands).
- Unlinking a device that already has telemetry rows → **KAT-12** (KAT-02's DELETE is intentionally only permitted when zero telemetry rows exist for the device, so we never orphan field data before KAT-13 is in place).
- Multi-device-per-parcel — explicitly forbidden by BR-K1 for MVD.
- QR-code provisioning, OTA firmware push — post-MVD ergonomics.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-01](./KAT-01-farmer-registers-parcel.md) `DONE` | `public.m1_katara_parcels` must exist; the `parcel_id` FK and RLS sub-selects depend on it. |
| [AUTH-06](./AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) `DONE` | `verification_status = 'VERIFIED'` gate is reused by `_require_verified_farmer` (the existing helper in [backend/app/modules/katara/router.py](../../backend/app/modules/katara/router.py)). |
| [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) `DONE` | `public.has_role()`, `public.is_admin()`, and the `pgcrypto` extension (already enabled in migration 0001) are reused. |
| `pgcrypto` available | Used for `crypt(plaintext, hash)` constant-time compare in `verify_device_api_key()`. Already on per 0001 — confirm with `select extname from pg_extension where extname='pgcrypto'`. |
| `bcrypt` package in `backend/pyproject.toml` | Add if not present (`bcrypt = "^4.2"`). The bcrypt cost factor for the device key is **10** — fast enough for the < 50 ms KAT-03 ingest path while still resisting offline cracking. |
| Frontend parcel detail page exists | KAT-01 added `/dashboard/farmer/parcels` (list) and `/dashboard/farmer/parcels/[id]` (detail). KAT-02 mounts the pairing widget on the detail page. |

---

## 4. Data Model

### Enum: `public.device_status`

| Value | Meaning |
|---|---|
| `PENDING` | Paired in DB but has not yet sent a single telemetry payload. |
| `ACTIVE` | Has sent telemetry within the last hour (set by KAT-03 on every insert). |
| `OFFLINE` | No telemetry for > 1 h (set by the KAT-11 worker). |
| `UNLINKED` | Soft-detached from a parcel (introduced in **KAT-12**; defined here so the enum is stable and KAT-12 needs no migration). |

### Table: `public.m1_katara_devices`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Internal PK. |
| `device_id` | `text` | NOT NULL, UNIQUE, CHECK matches `^ESP-KAT-\d{3}$` | Printed on the physical ESP32 case. Stable identifier the device puts in every telemetry payload. |
| `parcel_id` | `uuid` | NOT NULL, FK → `public.m1_katara_parcels(id)` ON DELETE RESTRICT | RESTRICT (not CASCADE) so a farmer cannot accidentally drop a device by deleting the parcel; KAT-01's parcel DELETE will now surface a 409 if a device is linked. |
| `farmer_id` | `uuid` | NOT NULL, FK → `public.profiles(id)` ON DELETE CASCADE | Denormalised from `parcel.farmer_id` so RLS does not require a sub-select on the hot ingest path. Kept in sync by a trigger (see §5.1). |
| `api_key_hash` | `text` | NOT NULL | bcrypt hash of the `vk_…` plaintext. Never returned by any endpoint. |
| `api_key_last4` | `text` | NOT NULL, CHECK length 4 | Last four chars of the plaintext, stored so the UI can show `vk_…a1b2` without keeping the plaintext. |
| `status` | `device_status` | NOT NULL, default `'PENDING'` | KAT-03 flips PENDING → ACTIVE on first ingest. KAT-11 flips ACTIVE ↔ OFFLINE. |
| `last_seen` | `timestamptz` | NULLABLE | Set by KAT-03's ingest path. NULL until first telemetry. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Auto-maintained by `set_updated_at()`. |

### BR-K1 constraint

> "One ESP32 can only be linked to one parcel at a time" (PRD §6.1.2).

Implementation: **partial unique index** on `parcel_id` filtered to non-`UNLINKED` rows. This keeps BR-K1 enforced at the DB layer while allowing KAT-12 to soft-detach a device (set `status = 'UNLINKED'`) and pair a fresh one without first deleting the row.

```sql
create unique index m1_katara_devices_one_active_per_parcel
    on public.m1_katara_devices (parcel_id)
    where status <> 'UNLINKED';
```

A second partial unique on `device_id` filtered the same way guards against the rare case of re-using a physical device on a new parcel after unlink (KAT-12 will hand-off to a new row; the old row stays UNLINKED for KAT-13 history).

### RLS matrix for `m1_katara_devices`

| Operation | Policy | Condition |
|---|---|---|
| SELECT | `katara_devices_select_own` | `auth.uid() = farmer_id` |
| SELECT | `katara_devices_admin_select` | `public.is_admin()` |
| INSERT | `katara_devices_insert_verified_farmer_owns_parcel` | `auth.uid() = farmer_id` AND `has_role('FARMER')` AND `verification_status = 'VERIFIED'` AND parcel is owned by the same farmer |
| UPDATE | `katara_devices_update_own` | `auth.uid() = farmer_id` (rotate-key + KAT-12 unlink) |
| DELETE | `katara_devices_delete_own` | `auth.uid() = farmer_id` (KAT-02 only allows DELETE when no telemetry exists — guard enforced at the FastAPI layer; the DB allows it for KAT-12 reuse) |

> Note: the **service role** writes from the KAT-03 ingest worker bypass RLS by design (per AUTH-05); the ingest endpoint calls `verify_device_api_key()` instead and never trusts a user JWT.

---

## 5. Step-by-Step Implementation

### 5.1 Migration 0017 — devices table + verifier helper

Create [db/migrations/0017_kat02_katara_devices.sql](../../db/migrations/0017_kat02_katara_devices.sql):

```sql
-- 0017 — M1 Katara: ESP32 device registry (KAT-02).
-- Each row = one physical ESP32 paired to one parcel. The api_key is generated
-- server-side, hashed with bcrypt before insert, and the plaintext is shown to
-- the farmer exactly once at pairing time. KAT-03's < 50 ms ingest endpoint
-- validates incoming payloads via public.verify_device_api_key().

-- ── Enum ──────────────────────────────────────────────────────────────────────
do $$
begin
    if not exists (select 1 from pg_type where typname = 'device_status') then
        create type public.device_status as enum (
            'PENDING',     -- paired, no telemetry yet
            'ACTIVE',      -- telemetry within the last hour
            'OFFLINE',     -- > 1h since last telemetry (set by KAT-11 worker)
            'UNLINKED'     -- soft-detached (KAT-12); kept for history
        );
    end if;
end$$;

-- ── Table ─────────────────────────────────────────────────────────────────────
create table if not exists public.m1_katara_devices (
    id              uuid                primary key default gen_random_uuid(),
    device_id       text                not null
                        constraint m1_katara_devices_device_id_format
                            check (device_id ~ '^ESP-KAT-\d{3}$'),
    parcel_id       uuid                not null
                        references public.m1_katara_parcels(id) on delete restrict,
    -- Denormalised from parcels.farmer_id so the hot ingest path (KAT-03) can
    -- do RLS-free direct inserts via the service role without a join. Kept in
    -- sync by trg_m1_katara_devices_sync_farmer below.
    farmer_id       uuid                not null
                        references public.profiles(id) on delete cascade,
    api_key_hash    text                not null,
    api_key_last4   text                not null
                        constraint m1_katara_devices_last4_len check (length(api_key_last4) = 4),
    status          public.device_status not null default 'PENDING',
    last_seen       timestamptz,
    created_at      timestamptz         not null default now(),
    updated_at      timestamptz         not null default now()
);

-- BR-K1: one active device per parcel. The partial filter is required because
-- KAT-12 will soft-detach via status='UNLINKED' rather than DELETE — a hard
-- unique on parcel_id would block legitimate re-pairing post-unlink.
create unique index m1_katara_devices_one_active_per_parcel
    on public.m1_katara_devices (parcel_id)
    where status <> 'UNLINKED';

-- Same logic for device_id: an unlinked physical device can be re-paired,
-- which creates a NEW row, but only one ACTIVE row per device_id is allowed.
create unique index m1_katara_devices_one_active_per_device_id
    on public.m1_katara_devices (device_id)
    where status <> 'UNLINKED';

-- Lookup by owner for the dashboard.
create index if not exists m1_katara_devices_farmer_idx
    on public.m1_katara_devices (farmer_id);

-- Re-use the set_updated_at() function from 0002.
create trigger trg_m1_katara_devices_updated_at
    before update on public.m1_katara_devices
    for each row execute function public.set_updated_at();

-- Keep farmer_id consistent with the linked parcel. Runs on INSERT only —
-- UPDATE of parcel_id is handled in KAT-12's relink flow.
create or replace function public.m1_katara_devices_sync_farmer()
returns trigger
language plpgsql
as $$
begin
    select farmer_id into new.farmer_id
    from   public.m1_katara_parcels
    where  id = new.parcel_id;

    if new.farmer_id is null then
        raise exception 'parcel % does not exist or is not visible', new.parcel_id;
    end if;
    return new;
end$$;

create trigger trg_m1_katara_devices_sync_farmer
    before insert on public.m1_katara_devices
    for each row execute function public.m1_katara_devices_sync_farmer();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.m1_katara_devices enable row level security;

create policy "katara_devices_select_own"
    on public.m1_katara_devices for select
    using (auth.uid() = farmer_id);

create policy "katara_devices_admin_select"
    on public.m1_katara_devices for select
    using (public.is_admin());

-- INSERT: must be a VERIFIED FARMER pairing on a parcel they own.
-- Mirrors the FastAPI _require_verified_farmer + ownership check.
create policy "katara_devices_insert_verified_farmer_owns_parcel"
    on public.m1_katara_devices for insert
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER')
        and (
            select verification_status
            from   public.profiles
            where  id = auth.uid()
        ) = 'VERIFIED'
        and exists (
            select 1
            from   public.m1_katara_parcels p
            where  p.id        = parcel_id
              and  p.farmer_id = auth.uid()
        )
    );

create policy "katara_devices_update_own"
    on public.m1_katara_devices for update
    using       (auth.uid() = farmer_id)
    with check  (auth.uid() = farmer_id);

create policy "katara_devices_delete_own"
    on public.m1_katara_devices for delete
    using (auth.uid() = farmer_id);

-- ── KAT-03 hand-off: constant-time api_key verifier ───────────────────────────
-- crypt(plaintext, stored_hash) recomputes bcrypt with the same salt+cost from
-- the stored hash and returns a value byte-equal to stored_hash on a match. The
-- comparison itself is performed in pgcrypto's C code which is constant-time
-- with respect to the byte values (only the cost factor leaks). This is the
-- same primitive used by AUTH-03's password verifier — see runbook §AUTH-03.
create or replace function public.verify_device_api_key(
    p_device_id text,
    p_api_key   text
)
returns table (
    device_row_id uuid,
    parcel_id     uuid,
    farmer_id     uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select d.id, d.parcel_id, d.farmer_id
    from   public.m1_katara_devices d
    where  d.device_id     = p_device_id
      and  d.status       <> 'UNLINKED'
      and  d.api_key_hash  = crypt(p_api_key, d.api_key_hash)
    limit  1;
$$;

revoke all on function public.verify_device_api_key(text, text) from public;
grant execute on function public.verify_device_api_key(text, text) to service_role;
```

Apply with:

```bash
supabase db push
```

Verify in the Supabase dashboard: `public.m1_katara_devices` exists, RLS enabled, **five** policies listed, `device_status` enum has four values, and `verify_device_api_key` shows under **Database → Functions** with `service_role` execute grant only.

---

### 5.2 Backend — API key utility

Create [backend/app/core/api_keys.py](../../backend/app/core/api_keys.py):

```python
"""KAT-02 device API key helpers.

The plaintext key is shown to the farmer exactly once at pairing time. The
backend never persists the plaintext — only a bcrypt hash and the last four
characters (for UI display). KAT-03's < 50 ms ingest endpoint validates via
the SQL function ``public.verify_device_api_key`` which uses ``pgcrypto.crypt``
for constant-time comparison.

Key format: ``vk_`` + 32 hex chars (16 random bytes). 128 bits of entropy is
sufficient for a per-device secret that lives behind the ingest endpoint's
NGINX rate limit (AUTH-08).
"""

from __future__ import annotations

import secrets

import bcrypt

_PREFIX = "vk_"
_HEX_BYTES = 16  # → 32 hex chars
# Cost factor 10 keeps the bcrypt step under ~10 ms on the demo VPS, leaving
# headroom inside the < 50 ms KAT-03 ingest SLA. Do not raise without
# benchmarking the ingest p50 first.
_BCRYPT_COST = 10


def generate_device_api_key() -> str:
    """Return a fresh plaintext device API key (``vk_<32 hex>``)."""
    return _PREFIX + secrets.token_hex(_HEX_BYTES)


def hash_device_api_key(plaintext: str) -> str:
    """Return the bcrypt hash to persist in ``m1_katara_devices.api_key_hash``."""
    return bcrypt.hashpw(
        plaintext.encode("utf-8"),
        bcrypt.gensalt(rounds=_BCRYPT_COST),
    ).decode("utf-8")


def last4(plaintext: str) -> str:
    """Last four chars — stored in ``api_key_last4`` for the UI."""
    return plaintext[-4:]
```

Add `bcrypt = "^4.2"` to `backend/pyproject.toml` if not already pinned by AUTH-03.

---

### 5.3 Backend — Pydantic schemas

Extend [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py) (append after the existing `ParcelOut`):

```python
# ── KAT-02 device pairing ────────────────────────────────────────────────────

import re

_DEVICE_ID_RE = re.compile(r"^ESP-KAT-\d{3}$")


class DevicePair(BaseModel):
    """Pairing request body. ``parcel_id`` is taken from the path, not the body."""
    device_id: str

    @field_validator("device_id")
    @classmethod
    def device_id_format(cls, v: str) -> str:
        if not _DEVICE_ID_RE.match(v):
            raise ValueError("device_id must match ESP-KAT-NNN")
        return v


class DevicePairResponse(BaseModel):
    """One-shot response with the plaintext key. Never returned again."""
    id: UUID
    device_id: str
    parcel_id: UUID
    api_key: str   # plaintext — shown once
    api_key_last4: str
    status: str
    created_at: datetime


class DeviceOut(BaseModel):
    """Safe device view — no plaintext key, only ``api_key_last4``."""
    id: UUID
    device_id: str
    parcel_id: UUID
    farmer_id: UUID
    api_key_last4: str
    status: str
    last_seen: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

---

### 5.4 Backend — pairing sub-router

Create [backend/app/modules/katara/devices.py](../../backend/app/modules/katara/devices.py):

```python
"""KAT-02 device pairing endpoints.

Mounted under the existing katara router at
``/api/v1/katara/parcels/{parcel_id}/devices``. The pairing endpoint is the
ONLY place the plaintext api_key crosses an HTTP boundary — every other
endpoint returns ``DeviceOut`` which exposes only ``api_key_last4``.

AUTH-04 defence-in-depth: both the ``katara_devices_insert_verified_farmer_owns_parcel``
RLS policy AND the FastAPI ``_require_verified_farmer`` + parcel-ownership
sub-query below enforce the same contract. Either alone would suffice; we run
both because the AUTH-07 matrix treats them as independent failure surfaces.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.core.api_keys import generate_device_api_key, hash_device_api_key, last4
from app.core.security import AuthUser, get_current_user, get_db_for_user
from app.modules.katara.router import _require_verified_farmer  # reuse KAT-01 gate
from app.modules.katara.schemas import (
    DeviceOut,
    DevicePair,
    DevicePairResponse,
)

router = APIRouter(prefix="/katara/parcels/{parcel_id}/devices", tags=["katara"])

_DEVICES_TABLE = "m1_katara_devices"
_PARCELS_TABLE = "m1_katara_parcels"
_TELEMETRY_TABLE = "m1_katara_telemetry"  # created in KAT-03; guarded below


def _assert_owns_parcel(db: Client, parcel_id: UUID, farmer_id: UUID) -> None:
    res = (
        db.table(_PARCELS_TABLE)
        .select("id")
        .eq("id", str(parcel_id))
        .eq("farmer_id", str(farmer_id))
        .limit(1)
        .execute()
    )
    if not (res.data or []):
        # 404 (not 403) to avoid leaking which parcels exist for other farmers.
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="parcel_not_found")


@router.post(
    "",
    response_model=DevicePairResponse,
    status_code=status.HTTP_201_CREATED,
)
async def pair_device(
    parcel_id: UUID,
    body: DevicePair,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> DevicePairResponse:
    _assert_owns_parcel(db, parcel_id, user.id)

    plaintext = generate_device_api_key()
    inserted = (
        db.table(_DEVICES_TABLE)
        .insert(
            {
                "device_id": body.device_id,
                "parcel_id": str(parcel_id),
                # farmer_id is filled by trg_m1_katara_devices_sync_farmer.
                # We still pass it so the RLS WITH CHECK clause sees the right
                # value — the trigger merely re-asserts it.
                "farmer_id": str(user.id),
                "api_key_hash": hash_device_api_key(plaintext),
                "api_key_last4": last4(plaintext),
            }
        )
        .execute()
    )
    rows = inserted.data or []
    if not rows:
        # The most common cause is BR-K1: a non-UNLINKED device already exists
        # on this parcel and the partial unique index rejected the insert.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="device_already_paired",
        )
    row = rows[0]
    return DevicePairResponse(
        id=row["id"],
        device_id=row["device_id"],
        parcel_id=row["parcel_id"],
        api_key=plaintext,
        api_key_last4=row["api_key_last4"],
        status=row["status"],
        created_at=row["created_at"],
    )


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    parcel_id: UUID,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> list[DeviceOut]:
    _assert_owns_parcel(db, parcel_id, user.id)
    res = (
        db.table(_DEVICES_TABLE)
        .select("*")
        .eq("parcel_id", str(parcel_id))
        .order("created_at", desc=False)
        .execute()
    )
    return [DeviceOut(**row) for row in (res.data or [])]


@router.post("/{device_row_id}/rotate-key", response_model=DevicePairResponse)
async def rotate_device_key(
    parcel_id: UUID,
    device_row_id: UUID,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> DevicePairResponse:
    """Regenerate the api_key. Use when the farmer suspects compromise or
    re-flashes the device. The old plaintext is irrecoverable."""
    _assert_owns_parcel(db, parcel_id, user.id)
    plaintext = generate_device_api_key()
    res = (
        db.table(_DEVICES_TABLE)
        .update(
            {
                "api_key_hash": hash_device_api_key(plaintext),
                "api_key_last4": last4(plaintext),
            }
        )
        .eq("id", str(device_row_id))
        .eq("parcel_id", str(parcel_id))
        .eq("farmer_id", str(user.id))
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="device_not_found")
    row = rows[0]
    return DevicePairResponse(
        id=row["id"],
        device_id=row["device_id"],
        parcel_id=row["parcel_id"],
        api_key=plaintext,
        api_key_last4=row["api_key_last4"],
        status=row["status"],
        created_at=row["created_at"],
    )


@router.delete("/{device_row_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unpair_device(
    parcel_id: UUID,
    device_row_id: UUID,
    user: Annotated[AuthUser, Depends(_require_verified_farmer)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> None:
    """KAT-02-scoped DELETE: only allowed when the device has never sent
    telemetry. KAT-12 will replace this with a proper unlink that preserves
    history (status → UNLINKED). The check is best-effort — KAT-03 creates the
    telemetry table; we tolerate its absence during the KAT-02-before-KAT-03
    window via the table_check below.
    """
    _assert_owns_parcel(db, parcel_id, user.id)

    # Guard: refuse to hard-delete if any telemetry rows exist. Skipped cleanly
    # when m1_katara_telemetry has not been created yet (KAT-03 not merged).
    try:
        tele = (
            db.table(_TELEMETRY_TABLE)
            .select("id", count="exact")
            .eq("device_id", str(device_row_id))
            .limit(1)
            .execute()
        )
        if (tele.count or 0) > 0:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="device_has_telemetry_use_unlink_in_kat12",
            )
    except HTTPException:
        raise
    except Exception:
        # Table does not exist yet (pre-KAT-03). Safe to proceed.
        pass

    res = (
        db.table(_DEVICES_TABLE)
        .delete()
        .eq("id", str(device_row_id))
        .eq("parcel_id", str(parcel_id))
        .eq("farmer_id", str(user.id))
        .execute()
    )
    if not (res.data or []):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="device_not_found")
```

Register the sub-router in [backend/app/main.py](../../backend/app/main.py) (next to the existing katara include):

```python
from app.modules.katara.devices import router as katara_devices_router

app.include_router(katara_devices_router, prefix="/api/v1")
```

---

### 5.5 Frontend — pairing widget on parcel detail page

Edit [frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx) (created in KAT-01). Add a **Devices** section below the parcel summary:

```tsx
// inside ParcelDetailPage(), after the parcel summary block:
<section className="mt-8">
  <div className="flex items-center justify-between mb-4">
    <h2 className="text-xl font-semibold">Capteurs ESP32</h2>
    <PairDeviceButton parcelId={parcel.id} />
  </div>
  <DeviceList parcelId={parcel.id} initialDevices={devices} />
</section>
```

Create [frontend/src/app/dashboard/farmer/parcels/[id]/PairDeviceButton.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/PairDeviceButton.tsx):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

interface PairResponse {
  id: string;
  device_id: string;
  api_key: string;       // plaintext — shown once
  api_key_last4: string;
}

export function PairDeviceButton({ parcelId }: { parcelId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paired, setPaired] = useState<PairResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/katara/parcels/${parcelId}/devices`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ device_id: deviceId.trim() }),
      },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body.detail ?? `Erreur ${res.status}`;
      // Map BR-K1 to user-friendly copy.
      setError(
        detail === "device_already_paired"
          ? "Un capteur est déjà associé à cette parcelle. Détachez-le avant d'en ajouter un autre."
          : detail,
      );
      setSubmitting(false);
      return;
    }

    setPaired(await res.json());
    setSubmitting(false);
  }

  function close() {
    setOpen(false);
    setDeviceId("");
    setError(null);
    setPaired(null);
    setConfirmed(false);
    if (paired) router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-green-600 px-4 py-2 text-white text-sm font-medium hover:bg-green-700"
      >
        + Associer un capteur
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-6 shadow-xl">
        {!paired ? (
          <>
            <h3 className="text-lg font-semibold mb-3">Associer un capteur ESP32</h3>
            <label className="block text-sm font-medium mb-1">
              Identifiant du capteur
            </label>
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="ESP-KAT-001"
              className="w-full rounded-md border px-3 py-2 text-sm mb-3"
            />
            <p className="text-xs text-gray-500 mb-3">
              L'identifiant est imprimé sur le boîtier du capteur (format
              <code className="font-mono"> ESP-KAT-NNN</code>).
            </p>
            {error && (
              <div className="mb-3 rounded-md bg-red-50 border border-red-200 p-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={close} className="px-3 py-2 text-sm">Annuler</button>
              <button
                onClick={submit}
                disabled={submitting || !deviceId.trim()}
                className="rounded-md bg-green-600 px-4 py-2 text-white text-sm disabled:opacity-50"
              >
                {submitting ? "Association…" : "Associer"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold mb-2">Clé API du capteur</h3>
            <p className="text-sm text-gray-600 mb-3">
              Copiez cette clé maintenant et flashez-la dans le firmware de votre
              ESP32. <strong>Vous ne pourrez plus la consulter par la suite.</strong>
            </p>
            <div className="rounded-md bg-gray-50 border px-3 py-3 font-mono text-sm break-all mb-3">
              {paired.api_key}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(paired.api_key)}
              className="text-sm text-green-700 hover:underline mb-4"
            >
              Copier dans le presse-papiers
            </button>
            <label className="flex items-start gap-2 text-sm mb-4">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1"
              />
              <span>
                Je confirme avoir sauvegardé la clé. Je comprends qu'elle ne sera
                plus affichée.
              </span>
            </label>
            <div className="flex justify-end">
              <button
                onClick={close}
                disabled={!confirmed}
                className="rounded-md bg-green-600 px-4 py-2 text-white text-sm disabled:opacity-50"
              >
                Terminer
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

Create [frontend/src/app/dashboard/farmer/parcels/[id]/DeviceList.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/DeviceList.tsx) (server-rendered, reads via the same fetch pattern as KAT-01's parcel list).

---

### 5.6 Backend tests

Create [backend/tests/test_kat02_devices.py](../../backend/tests/test_kat02_devices.py):

```python
"""KAT-02 device pairing tests.

Mix of pure-unit (api key utility + bcrypt round-trip) and e2e (gated on
``--run-e2e`` and the shared ``identities`` fixture from conftest.py).
"""

from __future__ import annotations

import pytest
import requests

from app.core.api_keys import (
    generate_device_api_key,
    hash_device_api_key,
    last4,
)


class TestApiKeyUtility:
    def test_key_format(self):
        k = generate_device_api_key()
        assert k.startswith("vk_")
        assert len(k) == 3 + 32

    def test_keys_are_unique(self):
        keys = {generate_device_api_key() for _ in range(50)}
        assert len(keys) == 50

    def test_bcrypt_roundtrip(self):
        import bcrypt
        plaintext = generate_device_api_key()
        h = hash_device_api_key(plaintext)
        assert bcrypt.checkpw(plaintext.encode(), h.encode())
        assert not bcrypt.checkpw(b"vk_wrong", h.encode())

    def test_last4(self):
        k = "vk_0123456789abcdef0123456789abcdef"
        assert last4(k) == "cdef"


@pytest.mark.skipif("not config.getoption('--run-e2e')", reason="e2e only")
class TestPairingFlow:
    """Requires SUPABASE_URL + api_base_url + identities fixtures from AUTH-07."""

    def _pair(self, api_base_url, token, parcel_id, device_id):
        return requests.post(
            f"{api_base_url}/api/v1/katara/parcels/{parcel_id}/devices",
            json={"device_id": device_id},
            headers={"Authorization": f"Bearer {token}"},
        )

    def test_verified_farmer_can_pair(self, api_base_url, identities, farmer_a_parcel_id):
        r = self._pair(api_base_url, identities["FARMER_A"]["token"],
                       farmer_a_parcel_id, "ESP-KAT-101")
        assert r.status_code == 201
        body = r.json()
        assert body["api_key"].startswith("vk_")
        assert body["api_key_last4"] == body["api_key"][-4:]

    def test_br_k1_second_device_rejected(self, api_base_url, identities, farmer_a_parcel_id):
        # First pair succeeds (or already exists from previous test).
        self._pair(api_base_url, identities["FARMER_A"]["token"],
                   farmer_a_parcel_id, "ESP-KAT-110")
        # Second device on the same parcel must 409.
        r = self._pair(api_base_url, identities["FARMER_A"]["token"],
                       farmer_a_parcel_id, "ESP-KAT-111")
        assert r.status_code == 409
        assert r.json()["detail"] == "device_already_paired"

    def test_pending_farmer_blocked(self, api_base_url, identities, farmer_a_parcel_id):
        r = self._pair(api_base_url, identities["FARMER_B"]["token"],
                       farmer_a_parcel_id, "ESP-KAT-201")
        assert r.status_code in (403, 404)  # 404 also acceptable (parcel not owned)

    def test_cross_farmer_blocked(self, api_base_url, identities, farmer_a_parcel_id):
        # FARMER-B cannot pair on FARMER-A's parcel → 404 (no leak).
        r = self._pair(api_base_url, identities["FARMER_B"]["token"],
                       farmer_a_parcel_id, "ESP-KAT-301")
        assert r.status_code == 404

    def test_restaurant_blocked(self, api_base_url, identities, farmer_a_parcel_id):
        r = self._pair(api_base_url, identities["RESTAURANT"]["token"],
                       farmer_a_parcel_id, "ESP-KAT-401")
        assert r.status_code == 403

    def test_list_devices_never_returns_plaintext(self, api_base_url, identities, farmer_a_parcel_id):
        r = requests.get(
            f"{api_base_url}/api/v1/katara/parcels/{farmer_a_parcel_id}/devices",
            headers={"Authorization": f"Bearer {identities['FARMER_A']['token']}"},
        )
        assert r.status_code == 200
        for d in r.json():
            assert "api_key" not in d
            assert "api_key_hash" not in d
            assert "api_key_last4" in d
            assert len(d["api_key_last4"]) == 4
```

Add a pgTAP block in [db/tests/auth07_role_matrix.sql](../../db/tests/auth07_role_matrix.sql) for `m1_katara_devices` — the existing `to_regclass()` guard will activate it the moment 0017 is applied. **No code change to AUTH-07** is required.

Add a pgTAP block in [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) for **BR-K1**: insert two non-UNLINKED rows with the same `parcel_id` and assert a unique-violation. The block is already stubbed under `to_regclass('public.m1_katara_devices')` from the AUTH-07 baseline.

Run:

```bash
cd backend && pytest tests/test_kat02_devices.py::TestApiKeyUtility -v
make -C db test-auth07
```

---

### 5.7 KAT-01 parcel DELETE — handle FK RESTRICT

The new FK `parcel_id REFERENCES m1_katara_parcels ON DELETE RESTRICT` means KAT-01's parcel DELETE endpoint will now fail with a Postgres error when a device is linked. Update [backend/app/modules/katara/router.py](../../backend/app/modules/katara/router.py) `delete_parcel` to catch the violation and return `409 Conflict` with `detail="parcel_has_device_unpair_first"`:

```python
# in delete_parcel(...), wrap the .execute() call:
try:
    res = db.table(_PARCELS_TABLE).delete()...execute()
except Exception as exc:
    if "violates foreign key constraint" in str(exc):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="parcel_has_device_unpair_first")
    raise
```

---

### 5.8 AUTH-07 SKIP-count check

Run after 0017 is applied:

```bash
make -C db test-auth07 2>&1 | grep -i "m1_katara_devices"
```

Five matrix cells (FARMER-select-own, FARMER-insert verified+owns-parcel, FARMER-update, FARMER-delete, ADMIN-select) and one BR cell (BR-K1) should flip from `# SKIP` to green `ok` lines.

---

## 6. Verification Checklist

- [ ] `db/migrations/0017_kat02_katara_devices.sql` applied — table + enum visible in Supabase dashboard with RLS enabled.
- [ ] Five RLS policies listed on `m1_katara_devices`.
- [ ] `public.verify_device_api_key` shows in **Database → Functions** with `service_role` execute grant only (verify with `\df+ verify_device_api_key` in `psql` or the dashboard).
- [ ] `pytest backend/tests/test_kat02_devices.py::TestApiKeyUtility -v` → 4/4 green (no network).
- [ ] VERIFIED FARMER-A can `POST /api/v1/katara/parcels/{their_parcel}/devices` → 201, response contains `api_key` (plaintext, starts with `vk_`).
- [ ] Same parcel + second pair attempt → 409 `device_already_paired` (BR-K1).
- [ ] FARMER-B (PENDING) → 403 or 404.
- [ ] FARMER-B pairing on FARMER-A's parcel → 404 (no leak).
- [ ] RESTAURANT → 403.
- [ ] `GET /api/v1/katara/parcels/{id}/devices` response contains **no** `api_key` or `api_key_hash` keys.
- [ ] `POST /api/v1/katara/parcels/{id}/devices/{device_row_id}/rotate-key` returns a new plaintext key; old key fails `verify_device_api_key()`.
- [ ] `DELETE /api/v1/katara/parcels/{id}/devices/{device_row_id}` → 204 (when no telemetry exists).
- [ ] Frontend: clicking "Associer un capteur" opens modal → enter `ESP-KAT-001` → modal flips to plaintext key view with copy button + confirm checkbox.
- [ ] Frontend: closing the modal without checking the confirm box is blocked.
- [ ] Frontend: after confirming, the device appears in the device list with `api_key_last4` visible and plaintext key absent from the page DOM.
- [ ] KAT-01 parcel DELETE for a parcel with a linked device returns 409 `parcel_has_device_unpair_first`.
- [ ] `make -C db test-auth07` — the five `m1_katara_devices` RLS cells and BR-K1 cell are green (no `# SKIP`).

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| DB migration | [db/migrations/0017_kat02_katara_devices.sql](../../db/migrations/0017_kat02_katara_devices.sql) |
| API key utility | [backend/app/core/api_keys.py](../../backend/app/core/api_keys.py) |
| Schema extensions | [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py) (append KAT-02 block) |
| FastAPI sub-router | [backend/app/modules/katara/devices.py](../../backend/app/modules/katara/devices.py) |
| Router registration | [backend/app/main.py](../../backend/app/main.py) — `include_router(katara_devices_router)` |
| Parcel DELETE 409 guard | [backend/app/modules/katara/router.py](../../backend/app/modules/katara/router.py) — wrap delete in FK-violation catch |
| Unit + e2e tests | [backend/tests/test_kat02_devices.py](../../backend/tests/test_kat02_devices.py) |
| Frontend — pairing modal | [frontend/src/app/dashboard/farmer/parcels/[id]/PairDeviceButton.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/PairDeviceButton.tsx) |
| Frontend — device list | [frontend/src/app/dashboard/farmer/parcels/[id]/DeviceList.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/DeviceList.tsx) |
| Frontend — parcel detail page | [frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx) (mount Devices section) |
| `spring-status.yml` update | Flip `KAT-02.status` → `DONE`; bump `E2.progress_pct` from 7 → 14; KAT-03 unblocked |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Plaintext API key leaks via logs | The plaintext only appears in `DevicePairResponse` (single endpoint). The serializer filter list (`DeviceOut`) excludes it on every other route. CI grep: `rg "api_key.*=" backend/ -t py` must not find any persistence call other than `hash_device_api_key`. |
| Farmer loses the key before flashing the device | The rotate-key endpoint (§5.4) is the documented recovery path. Surfaced in the UI as a "Régénérer la clé" link on the device card. |
| bcrypt cost factor 10 still too slow for KAT-03's 50 ms SLA | Benchmark with `python -c "import bcrypt, timeit; ..."` on the demo VPS during the KAT-02 acceptance gate. If p99 > 25 ms, drop to cost 8 and re-test. The SLA budget allows for it. |
| BR-K1 partial unique index does not survive a `pg_dump`/restore | `psql` dumps partial indexes correctly; verified by AUTH-07 baseline. Add a one-line assertion in the AUTH-07 pgTAP block: `SELECT indexname FROM pg_indexes WHERE indexname = 'm1_katara_devices_one_active_per_parcel'`. |
| KAT-01 parcel DELETE breaking change is missed by an existing test | The `delete_parcel` 409 path is covered by a new assertion in `test_kat01_parcels.py::TestParcelDelete::test_delete_blocked_when_device_linked` added in §5.7. |
| Service-role key reused by a non-ingest router by mistake | AUTH-05's `test_service_client_callsite_allowlist.py` rejects new callsites outside `routers/admin/` and `workers/`. The KAT-03 ingest router will be the only legitimate KAT consumer; KAT-02 itself never touches service-role. |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Migration 0017 (enum + table + indexes + RLS + verifier function) | 60 min |
| `api_keys.py` utility + bcrypt pin + unit tests | 20 min |
| Pydantic schemas (3 new models) | 15 min |
| FastAPI sub-router (pair / list / rotate / unpair) | 50 min |
| KAT-01 parcel DELETE 409 patch | 10 min |
| e2e pytest block (5 scenarios) | 40 min |
| Frontend pairing modal + device list | 60 min |
| AUTH-07 SKIP-count drill | 10 min |
| `spring-status.yml` update | 5 min |
| **Total active work** | **~4.5 h** |

---

## 10. Definition of Done

1. Acceptance criterion met: a VERIFIED FARMER can pair an ESP32 via the API and see it listed on the parcel detail page. A second pair attempt on the same parcel returns 409 (BR-K1).
2. Verification checklist (§6) fully ticked.
3. All deliverables (§7) committed and pushed.
4. `pytest backend/tests/test_kat02_devices.py::TestApiKeyUtility` → 4/4 green.
5. `make -C db test-auth07` — `m1_katara_devices` SKIP notices absent; BR-K1 pgTAP cell green.
6. [docs/spring-status.yml](../spring-status.yml) updated: `KAT-02.status: DONE`, `E2.progress_pct` incremented (≈ 14 %), and the comment on `E2` notes KAT-03 is unblocked.
7. Hand-off note to team: **KAT-03** (telemetry ingestion) is now unblocked — it consumes `public.verify_device_api_key(device_id, api_key)` and writes into `m1_katara_telemetry` (to be created in KAT-03). **KAT-11** (offline detection) and **KAT-12** (unlink/relink) are also unblocked.
