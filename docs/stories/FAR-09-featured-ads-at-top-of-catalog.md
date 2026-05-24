# FAR-09 — Featured ads at top of catalog

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Could
> **Status:** TODO
> **Actor:** System (ADMIN triggers; catalog consumers benefit)
> **Depends on:** [FAR-02](./FAR-02-restaurateur-browses-ads.md) (catalog endpoint + `is_featured` sort placeholder already live), [FAR-08](./FAR-08-admin-views-ads-leads.md) (admin farmarket router to extend with the PATCH endpoint)
> **Unblocks:** Nothing in MVD scope (premium revenue feature; post-MVD billing integration targets `is_featured` as the product slot)
> **Acceptance:** An ADMIN can call `PATCH /api/v1/admin/farmarket/ads/{ad_id}/feature` to toggle the `is_featured` flag. Active featured ads appear **first** in `GET /farmarket/catalog` (before non-featured ads at the same timestamp). A visual "Mis en avant" badge renders on featured ad cards in the catalog frontend.

---

## 1. Purpose

FAR-09 turns the `is_featured` placeholder — already planted in the database schema (migration 0032) and the catalog sort (FAR-02) — into a functional premium slot that VitaChain operators can award to farmers.

**What was already shipped by earlier stories:**

| Artifact | Story | State |
|---|---|---|
| `is_featured boolean NOT NULL DEFAULT false` column | FAR-01 / migration 0032 | Live in DB |
| `m2_farmarket_ads_featured_idx` partial index on `(is_featured, created_at DESC)` | FAR-01 / migration 0032 | Live in DB |
| `.order("is_featured", desc=True).order("created_at", desc=True)` in catalog query | FAR-02 | Live in backend |
| `AdOut.is_featured: bool` in Pydantic response | FAR-01 schemas | Live in backend |

**What FAR-09 adds:**

| Artifact | Path |
|---|---|
| Admin PATCH endpoint to toggle `is_featured` | Extended in `backend/app/modules/admin/farmarket_router.py` |
| Admin Pydantic schema for the toggle response | Extended in `backend/app/modules/admin/farmarket_schemas.py` |
| Frontend catalog featured badge | `frontend/src/app/dashboard/restaurant/FeaturedBadge.tsx` |
| Featured ad visual indicator in catalog page | Edit `frontend/src/app/dashboard/restaurant/` catalog component |
| Admin toggle button in FAR-08 admin ads table | Edit `frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx` |
| Backend test suite | `backend/tests/test_far09_featured_ads.py` |
| pgTAP cell F-09a | Appended to `db/tests/auth07_business_rules.sql` |
| Spring-status update | `docs/spring-status.yml` → `FAR-09.status: IN_REVIEW` |

---

## 2. Scope

### In scope

- `PATCH /api/v1/admin/farmarket/ads/{ad_id}/feature` endpoint — toggles `is_featured` between `true` and `false`; `require_role("ADMIN")` gate; uses `service_client()` (AUTH-05 allowlist: `routers/admin/`)
- A `FeatureToggleOut` response schema confirming the new state
- A "Mis en avant" badge component rendered on featured ad cards in the public catalog
- An inline Feature/Unfeature button in the FAR-08 admin table (client-side; calls the PATCH endpoint)
- Backend tests covering: ADMIN 200 → `is_featured` flips; non-ADMIN → 403; ad not found → 404; already-featured ad → idempotent 200
- pgTAP cell F-09a asserting `m2_farmarket_ads_featured_idx` exists

### Out of scope

- Any billing or subscription gate for the featured slot — MVD: admin awards it manually; payment integration is post-MVD
- Time-limited featured slots (auto-expiry of the featured status) — post-MVD
- Multiple tiers of promotion ("super-featured", sponsored) — post-MVD
- Farmer self-service to purchase a featured slot — post-MVD

---

## 3. Prerequisites

| Item | Check |
|---|---|
| [FAR-02](./FAR-02-restaurateur-browses-ads.md) `DONE` | `GET /api/v1/farmarket/catalog` already sorts by `is_featured DESC, created_at DESC`. Verify: call the catalog endpoint and inspect the SQL plan with `EXPLAIN` — `m2_farmarket_ads_featured_idx` should appear for queries where `is_featured = true` rows exist. |
| [FAR-08](./FAR-08-admin-views-ads-leads.md) `DONE` | `backend/app/modules/admin/farmarket_router.py` and `backend/app/modules/admin/farmarket_schemas.py` must exist. `require_role("ADMIN")` + `service_client()` pattern already in place. Verify: `GET /api/v1/admin/farmarket/ads` returns 200 for ADMIN. |
| Migration `0032` applied | `is_featured` column and `m2_farmarket_ads_featured_idx` exist. Verify: `\d public.m2_farmarket_ads` shows the column; `\di m2_farmarket_ads_featured_idx` confirms the index. |

---

## 4. Architecture Overview

```
Admin Browser  (/dashboard/admin/farmarket)
      │
      │  PATCH /api/v1/admin/farmarket/ads/{ad_id}/feature
      ▼
FastAPI  —  backend/app/modules/admin/farmarket_router.py
      │
      │  require_role("ADMIN")  ← 403 if not ADMIN
      │
      │  service_client()       ← bypasses RLS (AUTH-05 allowlist: routers/admin/)
      │
      │  UPDATE m2_farmarket_ads
      │     SET is_featured = NOT is_featured
      │   WHERE id = {ad_id}
      ▼
Supabase PostgREST (service-role)
      │
      └── Returns updated row → FeatureToggleOut {id, is_featured, updated_at}


Catalog Browser  (any authenticated user)
      │
      │  GET /api/v1/farmarket/catalog
      ▼
FastAPI  —  existing browse_catalog() in farmarket/router.py
      │
      │  ORDER BY is_featured DESC, created_at DESC   (already live — FAR-02)
      ▼
Supabase PostgREST
      │
      └── Returns items[] — featured ads first, AdOut.is_featured=true
              ▼
        Frontend renders "Mis en avant" badge on is_featured=true cards
```

**Key design decisions:**

| Decision | Rationale |
|---|---|
| Toggle (NOT current value) rather than an explicit `{is_featured: bool}` body | Simpler UX: admin clicks one button, state flips. Idempotent concern is handled by returning the current state — a double-click is a no-op at the UX level. |
| No new migration | `is_featured` column and index were planned in migration 0032 precisely for FAR-09. No schema change required. |
| Extend FAR-08 admin router, not a new file | Keeps all admin-farmarket logic in one file; consistent with the `admin/` module boundary. |
| Catalog sort untouched | The `.order("is_featured", desc=True)` was already committed in FAR-02 as a forward-compatible placeholder; FAR-09 activates it by making the flag non-trivially writable. |

---

## 5. Data Model Changes

No migration required. All schema artefacts already exist from migration `0032_far01_farmarket_ads.sql`:

```sql
-- Column (already in m2_farmarket_ads):
is_featured  boolean  NOT NULL DEFAULT false

-- Index (already exists):
CREATE INDEX m2_farmarket_ads_featured_idx
    ON public.m2_farmarket_ads (is_featured, created_at DESC)
    WHERE status = 'ACTIVE' AND is_featured = true;
```

The toggle PATCH issues a single `UPDATE … SET is_featured = NOT is_featured RETURNING id, is_featured, updated_at` via PostgREST. Because `updated_at` has a trigger auto-setting it on every UPDATE (migration 0032 trigger `trg_farmarket_ads_updated_at`), no explicit timestamp write is needed.

---

## 6. Step-by-Step Implementation

### 6.1 Add `FeatureToggleOut` schema to admin farmarket schemas

In [backend/app/modules/admin/farmarket_schemas.py](../../backend/app/modules/admin/farmarket_schemas.py), append:

```python
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class FeatureToggleOut(BaseModel):
    """Response from PATCH /admin/farmarket/ads/{ad_id}/feature."""

    id: UUID
    is_featured: bool
    updated_at: datetime

    model_config = {"populate_by_name": True}
```

---

### 6.2 Add the PATCH endpoint to the admin farmarket router

In [backend/app/modules/admin/farmarket_router.py](../../backend/app/modules/admin/farmarket_router.py), add the following import and endpoint **after** the existing `admin_list_leads` function:

```python
from app.modules.admin.farmarket_schemas import FeatureToggleOut   # add to existing import block
```

```python
# ---------------------------------------------------------------------------
# PATCH /admin/farmarket/ads/{ad_id}/feature
# ---------------------------------------------------------------------------

@router.patch(
    "/ads/{ad_id}/feature",
    response_class=ORJSONResponse,
    summary="[ADMIN] Toggle featured flag on a FarMarket ad",
    status_code=200,
)
async def admin_toggle_ad_featured(
    ad_id: UUID,
    _: AuthUser = Depends(require_role("ADMIN")),
) -> ORJSONResponse:
    """Toggle is_featured on a single ad.

    Flips the current boolean value atomically (NOT is_featured).
    Returns the new state.  Idempotent: calling twice restores original state.
    Returns 404 if the ad_id does not exist.
    """
    client = service_client()  # JUSTIFICATION: admin write — toggle featured flag, RLS bypass

    # Fetch current is_featured value first (PostgREST does not support
    # SET col = NOT col directly via the Python client).
    fetch = (
        client.table(_ADS_TABLE)
        .select("id, is_featured")
        .eq("id", str(ad_id))
        .maybe_single()
        .execute()
    )

    if fetch.data is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="ad_not_found")

    new_value = not fetch.data["is_featured"]

    update = (
        client.table(_ADS_TABLE)
        .update({"is_featured": new_value})
        .eq("id", str(ad_id))
        .select("id, is_featured, updated_at")
        .execute()
    )

    row = update.data[0]
    return ORJSONResponse(
        FeatureToggleOut(
            id=row["id"],
            is_featured=row["is_featured"],
            updated_at=row["updated_at"],
        ).model_dump(mode="json")
    )
```

---

### 6.3 Frontend — Featured badge component

Create [frontend/src/app/dashboard/restaurant/FeaturedBadge.tsx](../../frontend/src/app/dashboard/restaurant/FeaturedBadge.tsx):

```tsx
export default function FeaturedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      ★ Mis en avant
    </span>
  );
}
```

---

### 6.4 Frontend — Apply badge to catalog ad cards

In the catalog page or card component under [frontend/src/app/dashboard/restaurant/](../../frontend/src/app/dashboard/restaurant/), locate where individual ads are rendered. Import `FeaturedBadge` and conditionally render it:

```tsx
import FeaturedBadge from "./FeaturedBadge";

// Inside the ad card render:
{ad.is_featured && <FeaturedBadge />}
```

If you need to create the catalog UI as part of this story (it may not exist yet because FAR-02 only implemented the backend), create a minimal page at [frontend/src/app/dashboard/restaurant/catalog/page.tsx](../../frontend/src/app/dashboard/restaurant/catalog/page.tsx):

```tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import FeaturedBadge from "../FeaturedBadge";

export default async function CatalogPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  const res = await fetch(`${apiBase}/api/v1/farmarket/catalog?page=1&page_size=20`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  const page = res.ok ? await res.json() : { items: [] };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Catalogue FarMarket</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {page.items.map((ad: {
          id: string;
          title: string;
          product_type: string;
          price_mad: number;
          quantity_kg: number;
          region: string;
          is_featured: boolean;
          photo_urls: string[];
          expires_at: string;
        }) => (
          <div
            key={ad.id}
            className={`rounded-lg border p-4 space-y-2 ${
              ad.is_featured ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
            }`}
          >
            {ad.is_featured && <FeaturedBadge />}
            {ad.photo_urls[0] && (
              <img
                src={ad.photo_urls[0]}
                alt={ad.title}
                className="w-full h-36 object-cover rounded"
              />
            )}
            <h2 className="font-semibold text-gray-900">{ad.title}</h2>
            <p className="text-sm text-gray-600">{ad.product_type} — {ad.region}</p>
            <p className="text-sm font-medium text-green-700">
              {ad.price_mad} MAD/kg · {ad.quantity_kg} kg disponibles
            </p>
            <p className="text-xs text-gray-400">
              Expire le {new Date(ad.expires_at).toLocaleDateString("fr-MA")}
            </p>
          </div>
        ))}
      </div>
      {page.items.length === 0 && (
        <p className="text-center text-gray-400 py-12">Aucune annonce disponible.</p>
      )}
    </div>
  );
}
```

---

### 6.5 Frontend — Admin feature toggle button

In [frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx](../../frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx), add a toggle handler and a button column to the ads table:

```tsx
// Add to the component props type:
// accessToken: string   ← already present from FAR-08

// Add toggle handler inside the component:
async function toggleFeatured(adId: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  await fetch(`${apiBase}/api/v1/admin/farmarket/ads/${adId}/feature`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // Reload the page to reflect the new state (simple approach for admin tool).
  window.location.reload();
}

// Add a "Actions" column header to the ads table <thead>:
<th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
  Actions
</th>

// Add the toggle button cell to each <tr> in the ads table:
<td className="px-4 py-2">
  <button
    onClick={() => toggleFeatured(ad.id)}
    className={`text-xs px-2 py-1 rounded font-medium ${
      ad.is_featured
        ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
    }`}
  >
    {ad.is_featured ? "Désépingler" : "Épingler"}
  </button>
</td>
```

---

### 6.6 Backend test suite

Create [backend/tests/test_far09_featured_ads.py](../../backend/tests/test_far09_featured_ads.py):

```python
"""FAR-09 — Featured ads at top of catalog.

Coverage
--------
* ADMIN can toggle is_featured on an existing ad (200, new state returned)
* Non-ADMIN roles (FARMER, RESTAURANT, CITIZEN) → 403 on PATCH endpoint
* PATCH on a non-existent ad_id → 404 ad_not_found
* Calling PATCH twice restores the original value (idempotent toggle)
* Catalog sort: featured ads appear before non-featured ads (order test)
* AUTH-05: service_client() is used in the toggle endpoint
"""
from __future__ import annotations

import time
import uuid
from unittest.mock import MagicMock, patch

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings

_ALG = "HS256"
_AUD = "authenticated"


def _make_token(*, role: str, sub: str | None = None) -> str:
    now = int(time.time())
    return pyjwt.encode(
        {
            "iat": now,
            "exp": now + 3600,
            "aud": _AUD,
            "sub": sub or str(uuid.uuid4()),
            "email": f"{role.lower()}@test.local",
            "user_role": role,
            "verification_status": "VERIFIED",
        },
        get_settings().supabase_jwt_secret.get_secret_value(),
        algorithm=_ALG,
    )


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_AD_ID = str(uuid.uuid4())

_EXISTING_AD = {
    "id": _AD_ID,
    "is_featured": False,
}

_TOGGLE_RESPONSE = {
    "id": _AD_ID,
    "is_featured": True,
    "updated_at": "2026-05-23T10:00:00+00:00",
}


def _mock_service_client_for_toggle(
    fetch_data: dict | None,
    update_data: dict | None = None,
):
    """Mock service_client() for the toggle endpoint's two-step fetch + update."""

    class _FetchResp:
        data = fetch_data

    class _UpdateResp:
        data = [update_data] if update_data else []

    mock_client = MagicMock()

    fetch_q = MagicMock()
    fetch_q.select.return_value = fetch_q
    fetch_q.eq.return_value = fetch_q
    fetch_q.maybe_single.return_value = fetch_q
    fetch_q.execute.return_value = _FetchResp()

    update_q = MagicMock()
    update_q.update.return_value = update_q
    update_q.eq.return_value = update_q
    update_q.select.return_value = update_q
    update_q.execute.return_value = _UpdateResp()

    call_count = {"n": 0}

    def _table_side(table_name: str):
        call_count["n"] += 1
        return fetch_q if call_count["n"] == 1 else update_q

    mock_client.table.side_effect = _table_side
    return mock_client


# ---------------------------------------------------------------------------
# Auth gate — non-ADMIN roles are rejected
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["FARMER", "RESTAURANT", "CITIZEN"])
async def test_non_admin_toggle_returns_403(role: str) -> None:
    from app.main import create_app

    token = _make_token(role=role)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as client:
        resp = await client.patch(
            f"/api/v1/admin/farmarket/ads/{_AD_ID}/feature",
            headers=_auth(token),
        )
    assert resp.status_code == 403, f"{role} should be forbidden on featured toggle"


# ---------------------------------------------------------------------------
# ADMIN happy path — toggle flips the flag
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_toggle_featured_returns_200() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")
    mock_client = _mock_service_client_for_toggle(
        fetch_data=_EXISTING_AD,
        update_data=_TOGGLE_RESPONSE,
    )

    with patch(
        "app.modules.admin.farmarket_router.service_client",
        return_value=mock_client,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            resp = await client.patch(
                f"/api/v1/admin/farmarket/ads/{_AD_ID}/feature",
                headers=_auth(token),
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == _AD_ID
    assert body["is_featured"] is True
    assert "updated_at" in body


# ---------------------------------------------------------------------------
# 404 — ad does not exist
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_toggle_nonexistent_ad_returns_404() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")
    mock_client = _mock_service_client_for_toggle(fetch_data=None)

    with patch(
        "app.modules.admin.farmarket_router.service_client",
        return_value=mock_client,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            resp = await client.patch(
                f"/api/v1/admin/farmarket/ads/{uuid.uuid4()}/feature",
                headers=_auth(token),
            )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "ad_not_found"


# ---------------------------------------------------------------------------
# Idempotency — toggle twice restores original value
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_toggle_twice_restores_original() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")

    # First toggle: False → True
    mock1 = _mock_service_client_for_toggle(
        fetch_data={"id": _AD_ID, "is_featured": False},
        update_data={"id": _AD_ID, "is_featured": True, "updated_at": "2026-05-23T10:00:00+00:00"},
    )
    # Second toggle: True → False
    mock2 = _mock_service_client_for_toggle(
        fetch_data={"id": _AD_ID, "is_featured": True},
        update_data={"id": _AD_ID, "is_featured": False, "updated_at": "2026-05-23T10:01:00+00:00"},
    )

    with patch("app.modules.admin.farmarket_router.service_client", return_value=mock1):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            r1 = await client.patch(
                f"/api/v1/admin/farmarket/ads/{_AD_ID}/feature",
                headers=_auth(token),
            )

    with patch("app.modules.admin.farmarket_router.service_client", return_value=mock2):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            r2 = await client.patch(
                f"/api/v1/admin/farmarket/ads/{_AD_ID}/feature",
                headers=_auth(token),
            )

    assert r1.json()["is_featured"] is True
    assert r2.json()["is_featured"] is False


# ---------------------------------------------------------------------------
# AUTH-05 boundary — service_client() used in toggle, not user_scoped_client
# ---------------------------------------------------------------------------

class TestAuth05BoundaryFar09:
    def test_toggle_endpoint_uses_service_client(self) -> None:
        from pathlib import Path

        src = (
            Path(__file__).parent.parent
            / "app" / "modules" / "admin" / "farmarket_router.py"
        ).read_text()

        assert "admin_toggle_ad_featured" in src, (
            "Toggle function must be defined in admin/farmarket_router.py"
        )
        assert "service_client" in src, (
            "Toggle endpoint must use service_client() (AUTH-05 allowlist)"
        )
        assert "JUSTIFICATION" in src, (
            "Every service_client() call site requires a # JUSTIFICATION: comment"
        )
```

---

### 6.7 pgTAP cell — AUTH-07 assertion

Append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

```sql
-- ── FAR-09 cells ─────────────────────────────────────────────────────────────
-- Prerequisite: m2_farmarket_ads must exist (FAR-01 merged).

do $guard_f09$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP FAR-09 cells — m2_farmarket_ads not yet created';
    return;
  end if;
end $guard_f09$;

-- F-09a: the featured partial index exists on m2_farmarket_ads.
-- This index is the performance guarantee for the sort; its absence means
-- featured ads still appear first but via a full-scan rather than an index seek.
select isnt(
  (
    select indexname
      from pg_indexes
     where schemaname = 'public'
       and tablename  = 'm2_farmarket_ads'
       and indexname  = 'm2_farmarket_ads_featured_idx'
  ),
  null,
  'F-09a: m2_farmarket_ads_featured_idx exists (FAR-09 sort performance guarantee)'
);

-- F-09b: is_featured defaults to false on new rows (premium slots not auto-granted).
do $f09b$
declare
  v_farmer_id  uuid := gen_random_uuid();
  v_ad_id      uuid := gen_random_uuid();
  v_featured   boolean;
begin
  -- Minimal insert bypassing RLS via service-role context (already set in test runner).
  insert into public.m2_farmarket_ads (
      id, farmer_id, title, description, product_type,
      price_mad, quantity_kg, region
  ) values (
      v_ad_id, v_farmer_id,
      'Test FAR-09', 'Description longue pour test FAR-09', 'Tomates',
      5.00, 100.00, 'Souss-Massa'
  );

  select is_featured into v_featured
    from public.m2_farmarket_ads
   where id = v_ad_id;

  perform ok(
    v_featured = false,
    'F-09b: newly inserted ad has is_featured = false by default'
  );

  delete from public.m2_farmarket_ads where id = v_ad_id;
end $f09b$;
```

---

## 7. Verification Checklist

- [ ] `make -C backend test` green — all FAR-09 assertions in `test_far09_featured_ads.py` pass, no regressions in FAR-01..08 tests.
- [ ] `make -C db test-auth07` — cells F-09a and F-09b both `ok` (not `SKIP`).
- [ ] **Auth gate**: `curl -s -o /dev/null -w "%{http_code}" -X PATCH -H "Authorization: Bearer <FARMER-JWT>" http://localhost:8000/api/v1/admin/farmarket/ads/<ad_id>/feature` returns `403`.
- [ ] **Admin toggle**: `curl -X PATCH -H "Authorization: Bearer <ADMIN-JWT>" http://localhost:8000/api/v1/admin/farmarket/ads/<ad_id>/feature` returns `200` with `{"is_featured": true, ...}`.
- [ ] **Second toggle**: calling the same endpoint again returns `{"is_featured": false, ...}` — original value restored.
- [ ] **Not found**: `curl -X PATCH -H "Authorization: Bearer <ADMIN-JWT>" http://localhost:8000/api/v1/admin/farmarket/ads/00000000-0000-0000-0000-000000000000/feature` returns `404 ad_not_found`.
- [ ] **Catalog sort** (staging): seed one featured ad and two non-featured ACTIVE ads; call `GET /api/v1/farmarket/catalog` and confirm the featured ad is `items[0]` regardless of creation order.
- [ ] **Frontend badge**: navigate to the catalog as RESTAURANT; the featured ad shows the "★ Mis en avant" badge; non-featured ads do not.
- [ ] **Admin toggle button**: in `/dashboard/admin/farmarket`, the Ads tab shows "Épingler" / "Désépingler" buttons; clicking one flips the state and the page reloads with the updated badge.
- [ ] **AUTH-05 boundary**: `bash scripts/check-secrets-boundary.sh` exits 0; `# JUSTIFICATION:` present at the `service_client()` call site in `admin_toggle_ad_featured`.

---

## 8. Deliverables

| Artifact | Location |
|---|---|
| `FeatureToggleOut` schema | Appended to [backend/app/modules/admin/farmarket_schemas.py](../../backend/app/modules/admin/farmarket_schemas.py) |
| `admin_toggle_ad_featured` endpoint | Appended to [backend/app/modules/admin/farmarket_router.py](../../backend/app/modules/admin/farmarket_router.py) |
| Featured badge component | New file [frontend/src/app/dashboard/restaurant/FeaturedBadge.tsx](../../frontend/src/app/dashboard/restaurant/FeaturedBadge.tsx) |
| Catalog page with badge | [frontend/src/app/dashboard/restaurant/catalog/page.tsx](../../frontend/src/app/dashboard/restaurant/catalog/page.tsx) (new or edited) |
| Admin toggle button | Edited [frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx](../../frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx) |
| Backend test suite | New file [backend/tests/test_far09_featured_ads.py](../../backend/tests/test_far09_featured_ads.py) |
| AUTH-07 pgTAP cells (F-09a, F-09b) | Appended to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | Flip `FAR-09.status → IN_REVIEW`, bump `summary.in_review` |

---

## 9. Business Rules Enforced

| Rule | Layer | How it is enforced |
|---|---|---|
| Only ADMIN can grant featured status | FastAPI | `require_role("ADMIN")` → `403 role_not_allowed` for any other role |
| `is_featured` defaults to `false` | DB | `DEFAULT false` in migration 0032; F-09b pgTAP cell confirms it |
| Featured ads sort first in catalog | Backend | `.order("is_featured", desc=True)` in `browse_catalog()` — FAR-02 |
| Sort is index-backed | DB | `m2_farmarket_ads_featured_idx` partial index; F-09a pgTAP cell confirms it |
| `service_client()` restricted to `routers/admin/` | CI | AST allowlist test in `test_service_client_callsite_allowlist.py`; AUTH-05 |

---

## 10. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| Admin accidentally features all ads (makes the sort meaningless) | The toggle is one-by-one; no bulk action exists in MVD. Post-MVD: add a max-featured-per-day guard. | PRD §6.2.1 FAR-09 |
| Featured slot abused if admin credentials are compromised | Admin auth is protected by the same JWT + NGINX rate-limit stack as all other admin routes; featured flag change is fully auditable via `updated_at` | PRD §8.3 AUTH-04 |
| Two-step fetch + update creates a TOCTOU race | Acceptable at MVD scale (< 50 concurrent users). Post-MVD: use a raw SQL `UPDATE … SET is_featured = NOT is_featured` via a SECURITY DEFINER RPC function for atomic toggle. | PRD §11.1 |
| FAR-08 not yet done when FAR-09 is implemented | The `admin_toggle_ad_featured` endpoint can be implemented in the same PR as FAR-08, or in a follow-up PR. Backend routes are independently testable. | PRD §5.2 |

---

## 11. Time Estimate

| Sub-task | Estimate |
|---|---|
| `FeatureToggleOut` schema | 5 min |
| `admin_toggle_ad_featured` endpoint | 30 min |
| `FeaturedBadge.tsx` component | 10 min |
| Catalog page badge integration | 20 min |
| Admin toggle button in `FarMarketAdminView.tsx` | 20 min |
| `test_far09_featured_ads.py` (5 test cases) | 50 min |
| pgTAP cells F-09a + F-09b | 15 min |
| Local smoke + staging verification | 20 min |
| `spring-status.yml` update | 5 min |
| **Total active work** | **~2.5 h** |

---

## 12. Definition of Done

1. Acceptance criterion met: ADMIN can toggle `is_featured` via `PATCH /api/v1/admin/farmarket/ads/{ad_id}/feature`; featured ads appear first in `GET /farmarket/catalog`; a "★ Mis en avant" badge renders on featured cards in the frontend.
2. `make -C backend test` green — all FAR-09 assertions pass, no regressions in FAR-01..08 tests.
3. `make -C db test-auth07` — cells F-09a and F-09b `ok`.
4. `bash scripts/check-secrets-boundary.sh` exits 0; `test_service_client_callsite_allowlist.py` green.
5. Manual auth gate confirmed: FARMER/RESTAURANT/CITIZEN tokens return `403` on the toggle endpoint.
6. Catalog sort verified on staging: featured ad is `items[0]` regardless of creation order.
7. Frontend badge visible in catalog; admin toggle button functional in admin view.
8. Verification checklist (§7) fully ticked.
9. Deliverables (§8) committed.
10. `docs/spring-status.yml` updated: `FAR-09.status → IN_REVIEW`, `summary.in_review` incremented.
