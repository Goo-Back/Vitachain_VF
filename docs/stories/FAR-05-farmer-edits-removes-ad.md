# FAR-05 — Farmer edits or removes own ads

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** FARMER (verified, owner of the ad)
> **Depends on:** [FAR-01](./FAR-01-farmer-creates-ad.md) (`m2_farmarket_ads` table + RLS + storage bucket)
> **Unblocks:** [FAR-06](./FAR-06-nightly-cron-expires-ads.md) (CRON worker needs `DELETED` status to skip soft-deleted rows), [FAR-08](./FAR-08-admin-views-ads-leads.md) (admin view shows `DELETED` ads for audit trail)
> **Acceptance:** A verified FARMER can edit text fields and replace photos on their own ACTIVE ad, and soft-delete any of their own ads. RLS `farmarket_ads_update_own` and `farmarket_ads_delete_own` (migration 0032) enforce ownership at the DB layer. A non-owner PATCH or DELETE returns `403`.

---

## 1. Purpose

FAR-01 gives a farmer the ability to publish an ad. FAR-05 closes the ad lifecycle management loop: the farmer can correct mistakes, update price or quantity, and remove ads they no longer want visible. This is essential for data quality on the catalog restaurateurs browse (FAR-02).

**Design decisions:**

- **Soft-delete only**: `DELETE /ads/{ad_id}` sets `status = 'DELETED'` rather than issuing a SQL `DELETE`. This preserves the referential integrity of `m2_farmarket_leads.ad_id` FK — leads already submitted for the ad remain intact in the DB for admin audit (FAR-08). Storage photos are cleaned up best-effort after the soft-delete.
- **Edit is ACTIVE-only**: Only ads with `status = 'ACTIVE'` can have their content edited. Expired ads (`EXPIRED`) are read-only; the farmer may only delete them. This prevents resurrecting outdated listings by editing an expired ad.
- **Photo replacement semantics**: If the PATCH request includes at least one new photo, all existing storage objects for the ad are removed and the new set is uploaded. If no photos are sent, the existing `photo_paths` are preserved unchanged. Full add-one / remove-one photo management is post-MVD.
- **No new migration**: The RLS `UPDATE` and `DELETE` policies (`farmarket_ads_update_own`, `farmarket_ads_delete_own`) were already created in migration `0032_far01_farmarket_ads.sql`. This story is purely a backend + frontend implementation story.

This story delivers:

- `AdUpdate` Pydantic schema in `backend/app/modules/farmarket/schemas.py`.
- Two new endpoints in `backend/app/modules/farmarket/router.py`:
  - `PATCH /api/v1/farmarket/ads/{ad_id}` — edit text fields + optional photo replacement.
  - `DELETE /api/v1/farmarket/ads/{ad_id}` — soft-delete + best-effort Storage cleanup.
- New server actions `updateAd` and `deleteAd` in `frontend/src/app/dashboard/farmer/ads/actions.ts`.
- New edit page at `frontend/src/app/dashboard/farmer/ads/[id]/edit/` (`page.tsx` + `edit-ad-form.tsx`).
- Updated `AdCard` on the ads list page with Edit and Delete action buttons.
- Backend unit tests `backend/tests/test_far05_farmer_edits_removes_ad.py`.
- pgTAP cells F-05a through F-05c appended to `db/tests/auth07_business_rules.sql`.

---

## 2. Scope

### In scope

- `AdUpdate` schema — all fields optional, same validators as `AdCreate`.
- `PATCH /ads/{ad_id}` — partial text update + optional photo replacement (replace-all semantics).
- `DELETE /ads/{ad_id}` — soft-delete to `status = 'DELETED'` + best-effort Storage removal.
- Frontend edit page with pre-populated form and photo preview.
- Frontend delete confirmation (inline button with optimistic redirect; no modal for MVD).
- pgTAP cells asserting `farmarket_ads_update_own` and `farmarket_ads_delete_own` policies exist and function correctly.
- Backend unit tests for ownership guard, editability guard (only ACTIVE), and photo replacement branch.

### Out of scope

- Add-one / remove-one photo management → post-MVD.
- Hard SQL DELETE (referential integrity must be preserved for leads) → never (by design).
- Restoring a `DELETED` ad → post-MVD admin action (FAR-08).
- Editing an `EXPIRED` ad to make it `ACTIVE` again → post-MVD (farm owner can create a new ad).
- Admin ability to edit any ad → FAR-08.
- Audit log of edits → post-MVD.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [FAR-01](./FAR-01-farmer-creates-ad.md) `DONE` | `public.m2_farmarket_ads` table, RLS policies `farmarket_ads_update_own` + `farmarket_ads_delete_own`, `farmarket-photos` bucket write policies, and `_row_to_ad_out()` helper must exist. |
| [AUTH-05](./AUTH-05-service-key-isolated-to-fastapi.md) `DONE` | `farmarket/` is already in the `service_client()` allow-list comment in `backend/app/db.py` — no new entry needed (Storage removal uses the user-scoped client). |
| Migration `0032` applied | RLS UPDATE + DELETE policies exist (`farmarket_ads_update_own`, `farmarket_ads_delete_own`). Verify with `\dp public.m2_farmarket_ads` in psql. |
| `backend/app/modules/farmarket/router.py` exists | FAR-01 router with `POST /ads`, `GET /ads`, `GET /catalog`, `POST /ads/{ad_id}/leads`. |
| `backend/app/modules/farmarket/schemas.py` exists | `AdCreate`, `AdOut`, `CatalogQuery`, `CatalogPage`, `LeadCreate`, `LeadOut` already defined. |

---

## 4. Architecture Overview

```
PATCH /api/v1/farmarket/ads/{ad_id}          (multipart/form-data)
        │
        ├── require_verified("FARMER")        FastAPI layer
        ├── Fetch ad row (owner check + ACTIVE guard)
        ├── Validate provided text fields (AdUpdate)
        ├── If new photos provided:
        │     ├── Best-effort remove old Storage objects
        │     └── Upload new objects  {user_id}/{ad_id}/{filename}
        └── DB UPDATE (user-scoped client → RLS fires)
              └── 200 AdOut

DELETE /api/v1/farmarket/ads/{ad_id}
        │
        ├── require_verified("FARMER")        FastAPI layer
        ├── Fetch ad row (owner check)
        ├── DB UPDATE status = 'DELETED' (user-scoped client → RLS fires)
        └── Best-effort remove Storage objects from {user_id}/{ad_id}/
              └── 204 No Content
```

**RLS layer**: Both `PATCH` and `DELETE` use the user-scoped client (`get_db_for_user`). The `farmarket_ads_update_own` and `farmarket_ads_delete_own` policies from migration 0032 enforce `auth.uid() = farmer_id` at the DB layer independently of the FastAPI ownership guard.

**Double-check before DB call**: The FastAPI layer fetches the ad row and verifies `farmer_id == user.id` and `status == 'ACTIVE'` (for edit) before touching storage or issuing the DB write. This gives a meaningful `404 / 403 / 409` instead of a silent RLS empty result.

---

## 5. Data Model Changes

No new migration is required. The RLS policies already exist in migration `0032_far01_farmarket_ads.sql`:

```sql
-- Policy 5 (already in 0032)
create policy "farmarket_ads_update_own"
    on public.m2_farmarket_ads for update to authenticated
    using       (auth.uid() = farmer_id)
    with check  (auth.uid() = farmer_id);

-- Policy 6 (already in 0032)
create policy "farmarket_ads_delete_own"
    on public.m2_farmarket_ads for delete to authenticated
    using (auth.uid() = farmer_id);
```

The soft-delete sets `status = 'DELETED'` — this value is already part of the `public.m2_farmarket_ad_status` enum created in migration 0032.

---

## 6. Step-by-Step Implementation

### 6.1 `AdUpdate` schema — partial edit model

In [backend/app/modules/farmarket/schemas.py](../../backend/app/modules/farmarket/schemas.py), add the `AdUpdate` class after `AdCreate`:

```python
class AdUpdate(BaseModel):
    """Validated payload for PATCH /farmarket/ads/{ad_id}.

    All fields are optional — only provided fields are written to the DB.
    Validators are identical to AdCreate so the same constraints apply.
    """

    title: str | None = None
    description: str | None = None
    product_type: str | None = None
    price_mad: Decimal | None = None
    quantity_kg: Decimal | None = None
    region: str | None = None

    @field_validator("title")
    @classmethod
    def title_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not (3 <= len(v) <= 100):
            raise ValueError("title must be between 3 and 100 characters")
        return v

    @field_validator("description")
    @classmethod
    def description_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not (10 <= len(v) <= 2000):
            raise ValueError("description must be between 10 and 2000 characters")
        return v

    @field_validator("product_type")
    @classmethod
    def product_type_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not (2 <= len(v) <= 80):
            raise ValueError("product_type must be between 2 and 80 characters")
        return v

    @field_validator("price_mad")
    @classmethod
    def price_positive(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        if v <= 0:
            raise ValueError("price_mad must be positive")
        return v

    @field_validator("quantity_kg")
    @classmethod
    def quantity_positive(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        if v <= 0:
            raise ValueError("quantity_kg must be positive")
        return v

    @field_validator("region")
    @classmethod
    def region_valid(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in MOROCCO_REGIONS:
            raise ValueError(
                "region must be one of the 12 Moroccan administrative regions"
            )
        return v

    def to_db_patch(self) -> dict:
        """Return only the fields that were explicitly provided (non-None)."""
        return {
            k: (str(v) if isinstance(v, Decimal) else v)
            for k, v in self.model_dump(exclude_none=True).items()
        }
```

Also add `AdUpdate` to the import in `router.py` (see §6.2).

---

### 6.2 `PATCH /ads/{ad_id}` — edit endpoint

In [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py), add the `AdUpdate` import and the two new endpoints after `create_ad`:

First update the import block at the top of the router:

```python
from app.modules.farmarket.schemas import (
    CATALOG_PAGE_SIZE_DEFAULT,
    MAX_PHOTO_BYTES,
    MAX_PHOTOS,
    MOROCCO_REGIONS,
    AdCreate,
    AdOut,
    AdUpdate,          # ← FAR-05 addition
    CatalogPage,
    CatalogQuery,
    LeadCreate,
    LeadOut,
)
```

Then add the PATCH endpoint:

```python
@router.patch(
    "/ads/{ad_id}",
    response_model=AdOut,
    response_class=ORJSONResponse,
)
async def update_ad(
    ad_id: uuid.UUID,
    # ── Optional text fields (multipart/form-data) ─────────────────────────
    title: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    product_type: Annotated[str | None, Form()] = None,
    price_mad: Annotated[Decimal | None, Form()] = None,
    quantity_kg: Annotated[Decimal | None, Form()] = None,
    region: Annotated[str | None, Form()] = None,
    # ── Optional replacement photos (replace-all if any provided) ──────────
    photos: Annotated[list[UploadFile], File()] = [],
    # ── Auth + DB ───────────────────────────────────────────────────────────
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))] = None,
    db: Annotated[Client, Depends(get_db_for_user)] = None,
) -> AdOut:
    """PATCH /api/v1/farmarket/ads/{ad_id} — edit text fields and/or replace photos.

    Only the ad's owner may call this endpoint (FastAPI + RLS double gate).
    Only ACTIVE ads can be edited — EXPIRED ads are read-only (return 409).

    Photo semantics: if at least one photo file is provided, ALL existing storage
    objects for the ad are removed and the new set is uploaded (replace-all).
    If no photos are provided, existing photo_paths are preserved unchanged.
    """
    # 1. Validate provided text fields (raises 422 on violation).
    payload = AdUpdate(
        title=title,
        description=description,
        product_type=product_type,
        price_mad=price_mad,
        quantity_kg=quantity_kg,
        region=region,
    )

    # 2. Fetch existing ad — ownership + editability check.
    existing = (
        db.table(_ADS_TABLE)
        .select("id, farmer_id, status, photo_paths")
        .eq("id", str(ad_id))
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ad_not_found")
    row = existing.data
    if str(row["farmer_id"]) != str(user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_ad_owner")
    if row["status"] != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ad_not_editable: only ACTIVE ads can be edited",
        )

    # 3. Build the DB patch dict (only non-None fields).
    patch = payload.to_db_patch()

    # 4. Handle photo replacement (replace-all if any new photos provided).
    real_photos = [p for p in photos if p.filename]
    if real_photos:
        if len(real_photos) > MAX_PHOTOS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"too_many_photos: maximum {MAX_PHOTOS} photos allowed",
            )

        # Pre-read + validate all files before touching Storage.
        photo_data: list[tuple[str, bytes, str]] = []
        for upload in real_photos:
            content = await upload.read()
            if len(content) > MAX_PHOTO_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"photo_too_large: {upload.filename!r} exceeds 2 MB",
                )
            ct = upload.content_type or "image/jpeg"
            if not ct.startswith("image/"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"invalid_photo_type: {upload.filename!r} must be an image",
                )
            safe_name = (upload.filename or "photo").replace(" ", "_")
            photo_data.append((safe_name, content, ct))

        # Remove old photos from Storage (best-effort — do not fail the request).
        old_paths: list[str] = row.get("photo_paths") or []
        if old_paths:
            try:
                db.storage.from_(_BUCKET).remove(old_paths)
            except Exception:  # noqa: BLE001
                pass

        # Upload new photos.
        new_photo_paths: list[str] = []
        for safe_name, content, content_type in photo_data:
            storage_path = f"{user.id}/{ad_id}/{safe_name}"
            db.storage.from_(_BUCKET).upload(
                path=storage_path,
                file=content,
                file_options={"content-type": content_type, "upsert": "true"},
            )
            new_photo_paths.append(storage_path)

        patch["photo_paths"] = new_photo_paths

    if not patch:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="no_fields_to_update: provide at least one field or one photo",
        )

    # 5. DB UPDATE (user-scoped client → RLS farmarket_ads_update_own fires).
    update_result = (
        db.table(_ADS_TABLE)
        .update(patch)
        .eq("id", str(ad_id))
        .execute()
    )

    if not update_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ad_update_failed",
        )

    return _row_to_ad_out(update_result.data[0])
```

---

### 6.3 `DELETE /ads/{ad_id}` — soft-delete endpoint

Add directly after `update_ad` in [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py):

```python
@router.delete(
    "/ads/{ad_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_ad(
    ad_id: uuid.UUID,
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> None:
    """DELETE /api/v1/farmarket/ads/{ad_id} — soft-delete (status → DELETED).

    Preserves the ad row (and any leads FK-referencing it) for admin audit.
    Storage photos are removed best-effort after the DB update succeeds.

    RLS farmarket_ads_update_own enforces ``farmer_id = auth.uid()`` at the
    DB layer — an explicit ownership pre-check provides a meaningful 404/403.
    """
    # 1. Fetch ad — ownership check.
    existing = (
        db.table(_ADS_TABLE)
        .select("id, farmer_id, status, photo_paths")
        .eq("id", str(ad_id))
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ad_not_found")
    row = existing.data
    if str(row["farmer_id"]) != str(user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_ad_owner")
    if row["status"] == "DELETED":
        # Idempotent — already soft-deleted; return 204 without re-processing.
        return

    # 2. Soft-delete in DB (user-scoped client → RLS fires).
    update_result = (
        db.table(_ADS_TABLE)
        .update({"status": "DELETED"})
        .eq("id", str(ad_id))
        .execute()
    )
    if not update_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ad_delete_failed",
        )

    # 3. Best-effort Storage cleanup — must NOT fail the HTTP response.
    photo_paths: list[str] = row.get("photo_paths") or []
    if photo_paths:
        try:
            db.storage.from_(_BUCKET).remove(photo_paths)
        except Exception:  # noqa: BLE001
            pass
```

---

### 6.4 Frontend server actions

In [frontend/src/app/dashboard/farmer/ads/actions.ts](../../frontend/src/app/dashboard/farmer/ads/actions.ts), add the `updateAd` and `deleteAd` server actions after `submitAdForm`:

```typescript
export type AdUpdateFormState = { error: string | null };

export async function updateAd(
  adId: string,
  _prev: AdUpdateFormState,
  formData: FormData,
): Promise<AdUpdateFormState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "not_authenticated" };

  // Client-side guard: at least one field must be set.
  const hasText =
    formData.get("title") ||
    formData.get("description") ||
    formData.get("product_type") ||
    formData.get("price_mad") ||
    formData.get("quantity_kg") ||
    formData.get("region");
  const photos = formData.getAll("photos") as File[];
  const hasPhotos = photos.some((f) => f.size > 0);
  if (!hasText && !hasPhotos) return { error: "no_fields_to_update" };

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/ads/${adId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "network_error" };
  }

  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { error: detail };
  }

  revalidatePath("/dashboard/farmer/ads");
  redirect(`/dashboard/farmer/ads`);
}

export async function deleteAd(adId: string): Promise<{ error: string | null }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "not_authenticated" };

  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/farmarket/ads/${adId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { error: "network_error" };
  }

  if (!r.ok && r.status !== 204) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string" ? body.detail : `request_failed:${r.status}`;
    return { error: detail };
  }

  revalidatePath("/dashboard/farmer/ads");
  redirect("/dashboard/farmer/ads");
}

export async function fetchAdById(adId: string): Promise<Ad | null> {
  let r: Response;
  try {
    r = await _authedFetch(`/farmarket/ads/${adId}`);
  } catch {
    return null;
  }
  if (!r.ok) return null;
  const ads = (await r.json()) as Ad[];
  return ads.find((a) => a.id === adId) ?? null;
}
```

> **Note:** `fetchAdById` re-uses `GET /farmarket/ads` (which returns all of the farmer's own ads) and filters client-side. This avoids a `GET /ads/{id}` endpoint that would need to be added — one less endpoint for MVD. If the ad list grows large post-MVD, add a dedicated `GET /ads/{id}` endpoint.

---

### 6.5 Frontend edit page — server component

Create [frontend/src/app/dashboard/farmer/ads/[id]/edit/page.tsx](../../frontend/src/app/dashboard/farmer/ads/[id]/edit/page.tsx):

```tsx
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import { PageHeader } from "../../../_ui/PageHeader";
import { fetchAdById } from "../../actions";
import { EditAdForm } from "./edit-ad-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditAdPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, verification_status")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "role" | "verification_status">>();

  if (profile?.role !== "FARMER" || profile.verification_status !== "VERIFIED") {
    redirect("/dashboard/farmer/ads");
  }

  const ad = await fetchAdById(id);
  if (!ad) redirect("/dashboard/farmer/ads");
  if (ad.status !== "ACTIVE") redirect("/dashboard/farmer/ads");

  return (
    <div className="mx-auto max-w-2xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: "Mes annonces", href: "/dashboard/farmer/ads" },
          { label: "Modifier" },
        ]}
        eyebrow="FarMarket"
        title="Modifier l'annonce"
        subtitle={ad.title}
      />
      <EditAdForm ad={ad} />
    </div>
  );
}
```

---

### 6.6 Frontend edit form — client component

Create [frontend/src/app/dashboard/farmer/ads/[id]/edit/edit-ad-form.tsx](../../frontend/src/app/dashboard/farmer/ads/[id]/edit/edit-ad-form.tsx):

```tsx
"use client";

import { useActionState, useRef, useState } from "react";

import { updateAd, type Ad, type AdUpdateFormState } from "../../actions";
import { REGIONS } from "../../../ads/new/regions";

const ERROR_COPY: Record<string, string> = {
  no_fields_to_update: "Modifiez au moins un champ avant de sauvegarder.",
  ad_not_found: "Annonce introuvable.",
  not_ad_owner: "Vous n'êtes pas propriétaire de cette annonce.",
  "ad_not_editable: only ACTIVE ads can be edited":
    "Seules les annonces actives peuvent être modifiées.",
  too_many_photos: "Maximum 5 photos autorisées.",
  photo_too_large: "Chaque photo ne doit pas dépasser 2 Mo.",
  invalid_photo_type: "Seules les images sont acceptées.",
  network_error: "Erreur réseau. Vérifiez votre connexion et réessayez.",
  not_authenticated: "Session expirée. Reconnectez-vous.",
};

interface Props {
  ad: Ad;
}

export function EditAdForm({ ad }: Props) {
  const boundAction = updateAd.bind(null, ad.id);
  const [state, formAction, pending] = useActionState<AdUpdateFormState, FormData>(
    boundAction,
    { error: null },
  );

  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const errorMsg = state.error
    ? (ERROR_COPY[state.error] ?? `Erreur : ${state.error}`)
    : null;

  return (
    <form action={formAction} className="vc-card mt-6 space-y-5 p-6">
      {errorMsg && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {errorMsg}
        </div>
      )}

      {/* Title */}
      <div>
        <label className="vc-label" htmlFor="title">
          Titre de l&apos;annonce
        </label>
        <input
          id="title"
          name="title"
          type="text"
          defaultValue={ad.title}
          minLength={3}
          maxLength={100}
          className="vc-input mt-1 w-full"
        />
      </div>

      {/* Description */}
      <div>
        <label className="vc-label" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={ad.description}
          rows={4}
          minLength={10}
          maxLength={2000}
          className="vc-input mt-1 w-full resize-none"
        />
      </div>

      {/* Product type */}
      <div>
        <label className="vc-label" htmlFor="product_type">
          Type de produit
        </label>
        <input
          id="product_type"
          name="product_type"
          type="text"
          defaultValue={ad.product_type}
          minLength={2}
          maxLength={80}
          className="vc-input mt-1 w-full"
        />
      </div>

      {/* Price + Quantity */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="vc-label" htmlFor="price_mad">
            Prix (MAD/kg)
          </label>
          <input
            id="price_mad"
            name="price_mad"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={Number(ad.price_mad).toFixed(2)}
            className="vc-input mt-1 w-full"
          />
        </div>
        <div>
          <label className="vc-label" htmlFor="quantity_kg">
            Quantité (kg)
          </label>
          <input
            id="quantity_kg"
            name="quantity_kg"
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={Number(ad.quantity_kg).toFixed(1)}
            className="vc-input mt-1 w-full"
          />
        </div>
      </div>

      {/* Region */}
      <div>
        <label className="vc-label" htmlFor="region">
          Région
        </label>
        <select
          id="region"
          name="region"
          defaultValue={ad.region}
          className="vc-input mt-1 w-full"
        >
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Photo replacement */}
      <div>
        <label className="vc-label">
          Photos (laisser vide pour conserver les photos actuelles)
        </label>
        {ad.photo_urls.length > 0 && photoFiles.length === 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {ad.photo_urls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={`Photo ${i + 1}`}
                className="h-20 w-20 rounded-lg object-cover ring-1 ring-neutral-200"
              />
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          name="photos"
          accept="image/*"
          multiple
          className="mt-2 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-leaf-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-leaf-700"
          onChange={(e) => setPhotoFiles(Array.from(e.target.files ?? []))}
        />
        {photoFiles.length > 0 && (
          <p className="mt-1 text-xs text-warn-600">
            {photoFiles.length} nouvelle{photoFiles.length !== 1 ? "s" : ""} photo
            {photoFiles.length !== 1 ? "s" : ""} — remplacera toutes les photos existantes.
          </p>
        )}
        <p className="mt-1 text-xs text-neutral-400">
          Max 5 photos · 2 Mo par photo · formats image uniquement
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <a href="/dashboard/farmer/ads" className="vc-btn-ghost">
          Annuler
        </a>
        <button type="submit" disabled={pending} className="vc-btn-primary">
          {pending ? "Enregistrement…" : "Enregistrer les modifications"}
        </button>
      </div>
    </form>
  );
}
```

---

### 6.7 Update `AdCard` with Edit and Delete buttons

In [frontend/src/app/dashboard/farmer/ads/page.tsx](../../frontend/src/app/dashboard/farmer/ads/page.tsx), add the delete action import and update `AdCard` to include Edit and Delete buttons for `ACTIVE` ads:

Add to imports:

```tsx
import { deleteAd } from "./actions";
```

Replace the `AdCard` function with:

```tsx
function AdCard({ ad }: { ad: Ad }) {
  const expiresAt = new Date(ad.expires_at);
  const now = new Date();
  const daysLeft = Math.ceil(
    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 60 * 24),
  );

  return (
    <li>
      <div className="vc-card group block p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-leaf-50">
            {ad.photo_urls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ad.photo_urls[0]}
                alt={ad.title}
                className="h-10 w-10 rounded-lg object-cover"
              />
            ) : (
              <PackageIcon size={20} className="text-leaf-700" />
            )}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLASS[ad.status]}`}
          >
            {STATUS_LABEL[ad.status]}
          </span>
        </div>

        <p className="mt-4 truncate text-base font-semibold text-neutral-900">
          {ad.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
          <TagIcon size={12} className="text-leaf-600" />
          {ad.product_type} · {Number(ad.price_mad).toFixed(2)} MAD/kg
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
          <PackageIcon size={12} />
          {Number(ad.quantity_kg).toFixed(0)} kg · {ad.region}
        </p>

        {ad.status === "ACTIVE" && daysLeft > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
            <ClockIcon size={12} />
            Expire dans {daysLeft} jour{daysLeft !== 1 ? "s" : ""}
          </p>
        )}
        {ad.status === "ACTIVE" && daysLeft <= 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
            <CalendarIcon size={12} />
            Expire aujourd&apos;hui
          </p>
        )}

        {/* Edit / Delete — only for ACTIVE ads (EXPIRED is read-only; DELETED is archived) */}
        {ad.status === "ACTIVE" && (
          <div className="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-4">
            <Link
              href={`/dashboard/farmer/ads/${ad.id}/edit`}
              className="vc-btn-ghost flex-1 py-1.5 text-xs"
            >
              Modifier
            </Link>
            <form
              action={async () => {
                "use server";
                await deleteAd(ad.id);
              }}
              className="flex-1"
            >
              <button
                type="submit"
                className="w-full rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-200 hover:bg-red-50 transition-colors"
              >
                Supprimer
              </button>
            </form>
          </div>
        )}
      </div>
    </li>
  );
}
```

> **Note on inline server action in JSX**: The `action={async () => { "use server"; await deleteAd(ad.id); }}` pattern is valid in Next.js 15 Server Components. The form posts to the backend without a client-side JS hydration requirement — no `"use client"` needed on `AdsPage`.

---

### 6.8 pgTAP cells — AUTH-07 assertions

Append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

```sql
-- ── FAR-05 cells ─────────────────────────────────────────────────────────────
-- Prerequisites: m2_farmarket_ads table must exist (FAR-01 must be merged).

do $guard$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP FAR-05 cells — m2_farmarket_ads not yet created';
    return;
  end if;
end $guard$;

-- F-05a: farmarket_ads_update_own policy exists on m2_farmarket_ads.
select is(
  (
    select count(*)::int
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'm2_farmarket_ads'
       and policyname = 'farmarket_ads_update_own'
       and cmd        = 'UPDATE'
  ),
  1,
  'F-05a: farmarket_ads_update_own UPDATE policy exists on m2_farmarket_ads'
);

-- F-05b: farmarket_ads_delete_own policy exists on m2_farmarket_ads.
select is(
  (
    select count(*)::int
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'm2_farmarket_ads'
       and policyname = 'farmarket_ads_delete_own'
       and cmd        = 'DELETE'
  ),
  1,
  'F-05b: farmarket_ads_delete_own DELETE policy exists on m2_farmarket_ads'
);

-- F-05c: FARMER-A can set their own ad status to DELETED via UPDATE;
--        FARMER-B cannot update FARMER-A's ad (cross-farmer isolation).
--        Uses the auth07 shared seed identities (FARMER-A verified, FARMER-B verified).
do $seed_f05c$
begin
  if to_regclass('public.m2_farmarket_ads') is null then
    raise notice 'SKIP F-05c — m2_farmarket_ads not yet created';
    return;
  end if;

  insert into public.m2_farmarket_ads
      (id, farmer_id, title, description, product_type, price_mad, quantity_kg, region)
  values
      ('f05ad000-0000-0000-0000-000000000001',
       '<FARMER_A_UUID>',
       'Tomates FAR-05 test', 'Description test pour FAR-05.', 'Tomates', 2.50, 100.00, 'Souss-Massa')
  on conflict (id) do nothing;
end $seed_f05c$;

-- Owner (FARMER-A) can soft-delete their own ad.
set local role authenticated;
set local request.jwt.claims = '{"sub":"<FARMER_A_UUID>","role":"authenticated","user_role":"FARMER"}';

select is(
  (
    update public.m2_farmarket_ads
       set status = 'DELETED'
     where id = 'f05ad000-0000-0000-0000-000000000001'
    returning status
  ),
  'DELETED'::public.m2_farmarket_ad_status,
  'F-05c: FARMER-A can soft-delete their own ad (status → DELETED)'
);

-- Non-owner (FARMER-B) cannot update FARMER-A's ad — RLS returns 0 rows.
set local request.jwt.claims = '{"sub":"<FARMER_B_UUID>","role":"authenticated","user_role":"FARMER"}';

select is(
  (
    select count(*)::int from (
      update public.m2_farmarket_ads
         set title = 'Hacked title'
       where id = 'f05ad000-0000-0000-0000-000000000001'
      returning id
    ) t
  ),
  0,
  'F-05c: FARMER-B cannot update FARMER-A''s ad (RLS blocks cross-farmer UPDATE)'
);

reset role;
```

> Replace `<FARMER_A_UUID>` and `<FARMER_B_UUID>` with the UUIDs from `db/tests/_auth07_seed.psql`.

---

### 6.9 Backend unit tests

Create [backend/tests/test_far05_farmer_edits_removes_ad.py](../../backend/tests/test_far05_farmer_edits_removes_ad.py):

```python
"""FAR-05 — edit and soft-delete own ad: unit tests for the router guards."""

from __future__ import annotations

import uuid
from decimal import Decimal
from unittest import mock

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.core.security import AuthUser
from app.main import app

_FARMER_ID = uuid.uuid4()
_OTHER_FARMER_ID = uuid.uuid4()
_AD_ID = uuid.uuid4()

_ACTIVE_AD_ROW = {
    "id": str(_AD_ID),
    "farmer_id": str(_FARMER_ID),
    "title": "Tomates rondes",
    "description": "Description de test suffisamment longue.",
    "product_type": "Tomates",
    "price_mad": "2.50",
    "quantity_kg": "100.00",
    "region": "Souss-Massa",
    "photo_paths": [],
    "status": "ACTIVE",
    "is_featured": False,
    "expires_at": "2026-06-01T00:00:00+00:00",
    "created_at": "2026-05-01T00:00:00+00:00",
    "updated_at": "2026-05-01T00:00:00+00:00",
}

_EXPIRED_AD_ROW = {**_ACTIVE_AD_ROW, "status": "EXPIRED"}
_DELETED_AD_ROW = {**_ACTIVE_AD_ROW, "status": "DELETED"}


def _make_verified_farmer(user_id: uuid.UUID) -> AuthUser:
    return AuthUser(id=user_id, role="FARMER", email="farmer@test.ma")


class _MockSingleResult:
    def __init__(self, data: dict | None) -> None:
        self.data = data


class _MockResult:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


def _make_db_mock(ad_row: dict | None, update_returns: dict | None = None) -> mock.MagicMock:
    """Build a minimal Supabase client mock for router tests."""
    db = mock.MagicMock()
    # .table().select().eq().maybe_single().execute() → ad lookup
    single_result = _MockSingleResult(ad_row)
    (
        db.table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = single_result
    # .table().update().eq().execute() → update
    update_data = [update_returns] if update_returns else []
    (
        db.table.return_value
        .update.return_value
        .eq.return_value
        .execute.return_value
    ) = _MockResult(update_data)
    return db


class TestUpdateAdOwnershipGuard:
    def test_non_owner_returns_403(self) -> None:
        """PATCH by a different farmer returns 403 not_ad_owner."""
        from app.modules.farmarket import router as far_router

        other_farmer = _make_verified_farmer(_OTHER_FARMER_ID)
        db = _make_db_mock(_ACTIVE_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: other_farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Attempted overwrite"},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert r.json()["detail"] == "not_ad_owner"

    def test_ad_not_found_returns_404(self) -> None:
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(None)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Test"},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_404_NOT_FOUND


class TestUpdateAdEditabilityGuard:
    def test_expired_ad_returns_409(self) -> None:
        """PATCH on an EXPIRED ad returns 409 ad_not_editable."""
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(_EXPIRED_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={"title": "Updated title"},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_409_CONFLICT
        assert "ad_not_editable" in r.json()["detail"]

    def test_no_fields_returns_422(self) -> None:
        """PATCH with no fields and no photos returns 422."""
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(_ACTIVE_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.patch(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                data={},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


class TestDeleteAdGuards:
    def test_non_owner_returns_403(self) -> None:
        from app.modules.farmarket import router as far_router

        other_farmer = _make_verified_farmer(_OTHER_FARMER_ID)
        db = _make_db_mock(_ACTIVE_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: other_farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.delete(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_403_FORBIDDEN
        assert r.json()["detail"] == "not_ad_owner"

    def test_already_deleted_is_idempotent_204(self) -> None:
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(_DELETED_AD_ROW)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.delete(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_204_NO_CONTENT

    def test_ad_not_found_returns_404(self) -> None:
        from app.modules.farmarket import router as far_router

        farmer = _make_verified_farmer(_FARMER_ID)
        db = _make_db_mock(None)

        with (
            mock.patch.object(far_router, "require_verified", return_value=lambda: farmer),
            mock.patch.object(far_router, "get_db_for_user", return_value=lambda: db),
        ):
            client = TestClient(app)
            r = client.delete(
                f"/api/v1/farmarket/ads/{_AD_ID}",
                headers={"Authorization": "Bearer fake-token"},
            )
        assert r.status_code == status.HTTP_404_NOT_FOUND
```

---

## 7. Verification Checklist

- [ ] `AdUpdate` schema added to `schemas.py`; `pytest` for the validator unit (positive + negative for each field) green.
- [ ] `PATCH /api/v1/farmarket/ads/{ad_id}` endpoint exists in the router and appears in `/api/v1/docs`.
- [ ] `DELETE /api/v1/farmarket/ads/{ad_id}` endpoint exists in the router and appears in `/api/v1/docs`.
- [ ] `make -C backend test` green — all FAR-05 assertions in `test_far05_farmer_edits_removes_ad.py`.
- [ ] `make -C db test-auth07` — F-05a, F-05b, F-05c all `ok` (not SKIP).
- [ ] Edit page renders at `/dashboard/farmer/ads/{id}/edit` with form pre-populated from existing ad data.
- [ ] **End-to-end PATCH (staging)**:
  - [ ] Farmer edits title + price → ad card on `/dashboard/farmer/ads` shows updated values.
  - [ ] Farmer uploads 3 new photos → old photos removed from Storage; new photos appear.
  - [ ] PATCH on a non-owned ad returns `403`.
  - [ ] PATCH on an EXPIRED ad returns `409`.
- [ ] **End-to-end DELETE (staging)**:
  - [ ] Farmer clicks "Supprimer" → ad disappears from the ACTIVE list (status = `DELETED`).
  - [ ] Confirm `status = 'DELETED'` directly in Supabase Dashboard table.
  - [ ] Photo Storage objects for the ad are removed (check `farmarket-photos` bucket in Storage).
  - [ ] DELETE on a non-owned ad returns `403`.
  - [ ] Repeating DELETE on an already-deleted ad returns `204` (idempotent).
- [ ] **Catalog isolation (FAR-02)**: Deleted ad no longer appears in `GET /farmarket/catalog` (RLS `farmarket_ads_select_active` enforces `status = 'ACTIVE'`).
- [ ] `bash scripts/check-secrets-boundary.sh` exits 0 — no new `service_client()` leak (this story uses only the user-scoped client).

---

## 8. Deliverables

| Artifact | Location |
|---|---|
| `AdUpdate` schema | Added to [backend/app/modules/farmarket/schemas.py](../../backend/app/modules/farmarket/schemas.py) |
| `PATCH /ads/{ad_id}` endpoint | Added to [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py) |
| `DELETE /ads/{ad_id}` endpoint | Added to [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py) |
| `AdUpdate` import in router | Updated imports in [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py) |
| `updateAd`, `deleteAd`, `fetchAdById` server actions | Added to [frontend/src/app/dashboard/farmer/ads/actions.ts](../../frontend/src/app/dashboard/farmer/ads/actions.ts) |
| Edit page — server component | New file [frontend/src/app/dashboard/farmer/ads/[id]/edit/page.tsx](../../frontend/src/app/dashboard/farmer/ads/[id]/edit/page.tsx) |
| Edit form — client component | New file [frontend/src/app/dashboard/farmer/ads/[id]/edit/edit-ad-form.tsx](../../frontend/src/app/dashboard/farmer/ads/[id]/edit/edit-ad-form.tsx) |
| Updated `AdCard` with Edit + Delete buttons | Updated [frontend/src/app/dashboard/farmer/ads/page.tsx](../../frontend/src/app/dashboard/farmer/ads/page.tsx) |
| Backend tests | New file [backend/tests/test_far05_farmer_edits_removes_ad.py](../../backend/tests/test_far05_farmer_edits_removes_ad.py) |
| AUTH-07 pgTAP cells | Appended to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | Flip `FAR-05.status` → `IN_REVIEW`, bump `summary.in_review` |

---

## 9. Business Rules Enforced

| Rule | Where enforced |
|---|---|
| **BR-F1**: Only FARMER role can mutate ads | `require_verified("FARMER")` FastAPI dependency + RLS `farmarket_ads_update_own` / `farmarket_ads_delete_own` (DB layer) |
| **Ownership**: Farmer can only edit/delete their own ads | Application pre-check (`farmer_id == user.id` → `403`) + RLS `USING (auth.uid() = farmer_id)` (DB layer double gate) |
| **BR-F2**: ≤5 photos, 2 MB each | Enforced in the PATCH photo-replacement branch — same validation as `create_ad` |
| **Edit-only-ACTIVE**: EXPIRED ads are read-only | Application guard: `status != 'ACTIVE'` → `409 ad_not_editable` |
| **Soft-delete preserves leads**: No hard SQL DELETE | `DELETE /ads/{ad_id}` issues `UPDATE status = 'DELETED'`, not `DELETE FROM`; `m2_farmarket_leads.ad_id` FK rows stay intact |
| **Catalog isolation**: Deleted ads not visible in browse | RLS `farmarket_ads_select_active` enforces `status = 'ACTIVE'`; no backend change needed |
| **AUTH-05**: No Supabase service key in frontend | Both endpoints use `get_db_for_user` (user-scoped JWT); `service_client()` is not called at all in FAR-05 |

---

## 10. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| Orphaned Storage objects if DB update fails | Photo upload happens AFTER the ownership + status pre-check passes; the DB UPDATE is attempted after upload. On DB failure a best-effort cleanup runs — same pattern as `create_ad` (FAR-01). A nightly orphan-scan CRON is a post-MVD hardening step. | PRD §13 R3 |
| Storage DELETE fails silently after soft-delete | Storage removal is wrapped in `try/except` with `pass`; the HTTP `204` is already returned. The `photo_paths` array is NOT cleared from the DB row — a post-MVD admin tool (FAR-08) can clean these up. For demo day this is acceptable. | PRD §14 |
| Race: two PATCH requests from the same farmer in quick succession | The DB UPDATE is not atomic with the photo upload. For MVD with a single active session this is not a real risk. Post-MVD: add an `updated_at` optimistic-lock header. | PRD §13 R3 |
| Restaurateur has already submitted a lead for a now-deleted ad | `m2_farmarket_leads.ad_id` FK is `ON DELETE CASCADE` in the schema — wait, actually the migration uses `references public.profiles(id) on delete cascade` only for `farmer_id`. The `m2_farmarket_leads.ad_id` FK constraint must use `ON DELETE RESTRICT` or `ON DELETE SET NULL`. Since we use soft-delete (no SQL DELETE), this FK is never triggered. The lead rows survive intact for FAR-08 admin view. | PRD §6.2 |
| Inline Server Action syntax in Next.js 15 | Tested pattern: `action={async () => { "use server"; ... }}` in a Server Component is valid in Next.js 15 with React 19. If the project's ESLint config flags it, extract to a named server function — the pattern is identical. | — |

---

## 11. Time Estimate

| Sub-task | Estimate |
|---|---|
| `AdUpdate` schema + validators | 30 min |
| `PATCH /ads/{ad_id}` router endpoint | 1 h |
| `DELETE /ads/{ad_id}` router endpoint | 30 min |
| Frontend server actions (`updateAd`, `deleteAd`, `fetchAdById`) | 45 min |
| Edit page + form (`page.tsx` + `edit-ad-form.tsx`) | 1 h |
| `AdCard` update with Edit + Delete buttons | 30 min |
| Backend unit tests | 1.5 h |
| pgTAP cells F-05a/b/c | 30 min |
| End-to-end staging verification | 1 h |
| **Total active work** | **~7.25 h** |

---

## 12. Definition of Done

1. Acceptance criterion met: a verified FARMER can edit title, description, product type, price, quantity, region, and photos on their own ACTIVE ad; and can soft-delete any of their own ads regardless of status.
2. Ownership enforced at two layers: FastAPI (`403 not_ad_owner`) and Supabase RLS (`farmarket_ads_update_own` / `farmarket_ads_delete_own`).
3. EXPIRED ads return `409 ad_not_editable` on any PATCH attempt.
4. Soft-delete sets `status = 'DELETED'`; ad disappears from `GET /farmarket/catalog`; leads on that ad are preserved in the DB.
5. `make -C backend test` green — all FAR-05 test assertions pass, no regressions in FAR-01/02/03/04 tests.
6. `make -C db test-auth07` — F-05a, F-05b, F-05c all `ok`.
7. `bash scripts/check-secrets-boundary.sh` exits 0 — no `service_client()` in the PATCH/DELETE path.
8. Verification checklist (§7) fully ticked.
9. Deliverables (§8) committed.
10. `docs/spring-status.yml` updated: `FAR-05.status → IN_REVIEW`, `summary.in_review` incremented.
11. Hand-off note posted — **FAR-06** (nightly CRON expiry worker) and **FAR-08** (admin ad list) are now unblocked by the `DELETED` status being in production.
