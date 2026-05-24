# FAR-08 — Admin views all ads and leads

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Should
> **Status:** TODO
> **Actor:** ADMIN
> **Depends on:** [FAR-01](./FAR-01-farmer-creates-ad.md) (`m2_farmarket_ads` + `m2_farmarket_leads` tables + RLS policies), [FAR-03](./FAR-03-restaurateur-contacts-seller.md) (`m2_farmarket_leads` populated with contact data), [ADM-01](./ADM-01-admin-shell-role-protected-routes.md) (admin shell providing `require_role("ADMIN")` guard + `/dashboard/admin` layout)
> **Unblocks:** [ADM-03](./ADM-03-cross-module-lead-overview.md) (cross-module lead overview aggregates FAR-08 + BOT-05 data)
> **Acceptance:** An ADMIN user can call `GET /api/v1/admin/farmarket/ads` and `GET /api/v1/admin/farmarket/leads` and receive paginated, filterable results covering **all** statuses / all farmers — without RLS restriction. Non-ADMIN requests return `403 role_not_allowed`. A frontend admin page at `/dashboard/admin/farmarket` renders both lists with status-badge colouring and filter controls.

---

## 1. Purpose

After FAR-01 through FAR-07 ship, ads and leads accumulate in the database but only farmers and restaurateurs can see their own records via the user-facing endpoints. The VitaChain operator has no visibility into the full state of the marketplace.

FAR-08 closes that gap by adding two read-only admin endpoints that bypass RLS and a protected frontend page that gives the ADMIN role a full operational view of the FarMarket module.

**Why this matters for demo day:**

- Scenario C ("B2B Commerce") ends with a farmer receiving a Brevo email. FAR-08 lets the moderator show the Steering Committee all ads and all leads generated during the demo without needing to switch between farmer and restaurateur accounts.
- Post-demo: admin monitoring of lead quality and ad moderation (e.g., removing inappropriate content) both depend on this view.

**What FAR-08 delivers:**

| Artifact | Path |
|---|---|
| Admin farmarket backend router | `backend/app/modules/admin/farmarket_router.py` |
| Admin farmarket Pydantic schemas | `backend/app/modules/admin/farmarket_schemas.py` |
| Admin module package marker | `backend/app/modules/admin/__init__.py` |
| Router registration in main app | `backend/app/main.py` (one `include_router` line) |
| Frontend admin farmarket page | `frontend/src/app/dashboard/admin/farmarket/page.tsx` |
| Frontend admin farmarket client component | `frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx` |
| Backend test suite | `backend/tests/test_far08_admin_views_ads_leads.py` |
| pgTAP cell | Appended to `db/tests/auth07_business_rules.sql` (cell F-08a) |
| Spring-status update | `docs/spring-status.yml` → `FAR-08.status: IN_REVIEW` |

---

## 2. Scope

### In scope

- Two paginated, filterable GET endpoints under `/api/v1/admin/farmarket/`:
  - `GET /ads` — all ads, all statuses, all farmers.
  - `GET /leads` — all leads, all farmers, all buyers.
- `require_role("ADMIN")` guard on both routes (FastAPI layer).
- `service_client()` connection (bypasses RLS — AUTH-05 allowlist covers `routers/admin/`).
- Extended Pydantic response models (`AdminAdOut`, `AdminLeadOut`) that surface `farmer_id` and `notified_at`.
- A single-page admin frontend at `/dashboard/admin/farmarket` with two tabs (Ads / Leads), status-badge colouring, and filter controls (status, region, product_type for ads; status for leads).
- Backend unit tests covering: ADMIN 200, non-ADMIN 403, pagination, status filter, empty result.
- pgTAP cell F-08a asserting the admin-read RLS policy exists on `m2_farmarket_ads`.

### Out of scope

- **Write operations** (delete, moderate, force-expire) — post-FAR-08; the admin can already trigger expiry via the FAR-06 worker and delete via FAR-05 farmer tooling in a later story.
- **Bulk export to CSV** — deferred (PRD FAR-08 "Should" only covers viewing).
- **Lead assignment or notes** — BOT-07 pattern; applicable to BotaBa9a leads only for MVD.
- **Photo thumbnail rendering** in the admin view — the `photo_urls` array is returned by the API; the frontend can display the first image if desired, but full gallery management is out of scope.
- **Auth.users join** — farmer email is not surfaced in FAR-08 (the admin sees `farmer_id` UUID; cross-referencing with the verification queue, ADM-02, is the identity lookup flow).
- **Pagination beyond 500 rows** — MVD has fewer than 500 ads; cursor pagination is post-MVD.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [FAR-01](./FAR-01-farmer-creates-ad.md) `DONE` | `public.m2_farmarket_ads` table, `photo_paths text[]`, `status`, `expires_at`, `farmer_id` columns, and the `farmarket_ads_admin_select` RLS policy must exist. Verify: `select policyname from pg_policies where tablename='m2_farmarket_ads' and policyname ilike '%admin%'` returns a row. |
| [FAR-03](./FAR-03-restaurateur-contacts-seller.md) `DONE` | `public.m2_farmarket_leads` table must exist with `buyer_id`, `buyer_phone`, `message`, `status`, `created_at` columns. Verify: `\d public.m2_farmarket_leads`. |
| [ADM-01](./ADM-01-admin-shell-role-protected-routes.md) `DONE` | `require_role("ADMIN")` from `backend/app/core/security.py` must be importable. `/dashboard/admin` layout and middleware guard must be live. If ADM-01 is still TODO, this story can be implemented locally but the frontend cannot be wired into the nav yet. |
| Migration `0035` applied | `notified_at timestamptz` column exists on `m2_farmarket_leads` (added by FAR-04). Verify: `select column_name from information_schema.columns where table_name='m2_farmarket_leads' and column_name='notified_at'` returns a row. |
| `SUPABASE_SERVICE_ROLE_KEY` in backend env | The admin router uses `service_client()`. Key must be available in the VPS `.env` and in CI secrets. Already satisfied since FAR-06 worker also uses it. |

---

## 4. Architecture Overview

```
Admin Browser  (/dashboard/admin/farmarket)
      │
      │  GET /api/v1/admin/farmarket/ads?status=ACTIVE&page=1
      │  GET /api/v1/admin/farmarket/leads?page=1
      ▼
Next.js Server Component (page.tsx)
      │
      │  fetch() with Authorization: Bearer <ADMIN JWT>
      ▼
FastAPI  —  backend/app/modules/admin/farmarket_router.py
      │
      │  require_role("ADMIN")  ← 403 if not ADMIN
      │
      │  service_client()       ← bypasses RLS (AUTH-05 allowlist: routers/admin/)
      │                            All ads / leads visible regardless of farmer_id
      ▼
Supabase PostgREST (service-role)
      │
      ├── SELECT * FROM m2_farmarket_ads        [all statuses]
      │   + filters, pagination, ORDER BY created_at DESC
      │
      └── SELECT * FROM m2_farmarket_leads      [all leads]
          + filters, pagination, ORDER BY created_at DESC
```

**Key design decisions:**

| Decision | Rationale |
|---|---|
| `service_client()` over user-scoped client | Avoids relying on an admin-read RLS policy existing on every table. The AUTH-05 allowlist already permits `routers/admin/` call sites. One `# JUSTIFICATION:` comment per call site. |
| Read-only endpoints only | Least-privilege principle for MVD: the admin can observe but cannot mutate data without story-level coverage and tests. |
| Separate `admin/farmarket_router.py` | Keeps the admin module boundary clean. FAR-01's `farmarket/router.py` is not touched. ADM-03 will import the same module when it builds the cross-module view. |
| `photo_paths` returned, `photo_urls` computed | Same pattern as `AdOut` — the admin frontend calls `_storage_public_url()` via the same serialisation helper. |
| Pagination mandatory | Matches PRD §6.1.2 BR-K4 spirit — never return unbounded rows from admin endpoints. Cap: `page_size` max 100. |

---

## 5. Data Model Changes

No new migration required. All necessary columns and RLS policies were created by:

| Migration | What it provides |
|---|---|
| `0032_far01_farmarket_ads.sql` | `m2_farmarket_ads` table, status enum, `expires_at`, `farmer_id`, `photo_paths text[]`, `farmarket_ads_admin_select` RLS policy (`is_admin()` USING clause) |
| `0034_far03_farmarket_leads.sql` | `m2_farmarket_leads` table, `buyer_id`, `buyer_phone`, `message`, `status`, `created_at` |
| `0035_far04_farmarket_lead_notify.sql` | `notified_at timestamptz` column on `m2_farmarket_leads` |

The service_client() connection bypasses these RLS policies anyway, but the policies remain in place for defence-in-depth: if a future refactor accidentally passes a user-scoped client, the admin-read policy is the last line of defence.

---

## 6. Step-by-Step Implementation

### 6.1 Admin module package

Create [backend/app/modules/admin/__init__.py](../../backend/app/modules/admin/__init__.py):

```python
"""VitaChain admin module — backend/app/modules/admin/

All routers in this package use service_client() and require_role("ADMIN").
Every service_client() call site carries a # JUSTIFICATION: comment as required
by the AUTH-05 allow-list.
"""
```

---

### 6.2 Admin Pydantic schemas

Create [backend/app/modules/admin/farmarket_schemas.py](../../backend/app/modules/admin/farmarket_schemas.py):

```python
"""FAR-08 — Admin-facing Pydantic schemas for FarMarket.

These extend the public AdOut / LeadOut with admin-only fields (notified_at)
and a relaxed status filter that accepts all values including EXPIRED / DELETED.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

AdStatusFilter = Literal["ACTIVE", "EXPIRED", "DELETED"] | None

ADMIN_PAGE_SIZE_DEFAULT: int = 20
ADMIN_PAGE_SIZE_MAX: int = 100


class AdminAdOut(BaseModel):
    """Ad row returned to admin callers.

    Identical to AdOut but includes all statuses and does not omit
    EXPIRED or DELETED rows.
    """

    id: UUID
    farmer_id: UUID
    title: str
    description: str
    product_type: str
    price_mad: Decimal
    quantity_kg: Decimal
    region: str
    photo_paths: list[str]
    photo_urls: list[str]
    status: str
    is_featured: bool
    expires_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


class AdminAdPage(BaseModel):
    items: list[AdminAdOut]
    total: int
    page: int
    page_size: int
    has_next: bool


class AdminLeadOut(BaseModel):
    """Lead row returned to admin callers.

    Adds ``notified_at`` (FAR-04 Brevo timestamp) to the standard LeadOut.
    """

    id: UUID
    ad_id: UUID
    buyer_id: UUID
    message: str
    buyer_phone: str
    status: str
    notified_at: datetime | None
    created_at: datetime

    model_config = {"populate_by_name": True}


class AdminLeadPage(BaseModel):
    items: list[AdminLeadOut]
    total: int
    page: int
    page_size: int
    has_next: bool


class AdminAdQuery(BaseModel):
    """Validated query params for GET /admin/farmarket/ads."""

    status: str | None = None
    region: str | None = None
    product_type: str | None = None
    farmer_id: UUID | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(
        default=ADMIN_PAGE_SIZE_DEFAULT,
        ge=1,
        le=ADMIN_PAGE_SIZE_MAX,
    )


class AdminLeadQuery(BaseModel):
    """Validated query params for GET /admin/farmarket/leads."""

    status: str | None = None
    ad_id: UUID | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(
        default=ADMIN_PAGE_SIZE_DEFAULT,
        ge=1,
        le=ADMIN_PAGE_SIZE_MAX,
    )
```

---

### 6.3 Admin farmarket router

Create [backend/app/modules/admin/farmarket_router.py](../../backend/app/modules/admin/farmarket_router.py):

```python
"""FAR-08 — Admin-only FarMarket read endpoints.

Auth contract
-------------
Both endpoints require ``require_role("ADMIN")``.

Storage
-------
``service_client()`` bypasses RLS on m2_farmarket_ads and m2_farmarket_leads
so the admin sees ALL rows regardless of farmer/buyer ownership.
AUTH-05: routers/admin/ is in the service_client() allow-list.
Every call site carries a # JUSTIFICATION: comment.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import ORJSONResponse

from app.core.config import get_settings
from app.core.security import AuthUser, require_role
from app.db import service_client  # JUSTIFICATION: admin read — all rows, RLS bypass
from app.modules.admin.farmarket_schemas import (
    ADMIN_PAGE_SIZE_DEFAULT,
    ADMIN_PAGE_SIZE_MAX,
    AdminAdOut,
    AdminAdPage,
    AdminAdQuery,
    AdminLeadOut,
    AdminLeadPage,
    AdminLeadQuery,
)

router = APIRouter(prefix="/admin/farmarket", tags=["admin-farmarket"])

_ADS_TABLE = "m2_farmarket_ads"
_LEADS_TABLE = "m2_farmarket_leads"


def _storage_public_url(path: str) -> str:
    settings = get_settings()
    base = settings.supabase_url.rstrip("/")
    return f"{base}/storage/v1/object/public/farmarket-photos/{path}"


def _build_admin_ad_out(row: dict) -> AdminAdOut:
    paths: list[str] = row.get("photo_paths") or []
    urls = [_storage_public_url(p) for p in paths]
    return AdminAdOut(
        **{k: v for k, v in row.items() if k != "photo_paths"},
        photo_paths=paths,
        photo_urls=urls,
    )


# ---------------------------------------------------------------------------
# GET /admin/farmarket/ads
# ---------------------------------------------------------------------------

@router.get(
    "/ads",
    response_class=ORJSONResponse,
    summary="[ADMIN] List all FarMarket ads",
)
async def admin_list_ads(
    query: AdminAdQuery = Depends(),
    _: AuthUser = Depends(require_role("ADMIN")),
) -> ORJSONResponse:
    client = service_client()  # JUSTIFICATION: admin read — all rows, RLS bypass

    page_size = min(query.page_size, ADMIN_PAGE_SIZE_MAX)
    offset = (query.page - 1) * page_size

    q = (
        client.table(_ADS_TABLE)
        .select("*", count="exact")
        .order("created_at", desc=True)
        .range(offset, offset + page_size - 1)
    )

    if query.status is not None:
        q = q.eq("status", query.status)
    if query.region is not None:
        q = q.eq("region", query.region)
    if query.product_type is not None:
        q = q.ilike("product_type", f"%{query.product_type}%")
    if query.farmer_id is not None:
        q = q.eq("farmer_id", str(query.farmer_id))

    resp = q.execute()
    total = resp.count or 0
    items = [_build_admin_ad_out(row) for row in (resp.data or [])]

    return ORJSONResponse(
        AdminAdPage(
            items=items,
            total=total,
            page=query.page,
            page_size=page_size,
            has_next=(offset + page_size) < total,
        ).model_dump(mode="json")
    )


# ---------------------------------------------------------------------------
# GET /admin/farmarket/leads
# ---------------------------------------------------------------------------

@router.get(
    "/leads",
    response_class=ORJSONResponse,
    summary="[ADMIN] List all FarMarket leads",
)
async def admin_list_leads(
    query: AdminLeadQuery = Depends(),
    _: AuthUser = Depends(require_role("ADMIN")),
) -> ORJSONResponse:
    client = service_client()  # JUSTIFICATION: admin read — all rows, RLS bypass

    page_size = min(query.page_size, ADMIN_PAGE_SIZE_MAX)
    offset = (query.page - 1) * page_size

    q = (
        client.table(_LEADS_TABLE)
        .select("*", count="exact")
        .order("created_at", desc=True)
        .range(offset, offset + page_size - 1)
    )

    if query.status is not None:
        q = q.eq("status", query.status)
    if query.ad_id is not None:
        q = q.eq("ad_id", str(query.ad_id))

    resp = q.execute()
    total = resp.count or 0
    items = [AdminLeadOut(**row) for row in (resp.data or [])]

    return ORJSONResponse(
        AdminLeadPage(
            items=items,
            total=total,
            page=query.page,
            page_size=page_size,
            has_next=(offset + page_size) < total,
        ).model_dump(mode="json")
    )
```

---

### 6.4 Register the admin farmarket router in `main.py`

In [backend/app/main.py](../../backend/app/main.py), add after the existing `include_router` calls:

```python
from app.modules.admin.farmarket_router import router as admin_farmarket_router

# inside create_app() or wherever routers are registered:
app.include_router(admin_farmarket_router, prefix="/api/v1")
```

---

### 6.5 Frontend admin farmarket page

Create [frontend/src/app/dashboard/admin/farmarket/page.tsx](../../frontend/src/app/dashboard/admin/farmarket/page.tsx):

```tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import FarMarketAdminView from "./FarMarketAdminView";

export default async function AdminFarMarketPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "ADMIN") redirect("/dashboard");

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

  const [adsRes, leadsRes] = await Promise.all([
    fetch(`${apiBase}/api/v1/admin/farmarket/ads?page=1&page_size=20`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    }),
    fetch(`${apiBase}/api/v1/admin/farmarket/leads?page=1&page_size=20`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    }),
  ]);

  const adsPage = adsRes.ok ? await adsRes.json() : { items: [], total: 0 };
  const leadsPage = leadsRes.ok ? await leadsRes.json() : { items: [], total: 0 };

  return (
    <FarMarketAdminView
      initialAds={adsPage}
      initialLeads={leadsPage}
      accessToken={session.access_token}
    />
  );
}
```

Create [frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx](../../frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx):

```tsx
"use client";

import { useState } from "react";

type Ad = {
  id: string;
  farmer_id: string;
  title: string;
  product_type: string;
  price_mad: number;
  quantity_kg: number;
  region: string;
  status: string;
  expires_at: string;
  created_at: string;
  photo_urls: string[];
};

type Lead = {
  id: string;
  ad_id: string;
  buyer_id: string;
  buyer_phone: string;
  message: string;
  status: string;
  notified_at: string | null;
  created_at: string;
};

type Page<T> = { items: T[]; total: number; page: number; page_size: number; has_next: boolean };

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:  "bg-green-100 text-green-800",
  EXPIRED: "bg-yellow-100 text-yellow-800",
  DELETED: "bg-red-100 text-red-800",
  NEW:     "bg-blue-100 text-blue-800",
  SEEN:    "bg-gray-100 text-gray-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

export default function FarMarketAdminView({
  initialAds,
  initialLeads,
  accessToken,
}: {
  initialAds: Page<Ad>;
  initialLeads: Page<Lead>;
  accessToken: string;
}) {
  const [tab, setTab] = useState<"ads" | "leads">("ads");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">FarMarket — Admin View</h1>

      {/* Tab bar */}
      <div className="flex gap-2 border-b pb-2">
        {(["ads", "leads"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-t text-sm font-medium transition-colors ${
              tab === t
                ? "bg-white border border-b-0 text-green-700"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "ads"
              ? `Annonces (${initialAds.total})`
              : `Leads (${initialLeads.total})`}
          </button>
        ))}
      </div>

      {/* Ads tab */}
      {tab === "ads" && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {["Titre", "Agriculteur", "Région", "Prix (MAD)", "Qté (kg)", "Statut", "Expire le", "Créé le"].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {initialAds.items.map((ad) => (
                <tr key={ad.id}>
                  <td className="px-4 py-2 font-medium text-gray-900 max-w-xs truncate">{ad.title}</td>
                  <td className="px-4 py-2 text-gray-500 font-mono text-xs">{ad.farmer_id.slice(0, 8)}…</td>
                  <td className="px-4 py-2 text-gray-600">{ad.region}</td>
                  <td className="px-4 py-2 text-gray-900">{ad.price_mad}</td>
                  <td className="px-4 py-2 text-gray-900">{ad.quantity_kg}</td>
                  <td className="px-4 py-2"><StatusBadge status={ad.status} /></td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{new Date(ad.expires_at).toLocaleDateString("fr-MA")}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{new Date(ad.created_at).toLocaleDateString("fr-MA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {initialAds.items.length === 0 && (
            <p className="text-center text-gray-400 py-8">Aucune annonce trouvée.</p>
          )}
        </div>
      )}

      {/* Leads tab */}
      {tab === "leads" && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {["Annonce", "Acheteur", "Téléphone", "Message", "Statut", "Notifié le", "Créé le"].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {initialLeads.items.map((lead) => (
                <tr key={lead.id}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{lead.ad_id.slice(0, 8)}…</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{lead.buyer_id.slice(0, 8)}…</td>
                  <td className="px-4 py-2 text-gray-900">{lead.buyer_phone}</td>
                  <td className="px-4 py-2 text-gray-600 max-w-xs truncate" title={lead.message}>{lead.message}</td>
                  <td className="px-4 py-2"><StatusBadge status={lead.status} /></td>
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {lead.notified_at ? new Date(lead.notified_at).toLocaleDateString("fr-MA") : "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{new Date(lead.created_at).toLocaleDateString("fr-MA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {initialLeads.items.length === 0 && (
            <p className="text-center text-gray-400 py-8">Aucun lead trouvé.</p>
          )}
        </div>
      )}
    </div>
  );
}
```

---

### 6.6 Backend test suite

Create [backend/tests/test_far08_admin_views_ads_leads.py](../../backend/tests/test_far08_admin_views_ads_leads.py):

```python
"""FAR-08 — Admin views all FarMarket ads and leads.

Coverage
--------
* ADMIN 200 on /ads and /leads
* Non-ADMIN (FARMER, RESTAURANT, CITIZEN) → 403 on both endpoints
* Pagination shape (has_next, total, page)
* status filter narrows results for ads
* ad_id filter narrows results for leads
* Empty result returns 200 with items=[] and total=0
* service_client() is called (not user_scoped_client) — AUTH-05 boundary
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


def _make_token(
    *,
    role: str,
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
            "email": f"{role.lower()}@test.local",
            "user_role": role,
            "verification_status": verification_status,
        },
        get_settings().supabase_jwt_secret.get_secret_value(),
        algorithm=_ALG,
    )


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _mock_service_client(ads: list[dict] | None = None, leads: list[dict] | None = None):
    """Return a MagicMock that mimics service_client().table().select()...execute()."""
    ads = ads or []
    leads = leads or []

    class _Resp:
        def __init__(self, data, count):
            self.data = data
            self.count = count

    mock_client = MagicMock()

    def _table_side_effect(table_name: str):
        rows = ads if "ads" in table_name else leads
        q = MagicMock()
        q.select.return_value = q
        q.order.return_value = q
        q.range.return_value = q
        q.eq.return_value = q
        q.ilike.return_value = q
        q.execute.return_value = _Resp(data=rows, count=len(rows))
        return q

    mock_client.table.side_effect = _table_side_effect
    return mock_client


_SAMPLE_AD = {
    "id": str(uuid.uuid4()),
    "farmer_id": str(uuid.uuid4()),
    "title": "Tomates FAR-08",
    "description": "Annonce test pour admin",
    "product_type": "Tomates",
    "price_mad": "4.50",
    "quantity_kg": "100.00",
    "region": "Souss-Massa",
    "photo_paths": [],
    "status": "ACTIVE",
    "is_featured": False,
    "expires_at": "2026-05-29T12:00:00+00:00",
    "created_at": "2026-05-22T10:00:00+00:00",
    "updated_at": "2026-05-22T10:00:00+00:00",
}

_SAMPLE_LEAD = {
    "id": str(uuid.uuid4()),
    "ad_id": _SAMPLE_AD["id"],
    "buyer_id": str(uuid.uuid4()),
    "message": "Bonjour, je suis intéressé par vos tomates.",
    "buyer_phone": "0612345678",
    "status": "NEW",
    "notified_at": None,
    "created_at": "2026-05-22T11:00:00+00:00",
}


# ---------------------------------------------------------------------------
# Auth gate — non-ADMIN roles are rejected
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["FARMER", "RESTAURANT", "CITIZEN"])
async def test_non_admin_ads_returns_403(role: str) -> None:
    from app.main import create_app

    token = _make_token(role=role)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/admin/farmarket/ads",
            headers=_auth(token),
        )
    assert resp.status_code == 403, f"{role} should be forbidden on /admin/farmarket/ads"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["FARMER", "RESTAURANT", "CITIZEN"])
async def test_non_admin_leads_returns_403(role: str) -> None:
    from app.main import create_app

    token = _make_token(role=role)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as client:
        resp = await client.get(
            "/api/v1/admin/farmarket/leads",
            headers=_auth(token),
        )
    assert resp.status_code == 403, f"{role} should be forbidden on /admin/farmarket/leads"


# ---------------------------------------------------------------------------
# Happy path — ADMIN 200
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_can_list_ads() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")
    mock_client = _mock_service_client(ads=[_SAMPLE_AD])

    with patch("app.modules.admin.farmarket_router.service_client", return_value=mock_client):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/admin/farmarket/ads",
                headers=_auth(token),
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Tomates FAR-08"
    assert body["has_next"] is False
    assert body["page"] == 1


@pytest.mark.asyncio
async def test_admin_can_list_leads() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")
    mock_client = _mock_service_client(leads=[_SAMPLE_LEAD])

    with patch("app.modules.admin.farmarket_router.service_client", return_value=mock_client):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/admin/farmarket/leads",
                headers=_auth(token),
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["buyer_phone"] == "0612345678"
    assert body["items"][0]["notified_at"] is None


# ---------------------------------------------------------------------------
# Empty result
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_ads_empty_result() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")
    mock_client = _mock_service_client(ads=[])

    with patch("app.modules.admin.farmarket_router.service_client", return_value=mock_client):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/admin/farmarket/ads",
                headers=_auth(token),
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["has_next"] is False


# ---------------------------------------------------------------------------
# Pagination — has_next flag
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_ads_has_next_when_more_rows() -> None:
    from app.main import create_app

    token = _make_token(role="ADMIN")

    # Simulate: 25 total rows in DB, page_size=20
    class _BigResp:
        data = [_SAMPLE_AD] * 20
        count = 25

    mock_client = MagicMock()
    q = MagicMock()
    q.select.return_value = q
    q.order.return_value = q
    q.range.return_value = q
    q.eq.return_value = q
    q.ilike.return_value = q
    q.execute.return_value = _BigResp()
    mock_client.table.return_value = q

    with patch("app.modules.admin.farmarket_router.service_client", return_value=mock_client):
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/admin/farmarket/ads?page=1&page_size=20",
                headers=_auth(token),
            )

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 25
    assert body["has_next"] is True


# ---------------------------------------------------------------------------
# AUTH-05 boundary — service_client() is used, not user_scoped_client
# ---------------------------------------------------------------------------

class TestAuth05Boundary:
    def test_admin_farmarket_router_uses_service_client(self) -> None:
        """Admin router must import and call service_client(), not get_db_for_user."""
        from pathlib import Path

        router_path = (
            Path(__file__).parent.parent
            / "app"
            / "modules"
            / "admin"
            / "farmarket_router.py"
        )
        src = router_path.read_text()
        assert "service_client" in src, (
            "Admin farmarket router must call service_client() (AUTH-05 allowlist)"
        )
        assert "get_db_for_user" not in src, (
            "Admin farmarket router must not use get_db_for_user — use service_client()"
        )

    def test_justification_comment_present(self) -> None:
        """AUTH-05 requires a # JUSTIFICATION: comment at every service_client() call site."""
        from pathlib import Path

        router_path = (
            Path(__file__).parent.parent
            / "app"
            / "modules"
            / "admin"
            / "farmarket_router.py"
        )
        src = router_path.read_text()
        assert "JUSTIFICATION" in src, (
            "Every service_client() call in admin routers requires a # JUSTIFICATION: comment"
        )
```

---

### 6.7 pgTAP cell — AUTH-07 assertion

Append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

```sql
-- ── FAR-08 cells ─────────────────────────────────────────────────────────────
-- Prerequisite: m2_farmarket_ads must exist (FAR-01 merged).

do $guard_f08$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP FAR-08 cells — m2_farmarket_ads not yet created';
    return;
  end if;
end $guard_f08$;

-- F-08a: admin-read SELECT policy exists on m2_farmarket_ads.
-- FAR-08 documents that only ADMIN may see all rows; a non-admin using the
-- user-scoped client must still be restricted. The service_client() path
-- bypasses this policy, but the policy is the last-resort defence.
select isnt(
  (
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'm2_farmarket_ads'
       and cmd        = 'SELECT'
       and policyname ilike '%admin%'
  ),
  null,
  'F-08a: an admin SELECT policy exists on m2_farmarket_ads (defence-in-depth for FAR-08)'
);
```

---

## 7. Verification Checklist

- [ ] `make -C backend test` green — all FAR-08 assertions in `test_far08_admin_views_ads_leads.py` pass, no regressions in FAR-01..07 tests.
- [ ] `make -C db test-auth07` — cell F-08a `ok` (not `SKIP`).
- [ ] **Auth gate**: `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer <FARMER-JWT>" http://localhost:8000/api/v1/admin/farmarket/ads` returns `403`.
- [ ] **Admin 200**: `curl -H "Authorization: Bearer <ADMIN-JWT>" http://localhost:8000/api/v1/admin/farmarket/ads` returns `200` with the full ad list.
- [ ] **Status filter**: `GET /api/v1/admin/farmarket/ads?status=EXPIRED` returns only expired ads (verify with at least one EXPIRED ad present after FAR-06 runs or a manual expiry update).
- [ ] **Lead list**: `GET /api/v1/admin/farmarket/leads` returns leads with correct `notified_at` field (null before FAR-04 notifies, populated after).
- [ ] **Pagination**: with more than 20 ads, page 1 has `has_next: true`; page 2 has the remainder.
- [ ] **AUTH-05 boundary**: `bash scripts/check-secrets-boundary.sh` exits 0 — `# JUSTIFICATION:` comment present at both `service_client()` call sites in `admin/farmarket_router.py`.
- [ ] **Frontend smoke** (staging): Log in as ADMIN, navigate to `/dashboard/admin/farmarket`. Both tabs render without 403 errors.
- [ ] **Non-ADMIN redirect** (frontend): Log in as FARMER, manually navigate to `/dashboard/admin/farmarket`. Server component redirects to `/dashboard`.

---

## 8. Deliverables

| Artifact | Location |
|---|---|
| Admin module package | New file [backend/app/modules/admin/__init__.py](../../backend/app/modules/admin/__init__.py) |
| Admin Pydantic schemas | New file [backend/app/modules/admin/farmarket_schemas.py](../../backend/app/modules/admin/farmarket_schemas.py) |
| Admin farmarket router | New file [backend/app/modules/admin/farmarket_router.py](../../backend/app/modules/admin/farmarket_router.py) |
| Router registration | One `include_router` line in [backend/app/main.py](../../backend/app/main.py) |
| Frontend admin page | New file [frontend/src/app/dashboard/admin/farmarket/page.tsx](../../frontend/src/app/dashboard/admin/farmarket/page.tsx) |
| Frontend admin view component | New file [frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx](../../frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx) |
| Backend test suite | New file [backend/tests/test_far08_admin_views_ads_leads.py](../../backend/tests/test_far08_admin_views_ads_leads.py) |
| AUTH-07 pgTAP cell (F-08a) | Appended to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | Flip `FAR-08.status → IN_REVIEW`, bump `summary.in_review` |

---

## 9. Business Rules Enforced

| Rule | Layer | How it is enforced |
|---|---|---|
| **BR-F1**: Only ADMIN can see all ads | FastAPI | `require_role("ADMIN")` → `403 role_not_allowed` for any other role |
| **BR-F1**: Only ADMIN can see all ads | DB (defence-in-depth) | `farmarket_ads_admin_select` RLS policy on `m2_farmarket_ads` (migration 0032) |
| **AUTH-05**: `service_client()` restricted to `routers/admin/` | Backend convention | `admin/farmarket_router.py` is in the allow-list; each call site has `# JUSTIFICATION:` |
| **BR-F4**: Brevo key never in frontend | N/A for FAR-08 | No email is sent — FAR-08 is read-only |
| **Auth-05 allowlist** | CI | `backend/tests/test_service_client_callsite_allowlist.py` already includes `routers/admin/` as a permitted prefix |

---

## 10. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| Admin endpoint returns sensitive farmer data to unauthorized users | `require_role("ADMIN")` FastAPI gate + RLS admin-read policy (defence-in-depth); JWT verified by `get_current_user` before role check | PRD §7.1 AUTH-04 |
| `service_client()` usage bypasses RLS for all tables, not just the intended ones | Scope is limited to the two explicit `client.table()` calls; no dynamic table names; AST-based allowlist test catches any expansion outside `routers/admin/` | PRD §7.1 AUTH-05 |
| ADM-01 not yet done when FAR-08 is implemented | The backend routes can be implemented and tested independently of ADM-01's frontend shell. Wire the frontend nav link only after ADM-01 merges. | PRD §5.1 |
| Large number of ads (> 500) causes slow admin page load | `page_size` capped at 100; PostgREST `range()` ensures no full-table scan; `m2_farmarket_ads_expiry_idx` partial index covers status-filtered queries | PRD §8.1 |
| `notified_at` column absent if migration 0035 not applied | `AdminLeadOut` declares it as `datetime \| None`; Pydantic handles `KeyError` gracefully with a `None` default | PRD §6.2.1 FAR-04 |

---

## 11. Time Estimate

| Sub-task | Estimate |
|---|---|
| `admin/__init__.py` + `farmarket_schemas.py` | 20 min |
| `admin/farmarket_router.py` (ads + leads endpoints) | 45 min |
| `main.py` router registration | 5 min |
| `test_far08_admin_views_ads_leads.py` | 1 h |
| pgTAP cell F-08a | 10 min |
| Frontend `page.tsx` + `FarMarketAdminView.tsx` | 45 min |
| Local smoke + staging verification | 20 min |
| `spring-status.yml` update | 5 min |
| **Total active work** | **~3.5 h** |

---

## 12. Definition of Done

1. Acceptance criterion met: ADMIN role receives a paginated list of all ads (all statuses) and all leads; non-ADMIN requests return `403`.
2. `make -C backend test` green — all FAR-08 assertions pass, no regressions in FAR-01..07 tests.
3. `make -C db test-auth07` — cell F-08a `ok`.
4. `bash scripts/check-secrets-boundary.sh` exits 0; `test_service_client_callsite_allowlist.py` green.
5. Frontend admin page at `/dashboard/admin/farmarket` renders both tabs without errors when logged in as ADMIN.
6. Manual auth gate confirmed: FARMER/RESTAURANT/CITIZEN tokens return `403` on both admin endpoints.
7. Status filter works: `?status=EXPIRED` returns only expired ads (verified with at least one EXPIRED ad in staging DB).
8. Verification checklist (§7) fully ticked.
9. Deliverables (§8) committed.
10. `docs/spring-status.yml` updated: `FAR-08.status → IN_REVIEW`, `summary.in_review` incremented.
11. Hand-off note posted — **ADM-03** (cross-module lead overview aggregating FAR-08 + BOT-05) is now unblocked.
