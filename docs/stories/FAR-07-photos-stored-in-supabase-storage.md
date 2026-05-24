# FAR-07 — Photos stored in Supabase Storage (not DB)

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** System
> **Depends on:** [FAR-01](./FAR-01-farmer-creates-ad.md) (bucket + `photo_paths text[]` column + RLS policies in migrations 0032/0033 + router upload logic already implemented), [INF-02](./INF-02-supabase-project-base-schema.md) (`farmarket-photos` bucket created in migration 0004)
> **Unblocks:** [FAR-08](./FAR-08-admin-views-ads-leads.md) (admin view renders photo URLs from storage paths), [AUTH-07](./AUTH-07-rls-audit-business-rule-test-suite.md) (BR-F2 pgTAP row currently `SKIP` — activates once FAR-07 pgTAP cells land)
> **Acceptance:** `photo_paths` in `m2_farmarket_ads` is `text[]` (never `bytea`); the DB CHECK constraint caps photos at ≤ 5; the backend enforces 2 MB / image/* per file; public URLs are served without an auth round-trip; `test_far07_photo_storage.py` is green; pgTAP cell F-07a passes.

---

## 1. Purpose

FAR-07 is the **architectural constraint** that forbids storing photo binary data in the database. Instead, photos live in the `farmarket-photos` Supabase Storage bucket and only their object paths are recorded in the `photo_paths text[]` column of `m2_farmarket_ads`.

This constraint was implemented across FAR-01 and INF-02, but no dedicated verification test suite existed. FAR-07's job is to:

1. **Document** the full storage architecture in one place.
2. **Pin the constraint** with backend unit tests and a pgTAP cell so a future developer cannot accidentally add a `bytea` column or bypass the path convention without breaking CI.
3. **Confirm public URL delivery** works without an auth round-trip (the bucket is `public = true`).

**Why photos must not be in the DB:**

- Supabase Free Tier cap: **500 MB DB, 1 GB storage**. A `bytea` column would hit the DB cap after ~250 photos; the storage bucket handles gigabytes.
- CDN delivery: Supabase Storage's public URL is CDN-cached. A `bytea` column would route every image request through the PostgREST API, serialising as base64 — at least 33% larger and not cacheable.
- Security: the Storage INSERT RLS policy (migration 0033) enforces the `{farmer_id}/{ad_id}/{filename}` prefix so cross-farmer overwrites are structurally impossible at the DB layer.

**Current state (what FAR-01 already shipped):**

| Layer | Artifact | What it delivers |
|---|---|---|
| DB migration 0004 | `0004_storage_buckets.sql` | `farmarket-photos` bucket, `public = true` |
| DB migration 0032 | `0032_far01_farmarket_ads.sql` | `photo_paths text[]`, `CHECK (array_length ≤ 5)` |
| DB migration 0033 | `0033_far01_farmarket_photos_storage.sql` | Storage RLS: VERIFIED FARMER INSERT to own prefix; owner DELETE |
| Backend | `backend/app/modules/farmarket/router.py` | Upload via user-scoped client; `_storage_public_url()` helper; BR-F2 enforcement |
| Backend | `backend/app/modules/farmarket/schemas.py` | `MAX_PHOTOS = 5`, `MAX_PHOTO_BYTES = 2 MB`, `AdOut.photo_urls` computed field |
| Frontend | `frontend/src/app/dashboard/farmer/ads/new/new-ad-form.tsx` | Client-side count + size + MIME validation before submit |

**What FAR-07 delivers on top:**

- `backend/tests/test_far07_photo_storage.py` — verification test suite pinning every layer.
- pgTAP cell `F-07a` appended to `db/tests/auth07_business_rules.sql`.
- `docs/spring-status.yml` update: `FAR-07.status → IN_REVIEW`.

---

## 2. Scope

### In scope

- Backend unit tests asserting: `photo_paths` is `text[]`, photo count limit, photo size limit, MIME type gate, storage path convention `{farmer_id}/{ad_id}/{filename}`, public URL format, and AUTH-05 boundary (no `SUPABASE_SERVICE_ROLE_KEY` used on the upload path).
- pgTAP cell asserting the `photo_paths` column type and the DB CHECK constraint.
- Spring-status update.

### Out of scope

- Any new code in the router, migrations, or frontend — all storage logic is already shipped.
- Signed (private) URL generation — the bucket is `public = true`; no signed URLs are used. If the bucket is later made private, a separate story handles the switch.
- Image resizing, thumbnails, or CDN-level caching configuration — post-MVD.
- Orphan cleanup CRON (a nightly scan for `storage.objects` with no matching `photo_paths` reference) — post-MVD.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [FAR-01](./FAR-01-farmer-creates-ad.md) `DONE` | `m2_farmarket_ads` table, `photo_paths text[]` column, CHECK constraint, and the `farmarket-photos` Storage RLS policies (migration 0033) must exist in the live DB. Verify: `\d public.m2_farmarket_ads` shows `photo_paths text[]`. |
| [INF-02](./INF-02-supabase-project-base-schema.md) `DONE` | `farmarket-photos` bucket row in `storage.buckets` (`public = true`). Verify: `select name, public from storage.buckets where id = 'farmarket-photos'` returns one row with `public = t`. |
| Migration `0033` applied | `select count(*) from pg_policies where tablename = 'objects' and policyname = 'farmarket_photos_insert_verified_farmer'` returns `1`. |

---

## 4. Architecture Overview

```
FARMER Browser
     │
     │  multipart/form-data  (text fields + image files)
     ▼
Next.js Server Action (frontend/src/app/dashboard/farmer/ads/actions.ts)
     │
     │  POST /api/v1/farmarket/ads  multipart/form-data
     ▼
FastAPI router  (backend/app/modules/farmarket/router.py)
     │
     ├─ 1. AdCreate Pydantic validation (text fields)
     ├─ 2. BR-F2 count check: len(real_photos) ≤ 5
     ├─ 3. Pre-read all files: size ≤ 2 MB, content_type starts with "image/"
     ├─ 4. ad_id = uuid4()  ← generated BEFORE upload so path embeds it
     │
     ├─ 5. Storage upload (user-scoped client — bearer JWT forwarded)
     │        path: {farmer_id}/{ad_id}/{safe_filename}
     │        bucket: farmarket-photos
     │        Storage RLS INSERT policy fires: VERIFIED FARMER + own prefix only
     │
     ├─ 6. DB INSERT m2_farmarket_ads (photo_paths = [path1, path2, ...])
     │        RLS INSERT policy fires: VERIFIED FARMER + auth.uid() = farmer_id
     │
     └─ 7. Return AdOut
              photo_paths: ["uuid/uuid/file.jpg", ...]        ← stored paths
              photo_urls:  ["https://.../storage/v1/object/public/farmarket-photos/..."]
                                                              ← computed by router

RESTAURANT Browser (FAR-02 catalog)
     │
     │  GET /api/v1/farmarket/catalog
     ▼
FastAPI router returns AdOut with photo_urls
     │
     │  Browser fetches each photo_url
     ▼
Supabase Storage CDN  ← public bucket, no auth required for GET
```

**Key invariants:**

| Invariant | Enforced by |
|---|---|
| Binary data never in DB | `photo_paths text[]` schema; no `bytea` column exists |
| ≤ 5 photos per ad | DB `CHECK (array_length(photo_paths,1) is null OR array_length(photo_paths,1) <= 5)` + FastAPI `len(real_photos) > MAX_PHOTOS → 422` + frontend count guard |
| ≤ 2 MB per photo | FastAPI `len(content) > MAX_PHOTO_BYTES → 422` + frontend size guard |
| Image MIME only | FastAPI `not ct.startswith("image/") → 422` + frontend `accept="image/*"` |
| Path prefix = uploader's UUID | Storage RLS INSERT policy: `(storage.foldername(name))[1] = auth.uid()::text` |
| Public URL served without auth | `farmarket-photos` bucket `public = true`; `_storage_public_url()` uses the `/object/public/` endpoint |
| No service-role key on upload path | `db.storage` uses the user-scoped client (bearer JWT); `service_client()` is not called in `farmarket/router.py` — AUTH-05 compliant |

---

## 5. Data Model Changes

No new migration is required. All artefacts were shipped in earlier migrations:

```sql
-- migration 0004 — bucket bootstrap
insert into storage.buckets (id, name, public)
values ('farmarket-photos', 'farmarket-photos', true)
on conflict (id) do nothing;

-- migration 0032 — photo_paths column + CHECK (FAR-07 constraint)
photo_paths  text[]  NOT NULL DEFAULT '{}'
    CONSTRAINT m2_farmarket_ads_max_photos
        CHECK (
            array_length(photo_paths, 1) IS NULL
            OR array_length(photo_paths, 1) <= 5
        ),

-- migration 0033 — Storage RLS policies
-- INSERT: VERIFIED FARMER may upload to own prefix
-- DELETE: owner may remove own photos
-- UPDATE: not granted (delete + re-upload)
-- SELECT: not needed (bucket is public)
```

---

## 6. Step-by-Step Implementation

### 6.1 Backend verification test suite

Create [backend/tests/test_far07_photo_storage.py](../../backend/tests/test_far07_photo_storage.py):

```python
"""FAR-07 — Photo storage constraint verification.

These tests pin every enforcement layer of the "photos stored in Storage, not DB"
architectural constraint (PRD §6.2.1 FAR-07, BR-F2).

Layer coverage
--------------
* Schema layer  — AdOut.photo_urls is computed, not persisted; photo_paths is text[].
* Router layer  — count, size, MIME gate; storage path convention; public URL format.
* AUTH-05 layer — no service_client() call in the farmarket router module.
"""
from __future__ import annotations

import ast
import io
import time
import uuid
from decimal import Decimal
from pathlib import Path

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.modules.farmarket.schemas import (
    MAX_PHOTO_BYTES,
    MAX_PHOTOS,
    AdOut,
)

_ALG = "HS256"
_AUD = "authenticated"
_BUCKET = "farmarket-photos"
_ROUTER_PATH = Path(__file__).parent.parent / "app" / "modules" / "farmarket" / "router.py"


def _secret() -> str:
    return get_settings().supabase_jwt_secret.get_secret_value()


def _make_token(
    *,
    role: str = "FARMER",
    verification_status: str = "VERIFIED",
    sub: str | None = None,
) -> str:
    now = int(time.time())
    return pyjwt.encode(
        {
            "iat": now,
            "exp": now + 3600,
            "aud": _AUD,
            "sub": sub or str(uuid.uuid4()),
            "email": "farmer@test.local",
            "user_role": role,
            "verification_status": verification_status,
        },
        _secret(),
        algorithm=_ALG,
    )


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Schema layer
# ---------------------------------------------------------------------------

class TestSchemaLayer:
    def test_photo_paths_is_list_of_strings(self) -> None:
        """AdOut.photo_paths must be list[str] — not bytes, not list[bytes]."""
        annotation = AdOut.model_fields["photo_paths"].annotation
        assert annotation == list[str], (
            f"photo_paths annotation is {annotation!r} — must be list[str] (FAR-07)"
        )

    def test_photo_urls_not_a_db_field(self) -> None:
        """photo_urls is a computed field — it must not be stored in the DB."""
        # AdOut has photo_urls as a plain field populated by the router, not the DB.
        # If someone adds it to the DB insert dict, this test should catch it via
        # confirming the router never persists it.
        router_src = _ROUTER_PATH.read_text()
        assert '"photo_urls"' not in router_src, (
            "photo_urls must not appear as a DB key in router inserts (FAR-07)"
        )

    def test_max_photos_constant(self) -> None:
        assert MAX_PHOTOS == 5, "BR-F2: MAX_PHOTOS must be 5"

    def test_max_photo_bytes_constant(self) -> None:
        assert MAX_PHOTO_BYTES == 2 * 1024 * 1024, "BR-F2: MAX_PHOTO_BYTES must be 2 MB"


# ---------------------------------------------------------------------------
# Public URL format
# ---------------------------------------------------------------------------

class TestPublicUrlFormat:
    def test_storage_public_url_contains_bucket_and_path(self) -> None:
        """_storage_public_url must build a /object/public/ URL — no signed URL."""
        from app.modules.farmarket.router import _storage_public_url

        farmer_id = uuid.uuid4()
        ad_id = uuid.uuid4()
        path = f"{farmer_id}/{ad_id}/tomatoes.jpg"

        url = _storage_public_url(path)

        assert "/object/public/" in url, (
            f"URL {url!r} is not a public storage URL — check _storage_public_url (FAR-07)"
        )
        assert _BUCKET in url, f"URL {url!r} does not reference the '{_BUCKET}' bucket"
        assert str(farmer_id) in url
        assert str(ad_id) in url
        assert "tomatoes.jpg" in url

    def test_storage_public_url_no_signed_token(self) -> None:
        """Public bucket must not use signed URLs (token= param)."""
        from app.modules.farmarket.router import _storage_public_url

        url = _storage_public_url("a/b/c.jpg")
        assert "token=" not in url, (
            "Public bucket must not produce signed URLs — remove token= param (FAR-07)"
        )


# ---------------------------------------------------------------------------
# Router auth contract — photo validation gates (no DB / Storage calls needed)
# ---------------------------------------------------------------------------

class TestRouterPhotoGates:
    """
    These tests mount the FastAPI app and hit POST /farmarket/ads with:
    - too many photos  → 422
    - photo too large  → 422
    - wrong MIME type  → 422

    DB and Storage writes are mocked out because the test focuses on the
    *validation* layer, not the storage integration.
    """

    @pytest.fixture()
    def verified_farmer_token(self) -> str:
        return _make_token(role="FARMER", verification_status="VERIFIED")

    @pytest.mark.asyncio
    async def test_too_many_photos_returns_422(
        self, verified_farmer_token: str
    ) -> None:
        from unittest.mock import AsyncMock, patch

        from app.main import create_app

        app = create_app()
        base_fields = {
            "title": "Tomates FAR-07",
            "description": "Description longue pour satisfaire la validation Pydantic.",
            "product_type": "Tomates",
            "price_mad": "4.50",
            "quantity_kg": "100",
            "region": "Souss-Massa",
        }

        # Build MAX_PHOTOS + 1 tiny fake images
        files = [
            ("photos", (f"img{i}.jpg", b"\xff\xd8\xff" + b"x" * 10, "image/jpeg"))
            for i in range(MAX_PHOTOS + 1)
        ]

        with patch(
            "app.modules.farmarket.router.get_db_for_user",
            return_value=AsyncMock(),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/farmarket/ads",
                    headers=_auth(verified_farmer_token),
                    data=base_fields,
                    files=files,
                )

        assert resp.status_code == 422, (
            f"Expected 422 for {MAX_PHOTOS + 1} photos, got {resp.status_code}"
        )
        assert "too_many_photos" in resp.text

    @pytest.mark.asyncio
    async def test_photo_over_2mb_returns_422(
        self, verified_farmer_token: str
    ) -> None:
        from unittest.mock import AsyncMock, patch

        from app.main import create_app

        app = create_app()
        base_fields = {
            "title": "Tomates FAR-07 size",
            "description": "Description longue pour satisfaire la validation Pydantic.",
            "product_type": "Tomates",
            "price_mad": "4.50",
            "quantity_kg": "100",
            "region": "Souss-Massa",
        }
        oversized = b"\xff\xd8\xff" + b"x" * (MAX_PHOTO_BYTES + 1)

        with patch(
            "app.modules.farmarket.router.get_db_for_user",
            return_value=AsyncMock(),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/farmarket/ads",
                    headers=_auth(verified_farmer_token),
                    data=base_fields,
                    files=[("photos", ("big.jpg", oversized, "image/jpeg"))],
                )

        assert resp.status_code == 422, (
            f"Expected 422 for oversized photo, got {resp.status_code}"
        )
        assert "photo_too_large" in resp.text

    @pytest.mark.asyncio
    async def test_non_image_mime_returns_422(
        self, verified_farmer_token: str
    ) -> None:
        from unittest.mock import AsyncMock, patch

        from app.main import create_app

        app = create_app()
        base_fields = {
            "title": "Tomates FAR-07 mime",
            "description": "Description longue pour satisfaire la validation Pydantic.",
            "product_type": "Tomates",
            "price_mad": "4.50",
            "quantity_kg": "100",
            "region": "Souss-Massa",
        }

        with patch(
            "app.modules.farmarket.router.get_db_for_user",
            return_value=AsyncMock(),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/farmarket/ads",
                    headers=_auth(verified_farmer_token),
                    data=base_fields,
                    files=[("photos", ("malware.exe", b"MZ\x90\x00", "application/octet-stream"))],
                )

        assert resp.status_code == 422, (
            f"Expected 422 for non-image MIME, got {resp.status_code}"
        )
        assert "invalid_photo_type" in resp.text


# ---------------------------------------------------------------------------
# Storage path convention (AST-level, no network)
# ---------------------------------------------------------------------------

class TestStoragePathConvention:
    def test_path_includes_farmer_id_and_ad_id(self) -> None:
        """The path must embed {user.id}/{ad_id}/filename — cross-farmer isolation.

        The Storage RLS policy (migration 0033) asserts
        ``(storage.foldername(name))[1] = auth.uid()::text``.
        This test pins that the router builds the path in the matching order.
        """
        router_src = _ROUTER_PATH.read_text()
        # The router contains: storage_path = f"{user.id}/{ad_id}/{safe_name}"
        assert "user.id" in router_src and "ad_id" in router_src
        # Confirm the order: user.id is the FIRST path segment
        line = next(
            (ln for ln in router_src.splitlines() if "storage_path" in ln and "user.id" in ln),
            None,
        )
        assert line is not None, "Could not find storage_path assignment in router (FAR-07)"
        # user.id must appear before ad_id in the f-string
        assert line.index("user.id") < line.index("ad_id"), (
            "Storage path must be {user.id}/{ad_id}/... — user.id must be the first segment"
        )


# ---------------------------------------------------------------------------
# AUTH-05 boundary — no service_client() on the upload path
# ---------------------------------------------------------------------------

class TestAuth05Boundary:
    def test_farmarket_router_does_not_call_service_client(self) -> None:
        """The farmarket router must not call service_client() on any path.

        Photos are uploaded via the user-scoped Supabase client (bearer JWT
        forwarded).  The service-role key must never be used in this module.
        AUTH-05 allow-list does not include modules/farmarket/.
        """
        router_src = _ROUTER_PATH.read_text()
        assert "service_client" not in router_src, (
            "farmarket/router.py calls service_client() — AUTH-05 violation (FAR-07). "
            "Photo uploads must use the user-scoped client (get_db_for_user)."
        )

    def test_no_service_role_key_in_router_module(self) -> None:
        """No direct reference to SUPABASE_SERVICE_ROLE_KEY in the farmarket module."""
        schemas_path = _ROUTER_PATH.parent / "schemas.py"
        for path in (_ROUTER_PATH, schemas_path):
            src = path.read_text()
            assert "SERVICE_ROLE_KEY" not in src, (
                f"{path.name} references SERVICE_ROLE_KEY — AUTH-05 violation (FAR-07)"
            )
```

---

### 6.2 pgTAP cell — AUTH-07 assertion

Append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

```sql
-- ── FAR-07 cells ─────────────────────────────────────────────────────────────
-- Prerequisite: m2_farmarket_ads must exist (FAR-01 merged).

do $guard_f07$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP FAR-07 cells — m2_farmarket_ads not yet created';
    return;
  end if;
end $guard_f07$;

-- F-07a: photo_paths column is text[] (not bytea, not json).
-- This pins the core FAR-07 constraint: binary data must never be in the DB.
select is(
  (
    select data_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'm2_farmarket_ads'
       and column_name  = 'photo_paths'
  ),
  'ARRAY',
  'F-07a: photo_paths column exists and is an ARRAY type (not bytea or json)'
);

select is(
  (
    select udt_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'm2_farmarket_ads'
       and column_name  = 'photo_paths'
  ),
  '_text',
  'F-07a: photo_paths element type is text (udt_name = _text)'
);

-- F-07b: DB CHECK constraint caps photos at 5 (BR-F2).
select isnt(
  (
    select constraint_name
      from information_schema.table_constraints
     where table_schema    = 'public'
       and table_name      = 'm2_farmarket_ads'
       and constraint_type = 'CHECK'
       and constraint_name ilike '%max_photos%'
  ),
  null,
  'F-07b: m2_farmarket_ads_max_photos CHECK constraint exists (BR-F2 ≤5 photos)'
);

-- F-07c: farmarket-photos bucket exists and is public.
select is(
  (
    select public
      from storage.buckets
     where id = 'farmarket-photos'
  ),
  true,
  'F-07c: farmarket-photos Storage bucket exists and is public=true'
);

-- F-07d: Storage INSERT RLS policy for VERIFIED FARMER exists on storage.objects.
select isnt(
  (
    select policyname
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and policyname = 'farmarket_photos_insert_verified_farmer'
  ),
  null,
  'F-07d: farmarket_photos_insert_verified_farmer INSERT policy exists on storage.objects'
);
```

---

## 7. Verification Checklist

- [ ] `make -C backend test` green — all FAR-07 assertions in `test_far07_photo_storage.py` pass.
- [ ] `make -C db test-auth07` — F-07a, F-07b, F-07c, F-07d all `ok` (not `SKIP`).
- [ ] **Schema check**: `\d public.m2_farmarket_ads` on the live Supabase project shows `photo_paths text[]` (not `bytea`, not `jsonb`).
- [ ] **Bucket check**: `select id, name, public from storage.buckets where id='farmarket-photos'` returns one row with `public = t`.
- [ ] **RLS check**: `select policyname from pg_policies where tablename='objects' and policyname ilike 'farmarket%'` shows both `farmarket_photos_insert_verified_farmer` and `farmarket_photos_delete_own`.
- [ ] **Public URL smoke** (staging): Upload one test photo via `POST /api/v1/farmarket/ads` as a VERIFIED FARMER. Fetch the returned `photo_urls[0]` with `curl -I` (no `Authorization` header). Response must be `200 OK` with `Content-Type: image/*`.
- [ ] **AUTH-05 boundary**: `bash scripts/check-secrets-boundary.sh` exits 0 — no `SUPABASE_SERVICE_ROLE_KEY` reference in `backend/app/modules/farmarket/`.
- [ ] **Frontend validation**: Open `/dashboard/farmer/ads/new` in a browser. Attempt to add 6 photos — confirm the count error appears in the UI before submit. Attempt a 3 MB file — confirm the size error appears.
- [ ] **Cross-farmer isolation** (manual): As FARMER-B, attempt to upload a photo to a path starting with `FARMER-A's UUID`. Supabase Storage returns a `403 Forbidden` (the `(storage.foldername(name))[1] = auth.uid()::text` RLS check blocks it).

---

## 8. Deliverables

| Artifact | Location |
|---|---|
| Backend verification tests | New file [backend/tests/test_far07_photo_storage.py](../../backend/tests/test_far07_photo_storage.py) |
| AUTH-07 pgTAP cells (F-07a–d) | Appended to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | Flip `FAR-07.status → IN_REVIEW`, bump `summary.in_review` |

> **Note — no new application code.** All storage logic (bucket, migrations, RLS policies, router upload, public URL helper, frontend validation) was shipped as part of FAR-01. FAR-07 delivers only the verification test suite and pgTAP cells that pin the constraint in CI.

---

## 9. Business Rules Enforced

| Rule | Layer | How it is enforced |
|---|---|---|
| **BR-F2**: ≤ 5 photos per ad | DB | `CHECK (array_length(photo_paths,1) IS NULL OR array_length(photo_paths,1) <= 5)` in migration 0032 |
| **BR-F2**: ≤ 5 photos per ad | Backend | `len(real_photos) > MAX_PHOTOS → 422` in `router.create_ad()` and `router.update_ad()` |
| **BR-F2**: ≤ 5 photos per ad | Frontend | Client-side count check in `new-ad-form.tsx` `handleFiles()` |
| **BR-F2**: ≤ 2 MB per photo | Backend | `len(content) > MAX_PHOTO_BYTES → 422` in `router.create_ad()` and `router.update_ad()` |
| **BR-F2**: ≤ 2 MB per photo | Frontend | `file.size > MAX_PHOTO_BYTES → error` in `handleFiles()` |
| **FAR-07**: Binary data not in DB | DB schema | `photo_paths text[]` — no `bytea` or `json` column; the DB `CHECK` only counts array elements |
| **FAR-07**: Photos in Supabase Storage | Backend | `db.storage.from_("farmarket-photos").upload(path, ...)` in the router |
| **FAR-07**: Public URL without auth | Backend | `_storage_public_url()` returns `/object/public/farmarket-photos/{path}` — no signed token |
| **FAR-07**: Cross-farmer path isolation | Storage RLS | `(storage.foldername(name))[1] = auth.uid()::text` in `farmarket_photos_insert_verified_farmer` policy (migration 0033) |
| **AUTH-05**: No service-role on upload path | Backend | `get_db_for_user` (user-scoped client) is used — `service_client()` is absent from `farmarket/router.py` |

---

## 10. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| Future dev adds `bytea` column "for convenience" | pgTAP F-07a asserts `photo_paths` is `text[]`; CI fails if a migration adds `bytea`. | PRD §6.2.1 FAR-07 |
| Orphaned storage objects after a failed DB insert | The router has a best-effort `storage.remove()` cleanup block in the `except` path. A post-MVD nightly CRON will scan for orphans. Orphans are storage waste, not data loss. | PRD §13 R3 |
| Supabase Storage `1 GB` free-tier cap exceeded | `MAX_PHOTO_BYTES = 2 MB × 5 photos × N ads`. At 1,000 active ads: `10 GB` — exceeds free tier. Mitigation: image resizing post-MVD; or upgrade storage to Pro ($25/month). For MVD with ~50 ads: `250 MB` — comfortably within cap. | PRD §11.1 |
| Public bucket leaks farmer photos to unauthenticated crawlers | By design for MVD: the catalog (FAR-02) is intended to be browsable. If confidential photos are needed, switch the bucket to private and generate signed URLs in `_storage_public_url()`. | PRD §8.3 |
| Cross-farmer path overwrite (FARMER-B writes to FARMER-A prefix) | Structurally prevented by the Storage RLS INSERT policy: `(storage.foldername(name))[1] = auth.uid()::text`. Even if the backend were compromised, the DB-layer policy blocks it. | PRD §8.3 |

---

## 11. Time Estimate

| Sub-task | Estimate |
|---|---|
| `test_far07_photo_storage.py` — schema + URL + auth-contract tests | 1 h |
| `TestAuth05Boundary` assertions | 20 min |
| pgTAP cells F-07a–d in `auth07_business_rules.sql` | 20 min |
| Local smoke: upload via staging, verify public URL | 20 min |
| Manual cross-farmer isolation test | 15 min |
| `spring-status.yml` update | 5 min |
| **Total active work** | **~2.5 h** |

---

## 12. Definition of Done

1. Acceptance criterion met: `m2_farmarket_ads.photo_paths` is `text[]`; public CDN URLs served without auth; DB CHECK caps at 5 photos.
2. `make -C backend test` green — all FAR-07 assertions pass, no regressions in FAR-01/02/03/04/05/06 tests.
3. `make -C db test-auth07` — F-07a, F-07b, F-07c, F-07d all `ok` (not `SKIP`).
4. `bash scripts/check-secrets-boundary.sh` exits 0.
5. Public URL smoke against staging: `curl -I <photo_url>` returns `200 OK` with no `Authorization` header.
6. Manual cross-farmer isolation confirmed (Storage RLS blocks FARMER-B writing to FARMER-A prefix).
7. Frontend validation confirmed in browser (count + size error messages appear before submit).
8. Verification checklist (§7) fully ticked.
9. Deliverables (§8) committed.
10. `docs/spring-status.yml` updated: `FAR-07.status → IN_REVIEW`, `summary.in_review` incremented.
11. Hand-off note posted — **FAR-08** (admin photo rendering via public URLs) and **AUTH-07** BR-F2 pgTAP row (F-07b) are now unblocked.
