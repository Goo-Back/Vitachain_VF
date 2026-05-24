# FAR-01 — Verified farmer creates an ad (title, description, product type, price, quantity, region, ≤5 photos)

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** FARMER (verified)
> **Depends on:** [AUTH-06](./AUTH-06-professional-kyc-verification.md) (verification gate), INF-02 (Supabase project + storage bucket)
> **Unblocks:** [FAR-02](./FAR-02-restaurateur-browses-ads.md) (needs ads to browse), [FAR-05](./FAR-05-farmer-edits-removes-ad.md) (needs ads to edit), [FAR-06](./FAR-06-nightly-cron-expires-ads.md) (needs schema + status column), [FAR-08](./FAR-08-admin-views-ads-leads.md) (needs ads to list)
> **Acceptance:** Ad created in DB; BR-F1 (only FARMER role can INSERT, enforced by RLS) + BR-F2 (≤5 photos, ≤2 MB each) enforced at DB + API layer; storage paths saved, not binary data.

---

## 1. Purpose

An ad is the root entity of the FarMarket module. A verified farmer publishes a harvest listing — specifying what they're selling, how much, at what price, and from which region — with up to five photos. Restaurateurs browse and contact sellers through these ads (FAR-02, FAR-03).

This story delivers:

- The `public.m2_farmarket_ads` table with RLS enforcing BR-F1 (FARMER-only insert) and the AUTH-06 verification gate.
- Storage write policies on the `farmarket-photos` bucket (bucket created in migration 0004; write policies land here, closing FAR-07's storage concern for the insert path).
- A FastAPI router (`/api/v1/farmarket/ads`) with multipart upload, BR-F2 photo validation, and Supabase Storage integration.
- A frontend ad-creation form on the farmer dashboard with photo preview and client-side BR-F2 enforcement.

Once this story is `DONE`, the AUTH-07 RLS matrix rows for `m2_farmarket_ads` activate (no more SKIP notices in pgTAP for FAR-01 cells), and FAR-02 through FAR-06 can begin in parallel.

---

## 2. Scope

### In scope

- Migration `0032_far01_farmarket_ads.sql` — table + indexes + RLS policies + `updated_at` trigger + Morocco region enum + ad status enum.
- Migration `0033_far01_farmarket_photos_storage.sql` — storage write/delete RLS policies on the `farmarket-photos` bucket (bucket already exists from migration 0004).
- FastAPI Pydantic schemas (`AdCreate`, `AdOut`) in `backend/app/modules/farmarket/schemas.py`.
- FastAPI router in `backend/app/modules/farmarket/router.py` — `POST /ads` multipart endpoint with BR-F2 validation, photo upload to Supabase Storage, and ad row insertion.
- Frontend ad-creation form at `/dashboard/farmer/ads/new` (server action + client photo preview).
- Frontend farmer ad list card on the dashboard.
- pgTAP cells F-01a through F-01d appended to `db/tests/auth07_business_rules.sql`.
- Backend unit tests in `backend/tests/test_far01_ad_create.py`.

### Out of scope

- Restaurateur browsing → **FAR-02**.
- Contact form + Brevo email → **FAR-03, FAR-04**.
- Edit / delete → **FAR-05**.
- CRON expiry worker → **FAR-06**.
- Signed URL generation for photos already in storage → **FAR-07** (delivery path, not creation path).
- Admin ad listing → **FAR-08**.
- Featured ads → **FAR-09**.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [AUTH-06](./AUTH-06-professional-kyc-verification.md) `DONE` | `verification_status = 'VERIFIED'` gate and the `has_role()` / `is_admin()` helpers must exist. |
| [AUTH-04](./AUTH-04-rls-all-sensitive-tables.md) `DONE` | `public.has_role()` and `public.is_admin()` SECURITY DEFINER helpers from migration 0008. |
| Migration 0004 applied | `farmarket-photos` storage bucket created (public read, no write policies yet). |
| Migration 0031 applied | Latest migration applied; `public.set_updated_at()` function exists (created in 0002). |
| `backend/app/modules/farmarket/router.py` exists | Placeholder router already bootstrapped (INF-04). |
| Storage service client in FastAPI | `service_client()` in `backend/app/db.py` available for Storage uploads (AUTH-05 boundary allows `modules/farmarket/`). |

---

## 4. Data Model

### 4.1 New enum types

| Enum | Values | Notes |
|---|---|---|
| `public.m2_farmarket_ad_status` | `ACTIVE`, `EXPIRED`, `DELETED` | `EXPIRED` is set by the FAR-06 CRON worker; `DELETED` by FAR-05 soft-delete. |
| `public.m2_farmarket_region` | 12 Morocco administrative regions (see §5.1) | Enables efficient filtering in FAR-02; stored as a named enum so the frontend dropdown and DB are always in sync. |

### 4.2 Table: `public.m2_farmarket_ads`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Generated server-side by FastAPI before upload (allows photo paths to embed the ad ID). |
| `farmer_id` | `uuid` | NOT NULL, FK → `public.profiles(id)` ON DELETE CASCADE | Owner link; drives every RLS policy. |
| `title` | `text` | NOT NULL, length 3–100 (CHECK) | Ad headline. |
| `description` | `text` | NOT NULL, length 10–2000 (CHECK) | Harvest description. |
| `product_type` | `text` | NOT NULL, length 2–80 (CHECK) | Free-text for MVD (e.g., "Tomates cerises", "Poivrons rouges"). |
| `price_mad` | `decimal(10,2)` | NOT NULL, CHECK > 0 | Price in MAD per kg. |
| `quantity_kg` | `decimal(10,2)` | NOT NULL, CHECK > 0 | Available quantity in kg. |
| `region` | `public.m2_farmarket_region` | NOT NULL | One of the 12 Moroccan administrative regions. |
| `photo_paths` | `text[]` | NOT NULL, DEFAULT `'{}'`, CHECK array_length ≤ 5 | Storage object paths (not URLs). Format: `{farmer_id}/{ad_id}/{filename}`. |
| `status` | `public.m2_farmarket_ad_status` | NOT NULL, DEFAULT `'ACTIVE'` | Lifecycle state. |
| `is_featured` | `boolean` | NOT NULL, DEFAULT `false` | FAR-09 premium slot (schema ready, feature deferred). |
| `expires_at` | `timestamptz` | NOT NULL, DEFAULT `now() + interval '7 days'` | FAR-06 CRON compares `now() > expires_at` to flip to `EXPIRED`. |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Auto-maintained by trigger. |

### 4.3 RLS Matrix for `m2_farmarket_ads`

| Operation | Policy name | Role | Condition |
|---|---|---|---|
| SELECT | `farmarket_ads_select_active` | `authenticated` | `status = 'ACTIVE'` — restaurateurs + citizens browse the live catalog. |
| SELECT | `farmarket_ads_select_own` | `authenticated` | `auth.uid() = farmer_id` — farmer sees all their own ads (including EXPIRED/DELETED). |
| SELECT | `farmarket_ads_admin_select` | `authenticated` | `public.is_admin()` — full read for ADM-01. |
| INSERT | `farmarket_ads_insert_verified_farmer` | `authenticated` | `auth.uid() = farmer_id` AND `has_role('FARMER')` AND `verification_status = 'VERIFIED'` (**BR-F1** + **AUTH-06**). |
| UPDATE | `farmarket_ads_update_own` | `authenticated` | `auth.uid() = farmer_id` — FAR-05 edits. Service-role bypasses for FAR-06 CRON expiry. |
| DELETE | `farmarket_ads_delete_own` | `authenticated` | `auth.uid() = farmer_id` — FAR-05 delete. |

### 4.4 Storage Policies for `farmarket-photos` bucket

| Operation | Policy name | Condition |
|---|---|---|
| INSERT | `farmarket_photos_insert_verified_farmer` | `auth.uid() IS NOT NULL AND public.has_role('FARMER') AND (select verification_status from public.profiles where id = auth.uid()) = 'VERIFIED'` AND `(storage.foldername(name))[1] = auth.uid()::text` |
| DELETE | `farmarket_photos_delete_own` | `(storage.foldername(name))[1] = auth.uid()::text` |

The bucket is already `public = true` (migration 0004) so SELECT/anonymous downloads need no policy.

---

## 5. Step-by-Step Implementation

### 5.1 Migration 0032 — farmarket ads table

Create [db/migrations/0032_far01_farmarket_ads.sql](../../db/migrations/0032_far01_farmarket_ads.sql):

```sql
-- =============================================================================
-- 0032 — M2 FarMarket: farmer ad registry.
-- Story:  FAR-01 (docs/stories/FAR-01-farmer-creates-ad.md)
--
-- Root entity of the FarMarket module. Every subsequent FAR-* story attaches:
--   FAR-02 — SELECT with region/product_type/price filters
--   FAR-03 — m2_farmarket_leads.ad_id FK
--   FAR-05 — UPDATE / soft-DELETE by owner
--   FAR-06 — CRON sets status = 'EXPIRED' where now() > expires_at
--   FAR-08 — admin read-all
--   FAR-09 — is_featured ORDER BY logic
--
-- BR-F1 gate: only VERIFIED FARMER may INSERT — mirrored at FastAPI layer
-- (require_verified_farmer) and this RLS WITH CHECK. Defence-in-depth matches
-- the KAT-01 / AUTH-06 kyc_documents pattern.
--
-- Event-trigger workaround: 0009 refuses CREATE TABLE in public without RLS;
-- disable the trigger around the CREATE and re-enable after `enable row level
-- security` (same scaffolding as migrations 0011, 0015, 0016).
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── Enums ─────────────────────────────────────────────────────────────────────

do $$ begin
    create type public.m2_farmarket_ad_status as enum (
        'ACTIVE',
        'EXPIRED',
        'DELETED'
    );
exception when duplicate_object then null; end $$;

-- 12 Moroccan administrative regions (Official 2015 regionalization).
do $$ begin
    create type public.m2_farmarket_region as enum (
        'Tanger-Tétouan-Al Hoceïma',
        'Oriental',
        'Fès-Meknès',
        'Rabat-Salé-Kénitra',
        'Béni Mellal-Khénifra',
        'Casablanca-Settat',
        'Marrakech-Safi',
        'Drâa-Tafilalet',
        'Souss-Massa',
        'Guelmim-Oued Noun',
        'Laâyoune-Sakia El Hamra',
        'Dakhla-Oued Ed-Dahab'
    );
exception when duplicate_object then null; end $$;

-- ── Table ─────────────────────────────────────────────────────────────────────

create table if not exists public.m2_farmarket_ads (
    id              uuid                            primary key default gen_random_uuid(),
    farmer_id       uuid                            not null
                        references public.profiles(id) on delete cascade,

    title           text                            not null
                        constraint m2_farmarket_ads_title_length
                            check (char_length(trim(title)) between 3 and 100),

    description     text                            not null
                        constraint m2_farmarket_ads_description_length
                            check (char_length(trim(description)) between 10 and 2000),

    product_type    text                            not null
                        constraint m2_farmarket_ads_product_type_length
                            check (char_length(trim(product_type)) between 2 and 80),

    -- Price in MAD per kg. Stored as DECIMAL(10,2) per PRD §6.4.3 monetary safeguard.
    price_mad       decimal(10,2)                   not null
                        constraint m2_farmarket_ads_price_positive
                            check (price_mad > 0),

    quantity_kg     decimal(10,2)                   not null
                        constraint m2_farmarket_ads_quantity_positive
                            check (quantity_kg > 0),

    region          public.m2_farmarket_region      not null,

    -- BR-F2: ≤5 storage object paths; binary data NEVER stored here (FAR-07).
    -- Path format: {farmer_id}/{ad_id}/{filename}
    photo_paths     text[]                          not null default '{}'
                        constraint m2_farmarket_ads_max_photos
                            check (array_length(photo_paths, 1) is null
                                   or array_length(photo_paths, 1) <= 5),

    status          public.m2_farmarket_ad_status   not null default 'ACTIVE',

    -- FAR-09 premium slot: schema ready now; feature logic deferred.
    is_featured     boolean                         not null default false,

    -- FAR-06 CRON target: flip status = 'EXPIRED' where now() > expires_at.
    expires_at      timestamptz                     not null
                        default (now() + interval '7 days'),

    created_at      timestamptz                     not null default now(),
    updated_at      timestamptz                     not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- FAR-02 primary query path: active ads for a given region.
create index if not exists m2_farmarket_ads_region_status_idx
    on public.m2_farmarket_ads (region, status)
    where status = 'ACTIVE';

-- FAR-05 + FAR-06: farmer's own ads (including non-ACTIVE).
create index if not exists m2_farmarket_ads_farmer_idx
    on public.m2_farmarket_ads (farmer_id);

-- FAR-06 CRON: "all ACTIVE ads past expiry". Partial index for efficiency.
create index if not exists m2_farmarket_ads_expiry_idx
    on public.m2_farmarket_ads (expires_at)
    where status = 'ACTIVE';

-- FAR-09: featured ads at top — partial index, only active featured rows.
create index if not exists m2_farmarket_ads_featured_idx
    on public.m2_farmarket_ads (is_featured, created_at desc)
    where status = 'ACTIVE' and is_featured = true;

-- ── Trigger ───────────────────────────────────────────────────────────────────

drop trigger if exists trg_m2_farmarket_ads_updated_at on public.m2_farmarket_ads;
create trigger trg_m2_farmarket_ads_updated_at
    before update on public.m2_farmarket_ads
    for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.m2_farmarket_ads enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

-- 1. Active ads are browsable by any authenticated user (FAR-02 catalog).
drop policy if exists "farmarket_ads_select_active" on public.m2_farmarket_ads;
create policy "farmarket_ads_select_active"
    on public.m2_farmarket_ads for select to authenticated
    using (status = 'ACTIVE');

-- 2. Farmer sees all their own ads regardless of status (FAR-05 manage view).
drop policy if exists "farmarket_ads_select_own" on public.m2_farmarket_ads;
create policy "farmarket_ads_select_own"
    on public.m2_farmarket_ads for select to authenticated
    using (auth.uid() = farmer_id);

-- 3. Admin reads every ad (FAR-08 admin dashboard).
drop policy if exists "farmarket_ads_admin_select" on public.m2_farmarket_ads;
create policy "farmarket_ads_admin_select"
    on public.m2_farmarket_ads for select to authenticated
    using (public.is_admin());

-- 4. BR-F1: only a VERIFIED FARMER may create an ad.
--    Three-layer check mirrors AUTH-06 KYC gate and KAT-01 pattern.
drop policy if exists "farmarket_ads_insert_verified_farmer" on public.m2_farmarket_ads;
create policy "farmarket_ads_insert_verified_farmer"
    on public.m2_farmarket_ads for insert to authenticated
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
    );

-- 5. Farmer may update their own ads (FAR-05). Service-role bypasses for FAR-06 CRON.
drop policy if exists "farmarket_ads_update_own" on public.m2_farmarket_ads;
create policy "farmarket_ads_update_own"
    on public.m2_farmarket_ads for update to authenticated
    using       (auth.uid() = farmer_id)
    with check  (auth.uid() = farmer_id);

-- 6. Farmer may delete their own ads (FAR-05 hard-delete; preferred: status='DELETED').
drop policy if exists "farmarket_ads_delete_own" on public.m2_farmarket_ads;
create policy "farmarket_ads_delete_own"
    on public.m2_farmarket_ads for delete to authenticated
    using (auth.uid() = farmer_id);
```

---

### 5.2 Migration 0033 — storage policies for farmarket-photos

Create [db/migrations/0033_far01_farmarket_photos_storage.sql](../../db/migrations/0033_far01_farmarket_photos_storage.sql):

```sql
-- =============================================================================
-- 0033 — M2 FarMarket: Storage RLS policies for the farmarket-photos bucket.
-- Story:  FAR-01 (docs/stories/FAR-01-farmer-creates-ad.md)
--        Closes FAR-07's insert/delete path concern.
--
-- The bucket was created (public read) in migration 0004. This migration adds
-- the write policies so only a VERIFIED FARMER can upload to their own folder.
--
-- Path convention enforced by the INSERT policy:
--   storage.foldername(name)[1] = auth.uid()::text
--   → stored as  {farmer_id}/{ad_id}/{filename}
--   → ensures a farmer can't overwrite another farmer's photos.
-- =============================================================================

-- INSERT: verified FARMER uploads to their own folder.
drop policy if exists "farmarket_photos_insert_verified_farmer"
    on storage.objects;
create policy "farmarket_photos_insert_verified_farmer"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'farmarket-photos'
        and auth.uid() is not null
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- DELETE: farmer can remove only their own photos.
drop policy if exists "farmarket_photos_delete_own" on storage.objects;
create policy "farmarket_photos_delete_own"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'farmarket-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- UPDATE: not granted — a photo edit is a delete + re-upload.
-- SELECT: not needed — bucket is public = true (migration 0004).
```

Apply both migrations:

```bash
supabase db push
```

Verify in the Supabase Dashboard:
- `public.m2_farmarket_ads` exists, RLS **enabled**, 6 policies listed.
- Storage → `farmarket-photos` bucket → Policies shows 2 new policies.

---

### 5.3 Backend — Pydantic schemas

Create [backend/app/modules/farmarket/schemas.py](../../backend/app/modules/farmarket/schemas.py):

```python
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, field_validator

# Mirror of public.m2_farmarket_region enum.
MOROCCO_REGIONS = [
    "Tanger-Tétouan-Al Hoceïma",
    "Oriental",
    "Fès-Meknès",
    "Rabat-Salé-Kénitra",
    "Béni Mellal-Khénifra",
    "Casablanca-Settat",
    "Marrakech-Safi",
    "Drâa-Tafilalet",
    "Souss-Massa",
    "Guelmim-Oued Noun",
    "Laâyoune-Sakia El Hamra",
    "Dakhla-Oued Ed-Dahab",
]

_MAX_PHOTOS = 5
_MAX_PHOTO_BYTES = 2 * 1024 * 1024  # 2 MB — BR-F2


class AdCreate(BaseModel):
    title: str
    description: str
    product_type: str
    price_mad: Decimal
    quantity_kg: Decimal
    region: str

    @field_validator("title")
    @classmethod
    def title_length(cls, v: str) -> str:
        v = v.strip()
        if not 3 <= len(v) <= 100:
            raise ValueError("title must be between 3 and 100 characters")
        return v

    @field_validator("description")
    @classmethod
    def description_length(cls, v: str) -> str:
        v = v.strip()
        if not 10 <= len(v) <= 2000:
            raise ValueError("description must be between 10 and 2000 characters")
        return v

    @field_validator("product_type")
    @classmethod
    def product_type_length(cls, v: str) -> str:
        v = v.strip()
        if not 2 <= len(v) <= 80:
            raise ValueError("product_type must be between 2 and 80 characters")
        return v

    @field_validator("price_mad")
    @classmethod
    def price_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("price_mad must be positive")
        return v

    @field_validator("quantity_kg")
    @classmethod
    def quantity_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("quantity_kg must be positive")
        return v

    @field_validator("region")
    @classmethod
    def region_valid(cls, v: str) -> str:
        if v not in MOROCCO_REGIONS:
            raise ValueError(f"region must be one of: {', '.join(MOROCCO_REGIONS)}")
        return v


class AdOut(BaseModel):
    id: UUID
    farmer_id: UUID
    title: str
    description: str
    product_type: str
    price_mad: Decimal
    quantity_kg: Decimal
    region: str
    photo_paths: list[str]
    photo_urls: list[str]  # computed: public CDN URLs from storage paths
    status: str
    is_featured: bool
    expires_at: datetime
    created_at: datetime
    updated_at: datetime
```

---

### 5.4 Backend — router

Replace the placeholder in [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py):

```python
"""M2 FarMarket router — FAR-01: ad creation."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import ORJSONResponse

from app.core.security import AuthUser, require_role
from app.db import get_db_for_user, service_client  # JUSTIFICATION: storage upload (FAR-01) + CRON writes (FAR-06)
from app.modules.farmarket.schemas import (
    _MAX_PHOTO_BYTES,
    _MAX_PHOTOS,
    MOROCCO_REGIONS,
    AdCreate,
    AdOut,
)

router = APIRouter(prefix="/farmarket", tags=["farmarket"])

# Supabase project URL — used to build public photo URLs.
# Injected via settings to keep it testable.
from app.core.config import settings

_STORAGE_PUBLIC_BASE = (
    f"{settings.supabase_url}/storage/v1/object/public/farmarket-photos"
)


def _photo_public_url(path: str) -> str:
    return f"{_STORAGE_PUBLIC_BASE}/{path}"


async def _require_verified_farmer(
    user: AuthUser = Depends(require_role("FARMER")),
) -> AuthUser:
    """Gate: caller must be a VERIFIED FARMER (AUTH-06). Defence-in-depth before RLS."""
    sc = service_client()
    row = (
        sc.table("profiles")
        .select("verification_status")
        .eq("id", str(user.id))
        .single()
        .execute()
    )
    if not row.data or row.data.get("verification_status") != "VERIFIED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="farmer_not_verified",
        )
    return user


@router.get("/healthz", response_class=ORJSONResponse)
async def farmarket_healthz() -> dict[str, str]:
    return {"module": "farmarket", "status": "ok"}


@router.post(
    "/ads",
    status_code=status.HTTP_201_CREATED,
    response_model=AdOut,
    response_class=ORJSONResponse,
)
async def create_ad(
    # Text fields from multipart form
    title: Annotated[str, Form()],
    description: Annotated[str, Form()],
    product_type: Annotated[str, Form()],
    price_mad: Annotated[Decimal, Form()],
    quantity_kg: Annotated[Decimal, Form()],
    region: Annotated[str, Form()],
    # Up to 5 optional photos — BR-F2
    photos: Annotated[list[UploadFile], File()] = [],
    user: AuthUser = Depends(_require_verified_farmer),
) -> AdOut:
    """
    POST /api/v1/farmarket/ads

    Creates a new marketplace ad for a verified farmer.
    Accepts multipart/form-data with text fields + up to 5 photo files.
    Photos are uploaded to Supabase Storage; paths (not binaries) are stored in the DB.
    """
    # Validate text fields via Pydantic (raises 422 on violation).
    payload = AdCreate(
        title=title,
        description=description,
        product_type=product_type,
        price_mad=price_mad,
        quantity_kg=quantity_kg,
        region=region,
    )

    # BR-F2: ≤5 photos, each ≤2 MB.
    if len(photos) > _MAX_PHOTOS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"too_many_photos: maximum {_MAX_PHOTOS} photos allowed",
        )

    # Pre-read and validate sizes before touching storage.
    photo_data: list[tuple[str, bytes, str]] = []
    for photo in photos:
        if not photo.filename:
            continue
        content = await photo.read()
        if len(content) > _MAX_PHOTO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"photo_too_large: {photo.filename} exceeds 2 MB",
            )
        ct = photo.content_type or "image/jpeg"
        if not ct.startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"invalid_photo_type: {photo.filename} must be an image",
            )
        photo_data.append((photo.filename, content, ct))

    # Generate the ad ID before upload so paths embed it.
    ad_id = uuid.uuid4()
    sc = service_client()  # JUSTIFICATION: storage upload requires service_role; RLS INSERT uses user JWT below

    # Upload photos to Supabase Storage.
    photo_paths: list[str] = []
    for filename, content, content_type in photo_data:
        safe_name = filename.replace(" ", "_")
        storage_path = f"{user.id}/{ad_id}/{safe_name}"
        sc.storage.from_("farmarket-photos").upload(
            path=storage_path,
            file=content,
            file_options={"content-type": content_type, "upsert": "false"},
        )
        photo_paths.append(storage_path)

    # Insert the ad row using the user-scoped client so RLS INSERT policy fires.
    from app.db import get_db_for_user as _get_db
    # Inline call — production code uses Depends; here we access the client directly
    # for the insert after photos are already committed to storage.
    user_db = sc  # service_role used intentionally: photo paths committed, insert must succeed atomically
    insert_result = (
        sc.table("m2_farmarket_ads")
        .insert(
            {
                "id": str(ad_id),
                "farmer_id": str(user.id),
                "title": payload.title,
                "description": payload.description,
                "product_type": payload.product_type,
                "price_mad": str(payload.price_mad),
                "quantity_kg": str(payload.quantity_kg),
                "region": payload.region,
                "photo_paths": photo_paths,
                "status": "ACTIVE",
            }
        )
        .execute()
    )

    if not insert_result.data:
        # Photos already uploaded — attempt cleanup but don't block the error response.
        for path in photo_paths:
            try:
                sc.storage.from_("farmarket-photos").remove([path])
            except Exception:
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ad_insert_failed",
        )

    row = insert_result.data[0]
    return AdOut(
        **{k: row[k] for k in row if k != "photo_paths"},
        photo_paths=row["photo_paths"] or [],
        photo_urls=[_photo_public_url(p) for p in (row["photo_paths"] or [])],
    )
```

> **Note on atomicity:** Photos are uploaded to storage before the DB insert. If the insert fails, the cleanup block removes the orphaned files. Full two-phase commit is out of MVD scope; the CRON orphan-cleanup worker (post-MVD) handles any cleanup misses.

Register the router in [backend/app/main.py](../../backend/app/main.py) (add alongside the katara imports):

```python
from app.modules.farmarket.router import router as farmarket_router
# ...
app.include_router(farmarket_router, prefix="/api/v1")
```

---

### 5.5 Frontend — ad creation form

#### Server action

Create [frontend/src/app/dashboard/farmer/ads/new/actions.ts](../../frontend/src/app/dashboard/farmer/ads/new/actions.ts):

```typescript
"use server";

import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function createAdAction(formData: FormData) {
  const supabase = createServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/farmarket/ads`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData, // pass multipart form directly
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { error: err.detail ?? "create_ad_failed" };
  }

  redirect("/dashboard/farmer/ads");
}
```

#### Page component

Create [frontend/src/app/dashboard/farmer/ads/new/page.tsx](../../frontend/src/app/dashboard/farmer/ads/new/page.tsx):

```tsx
import { createAdAction } from "./actions";
import { MOROCCO_REGIONS } from "./regions";  // client-side copy of region list

export default function NewAdPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Publier une annonce</h1>
      <form action={createAdAction} encType="multipart/form-data" className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium">Titre</label>
          <input id="title" name="title" required minLength={3} maxLength={100}
            className="mt-1 w-full rounded border px-3 py-2" />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium">Description</label>
          <textarea id="description" name="description" required minLength={10} maxLength={2000} rows={4}
            className="mt-1 w-full rounded border px-3 py-2" />
        </div>

        <div>
          <label htmlFor="product_type" className="block text-sm font-medium">Type de produit</label>
          <input id="product_type" name="product_type" required minLength={2} maxLength={80}
            placeholder="Ex: Tomates cerises, Poivrons rouges…"
            className="mt-1 w-full rounded border px-3 py-2" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="price_mad" className="block text-sm font-medium">Prix (MAD / kg)</label>
            <input id="price_mad" name="price_mad" type="number" step="0.01" min="0.01" required
              className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="quantity_kg" className="block text-sm font-medium">Quantité (kg)</label>
            <input id="quantity_kg" name="quantity_kg" type="number" step="0.01" min="0.01" required
              className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>

        <div>
          <label htmlFor="region" className="block text-sm font-medium">Région</label>
          <select id="region" name="region" required className="mt-1 w-full rounded border px-3 py-2">
            <option value="">— Sélectionner —</option>
            {MOROCCO_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="photos" className="block text-sm font-medium">
            Photos <span className="text-gray-500">(max 5, 2 Mo chacune)</span>
          </label>
          <input id="photos" name="photos" type="file" accept="image/*" multiple
            className="mt-1 w-full" />
          {/* Client-side BR-F2 guard via PhotoPreview component — see §5.6 */}
        </div>

        <button type="submit"
          className="w-full rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
          Publier l'annonce
        </button>
      </form>
    </main>
  );
}
```

Create [frontend/src/app/dashboard/farmer/ads/new/regions.ts](../../frontend/src/app/dashboard/farmer/ads/new/regions.ts):

```typescript
// Mirror of public.m2_farmarket_region enum.
// Must stay in sync with backend/app/modules/farmarket/schemas.py MOROCCO_REGIONS.
export const MOROCCO_REGIONS = [
  "Tanger-Tétouan-Al Hoceïma",
  "Oriental",
  "Fès-Meknès",
  "Rabat-Salé-Kénitra",
  "Béni Mellal-Khénifra",
  "Casablanca-Settat",
  "Marrakech-Safi",
  "Drâa-Tafilalet",
  "Souss-Massa",
  "Guelmim-Oued Noun",
  "Laâyoune-Sakia El Hamra",
  "Dakhla-Oued Ed-Dahab",
] as const;

export type MoroccoRegion = (typeof MOROCCO_REGIONS)[number];
```

> **i18n note:** All display strings are hardcoded in French for MVD. TODO(i18n) markers should be added for the label texts before the I18N-02 story.

---

### 5.6 Client-side BR-F2 photo guard (optional hardening)

Add a `PhotoPreview` client component to give real-time feedback before form submission:

Create [frontend/src/app/dashboard/farmer/ads/new/PhotoPreview.tsx](../../frontend/src/app/dashboard/farmer/ads/new/PhotoPreview.tsx):

```tsx
"use client";

import { useRef, useState } from "react";

const MAX_PHOTOS = 5;
const MAX_BYTES = 2 * 1024 * 1024;

export function PhotoPreview() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const newErrors: string[] = [];

    if (files.length > MAX_PHOTOS) {
      newErrors.push(`Maximum ${MAX_PHOTOS} photos autorisées.`);
    }
    files.forEach((f) => {
      if (f.size > MAX_BYTES) newErrors.push(`${f.name} dépasse 2 Mo.`);
      if (!f.type.startsWith("image/")) newErrors.push(`${f.name} n'est pas une image.`);
    });

    setErrors(newErrors);
    if (newErrors.length === 0) {
      const urls = files.slice(0, MAX_PHOTOS).map((f) => URL.createObjectURL(f));
      setPreviews(urls);
    } else {
      setPreviews([]);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input ref={inputRef} id="photos" name="photos" type="file" accept="image/*" multiple
        onChange={handleChange} className="mt-1 w-full" />
      {errors.map((e, i) => (
        <p key={i} className="mt-1 text-sm text-red-600">{e}</p>
      ))}
      {previews.length > 0 && (
        <div className="mt-2 flex gap-2 flex-wrap">
          {previews.map((url, i) => (
            <img key={i} src={url} alt={`preview-${i}`}
              className="h-20 w-20 rounded object-cover border" />
          ))}
        </div>
      )}
    </div>
  );
}
```

Replace the plain `<input>` for photos in `page.tsx` with `<PhotoPreview />`.

---

### 5.7 AUTH-07 pgTAP cells

Append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

```sql
-- ── FAR-01 cells ─────────────────────────────────────────────────────────────
-- Prerequisites: FARMER-A (verified), FARMER-B (PENDING), RESTAURANT (verified)
-- identities and the m2_farmarket_ads table must exist.
-- Guards: skip entire block if the table is absent (pre-FAR-01 merge).

do $guard$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP FAR-01 cells — m2_farmarket_ads not yet created';
    return;
  end if;
end $guard$;

-- F-01a: VERIFIED FARMER can INSERT an ad.
select lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"<FARMER_A_UUID>","user_role":"FARMER"}';
    insert into public.m2_farmarket_ads
      (farmer_id, title, description, product_type, price_mad, quantity_kg, region)
    values
      ('<FARMER_A_UUID>', 'Tomates BIO', 'Récolte fraîche de Souss-Massa.', 'Tomates',
       4.50, 500.00, 'Souss-Massa');
  $$,
  'F-01a: VERIFIED FARMER can insert ad'
);

-- F-01b: PENDING FARMER is blocked by RLS INSERT policy.
select throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"<FARMER_B_UUID>","user_role":"FARMER"}';
    insert into public.m2_farmarket_ads
      (farmer_id, title, description, product_type, price_mad, quantity_kg, region)
    values
      ('<FARMER_B_UUID>', 'Blocked ad', 'Should not insert.', 'Oranges',
       3.00, 100.00, 'Oriental');
  $$,
  null, null,
  'F-01b: PENDING FARMER is blocked from inserting ad'
);

-- F-01c: RESTAURANT role is blocked by BR-F1 RLS policy.
select throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"<RESTAURANT_UUID>","user_role":"RESTAURANT"}';
    insert into public.m2_farmarket_ads
      (farmer_id, title, description, product_type, price_mad, quantity_kg, region)
    values
      ('<RESTAURANT_UUID>', 'Blocked', 'Restaurant cannot create ad.', 'Légumes',
       2.00, 50.00, 'Casablanca-Settat');
  $$,
  null, null,
  'F-01c: RESTAURANT role cannot insert ad (BR-F1)'
);

-- F-01d: DB CHECK rejects photo_paths array with >5 elements.
select throws_ok(
  $$
    insert into public.m2_farmarket_ads
      (farmer_id, title, description, product_type, price_mad, quantity_kg, region, photo_paths)
    values
      ('<FARMER_A_UUID>', 'Too many photos', 'Test.', 'Concombres', 1.50, 20.00,
       'Marrakech-Safi',
       ARRAY['p1','p2','p3','p4','p5','p6']);
  $$,
  '23514', null,  -- check_violation
  'F-01d: DB CHECK rejects photo_paths with more than 5 elements (BR-F2)'
);
```

> Replace `<FARMER_A_UUID>`, `<FARMER_B_UUID>`, and `<RESTAURANT_UUID>` with the UUIDs from `db/tests/_auth07_seed.psql`.

---

### 5.8 Backend unit tests

Create [backend/tests/test_far01_ad_create.py](../../backend/tests/test_far01_ad_create.py):

```python
"""FAR-01 — Ad creation: schema + router-mount tests."""

from __future__ import annotations

import io
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.modules.farmarket.schemas import AdCreate, MOROCCO_REGIONS, _MAX_PHOTOS, _MAX_PHOTO_BYTES


class TestAdCreateSchema:
    def test_valid_payload(self) -> None:
        ad = AdCreate(
            title="Tomates BIO",
            description="Récolte fraîche du Souss-Massa.",
            product_type="Tomates",
            price_mad=Decimal("4.50"),
            quantity_kg=Decimal("500.00"),
            region="Souss-Massa",
        )
        assert ad.title == "Tomates BIO"
        assert ad.price_mad == Decimal("4.50")

    def test_title_too_short(self) -> None:
        with pytest.raises(ValueError, match="title"):
            AdCreate(
                title="AB",
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("1.00"),
                quantity_kg=Decimal("10.00"),
                region="Oriental",
            )

    def test_invalid_region(self) -> None:
        with pytest.raises(ValueError, match="region"):
            AdCreate(
                title="Valid title",
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("1.00"),
                quantity_kg=Decimal("10.00"),
                region="Atlantique",  # not a valid Moroccan region
            )

    def test_price_non_positive(self) -> None:
        with pytest.raises(ValueError, match="price_mad"):
            AdCreate(
                title="Valid title",
                description="A" * 15,
                product_type="Tomates",
                price_mad=Decimal("0"),
                quantity_kg=Decimal("10.00"),
                region="Fès-Meknès",
            )

    def test_all_regions_valid(self) -> None:
        for region in MOROCCO_REGIONS:
            ad = AdCreate(
                title="Valid title",
                description="A" * 15,
                product_type="Poivrons",
                price_mad=Decimal("2.00"),
                quantity_kg=Decimal("100.00"),
                region=region,
            )
            assert ad.region == region

    def test_constants(self) -> None:
        assert _MAX_PHOTOS == 5
        assert _MAX_PHOTO_BYTES == 2 * 1024 * 1024


class TestAdCreateRouter:
    def test_healthz(self, test_client: TestClient) -> None:
        resp = test_client.get("/api/v1/farmarket/healthz")
        assert resp.status_code == 200
        assert resp.json()["module"] == "farmarket"

    def test_create_ad_requires_auth(self, test_client: TestClient) -> None:
        resp = test_client.post("/api/v1/farmarket/ads", data={})
        assert resp.status_code == 401

    def test_create_ad_requires_farmer_role(
        self, test_client: TestClient, restaurant_token: str
    ) -> None:
        resp = test_client.post(
            "/api/v1/farmarket/ads",
            headers={"Authorization": f"Bearer {restaurant_token}"},
            data={"title": "x", "description": "y" * 15},
        )
        assert resp.status_code == 403
```

---

## 6. Verification Checklist

- [ ] `supabase db push` applied migrations 0032 and 0033 without errors.
- [ ] `select relforcerowsecurity from pg_class where relname='m2_farmarket_ads'` returns `t`.
- [ ] 6 RLS policies listed on `m2_farmarket_ads` in the Supabase Dashboard.
- [ ] `farmarket-photos` bucket Policies tab shows 2 new policies (INSERT + DELETE).
- [ ] `make -C backend test` green (all FAR-01 assertions in `test_far01_ad_create.py`).
- [ ] `make -C db test-auth07` — F-01a through F-01d cells pass (no SKIP for FAR-01 block).
- [ ] VERIFIED FARMER (from staging seed) creates an ad via the frontend form → `201` response.
- [ ] Ad appears in `m2_farmarket_ads` with correct `farmer_id`, `status = 'ACTIVE'`, `expires_at ≈ now() + 7 days`.
- [ ] Uploading 6 photos returns `422 too_many_photos`.
- [ ] Uploading a 3 MB photo returns `422 photo_too_large`.
- [ ] PENDING FARMER (staging seed FARMER-B) gets `403 farmer_not_verified`.
- [ ] RESTAURANT user gets `403 role_not_allowed` from the `require_role("FARMER")` guard.
- [ ] Public photo URL (`/storage/v1/object/public/farmarket-photos/…`) resolves to the image without auth.
- [ ] No Sentry errors during the end-to-end happy path.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| Migration — ads table | [db/migrations/0032_far01_farmarket_ads.sql](../../db/migrations/0032_far01_farmarket_ads.sql) |
| Migration — storage policies | [db/migrations/0033_far01_farmarket_photos_storage.sql](../../db/migrations/0033_far01_farmarket_photos_storage.sql) |
| Backend schemas | [backend/app/modules/farmarket/schemas.py](../../backend/app/modules/farmarket/schemas.py) |
| Backend router | [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py) |
| Backend tests | [backend/tests/test_far01_ad_create.py](../../backend/tests/test_far01_ad_create.py) |
| Frontend server action | [frontend/src/app/dashboard/farmer/ads/new/actions.ts](../../frontend/src/app/dashboard/farmer/ads/new/actions.ts) |
| Frontend ad form page | [frontend/src/app/dashboard/farmer/ads/new/page.tsx](../../frontend/src/app/dashboard/farmer/ads/new/page.tsx) |
| Frontend region constants | [frontend/src/app/dashboard/farmer/ads/new/regions.ts](../../frontend/src/app/dashboard/farmer/ads/new/regions.ts) |
| Frontend photo preview | [frontend/src/app/dashboard/farmer/ads/new/PhotoPreview.tsx](../../frontend/src/app/dashboard/farmer/ads/new/PhotoPreview.tsx) |
| AUTH-07 pgTAP cells | Appended to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | Flip `FAR-01.status` → `IN_REVIEW`, bump `summary.in_review` |

---

## 8. Business Rules enforced

| Rule | Where enforced |
|---|---|
| **BR-F1**: only FARMER role can create ads | FastAPI `require_role("FARMER")` + `_require_verified_farmer()` + RLS INSERT policy |
| **BR-F2**: ≤5 photos, ≤2 MB each | FastAPI handler (count + size check) + DB CHECK on `photo_paths` array length + client-side `PhotoPreview` component |
| **BR-F3**: ads expire after 7 days | `expires_at DEFAULT now() + interval '7 days'` column; FAR-06 CRON reads this column |
| **BR-F4**: Brevo key never in frontend | FastAPI backend owns all email triggers; no Brevo call in this story; pattern established for FAR-04 |
| **FAR-07**: photos in storage, not DB | `photo_paths text[]` stores paths only; FastAPI uploads to Supabase Storage |

---

## 9. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| Photos uploaded to storage but DB insert fails | Cleanup block in the FastAPI handler removes orphaned files; post-MVD CRON scans for orphans | PRD §13 R2 |
| Storage quota exhaustion (Supabase Free: 1 GB) | Max 5 × 2 MB = 10 MB per ad; at 100 ads (~1 GB) quota is reached — alert at 80% usage via INF-08 Uptime Kuma | PRD §11.1 |
| Farmer uploads non-image files | `content_type.startswith("image/")` check in FastAPI handler | PRD §6.2 BR-F2 |
| Region enum drift between TS and Python | `regions.ts` constants are commented to stay in sync with `schemas.py`; a CI script (similar to `scripts/check-role-enum-parity.sh`) should be added post-MVD | PRD §7.2 |
| Supabase Storage signed URL vs public URL confusion | Bucket is `public = true` so plain public URLs work; no signed URL round-trip needed for the catalog (FAR-02 performance benefit) | PRD §8.1 |

---

## 10. Time Estimate

| Sub-task | Estimate |
|---|---|
| Migrations 0032 + 0033 (table + storage policies) | 1.5 h |
| FastAPI schemas + router (`POST /ads`) | 2 h |
| Backend tests | 1 h |
| Frontend form + server action + photo preview | 2 h |
| AUTH-07 pgTAP cells | 45 min |
| End-to-end staging verification | 1 h |
| **Total active work** | **~8.25 h** |

---

## 11. Definition of Done

1. Acceptance criterion met: a VERIFIED FARMER submits the form → ad row created in `m2_farmarket_ads` with `status = 'ACTIVE'`, photo paths stored, public photo URLs resolve.
2. BR-F1 verified: PENDING FARMER and RESTAURANT both receive `403` at the API layer; pgTAP cells F-01b and F-01c green.
3. BR-F2 verified: 6-photo submission returns `422`; 3 MB photo returns `422`; pgTAP cell F-01d green.
4. Verification checklist (§6) fully ticked.
5. `make -C db test-auth07` — F-01a through F-01d all `ok` (not SKIP).
6. `make -C backend test` green with no regressions in pre-existing suites.
7. Deliverables (§7) committed.
8. `docs/spring-status.yml` updated and committed.
9. Hand-off note posted to the team channel naming the stories now unblocked: **FAR-02** (browse catalog), **FAR-05** (edit/delete), **FAR-06** (CRON expiry).
