# FAR-02 — Restaurateur browses active ads with region / product-type / price filters

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** RESTAURANT (authenticated)
> **Depends on:** [FAR-01](./FAR-01-farmer-creates-ad.md) (`m2_farmarket_ads` table + RLS must exist)
> **Unblocks:** [FAR-03](./FAR-03-restaurateur-contacts-seller.md) (contact form needs a browsable ad), [FAR-09](./FAR-09-featured-ads.md) (sort hook is in this catalog)
> **Acceptance:** Active ads listing with working region, product_type (partial match), and price range filters; offset-based pagination; EXPIRED/DELETED ads never visible.

---

## 1. Purpose

FAR-01 delivers ad creation. FAR-02 makes those ads discoverable — a restaurateur can find fresh-produce listings without a middleman (PRD §9.3 user story).

This story delivers:

- A new backend endpoint `GET /api/v1/farmarket/catalog` with filter + pagination query params.
- Two new Pydantic models: `CatalogQuery` (validated query params) and `CatalogPage` (paginated response envelope).
- A minimal restaurant dashboard shell (`/dashboard/restaurant/layout.tsx`) scoped to this story.
- A server-rendered catalog page at `/dashboard/restaurant/marketplace` with a client-side filter panel and pagination.
- Backend unit tests in `backend/tests/test_far02_catalog_browse.py`.

No new migrations are needed — `m2_farmarket_ads` (migration 0032) and its `(region, status)` partial index already support the query path.

---

## 2. Scope

### In scope

- New FastAPI endpoint `GET /api/v1/farmarket/catalog` — filterable, paginated, accessible to any authenticated user.
- `CatalogQuery` Pydantic model for query-param validation.
- `CatalogPage` Pydantic response envelope (`items`, `total`, `page`, `page_size`, `has_next`).
- Schema constants: `CATALOG_PAGE_SIZE_DEFAULT = 20`, `CATALOG_PAGE_SIZE_MAX = 50`.
- Frontend: minimal `/dashboard/restaurant/layout.tsx` (role guard + shell).
- Frontend: catalog page `/dashboard/restaurant/marketplace/page.tsx` (server-rendered, reads URL search params).
- Frontend: `CatalogFilters` client component (updates URL search params on submit).
- Frontend: `AdCatalogCard` component (with a disabled "Contacter" button as a FAR-03 hook).
- Frontend: `fetchCatalog(filters)` server action.
- Backend unit tests.

### Out of scope

- Contact form → **FAR-03**.
- Brevo seller-notification email → **FAR-04**.
- Featured ad sort boost → **FAR-09** (the `is_featured` column is already in the SELECT; FAR-09 adds the ORDER BY logic when premium ads exist).
- Full restaurant dashboard sidebar (SecondServe, settings, etc.) → future stories.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [FAR-01](./FAR-01-farmer-creates-ad.md) `DONE` | `public.m2_farmarket_ads` table + 6 RLS policies + `farmarket-photos` storage policies must exist. Migration 0032 applied. |
| [AUTH-03](./AUTH-03-jwt-config-256bit-1h-7d.md) `DONE` | `get_current_user` + `require_role` available in `backend/app/core/security.py`. |
| Migration 0032 applied | `farmarket_ads_select_active` RLS policy allows any `authenticated` user to SELECT rows with `status = 'ACTIVE'`. |

---

## 4. Data Model

No new database objects. FAR-02 is a read-only query story against the existing `m2_farmarket_ads` table.

### 4.1 Query path

| Filter param | Column | PostgREST method | Index used |
|---|---|---|---|
| `region` | `region` | `.eq()` | `m2_farmarket_ads_region_status_idx` (partial, `status = 'ACTIVE'`) |
| `product_type` | `product_type` | `.ilike("%value%")` | sequential scan on filtered set (acceptable at MVD volumes) |
| `price_min` | `price_mad` | `.gte()` | — |
| `price_max` | `price_mad` | `.lte()` | — |

### 4.2 Pagination

Offset-based: `LIMIT page_size OFFSET (page − 1) × page_size`.  
`supabase-py` `.range(start, end)` maps to PostgREST's `Range` header.  
`count="exact"` returns the total filtered row count in the same round-trip.

### 4.3 Sort order

Featured ads first (`is_featured DESC`), then newest first (`created_at DESC`). This ordering is the anchor FAR-09 relies on — the `is_featured` column already exists in migration 0032; FAR-09 only adds the admin toggle and front-end badge.

### 4.4 Auth boundary

`GET /api/v1/farmarket/catalog` uses `get_current_user` (no role restriction). Any authenticated user — RESTAURANT, FARMER, CITIZEN — can browse the catalog. RLS `farmarket_ads_select_active` is the true gate at the DB layer.

The existing `GET /api/v1/farmarket/ads` endpoint (FAR-01) is **FARMER-only** and returns the caller's own ads across all statuses. Keep these two endpoints separate; do not merge them.

---

## 5. Step-by-Step Implementation

### 5.1 Backend — add `CatalogQuery` and `CatalogPage` to schemas.py

Extend [backend/app/modules/farmarket/schemas.py](../../backend/app/modules/farmarket/schemas.py) by appending the following after the existing `AdOut` class:

```python
from pydantic import Field

# ---------------------------------------------------------------------------
# FAR-02 — Catalog browse
# ---------------------------------------------------------------------------

CATALOG_PAGE_SIZE_DEFAULT: int = 20
CATALOG_PAGE_SIZE_MAX: int = 50


class CatalogQuery(BaseModel):
    """Validated query params for GET /farmarket/catalog."""

    region: str | None = None
    product_type: str | None = None
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(
        default=CATALOG_PAGE_SIZE_DEFAULT,
        ge=1,
        le=CATALOG_PAGE_SIZE_MAX,
    )

    @field_validator("region")
    @classmethod
    def region_valid_if_present(cls, v: str | None) -> str | None:
        if v is not None and v not in MOROCCO_REGIONS:
            raise ValueError(
                "region must be one of the 12 Moroccan administrative regions"
            )
        return v

    @field_validator("price_min", "price_max")
    @classmethod
    def price_non_negative(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v < 0:
            raise ValueError("price filter must be non-negative")
        return v


class CatalogPage(BaseModel):
    """Paginated response envelope for GET /farmarket/catalog."""

    items: list[AdOut]
    total: int
    page: int
    page_size: int
    has_next: bool
```

---

### 5.2 Backend — catalog endpoint

Add the following endpoint to [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py).

Add to the imports block:

```python
from app.core.security import AuthUser, get_current_user, get_db_for_user, require_verified
from app.modules.farmarket.schemas import (
    MAX_PHOTO_BYTES,
    MAX_PHOTOS,
    MOROCCO_REGIONS,
    AdCreate,
    AdOut,
    CatalogQuery,
    CatalogPage,
    CATALOG_PAGE_SIZE_DEFAULT,
)
```

Add the endpoint after the existing `list_my_ads` handler:

```python
@router.get(
    "/catalog",
    response_model=CatalogPage,
    response_class=ORJSONResponse,
)
async def browse_catalog(
    region: str | None = None,
    product_type: str | None = None,
    price_min: Decimal | None = None,
    price_max: Decimal | None = None,
    page: int = 1,
    page_size: int = CATALOG_PAGE_SIZE_DEFAULT,
    user: Annotated[AuthUser, Depends(get_current_user)] = None,
    db: Annotated[Client, Depends(get_db_for_user)] = None,
) -> CatalogPage:
    """GET /api/v1/farmarket/catalog

    Filterable, paginated catalog of ACTIVE ads — readable by any
    authenticated user (RESTAURANT, FARMER, CITIZEN).

    RLS ``farmarket_ads_select_active`` enforces ``status = 'ACTIVE'`` at the
    DB layer; this handler adds optional filter predicates on top.

    Sort: featured first (FAR-09 placeholder), then newest first.

    Security note: `product_type` is passed to PostgREST via `.ilike()` as
    a parameterised filter — not string interpolation — so the % wildcards
    are safe against SQL injection.
    """
    params = CatalogQuery(
        region=region,
        product_type=product_type,
        price_min=price_min,
        price_max=price_max,
        page=page,
        page_size=page_size,
    )

    offset = (params.page - 1) * params.page_size

    query = (
        db.table(_ADS_TABLE)
        .select("*", count="exact")
        .eq("status", "ACTIVE")
        .order("is_featured", desc=True)
        .order("created_at", desc=True)
        .range(offset, offset + params.page_size - 1)
    )

    if params.region is not None:
        query = query.eq("region", params.region)
    if params.product_type is not None:
        query = query.ilike("product_type", f"%{params.product_type}%")
    if params.price_min is not None:
        query = query.gte("price_mad", str(params.price_min))
    if params.price_max is not None:
        query = query.lte("price_mad", str(params.price_max))

    result = query.execute()
    total: int = result.count or 0
    items = [_row_to_ad_out(r) for r in (result.data or [])]

    return CatalogPage(
        items=items,
        total=total,
        page=params.page,
        page_size=params.page_size,
        has_next=(offset + params.page_size) < total,
    )
```

---

### 5.3 Frontend — restaurant dashboard layout

Create [frontend/src/app/dashboard/restaurant/layout.tsx](../../frontend/src/app/dashboard/restaurant/layout.tsx):

```tsx
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

export default async function RestaurantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "role">>();

  if (profile?.role !== "RESTAURANT") redirect("/dashboard");

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-6 py-4">
        <p className="text-sm font-semibold text-neutral-700">
          Tableau de bord Restaurateur
        </p>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
```

> **Scope note:** This is the minimal shell required for FAR-02. A full restaurant sidebar (navigation to SecondServe, settings, etc. — mirroring the farmer `Sidebar.tsx`) is deferred until those stories land.

---

### 5.4 Frontend — catalog server action

Create [frontend/src/app/dashboard/restaurant/marketplace/actions.ts](../../frontend/src/app/dashboard/restaurant/marketplace/actions.ts):

```typescript
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Ad } from "@/app/dashboard/farmer/ads/actions";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type CatalogPage = {
  items: Ad[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
};

export type CatalogFilters = {
  region?: string;
  product_type?: string;
  price_min?: string;
  price_max?: string;
  page?: number;
};

const EMPTY_PAGE: CatalogPage = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
  has_next: false,
};

export async function fetchCatalog(
  filters: CatalogFilters = {},
): Promise<CatalogPage> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return EMPTY_PAGE;

  const qs = new URLSearchParams();
  if (filters.region) qs.set("region", filters.region);
  if (filters.product_type) qs.set("product_type", filters.product_type);
  if (filters.price_min) qs.set("price_min", filters.price_min);
  if (filters.price_max) qs.set("price_max", filters.price_max);
  if (filters.page && filters.page > 1) qs.set("page", String(filters.page));

  let r: Response;
  try {
    r = await fetch(
      `${API_BASE}/api/v1/farmarket/catalog?${qs.toString()}`,
      {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return EMPTY_PAGE;
  }

  if (!r.ok) return EMPTY_PAGE;
  return (await r.json()) as CatalogPage;
}
```

---

### 5.5 Frontend — catalog page

Create [frontend/src/app/dashboard/restaurant/marketplace/page.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/page.tsx):

```tsx
import Link from "next/link";

import { fetchCatalog } from "./actions";
import { CatalogFilters } from "./CatalogFilters";
import { AdCatalogCard } from "./AdCatalogCard";
import { MOROCCO_REGIONS } from "@/app/dashboard/farmer/ads/new/regions";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type Props = {
  searchParams: Promise<SearchParams>;
};

export default async function MarketplacePage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);

  const catalog = await fetchCatalog({
    region: sp.region as string | undefined,
    product_type: sp.product_type as string | undefined,
    price_min: sp.price_min as string | undefined,
    price_max: sp.price_max as string | undefined,
    page,
  });

  const defaultFilters = {
    region: (sp.region as string) ?? "",
    product_type: (sp.product_type as string) ?? "",
    price_min: (sp.price_min as string) ?? "",
    price_max: (sp.price_max as string) ?? "",
  };

  return (
    <div className="vc-fade-in">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          FarMarket
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-neutral-900">
          Catalogue Producteurs
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {catalog.total} annonce{catalog.total !== 1 ? "s" : ""} disponible
          {catalog.total !== 1 ? "s" : ""}
        </p>
      </div>

      <CatalogFilters regions={MOROCCO_REGIONS} defaultValues={defaultFilters} />

      {catalog.items.length === 0 ? (
        <div className="vc-card mt-6 p-10 text-center">
          <p className="text-base font-semibold text-neutral-900">
            Aucune annonce trouvée.
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Essayez d&apos;élargir vos filtres de recherche.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.items.map((ad) => (
            <AdCatalogCard key={ad.id} ad={ad} />
          ))}
        </ul>
      )}

      <PaginationBar
        page={catalog.page}
        hasNext={catalog.has_next}
        currentSearchParams={sp as Record<string, string>}
      />
    </div>
  );
}

function PaginationBar({
  page,
  hasNext,
  currentSearchParams,
}: {
  page: number;
  hasNext: boolean;
  currentSearchParams: Record<string, string>;
}) {
  const buildHref = (p: number) => {
    const qs = new URLSearchParams({ ...currentSearchParams, page: String(p) });
    return `/dashboard/restaurant/marketplace?${qs.toString()}`;
  };

  if (page === 1 && !hasNext) return null;

  return (
    <div className="mt-8 flex items-center justify-between">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className="vc-btn-secondary">
          ← Précédent
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-neutral-500">Page {page}</span>
      {hasNext ? (
        <Link href={buildHref(page + 1)} className="vc-btn-secondary">
          Suivant →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
```

---

### 5.6 Frontend — `CatalogFilters` client component

Create [frontend/src/app/dashboard/restaurant/marketplace/CatalogFilters.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/CatalogFilters.tsx):

```tsx
"use client";

import { useRouter, usePathname } from "next/navigation";
import { useRef } from "react";

type DefaultValues = {
  region: string;
  product_type: string;
  price_min: string;
  price_max: string;
};

type Props = {
  regions: readonly string[];
  defaultValues: DefaultValues;
};

export function CatalogFilters({ regions, defaultValues }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const qs = new URLSearchParams();

    const region = fd.get("region") as string;
    const product_type = (fd.get("product_type") as string).trim();
    const price_min = fd.get("price_min") as string;
    const price_max = fd.get("price_max") as string;

    if (region) qs.set("region", region);
    if (product_type) qs.set("product_type", product_type);
    if (price_min) qs.set("price_min", price_min);
    if (price_max) qs.set("price_max", price_max);
    // reset to page 1 on new filter

    router.push(`${pathname}?${qs.toString()}`);
  }

  function handleReset() {
    formRef.current?.reset();
    router.push(pathname);
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="vc-card flex flex-wrap items-end gap-4 p-4"
    >
      <div className="min-w-[180px] flex-1">
        <label
          htmlFor="region"
          className="block text-xs font-medium text-neutral-600"
        >
          Région
        </label>
        <select
          id="region"
          name="region"
          defaultValue={defaultValues.region}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">Toutes les régions</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[180px] flex-1">
        <label
          htmlFor="product_type"
          className="block text-xs font-medium text-neutral-600"
        >
          Type de produit
        </label>
        <input
          id="product_type"
          name="product_type"
          type="text"
          placeholder="Ex: Tomates, Poivrons…"
          defaultValue={defaultValues.product_type}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="min-w-[120px]">
        <label
          htmlFor="price_min"
          className="block text-xs font-medium text-neutral-600"
        >
          Prix min (MAD/kg)
        </label>
        <input
          id="price_min"
          name="price_min"
          type="number"
          step="0.01"
          min="0"
          defaultValue={defaultValues.price_min}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="min-w-[120px]">
        <label
          htmlFor="price_max"
          className="block text-xs font-medium text-neutral-600"
        >
          Prix max (MAD/kg)
        </label>
        <input
          id="price_max"
          name="price_max"
          type="number"
          step="0.01"
          min="0"
          defaultValue={defaultValues.price_max}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button type="submit" className="vc-btn-primary">
          Filtrer
        </button>
        <button type="button" onClick={handleReset} className="vc-btn-secondary">
          Réinitialiser
        </button>
      </div>
    </form>
  );
}
```

---

### 5.7 Frontend — `AdCatalogCard` component

Create [frontend/src/app/dashboard/restaurant/marketplace/AdCatalogCard.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/AdCatalogCard.tsx):

```tsx
import type { Ad } from "@/app/dashboard/farmer/ads/actions";

export function AdCatalogCard({ ad }: { ad: Ad }) {
  const price = Number(ad.price_mad).toFixed(2);
  const qty = Number(ad.quantity_kg).toFixed(0);

  return (
    <li>
      <div className="vc-card overflow-hidden p-0">
        {ad.photo_urls[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.photo_urls[0]}
            alt={ad.title}
            className="h-40 w-full object-cover"
          />
        ) : (
          <div className="flex h-40 w-full items-center justify-center bg-leaf-50">
            <span className="text-4xl">🌿</span>
          </div>
        )}

        <div className="p-4">
          {ad.is_featured && (
            <span className="mb-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              ★ En vedette
            </span>
          )}

          <p className="truncate text-sm font-semibold text-neutral-900">
            {ad.title}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">{ad.product_type}</p>

          <p className="mt-2 text-base font-bold text-leaf-700">
            {price}{" "}
            <span className="text-xs font-normal text-neutral-400">MAD/kg</span>
          </p>
          <p className="text-xs text-neutral-500">{qty} kg disponibles</p>
          <p className="mt-1 text-xs text-neutral-400">{ad.region}</p>

          {/* FAR-03 hook: replace with <ContactAdButton adId={ad.id} /> */}
          <button
            disabled
            className="mt-4 w-full cursor-not-allowed rounded bg-neutral-100 px-4 py-2 text-sm text-neutral-400"
            title="Contacter le vendeur — disponible dans FAR-03"
          >
            Contacter le vendeur
          </button>
        </div>
      </div>
    </li>
  );
}
```

> **FAR-03 hook:** Replace the `<button disabled>` with `<ContactAdButton adId={ad.id} />` when FAR-03 lands. Pass `ad.id` to the contact lead endpoint.

---

### 5.8 Backend unit tests

Create [backend/tests/test_far02_catalog_browse.py](../../backend/tests/test_far02_catalog_browse.py):

```python
"""FAR-02 — Catalog browse: CatalogQuery schema + endpoint guard tests."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.modules.farmarket.schemas import (
    CATALOG_PAGE_SIZE_DEFAULT,
    CATALOG_PAGE_SIZE_MAX,
    CatalogQuery,
)


class TestCatalogQuery:
    def test_defaults(self) -> None:
        q = CatalogQuery()
        assert q.region is None
        assert q.product_type is None
        assert q.price_min is None
        assert q.price_max is None
        assert q.page == 1
        assert q.page_size == CATALOG_PAGE_SIZE_DEFAULT

    def test_valid_region(self) -> None:
        q = CatalogQuery(region="Souss-Massa")
        assert q.region == "Souss-Massa"

    def test_invalid_region_rejected(self) -> None:
        with pytest.raises(ValueError, match="region"):
            CatalogQuery(region="Atlantique")

    def test_none_region_valid(self) -> None:
        q = CatalogQuery(region=None)
        assert q.region is None

    def test_negative_price_min_rejected(self) -> None:
        with pytest.raises(ValueError, match="non-negative"):
            CatalogQuery(price_min=Decimal("-1"))

    def test_negative_price_max_rejected(self) -> None:
        with pytest.raises(ValueError, match="non-negative"):
            CatalogQuery(price_max=Decimal("-0.01"))

    def test_zero_price_is_valid(self) -> None:
        q = CatalogQuery(price_min=Decimal("0"), price_max=Decimal("0"))
        assert q.price_min == Decimal("0")

    def test_page_zero_rejected(self) -> None:
        with pytest.raises(ValueError):
            CatalogQuery(page=0)

    def test_page_size_over_max_rejected(self) -> None:
        with pytest.raises(ValueError):
            CatalogQuery(page_size=CATALOG_PAGE_SIZE_MAX + 1)

    def test_page_size_at_max_is_valid(self) -> None:
        q = CatalogQuery(page_size=CATALOG_PAGE_SIZE_MAX)
        assert q.page_size == CATALOG_PAGE_SIZE_MAX

    def test_product_type_filter_passthrough(self) -> None:
        q = CatalogQuery(product_type="tomate")
        assert q.product_type == "tomate"


class TestCatalogEndpoint:
    def test_catalog_requires_auth(self, test_client) -> None:
        resp = test_client.get("/api/v1/farmarket/catalog")
        assert resp.status_code == 401

    def test_catalog_invalid_region_returns_422(
        self, test_client, farmer_token: str
    ) -> None:
        resp = test_client.get(
            "/api/v1/farmarket/catalog?region=NonExistent",
            headers={"Authorization": f"Bearer {farmer_token}"},
        )
        assert resp.status_code == 422

    def test_catalog_negative_price_min_returns_422(
        self, test_client, farmer_token: str
    ) -> None:
        resp = test_client.get(
            "/api/v1/farmarket/catalog?price_min=-5",
            headers={"Authorization": f"Bearer {farmer_token}"},
        )
        assert resp.status_code == 422

    def test_catalog_page_zero_returns_422(
        self, test_client, farmer_token: str
    ) -> None:
        resp = test_client.get(
            "/api/v1/farmarket/catalog?page=0",
            headers={"Authorization": f"Bearer {farmer_token}"},
        )
        assert resp.status_code == 422

    def test_catalog_page_size_over_max_returns_422(
        self, test_client, farmer_token: str
    ) -> None:
        resp = test_client.get(
            f"/api/v1/farmarket/catalog?page_size={CATALOG_PAGE_SIZE_MAX + 1}",
            headers={"Authorization": f"Bearer {farmer_token}"},
        )
        assert resp.status_code == 422
```

---

## 6. Verification Checklist

- [ ] `GET /api/v1/farmarket/catalog` returns `200` for an authenticated RESTAURANT user with no filters. Response shape: `{ items, total, page, page_size, has_next }`.
- [ ] `GET /api/v1/farmarket/catalog` (no auth) returns `401`.
- [ ] `GET /api/v1/farmarket/catalog?region=Souss-Massa` — only ads from that region returned.
- [ ] `GET /api/v1/farmarket/catalog?product_type=tomate` — ads with "tomate" (case-insensitive) in `product_type` returned.
- [ ] `GET /api/v1/farmarket/catalog?price_min=2&price_max=5` — only ads with `price_mad` between 2 and 5 returned.
- [ ] `GET /api/v1/farmarket/catalog?page=2&page_size=5` — second page of 5 results returned.
- [ ] `GET /api/v1/farmarket/catalog?region=InvalidRegion` returns `422`.
- [ ] `GET /api/v1/farmarket/catalog?price_min=-1` returns `422`.
- [ ] `GET /api/v1/farmarket/catalog?page=0` returns `422`.
- [ ] `GET /api/v1/farmarket/catalog?page_size=51` returns `422`.
- [ ] EXPIRED and DELETED ads never appear in catalog responses (verify by checking `status` of all returned rows).
- [ ] `/dashboard/restaurant/marketplace` loads for a RESTAURANT user without error.
- [ ] A non-RESTAURANT user accessing `/dashboard/restaurant/marketplace` is redirected to `/dashboard`.
- [ ] Region dropdown and product_type input submit correctly; URL search params update.
- [ ] Resetting filters navigates back to the unfiltered catalog.
- [ ] Pagination "Suivant" / "Précédent" links correctly increment and decrement `page` without losing other filter params.
- [ ] `make -C backend test` green (all FAR-02 assertions pass, no regressions in FAR-01 or earlier suites).
- [ ] No Sentry errors during end-to-end happy path.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| Backend schemas update | [backend/app/modules/farmarket/schemas.py](../../backend/app/modules/farmarket/schemas.py) |
| Backend router extension | [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py) |
| Backend tests | [backend/tests/test_far02_catalog_browse.py](../../backend/tests/test_far02_catalog_browse.py) |
| Restaurant dashboard layout | [frontend/src/app/dashboard/restaurant/layout.tsx](../../frontend/src/app/dashboard/restaurant/layout.tsx) |
| Catalog server action | [frontend/src/app/dashboard/restaurant/marketplace/actions.ts](../../frontend/src/app/dashboard/restaurant/marketplace/actions.ts) |
| Catalog page | [frontend/src/app/dashboard/restaurant/marketplace/page.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/page.tsx) |
| Filter panel component | [frontend/src/app/dashboard/restaurant/marketplace/CatalogFilters.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/CatalogFilters.tsx) |
| Ad catalog card component | [frontend/src/app/dashboard/restaurant/marketplace/AdCatalogCard.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/AdCatalogCard.tsx) |
| `spring-status.yml` update | Flip `FAR-02.status` → `IN_REVIEW`, bump `summary.in_review` |

---

## 8. Business Rules Enforced

| Rule | Where enforced |
|---|---|
| Only `ACTIVE` ads visible in catalog | `farmarket_ads_select_active` RLS policy (DB layer) + `.eq("status", "ACTIVE")` in router |
| Any authenticated user can browse | `get_current_user` dependency (no role gate) |
| Region filter must be a valid Moroccan region if provided | `CatalogQuery.region_valid_if_present` → 422 on invalid value |
| Price filters must be non-negative | `CatalogQuery.price_non_negative` → 422 on negative value |
| Page size capped at 50 | `CatalogQuery.page_size` Field constraint (`le=CATALOG_PAGE_SIZE_MAX`) |
| **BR-F4**: Brevo key not in frontend | Not applicable — no email triggers in this story |
| Restaurant layout gate | `RestaurantLayout` checks `role = 'RESTAURANT'` and redirects non-RESTAURANT users |

---

## 9. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| `product_type` ilike scan slow on large dataset | At MVD scale (<1000 ads) a seq scan over the filtered set is acceptable. Post-MVD: add GIN trigram index on `product_type` | PRD §8.1 |
| `count="exact"` adds a COUNT sub-query on every page load | Acceptable at MVD scale. Post-MVD: cache the unfiltered total in Redis with a short TTL | PRD §8.4 |
| FARMER browsing catalog sees their own ACTIVE ads | RLS `farmarket_ads_select_active` returns them — no security issue, just a UX note | PRD §7.1 AUTH-04 |
| URL search params expose filter values in browser history | Intentional — enables shareable filter URLs and browser back-button support | PRD §8.1 |
| `searchParams` type mismatch in Next.js 15 (Promise vs sync) | `await searchParams` used in the page component as per Next.js 15 API | — |

---

## 10. Time Estimate

| Sub-task | Estimate |
|---|---|
| Backend schemas (`CatalogQuery`, `CatalogPage`, constants) | 30 min |
| Backend `GET /catalog` endpoint | 1 h |
| Backend unit tests | 45 min |
| Frontend restaurant layout (minimal role guard + shell) | 30 min |
| Frontend catalog page + server action | 1.5 h |
| Frontend `CatalogFilters` client component | 1 h |
| Frontend `AdCatalogCard` component | 30 min |
| End-to-end staging verification | 45 min |
| **Total active work** | **~6.5 h** |

---

## 11. Definition of Done

1. Acceptance criterion met: a RESTAURANT user browses `/dashboard/restaurant/marketplace`, applies region + product_type + price filters, results update correctly.
2. All filter validation enforced: invalid region → `422`; negative price → `422`; page 0 → `422`; page_size > 50 → `422`.
3. EXPIRED/DELETED ads never visible in any catalog response (confirmed via staging data check).
4. Pagination: `has_next: true` when more results exist; `has_next: false` on last page; page links preserve other filter params.
5. Unauthenticated `GET /catalog` → `401`.
6. Non-RESTAURANT user accessing `/dashboard/restaurant/marketplace` → redirect to `/dashboard`.
7. Verification checklist (§6) fully ticked.
8. `make -C backend test` green with no regressions in pre-existing suites.
9. Deliverables (§7) committed.
10. `docs/spring-status.yml` updated: `FAR-02.status` → `IN_REVIEW`, `summary.in_review` incremented.
11. Hand-off note posted naming the story now unblocked: **FAR-03** (contact form — needs a browsable ad with an `id`).
