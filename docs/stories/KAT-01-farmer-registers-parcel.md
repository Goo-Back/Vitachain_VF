# KAT-01 — Farmer registers a parcel (GeoJSON polygon, crop type, surface area)

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** FARMER (verified)
> **Depends on:** [AUTH-06](./AUTH-06-professional-kyc-verification.md) (verification gate)
> **Unblocks:** [KAT-02](./KAT-02-esp32-device-pairing.md) (device needs a parcel), [KAT-14](./KAT-14-multi-parcel-support.md) (multi-parcel dashboard)
> **Acceptance:** Parcel persisted with valid GeoJSON; listed on farmer dashboard.

---

## 1. Purpose

A parcel is the root entity of the Katara module. Every subsequent KAT story — device pairing (KAT-02), telemetry ingestion (KAT-03), charts (KAT-04), alert thresholds (KAT-05), and AI diagnostics (KAT-07) — hangs off a parcel row.

This story delivers:

- The `public.m1_katara_parcels` database table with RLS enforcing the AUTH-06 verification gate.
- A FastAPI CRUD router (`/api/v1/katara/parcels`) with server-side GeoJSON validation.
- A minimal frontend: a parcel registration form and a parcel list card on the farmer dashboard.

Once this story is `DONE`, any verified farmer can register their land digitally, and the AUTH-07 RLS matrix block for `m1_katara_parcels` activates (no more SKIP notices in pgTAP output for this table).

---

## 2. Scope

### In scope
- Migration `0016_kat01_katara_parcels.sql` — table + indexes + RLS + updated_at trigger.
- FastAPI module `backend/app/modules/katara/` — schemas, router, registration in `main.py`.
- Server-side GeoJSON polygon validation (no PostGIS required — jsonb + Python validator).
- Frontend parcel registration form (name, crop type, surface area, GeoJSON textarea).
- Frontend parcel list shown under the farmer dashboard section.
- Smoke tests covering: VERIFIED FARMER creates/lists parcel; PENDING FARMER blocked (403); RESTAURANT blocked (403); cross-farmer isolation (FARMER-B cannot see FARMER-A's parcel).

### Out of scope
- Device pairing → **KAT-02**.
- Telemetry ingestion → **KAT-03**.
- Map-based polygon drawing (post-MVD UX; GeoJSON textarea is MVD-sufficient).
- Parcel deletion (blocked if a device is linked — deferring until KAT-02 establishes the FK constraint).
- PostGIS spatial queries — not needed for parcel CRUD; relevant only for SEC-03.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [AUTH-06](./AUTH-06-professional-kyc-verification.md) `DONE` | `verification_status = 'VERIFIED'` gate must exist; the INSERT RLS policy and FastAPI guard both depend on it. |
| [AUTH-04](./AUTH-04-rls-all-sensitive-tables.md) `DONE` | `public.has_role()` and `public.is_admin()` helpers required by the RLS policies below. |
| Migration 0015 applied | `public.set_updated_at()` function exists (created in 0002); enum types exist (0001). |
| FastAPI skeleton (`backend/app/main.py`) | Router registration requires the app already bootstrapped (INF-04 DONE). |
| Next.js scaffold with farmer dashboard route | `/dashboard` page exists; add a parcel section (INF-03 DONE). |

---

## 4. Data Model

### Table: `public.m1_katara_parcels`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Parcel primary key. |
| `farmer_id` | `uuid` | NOT NULL, FK → `public.profiles(id)` ON DELETE CASCADE | Owner link. |
| `name` | `text` | NOT NULL | Human label (e.g. "Parcelle Nord"). |
| `geojson` | `jsonb` | NOT NULL, CHECK (valid structure) | GeoJSON `Feature` or `Polygon`/`MultiPolygon`. |
| `crop_type` | `text` | NOT NULL | Free text for MVD (e.g. "Tomates", "Poivrons"). |
| `surface_area_ha` | `decimal(10, 4)` | NOT NULL, CHECK > 0 | Surface area in hectares. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Auto-maintained by trigger. |

### RLS Matrix for `m1_katara_parcels`

| Operation | Policy | Condition |
|---|---|---|
| SELECT | `katara_parcels_select_own` | `auth.uid() = farmer_id` |
| SELECT | `katara_parcels_admin_select` | `public.is_admin()` |
| INSERT | `katara_parcels_insert_verified_farmer` | `auth.uid() = farmer_id` AND `has_role('FARMER')` AND `verification_status = 'VERIFIED'` |
| UPDATE | `katara_parcels_update_own` | `auth.uid() = farmer_id` |
| DELETE | `katara_parcels_delete_own` | `auth.uid() = farmer_id` |

---

## 5. Step-by-Step Implementation

### 5.1 Migration 0016 — parcels table

Create [db/migrations/0016_kat01_katara_parcels.sql](../../db/migrations/0016_kat01_katara_parcels.sql):

```sql
-- 0016 — M1 Katara: farmer parcel registry (KAT-01).
-- One parcel = one monitored field. Devices and telemetry attach to this in KAT-02/03.

create table if not exists public.m1_katara_parcels (
    id              uuid            primary key default gen_random_uuid(),
    farmer_id       uuid            not null references public.profiles(id) on delete cascade,
    name            text            not null,
    -- Stored as a raw GeoJSON object (Feature or Polygon/MultiPolygon).
    -- Full structural validation is performed by the FastAPI layer (KAT-01 router).
    -- Basic guard: must be a JSON object with a "type" key.
    geojson         jsonb           not null
                        constraint m1_katara_parcels_geojson_has_type
                            check (jsonb_typeof(geojson) = 'object' and geojson ? 'type'),
    crop_type       text            not null,
    surface_area_ha decimal(10, 4)  not null
                        constraint m1_katara_parcels_area_positive check (surface_area_ha > 0),
    created_at      timestamptz     not null default now(),
    updated_at      timestamptz     not null default now()
);

-- Fast lookup of all parcels owned by a farmer (KAT-04 dashboard, KAT-14 multi-parcel).
create index if not exists m1_katara_parcels_farmer_idx
    on public.m1_katara_parcels (farmer_id);

-- Reuse the set_updated_at() function created in 0002.
create trigger trg_m1_katara_parcels_updated_at
    before update on public.m1_katara_parcels
    for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.m1_katara_parcels enable row level security;

-- Farmer sees only their own parcels.
create policy "katara_parcels_select_own"
    on public.m1_katara_parcels for select
    using (auth.uid() = farmer_id);

-- Admin may read all parcels (monitoring / audit).
create policy "katara_parcels_admin_select"
    on public.m1_katara_parcels for select
    using (public.is_admin());

-- Only a VERIFIED FARMER may create a parcel (AUTH-06 gate).
-- has_role() + verification_status check mirrors the FastAPI require_verified_farmer() guard.
create policy "katara_parcels_insert_verified_farmer"
    on public.m1_katara_parcels for insert
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER')
        and (
            select verification_status
            from   public.profiles
            where  id = auth.uid()
        ) = 'VERIFIED'
    );

-- Farmer may update their own parcels (name, crop type, surface, geojson).
create policy "katara_parcels_update_own"
    on public.m1_katara_parcels for update
    using  (auth.uid() = farmer_id)
    with check (auth.uid() = farmer_id);

-- Farmer may delete their own parcels.
-- KAT-02 will add an app-level guard to block deletion when a device is linked.
create policy "katara_parcels_delete_own"
    on public.m1_katara_parcels for delete
    using (auth.uid() = farmer_id);
```

Apply with:

```bash
supabase db push
```

Verify in the Supabase dashboard: `public.m1_katara_parcels` exists, RLS is **enabled** (green padlock), and five policies are listed.

---

### 5.2 Backend — module scaffold

Create the Katara module directory:

```
backend/app/modules/katara/
    __init__.py
    schemas.py
    router.py
```

---

### 5.3 Backend — Pydantic schemas

[backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py):

```python
from __future__ import annotations

import re
from decimal import Decimal
from typing import Any
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator


# Accepted GeoJSON geometry types for a parcel polygon.
_POLYGON_TYPES = {"Polygon", "MultiPolygon"}


def _validate_geojson(value: dict[str, Any]) -> dict[str, Any]:
    """
    Accepts either:
      - A raw geometry: {"type": "Polygon", "coordinates": [...]}
      - A Feature:      {"type": "Feature", "geometry": {"type": "Polygon", ...}}

    Raises ValueError for anything else so the DB constraint never fires on a
    structurally invalid payload.
    """
    geo_type = value.get("type")
    if geo_type in _POLYGON_TYPES:
        coords = value.get("coordinates")
        if not coords:
            raise ValueError("GeoJSON geometry must have a non-empty 'coordinates' array")
        return value

    if geo_type == "Feature":
        geom = value.get("geometry") or {}
        if geom.get("type") not in _POLYGON_TYPES:
            raise ValueError(
                f"Feature.geometry.type must be Polygon or MultiPolygon, got: {geom.get('type')!r}"
            )
        if not geom.get("coordinates"):
            raise ValueError("GeoJSON Feature geometry must have a non-empty 'coordinates' array")
        return value

    raise ValueError(
        f"geojson.type must be 'Polygon', 'MultiPolygon', or 'Feature', got: {geo_type!r}"
    )


class ParcelCreate(BaseModel):
    name: str
    geojson: dict[str, Any]
    crop_type: str
    surface_area_ha: Decimal

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be blank")
        return v.strip()

    @field_validator("crop_type")
    @classmethod
    def crop_type_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("crop_type must not be blank")
        return v.strip()

    @field_validator("surface_area_ha")
    @classmethod
    def area_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("surface_area_ha must be positive")
        return v

    @field_validator("geojson")
    @classmethod
    def valid_geojson(cls, v: dict[str, Any]) -> dict[str, Any]:
        return _validate_geojson(v)


class ParcelUpdate(BaseModel):
    name: str | None = None
    geojson: dict[str, Any] | None = None
    crop_type: str | None = None
    surface_area_ha: Decimal | None = None

    @field_validator("geojson")
    @classmethod
    def valid_geojson(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None:
            return _validate_geojson(v)
        return v

    @field_validator("surface_area_ha")
    @classmethod
    def area_positive(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v <= 0:
            raise ValueError("surface_area_ha must be positive")
        return v


class ParcelOut(BaseModel):
    id: UUID
    farmer_id: UUID
    name: str
    geojson: dict[str, Any]
    crop_type: str
    surface_area_ha: Decimal
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

---

### 5.4 Backend — FastAPI router

[backend/app/modules/katara/router.py](../../backend/app/modules/katara/router.py):

```python
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import require_role, get_current_user, AuthUser
from app.db import user_scoped_client, service_client
from app.modules.katara.schemas import ParcelCreate, ParcelUpdate, ParcelOut

router = APIRouter(prefix="/katara/parcels", tags=["katara"])


def _require_verified_farmer(current_user: AuthUser = Depends(get_current_user)) -> AuthUser:
    """Application-level guard for AUTH-06: role + verification gate."""
    if current_user.role != "FARMER":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="FARMER role required")
    if current_user.verification_status != "VERIFIED":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Professional verification required. Submit your documents via your profile page.",
        )
    return current_user


@router.post("", response_model=ParcelOut, status_code=status.HTTP_201_CREATED)
async def create_parcel(
    body: ParcelCreate,
    current_user: AuthUser = Depends(_require_verified_farmer),
    token: str = Depends(require_role("FARMER")),
):
    db = user_scoped_client(token)
    result = (
        db.table("m1_katara_parcels")
        .insert(
            {
                "farmer_id": str(current_user.id),
                "name": body.name,
                "geojson": body.geojson,
                "crop_type": body.crop_type,
                "surface_area_ha": str(body.surface_area_ha),
            }
        )
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Parcel creation failed")
    return ParcelOut(**result.data[0])


@router.get("", response_model=list[ParcelOut])
async def list_parcels(
    current_user: AuthUser = Depends(get_current_user),
    token: str = Depends(require_role("FARMER")),
):
    db = user_scoped_client(token)
    result = (
        db.table("m1_katara_parcels")
        .select("*")
        .eq("farmer_id", str(current_user.id))
        .order("created_at", desc=False)
        .execute()
    )
    return [ParcelOut(**row) for row in result.data]


@router.get("/{parcel_id}", response_model=ParcelOut)
async def get_parcel(
    parcel_id: UUID,
    current_user: AuthUser = Depends(get_current_user),
    token: str = Depends(require_role("FARMER")),
):
    db = user_scoped_client(token)
    result = (
        db.table("m1_katara_parcels")
        .select("*")
        .eq("id", str(parcel_id))
        .eq("farmer_id", str(current_user.id))
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Parcel not found")
    return ParcelOut(**result.data)


@router.patch("/{parcel_id}", response_model=ParcelOut)
async def update_parcel(
    parcel_id: UUID,
    body: ParcelUpdate,
    current_user: AuthUser = Depends(_require_verified_farmer),
    token: str = Depends(require_role("FARMER")),
):
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "surface_area_ha" in patch:
        patch["surface_area_ha"] = str(patch["surface_area_ha"])
    if not patch:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No fields to update")

    db = user_scoped_client(token)
    result = (
        db.table("m1_katara_parcels")
        .update(patch)
        .eq("id", str(parcel_id))
        .eq("farmer_id", str(current_user.id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Parcel not found or not owned by you")
    return ParcelOut(**result.data[0])


@router.delete("/{parcel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_parcel(
    parcel_id: UUID,
    current_user: AuthUser = Depends(_require_verified_farmer),
    token: str = Depends(require_role("FARMER")),
):
    db = user_scoped_client(token)
    result = (
        db.table("m1_katara_parcels")
        .delete()
        .eq("id", str(parcel_id))
        .eq("farmer_id", str(current_user.id))
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Parcel not found or not owned by you")
```

Register the router in [backend/app/main.py](../../backend/app/main.py):

```python
from app.modules.katara.router import router as katara_router

app.include_router(katara_router, prefix="/api/v1")
```

---

### 5.5 Frontend — Parcel registration form

Create [frontend/src/app/dashboard/farmer/parcels/new/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/new/page.tsx):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export default function NewParcelPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const rawGeoJSON = form.get("geojson") as string;

    let geojson: unknown;
    try {
      geojson = JSON.parse(rawGeoJSON);
    } catch {
      setError("GeoJSON invalide — vérifiez la syntaxe JSON.");
      setSubmitting(false);
      return;
    }

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch("/api/v1/katara/parcels", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({
        name: form.get("name"),
        crop_type: form.get("crop_type"),
        surface_area_ha: parseFloat(form.get("surface_area_ha") as string),
        geojson,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.detail ?? `Erreur ${res.status}`);
      setSubmitting(false);
      return;
    }

    router.push("/dashboard/farmer/parcels");
    router.refresh();
  }

  return (
    <div className="max-w-xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-semibold mb-6">Nouvelle parcelle</h1>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="name">
            Nom de la parcelle
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="Parcelle Nord"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="crop_type">
            Type de culture
          </label>
          <input
            id="crop_type"
            name="crop_type"
            type="text"
            required
            placeholder="Tomates, Poivrons, Courgettes…"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="surface_area_ha">
            Surface (hectares)
          </label>
          <input
            id="surface_area_ha"
            name="surface_area_ha"
            type="number"
            step="0.0001"
            min="0.0001"
            required
            placeholder="1.5"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="geojson">
            Polygone GeoJSON
          </label>
          <p className="text-xs text-gray-500 mb-1">
            Collez ici le GeoJSON de votre parcelle (type{" "}
            <code className="font-mono">Polygon</code> ou{" "}
            <code className="font-mono">Feature</code>).
          </p>
          <textarea
            id="geojson"
            name="geojson"
            required
            rows={8}
            placeholder='{"type":"Polygon","coordinates":[[[...],[...],[...],[...]]]}'
            className="w-full rounded-md border px-3 py-2 text-sm font-mono"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-green-600 px-4 py-2 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? "Enregistrement…" : "Enregistrer la parcelle"}
        </button>
      </form>
    </div>
  );
}
```

---

### 5.6 Frontend — Parcel list on farmer dashboard

Create [frontend/src/app/dashboard/farmer/parcels/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/page.tsx):

```tsx
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

interface Parcel {
  id: string;
  name: string;
  crop_type: string;
  surface_area_ha: string;
  created_at: string;
}

async function fetchParcels(accessToken: string): Promise<Parcel[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/katara/parcels`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  if (!res.ok) return [];
  return res.json();
}

export default async function ParcelsPage() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  );
  const { data: { session } } = await supabase.auth.getSession();
  const parcels = session ? await fetchParcels(session.access_token) : [];

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Mes parcelles</h1>
        <Link
          href="/dashboard/farmer/parcels/new"
          className="rounded-md bg-green-600 px-4 py-2 text-white text-sm font-medium hover:bg-green-700"
        >
          + Nouvelle parcelle
        </Link>
      </div>

      {parcels.length === 0 ? (
        <p className="text-gray-500 text-sm">
          Aucune parcelle enregistrée. Commencez par en créer une.
        </p>
      ) : (
        <ul className="space-y-3">
          {parcels.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border bg-white px-5 py-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-gray-500">
                    {p.crop_type} · {Number(p.surface_area_ha).toFixed(2)} ha
                  </p>
                </div>
                <Link
                  href={`/dashboard/farmer/parcels/${p.id}`}
                  className="text-sm text-green-700 hover:underline"
                >
                  Détails →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

### 5.7 Backend unit tests

Create [backend/tests/test_kat01_parcels.py](../../backend/tests/test_kat01_parcels.py):

```python
"""KAT-01 parcel CRUD + auth gate tests.

Uses the same `identities` fixture from conftest.py (six accounts: FARMER-A verified,
FARMER-B PENDING, RESTAURANT verified, CITIZEN-A, CITIZEN-B, ADMIN).
Requires SUPABASE_URL to be set; skips cleanly in fast CI without staging credentials.
"""

import json
import pytest

VALID_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [-8.0, 31.0],
            [-8.0, 31.1],
            [-7.9, 31.1],
            [-7.9, 31.0],
            [-8.0, 31.0],
        ]
    ],
}

PARCEL_BODY = {
    "name": "Parcelle Test",
    "crop_type": "Tomates",
    "surface_area_ha": 1.5,
    "geojson": VALID_POLYGON,
}


@pytest.mark.skipif("not config.getoption('--run-e2e')", reason="e2e only")
class TestParcelCreate:
    def test_verified_farmer_creates_parcel(self, api_base_url, identities):
        token = identities["FARMER_A"]["token"]
        res = __import__("requests").post(
            f"{api_base_url}/api/v1/katara/parcels",
            json=PARCEL_BODY,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Parcelle Test"
        assert data["crop_type"] == "Tomates"
        assert float(data["surface_area_ha"]) == 1.5

    def test_pending_farmer_blocked(self, api_base_url, identities):
        token = identities["FARMER_B"]["token"]
        res = __import__("requests").post(
            f"{api_base_url}/api/v1/katara/parcels",
            json=PARCEL_BODY,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403

    def test_restaurant_blocked(self, api_base_url, identities):
        token = identities["RESTAURANT"]["token"]
        res = __import__("requests").post(
            f"{api_base_url}/api/v1/katara/parcels",
            json=PARCEL_BODY,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403

    def test_invalid_geojson_type_rejected(self, api_base_url, identities):
        token = identities["FARMER_A"]["token"]
        bad_body = {**PARCEL_BODY, "geojson": {"type": "Point", "coordinates": [0, 0]}}
        res = __import__("requests").post(
            f"{api_base_url}/api/v1/katara/parcels",
            json=bad_body,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 422


class TestGeoJSONValidator:
    """Pure-unit tests — no network needed."""

    from app.modules.katara.schemas import ParcelCreate

    def test_polygon_accepted(self):
        p = ParcelCreate(
            name="X", crop_type="Y", surface_area_ha=1,
            geojson=VALID_POLYGON,
        )
        assert p.geojson["type"] == "Polygon"

    def test_feature_wrapping_polygon_accepted(self):
        feature = {"type": "Feature", "geometry": VALID_POLYGON, "properties": {}}
        p = ParcelCreate(name="X", crop_type="Y", surface_area_ha=1, geojson=feature)
        assert p.geojson["type"] == "Feature"

    def test_point_rejected(self):
        with pytest.raises(Exception):
            ParcelCreate(
                name="X", crop_type="Y", surface_area_ha=1,
                geojson={"type": "Point", "coordinates": [0, 0]},
            )

    def test_empty_coordinates_rejected(self):
        with pytest.raises(Exception):
            ParcelCreate(
                name="X", crop_type="Y", surface_area_ha=1,
                geojson={"type": "Polygon", "coordinates": []},
            )

    def test_zero_area_rejected(self):
        with pytest.raises(Exception):
            ParcelCreate(name="X", crop_type="Y", surface_area_ha=0, geojson=VALID_POLYGON)

    def test_negative_area_rejected(self):
        with pytest.raises(Exception):
            ParcelCreate(name="X", crop_type="Y", surface_area_ha=-1, geojson=VALID_POLYGON)

    def test_blank_name_rejected(self):
        with pytest.raises(Exception):
            ParcelCreate(name="  ", crop_type="Y", surface_area_ha=1, geojson=VALID_POLYGON)
```

Run unit tests (no network):

```bash
cd backend && pytest tests/test_kat01_parcels.py::TestGeoJSONValidator -v
```

---

### 5.8 AUTH-07 activation note

The `m1_katara_parcels` block in `db/tests/auth07_role_matrix.sql` is currently guarded with `to_regclass('public.m1_katara_parcels') is not null`. Once migration 0016 is applied and merged, those SKIP notices disappear and the 5 RLS cells (FARMER-select-own, FARMER-insert, FARMER-update, FARMER-delete, ADMIN-select) activate in the full matrix run.

No changes to the AUTH-07 test files are needed — the guard pattern handles this automatically.

---

## 6. Verification Checklist

- [ ] `db/migrations/0016_kat01_katara_parcels.sql` applied — table visible in Supabase dashboard with RLS enabled.
- [ ] Five RLS policies listed on `m1_katara_parcels` in the dashboard policy view.
- [ ] `supabase db push` exits 0 on the linked project (`qyyxgdfetzjqfpygikbz`).
- [ ] `pytest tests/test_kat01_parcels.py::TestGeoJSONValidator -v` → 6/6 green (no network).
- [ ] VERIFIED FARMER (FARMER-A) can `POST /api/v1/katara/parcels` → 201.
- [ ] PENDING FARMER (FARMER-B) gets 403 on the same endpoint.
- [ ] RESTAURANT token gets 403.
- [ ] `GET /api/v1/katara/parcels` with FARMER-A token returns only FARMER-A's parcels.
- [ ] FARMER-A cannot read FARMER-B's parcels (RLS isolation).
- [ ] `PATCH /api/v1/katara/parcels/{id}` updates name and returns updated row.
- [ ] `DELETE /api/v1/katara/parcels/{id}` returns 204.
- [ ] Frontend: verified farmer sees parcel list at `/dashboard/farmer/parcels`.
- [ ] Frontend: registration form submits and redirects to list page.
- [ ] Frontend: invalid GeoJSON JSON syntax shows user-facing error (no crash).
- [ ] `make -C db test-auth07` — `m1_katara_parcels` SKIP notices replaced by green TAP lines.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| DB migration | [db/migrations/0016_kat01_katara_parcels.sql](../../db/migrations/0016_kat01_katara_parcels.sql) |
| Pydantic schemas | [backend/app/modules/katara/schemas.py](../../backend/app/modules/katara/schemas.py) |
| FastAPI router | [backend/app/modules/katara/router.py](../../backend/app/modules/katara/router.py) |
| Router registration | [backend/app/main.py](../../backend/app/main.py) — `include_router(katara_router)` |
| Unit tests | [backend/tests/test_kat01_parcels.py](../../backend/tests/test_kat01_parcels.py) |
| Frontend — list page | [frontend/src/app/dashboard/farmer/parcels/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/page.tsx) |
| Frontend — new form | [frontend/src/app/dashboard/farmer/parcels/new/page.tsx](../../frontend/src/app/dashboard/farmer/parcels/new/page.tsx) |
| `spring-status.yml` update | Flip `KAT-01.status` → `DONE`; bump `E2.progress_pct`; update `summary` counters |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Farmer submits invalid GeoJSON coordinates (rings not closed, wrong nesting) | FastAPI validator catches structural issues; DB CHECK is the last-resort guard. Consider adding a `shapely`-based ring-closure check post-MVD. |
| PostGIS extension absent | KAT-01 does not require PostGIS — jsonb storage is sufficient. PostGIS is deferred to SEC-03. |
| Supabase free-tier 500 MB budget | Parcel rows are tiny (~1–5 KB each including GeoJSON polygon). 50 farmers × 5 parcels = negligible. |
| AUTH-07 SKIP count doesn't drop after migration | Verify with `select to_regclass('public.m1_katara_parcels')` in the SQL editor — must return a non-null OID. |
| Farmer accidentally deletes a parcel that has an active device | KAT-02 will add an FK constraint on `m1_katara_devices.parcel_id` and a pre-delete check. The DELETE policy here is intentionally permissive during KAT-01 (no devices exist yet). |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Migration 0016 (write + apply + verify) | 30 min |
| Pydantic schemas + validator | 30 min |
| FastAPI router (5 endpoints) | 45 min |
| Register router in main.py + smoke curl | 10 min |
| Unit tests (GeoJSON validator, 6 assertions) | 20 min |
| Frontend list page | 30 min |
| Frontend registration form | 30 min |
| E2E drill (verified vs pending vs wrong role) | 20 min |
| `spring-status.yml` update | 5 min |
| **Total active work** | **~3.5 h** |

---

## 10. Definition of Done

1. Acceptance criterion met: a VERIFIED FARMER can register a parcel via the API and see it listed on the dashboard. A PENDING FARMER receives 403.
2. Verification checklist (§6) fully ticked.
3. All deliverables (§7) committed and pushed.
4. `pytest tests/test_kat01_parcels.py::TestGeoJSONValidator` → 6/6 green.
5. AUTH-07 `m1_katara_parcels` SKIP notices absent from `make -C db test-auth07` output.
6. [docs/spring-status.yml](../spring-status.yml) updated: `KAT-01.status: DONE`, `E2.progress_pct` incremented.
7. Hand-off note to team: **KAT-02** (device pairing) and **KAT-14** (multi-parcel dashboard) are now unblocked.
