> ⚠️ **OBSOLETE — REWRITE IN PROGRESS (2026-05-24)** ⚠️
>
> The lead-form contact flow described below has been removed from the
> codebase: migration 0039 drops `m2_farmarket_leads` and the lead-notify
> trigger; the worker `backend/app/workers/farmarket_lead_email/`, the
> backend endpoint `POST /farmarket/ads/{ad_id}/leads`, the frontend
> `ContactAdButton`/`ContactModal`, and the lead schemas have all been
> deleted (Phase A of the FarMarket pivot). FarMarket now operates as a
> logistics intermediary — restaurateurs place orders via a cart and the
> producer is notified anonymously with zero buyer contact info.
>
> This file is retained only as historical context until the new FAR-03
> spec (cart → order placement) is written. **Do not implement anything
> below.**

# FAR-03 — Restaurateur contacts seller (message + phone number)  [OBSOLETE]

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** RESTAURANT (authenticated)
> **Depends on:** [FAR-02](./FAR-02-restaurateur-browses-ads.md) (`m2_farmarket_leads.ad_id` FK + browsable ad needed), [AUTH-03](./AUTH-03-jwt-config-256bit-1h-7d.md) (`get_current_user` + `require_role`)
> **Unblocks:** [FAR-04](./FAR-04-brevo-email-to-seller.md) (Brevo email trigger reads the lead row), [FAR-08](./FAR-08-admin-views-ads-leads.md) (admin lead dashboard)
> **Acceptance:** Lead persisted in `m2_farmarket_leads`; Moroccan phone format (`^0[5-7][0-9]{8}$`) validated at API layer + DB CHECK; `ContactAdButton` enabled in the catalog; FAR-04 email NOT triggered here.

---

## 1. Purpose

FAR-02 makes produce ads discoverable. FAR-03 closes the commercial loop: a restaurateur submits their phone number and a message for a specific ad, creating a **lead record** in the database. The farmer is notified by email in the next story (FAR-04); this story only persists the lead.

This story delivers:

- Migration `0034_far03_farmarket_leads.sql` — `m2_farmarket_leads` table + RLS policies + Moroccan phone CHECK constraint.
- Two new Pydantic schemas (`LeadCreate`, `LeadOut`) appended to `backend/app/modules/farmarket/schemas.py`.
- FastAPI endpoint `POST /api/v1/farmarket/ads/{ad_id}/leads` that validates the payload and inserts the lead row.
- Frontend `ContactAdButton` client component that replaces the disabled button stub in `AdCatalogCard.tsx`.
- Frontend contact modal with phone + message fields and a server action.
- pgTAP cells F-03a through F-03e appended to `db/tests/auth07_business_rules.sql`.
- Backend unit tests in `backend/tests/test_far03_contact_seller.py`.

Once `DONE`, the AUTH-07 matrix rows for `m2_farmarket_leads` activate, FAR-04 can trigger the Brevo email, and FAR-08 can list leads in the admin dashboard.

---

## 2. Scope

### In scope

- Migration `0034_far03_farmarket_leads.sql` — leads table + indexes + RLS + phone CHECK.
- `LeadCreate` and `LeadOut` Pydantic schemas.
- FastAPI `POST /api/v1/farmarket/ads/{ad_id}/leads` endpoint.
- Frontend `ContactAdButton` component (replaces the FAR-03 hook stub in `AdCatalogCard.tsx`).
- Frontend contact modal (`ContactModal.tsx`) with phone + message fields.
- Frontend server action `contactSellerAction`.
- pgTAP cells F-03a through F-03e.
- Backend unit tests.

### Out of scope

- Brevo email notification to seller → **FAR-04** (reads the lead row; NOT triggered here).
- Admin lead listing dashboard → **FAR-08**.
- Lead status updates (CONTACTED, CLOSED) → **FAR-08** admin flow.
- Rate-limiting per buyer per ad (one lead per buyer per ad) → post-MVD hardening.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [FAR-01](./FAR-01-farmer-creates-ad.md) `DONE` | `public.m2_farmarket_ads` table + RLS must exist. Migration 0032 applied. |
| [FAR-02](./FAR-02-restaurateur-browses-ads.md) `DONE` (or `IN_REVIEW`) | `AdCatalogCard.tsx` has the `{/* FAR-03 hook */}` stub; restaurant dashboard shell + catalog page exist. |
| [AUTH-03](./AUTH-03-jwt-config-256bit-1h-7d.md) `DONE` | `get_current_user` + `require_role` available in `backend/app/core/security.py`. |
| Migration 0033 applied | Latest applied migration; no gap before 0034. |

---

## 4. Data Model

### 4.1 New enum type

| Enum | Values | Notes |
|---|---|---|
| `public.m2_farmarket_lead_status` | `PENDING`, `CONTACTED`, `CLOSED` | `PENDING` on creation; FAR-08 admin / farmer updates to `CONTACTED` / `CLOSED`. |

### 4.2 Table: `public.m2_farmarket_leads`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `ad_id` | `uuid` | NOT NULL, FK → `public.m2_farmarket_ads(id)` ON DELETE CASCADE | Cascade ensures leads are removed if the ad is hard-deleted. |
| `buyer_id` | `uuid` | NOT NULL, FK → `public.profiles(id)` ON DELETE CASCADE | The RESTAURANT user who submitted the form. |
| `message` | `text` | NOT NULL, CHECK length 10–1000 | Contact message to the farmer. |
| `buyer_phone` | `text` | NOT NULL, CHECK `^0[5-7][0-9]{8}$` | **BR-B1 phone format** applied here too (same regex as BotaBa9a leads). |
| `status` | `public.m2_farmarket_lead_status` | NOT NULL, DEFAULT `'PENDING'` | FAR-08 admin flow updates this. |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | |

### 4.3 RLS Matrix for `m2_farmarket_leads`

| Operation | Policy name | Role | Condition |
|---|---|---|---|
| SELECT | `farmarket_leads_select_own_buyer` | `authenticated` | `auth.uid() = buyer_id` — buyer sees their own submitted leads. |
| SELECT | `farmarket_leads_select_own_farmer` | `authenticated` | Farmer sees leads on ads they own: `exists (select 1 from public.m2_farmarket_ads a where a.id = ad_id and a.farmer_id = auth.uid())` |
| SELECT | `farmarket_leads_admin_select` | `authenticated` | `public.is_admin()` — full read for FAR-08 admin dashboard. |
| INSERT | `farmarket_leads_insert_restaurant` | `authenticated` | `auth.uid() = buyer_id AND public.has_role('RESTAURANT'::public.user_role)` — only RESTAURANT role can submit leads. |
| UPDATE | `farmarket_leads_update_admin` | `authenticated` | `public.is_admin()` — admin can change `status` (FAR-08). |
| DELETE | _(none)_ | — | Leads are audit records; no delete policy. |

---

## 5. Step-by-Step Implementation

### 5.1 Migration 0034 — farmarket leads table

Create [db/migrations/0034_far03_farmarket_leads.sql](../../db/migrations/0034_far03_farmarket_leads.sql):

```sql
-- =============================================================================
-- 0034 — M2 FarMarket: contact lead registry.
-- Story:  FAR-03 (docs/stories/FAR-03-restaurateur-contacts-seller.md)
--
-- A lead is created when a RESTAURANT user submits the contact form for an ad.
-- FAR-04 reads this row to trigger the Brevo email to the seller.
-- FAR-08 admin dashboard lists, filters, and updates lead status.
--
-- Phone format: Moroccan ^0[5-7][0-9]{8}$ — same regex as BotaBa9a (BR-B1).
-- Cascade: if the parent ad is hard-deleted, leads cascade-delete too.
--
-- Event-trigger workaround: disable trg_enforce_rls_on_public_tables before
-- CREATE TABLE and re-enable after RLS is enabled (same pattern as 0032).
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── Enum ──────────────────────────────────────────────────────────────────────

do $$ begin
    create type public.m2_farmarket_lead_status as enum (
        'PENDING',
        'CONTACTED',
        'CLOSED'
    );
exception when duplicate_object then null; end $$;

-- ── Table ─────────────────────────────────────────────────────────────────────

create table if not exists public.m2_farmarket_leads (
    id              uuid                                primary key default gen_random_uuid(),

    ad_id           uuid                                not null
                        references public.m2_farmarket_ads(id) on delete cascade,

    buyer_id        uuid                                not null
                        references public.profiles(id) on delete cascade,

    message         text                                not null
                        constraint m2_farmarket_leads_message_length
                            check (char_length(trim(message)) between 10 and 1000),

    -- BR-B1 phone format: Moroccan mobile/landline numbers (0[5-7] prefix).
    buyer_phone     text                                not null
                        constraint m2_farmarket_leads_phone_format
                            check (buyer_phone ~ '^0[5-7][0-9]{8}$'),

    status          public.m2_farmarket_lead_status     not null default 'PENDING',

    created_at      timestamptz                         not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- FAR-08 admin + farmer: leads per ad, newest first.
create index if not exists m2_farmarket_leads_ad_idx
    on public.m2_farmarket_leads (ad_id, created_at desc);

-- Buyer history view (FAR-03: buyer sees their own leads).
create index if not exists m2_farmarket_leads_buyer_idx
    on public.m2_farmarket_leads (buyer_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.m2_farmarket_leads enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

-- 1. Buyer sees their own submitted leads.
drop policy if exists "farmarket_leads_select_own_buyer" on public.m2_farmarket_leads;
create policy "farmarket_leads_select_own_buyer"
    on public.m2_farmarket_leads for select to authenticated
    using (auth.uid() = buyer_id);

-- 2. Farmer sees leads on ads they own.
drop policy if exists "farmarket_leads_select_own_farmer" on public.m2_farmarket_leads;
create policy "farmarket_leads_select_own_farmer"
    on public.m2_farmarket_leads for select to authenticated
    using (
        exists (
            select 1
              from public.m2_farmarket_ads a
             where a.id = ad_id
               and a.farmer_id = auth.uid()
        )
    );

-- 3. Admin reads all leads (FAR-08 dashboard).
drop policy if exists "farmarket_leads_admin_select" on public.m2_farmarket_leads;
create policy "farmarket_leads_admin_select"
    on public.m2_farmarket_leads for select to authenticated
    using (public.is_admin());

-- 4. Only RESTAURANT role can submit a lead; buyer_id must equal caller.
drop policy if exists "farmarket_leads_insert_restaurant" on public.m2_farmarket_leads;
create policy "farmarket_leads_insert_restaurant"
    on public.m2_farmarket_leads for insert to authenticated
    with check (
        auth.uid() = buyer_id
        and public.has_role('RESTAURANT'::public.user_role)
    );

-- 5. Admin can update lead status (PENDING → CONTACTED / CLOSED).
drop policy if exists "farmarket_leads_update_admin" on public.m2_farmarket_leads;
create policy "farmarket_leads_update_admin"
    on public.m2_farmarket_leads for update to authenticated
    using       (public.is_admin())
    with check  (public.is_admin());
```

Apply:

```bash
supabase db push
```

Verify in the Supabase Dashboard:
- `public.m2_farmarket_leads` exists, RLS **enabled**, 5 policies listed.
- Column `buyer_phone` has a CHECK constraint in the schema.

---

### 5.2 Backend — Pydantic schemas

Append to [backend/app/modules/farmarket/schemas.py](../../backend/app/modules/farmarket/schemas.py):

```python
import re

# ---------------------------------------------------------------------------
# FAR-03 — Contact lead
# ---------------------------------------------------------------------------

_MOROCCAN_PHONE_RE = re.compile(r"^0[5-7][0-9]{8}$")


class LeadCreate(BaseModel):
    """Payload for POST /farmarket/ads/{ad_id}/leads."""

    message: str
    buyer_phone: str

    @field_validator("message")
    @classmethod
    def message_length(cls, v: str) -> str:
        v = v.strip()
        if not 10 <= len(v) <= 1000:
            raise ValueError("message must be between 10 and 1000 characters")
        return v

    @field_validator("buyer_phone")
    @classmethod
    def phone_moroccan_format(cls, v: str) -> str:
        v = v.strip()
        if not _MOROCCAN_PHONE_RE.match(v):
            raise ValueError(
                "buyer_phone must be a Moroccan number matching ^0[5-7][0-9]{8}$"
            )
        return v


class LeadOut(BaseModel):
    """Response model for a persisted lead."""

    id: UUID
    ad_id: UUID
    buyer_id: UUID
    message: str
    buyer_phone: str
    status: str
    created_at: datetime
```

---

### 5.3 Backend — contact lead endpoint

Add the following endpoint to [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py).

Add to the imports block (alongside existing FAR-01/FAR-02 imports):

```python
from app.modules.farmarket.schemas import (
    # ... existing imports ...
    LeadCreate,
    LeadOut,
)
```

Add the table constant near the top of the module (after `_ADS_TABLE`):

```python
_LEADS_TABLE = "m2_farmarket_leads"
```

Add the endpoint after the existing `browse_catalog` handler:

```python
@router.post(
    "/ads/{ad_id}/leads",
    status_code=status.HTTP_201_CREATED,
    response_model=LeadOut,
    response_class=ORJSONResponse,
)
async def contact_seller(
    ad_id: uuid.UUID,
    payload: LeadCreate,
    user: Annotated[AuthUser, Depends(require_role("RESTAURANT"))],
    db: Annotated[Any, Depends(get_db_for_user)],
) -> LeadOut:
    """POST /api/v1/farmarket/ads/{ad_id}/leads

    A RESTAURANT user submits a contact lead for a specific active ad.

    Guards:
    * ``require_role("RESTAURANT")`` — FastAPI layer.
    * RLS ``farmarket_leads_insert_restaurant`` — DB layer (buyer_id = caller).
    * Ad existence + ACTIVE status — checked before insert to return a
      meaningful 404/409 rather than a generic RLS 403.
    * Phone format — Pydantic ``LeadCreate.phone_moroccan_format`` + DB CHECK.

    FAR-04 reads the inserted row to trigger the Brevo email; no email is
    sent from this handler (BR-F4: Brevo key lives in the backend worker only).
    """
    # Verify the target ad exists and is ACTIVE.
    ad_row = (
        db.table(_ADS_TABLE)
        .select("id, status")
        .eq("id", str(ad_id))
        .maybe_single()
        .execute()
    )
    if not ad_row.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ad_not_found",
        )
    if ad_row.data["status"] != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ad_not_active",
        )

    # Insert the lead; RLS INSERT policy re-checks role + buyer_id ownership.
    result = (
        db.table(_LEADS_TABLE)
        .insert(
            {
                "ad_id": str(ad_id),
                "buyer_id": str(user.id),
                "message": payload.message,
                "buyer_phone": payload.buyer_phone,
                "status": "PENDING",
            }
        )
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="lead_insert_failed",
        )

    row = result.data[0]
    return LeadOut(**row)
```

---

### 5.4 Frontend — ContactAdButton component

Replace the disabled button stub in [frontend/src/app/dashboard/restaurant/marketplace/AdCatalogCard.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/AdCatalogCard.tsx):

```diff
- import type { Ad } from "@/app/dashboard/farmer/ads/actions";
+ import type { Ad } from "@/app/dashboard/farmer/ads/actions";
+ import { ContactAdButton } from "./ContactAdButton";

  ...

-         {/* FAR-03 hook: replace with <ContactAdButton adId={ad.id} /> */}
-         <button
-           disabled
-           className="mt-4 w-full cursor-not-allowed rounded bg-neutral-100 px-4 py-2 text-sm text-neutral-400"
-           title="Contacter le vendeur — disponible dans FAR-03"
-         >
-           Contacter le vendeur
-         </button>
+         <ContactAdButton adId={ad.id} adTitle={ad.title} />
```

---

### 5.5 Frontend — ContactAdButton + ContactModal

Create [frontend/src/app/dashboard/restaurant/marketplace/ContactAdButton.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/ContactAdButton.tsx):

```tsx
"use client";

import { useState } from "react";
import { ContactModal } from "./ContactModal";

interface Props {
  adId: string;
  adTitle: string;
}

export function ContactAdButton({ adId, adTitle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded bg-leaf-600 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-700 focus:outline-none focus:ring-2 focus:ring-leaf-500"
      >
        Contacter le vendeur
      </button>

      {open && (
        <ContactModal
          adId={adId}
          adTitle={adTitle}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
```

Create [frontend/src/app/dashboard/restaurant/marketplace/ContactModal.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/ContactModal.tsx):

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { contactSellerAction } from "./actions";

interface Props {
  adId: string;
  adTitle: string;
  onClose: () => void;
}

const PHONE_RE = /^0[5-7][0-9]{8}$/;

export function ContactModal({ adId, adTitle, onClose }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const phone = (fd.get("buyer_phone") as string).trim();
    const message = (fd.get("message") as string).trim();

    if (!PHONE_RE.test(phone)) {
      setError("Numéro invalide — format requis : 0[5-7]XXXXXXXX (ex: 0612345678)");
      return;
    }
    if (message.length < 10) {
      setError("Message trop court (minimum 10 caractères).");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await contactSellerAction(adId, fd);
      if (result?.error) {
        setError(result.error);
      } else {
        setSuccess(true);
      }
    });
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        {success ? (
          <div className="text-center">
            <p className="text-lg font-semibold text-leaf-700">
              Demande envoyée !
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              Le vendeur recevra vos coordonnées par e-mail et vous contactera
              directement.
            </p>
            <button
              onClick={onClose}
              className="mt-4 rounded bg-leaf-600 px-4 py-2 text-sm text-white hover:bg-leaf-700"
            >
              Fermer
            </button>
          </div>
        ) : (
          <>
            <h2 className="mb-4 text-base font-semibold text-neutral-900">
              Contacter le vendeur
            </h2>
            <p className="mb-4 text-sm text-neutral-500 truncate">
              Annonce : <span className="font-medium text-neutral-700">{adTitle}</span>
            </p>

            <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="buyer_phone"
                  className="block text-sm font-medium text-neutral-700"
                >
                  Votre numéro de téléphone
                </label>
                <input
                  id="buyer_phone"
                  name="buyer_phone"
                  type="tel"
                  required
                  placeholder="0612345678"
                  pattern="0[5-7][0-9]{8}"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-leaf-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-neutral-400">
                  Format marocain : 06, 07 ou 05 suivi de 8 chiffres
                </p>
              </div>

              <div>
                <label
                  htmlFor="message"
                  className="block text-sm font-medium text-neutral-700"
                >
                  Votre message
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  minLength={10}
                  maxLength={1000}
                  rows={4}
                  placeholder="Bonjour, je suis intéressé(e) par votre annonce…"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-leaf-500 focus:outline-none"
                />
              </div>

              {error && (
                <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 rounded bg-leaf-600 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-700 disabled:opacity-50"
                >
                  {isPending ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
```

---

### 5.6 Frontend — server action

Append to [frontend/src/app/dashboard/restaurant/marketplace/actions.ts](../../frontend/src/app/dashboard/restaurant/marketplace/actions.ts):

```typescript
export async function contactSellerAction(
  adId: string,
  formData: FormData,
): Promise<{ error: string } | null> {
  const supabase = createServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const body = {
    message: formData.get("message") as string,
    buyer_phone: formData.get("buyer_phone") as string,
  };

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/farmarket/ads/${adId}/leads`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return { error: err.detail ?? "contact_failed" };
  }

  return null;
}
```

> **Note:** `createServerClient` and `redirect` are already imported in `actions.ts` from FAR-02. Add only the `contactSellerAction` export — do not duplicate the existing imports.

---

### 5.7 AUTH-07 pgTAP cells

Append to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql):

```sql
-- ── FAR-03 cells ─────────────────────────────────────────────────────────────
-- Prerequisites: FARMER-A (verified), RESTAURANT (verified), FARMER-B (PENDING)
-- identities + m2_farmarket_ads + m2_farmarket_leads tables must exist.
-- Seeds an ACTIVE ad under FARMER-A before testing lead insertion.

do $guard$
begin
  if to_regclass('public.m2_farmarket_leads') is null then
    raise notice 'SKIP FAR-03 cells — m2_farmarket_leads not yet created';
    return;
  end if;
end $guard$;

-- Seed: one ACTIVE ad owned by FARMER-A (reuse if F-01a already inserted it).
insert into public.m2_farmarket_ads
    (id, farmer_id, title, description, product_type, price_mad, quantity_kg, region)
values
    ('f03ad000-0000-0000-0000-000000000001',
     '<FARMER_A_UUID>',
     'Poivrons FAR-03 test', 'Description suffisante pour le test.',
     'Poivrons', 3.00, 200.00, 'Fès-Meknès')
on conflict (id) do nothing;

-- F-03a: RESTAURANT can insert a lead for an ACTIVE ad.
select lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"<RESTAURANT_UUID>","user_role":"RESTAURANT"}';
    insert into public.m2_farmarket_leads
        (ad_id, buyer_id, message, buyer_phone)
    values
        ('f03ad000-0000-0000-0000-000000000001',
         '<RESTAURANT_UUID>',
         'Je suis intéressé par vos poivrons, rappel svp.',
         '0612345678');
  $$,
  'F-03a: RESTAURANT can insert a lead for an active ad'
);

-- F-03b: FARMER role is blocked by RLS INSERT policy.
select throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"<FARMER_A_UUID>","user_role":"FARMER"}';
    insert into public.m2_farmarket_leads
        (ad_id, buyer_id, message, buyer_phone)
    values
        ('f03ad000-0000-0000-0000-000000000001',
         '<FARMER_A_UUID>',
         'Farmer tries to insert a lead — should fail.',
         '0611111111');
  $$,
  null, null,
  'F-03b: FARMER role cannot insert a lead (not RESTAURANT)'
);

-- F-03c: DB CHECK rejects an invalid Moroccan phone number.
select throws_ok(
  $$
    insert into public.m2_farmarket_leads
        (ad_id, buyer_id, message, buyer_phone)
    values
        ('f03ad000-0000-0000-0000-000000000001',
         '<RESTAURANT_UUID>',
         'Message avec numéro invalide.',
         '0312345678');  -- starts with 03 — invalid
  $$,
  '23514', null,  -- check_violation
  'F-03c: DB CHECK rejects invalid phone format (^0[5-7][0-9]{8}$)'
);

-- F-03d: FARMER-A can SELECT leads on their own ad.
select lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"<FARMER_A_UUID>","user_role":"FARMER"}';
    select id from public.m2_farmarket_leads
     where ad_id = 'f03ad000-0000-0000-0000-000000000001';
  $$,
  'F-03d: ad owner (FARMER-A) can SELECT leads on their own ad'
);

-- F-03e: RESTAURANT buyer cannot see leads submitted by another buyer on the same ad.
-- Insert a second lead under a different buyer identity first.
insert into public.m2_farmarket_leads
    (ad_id, buyer_id, message, buyer_phone)
values
    ('f03ad000-0000-0000-0000-000000000001',
     '<CITIZEN_A_UUID>',  -- wrong role but this is a direct seed bypassing RLS
     'Autre acheteur.', '0655555555')
on conflict do nothing;

select is(
  (
    select count(*)::int
      from (
          set local role authenticated;
          set local request.jwt.claims = '{"sub":"<RESTAURANT_UUID>","user_role":"RESTAURANT"}';
          select id from public.m2_farmarket_leads
           where ad_id = 'f03ad000-0000-0000-0000-000000000001'
      ) sub
  ),
  1,  -- only the lead inserted by RESTAURANT, not CITIZEN_A's seed
  'F-03e: RESTAURANT buyer sees only their own leads (not other buyers)'
);
```

> Replace `<FARMER_A_UUID>`, `<RESTAURANT_UUID>`, `<CITIZEN_A_UUID>` with the UUIDs from `db/tests/_auth07_seed.psql`.

---

### 5.8 Backend unit tests

Create [backend/tests/test_far03_contact_seller.py](../../backend/tests/test_far03_contact_seller.py):

```python
"""FAR-03 — Contact seller: schema + router endpoint tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.modules.farmarket.schemas import LeadCreate


class TestLeadCreateSchema:
    def test_valid_payload(self) -> None:
        lead = LeadCreate(
            message="Bonjour, je suis intéressé par votre annonce de tomates.",
            buyer_phone="0612345678",
        )
        assert lead.buyer_phone == "0612345678"

    def test_phone_invalid_prefix(self) -> None:
        with pytest.raises(ValueError, match="buyer_phone"):
            LeadCreate(
                message="Message suffisamment long.",
                buyer_phone="0312345678",  # 03 — invalid prefix
            )

    def test_phone_too_short(self) -> None:
        with pytest.raises(ValueError, match="buyer_phone"):
            LeadCreate(
                message="Message suffisamment long.",
                buyer_phone="061234567",  # 9 digits total — too short
            )

    def test_phone_too_long(self) -> None:
        with pytest.raises(ValueError, match="buyer_phone"):
            LeadCreate(
                message="Message suffisamment long.",
                buyer_phone="06123456789",  # 11 digits — too long
            )

    def test_valid_07_prefix(self) -> None:
        lead = LeadCreate(
            message="Je voudrais passer une commande de 50 kg.",
            buyer_phone="0712345678",
        )
        assert lead.buyer_phone == "0712345678"

    def test_valid_05_prefix(self) -> None:
        lead = LeadCreate(
            message="Je voudrais passer une commande de 50 kg.",
            buyer_phone="0512345678",
        )
        assert lead.buyer_phone == "0512345678"

    def test_message_too_short(self) -> None:
        with pytest.raises(ValueError, match="message"):
            LeadCreate(
                message="Trop court",  # < 10 chars
                buyer_phone="0612345678",
            )

    def test_message_too_long(self) -> None:
        with pytest.raises(ValueError, match="message"):
            LeadCreate(
                message="A" * 1001,
                buyer_phone="0612345678",
            )

    def test_message_stripped(self) -> None:
        lead = LeadCreate(
            message="  Je suis intéressé(e) par vos produits.  ",
            buyer_phone="0612345678",
        )
        assert lead.message == "Je suis intéressé(e) par vos produits."


class TestContactSellerRouter:
    def test_contact_requires_auth(self, test_client: TestClient) -> None:
        resp = test_client.post(
            "/api/v1/farmarket/ads/00000000-0000-0000-0000-000000000001/leads",
            json={"message": "Test message suffisant.", "buyer_phone": "0612345678"},
        )
        assert resp.status_code == 401

    def test_contact_requires_restaurant_role(
        self, test_client: TestClient, farmer_token: str
    ) -> None:
        resp = test_client.post(
            "/api/v1/farmarket/ads/00000000-0000-0000-0000-000000000001/leads",
            headers={"Authorization": f"Bearer {farmer_token}"},
            json={"message": "Test message suffisant.", "buyer_phone": "0612345678"},
        )
        assert resp.status_code == 403

    def test_contact_invalid_phone_returns_422(
        self, test_client: TestClient, restaurant_token: str
    ) -> None:
        resp = test_client.post(
            "/api/v1/farmarket/ads/00000000-0000-0000-0000-000000000001/leads",
            headers={"Authorization": f"Bearer {restaurant_token}"},
            json={"message": "Message suffisamment long.", "buyer_phone": "0312345678"},
        )
        assert resp.status_code == 422
```

---

## 6. Verification Checklist

- [ ] `supabase db push` applied migration 0034 without errors.
- [ ] `select relforcerowsecurity from pg_class where relname='m2_farmarket_leads'` returns `t`.
- [ ] 5 RLS policies listed on `m2_farmarket_leads` in the Supabase Dashboard.
- [ ] `make -C backend test` green (all FAR-03 assertions in `test_far03_contact_seller.py`).
- [ ] `make -C db test-auth07` — F-03a through F-03e cells pass (no SKIP for FAR-03 block).
- [ ] RESTAURANT user (staging seed) opens the catalog → "Contacter le vendeur" button is enabled.
- [ ] Clicking the button opens the `ContactModal` correctly.
- [ ] Submitting with `0312345678` (invalid prefix) shows the inline error and does NOT submit.
- [ ] Submitting with a valid phone + message → `201` response → success state shown in modal.
- [ ] Lead row appears in `m2_farmarket_leads` with `status = 'PENDING'` and correct `buyer_id` + `ad_id`.
- [ ] FARMER user (staging) views the Supabase Studio table and can see the lead for their ad.
- [ ] RESTAURANT user cannot see leads submitted by another buyer for the same ad.
- [ ] FARMER user posting to `POST /ads/{ad_id}/leads` receives `403 role_not_allowed`.
- [ ] Posting to a non-existent `ad_id` receives `404 ad_not_found`.
- [ ] Posting to an `EXPIRED` ad returns `409 ad_not_active`.
- [ ] No Sentry errors during the end-to-end happy path.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| Migration — leads table | [db/migrations/0034_far03_farmarket_leads.sql](../../db/migrations/0034_far03_farmarket_leads.sql) |
| Backend schemas (`LeadCreate`, `LeadOut`) | Appended to [backend/app/modules/farmarket/schemas.py](../../backend/app/modules/farmarket/schemas.py) |
| Backend router (`POST /ads/{ad_id}/leads`) | Added to [backend/app/modules/farmarket/router.py](../../backend/app/modules/farmarket/router.py) |
| Backend tests | [backend/tests/test_far03_contact_seller.py](../../backend/tests/test_far03_contact_seller.py) |
| Frontend `ContactAdButton` | [frontend/src/app/dashboard/restaurant/marketplace/ContactAdButton.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/ContactAdButton.tsx) |
| Frontend `ContactModal` | [frontend/src/app/dashboard/restaurant/marketplace/ContactModal.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/ContactModal.tsx) |
| Frontend server action | Appended to [frontend/src/app/dashboard/restaurant/marketplace/actions.ts](../../frontend/src/app/dashboard/restaurant/marketplace/actions.ts) |
| `AdCatalogCard.tsx` updated | [frontend/src/app/dashboard/restaurant/marketplace/AdCatalogCard.tsx](../../frontend/src/app/dashboard/restaurant/marketplace/AdCatalogCard.tsx) — FAR-03 hook stub replaced |
| AUTH-07 pgTAP cells | Appended to [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql) |
| `spring-status.yml` update | Flip `FAR-03.status` → `IN_REVIEW`, bump `summary.in_review` |

---

## 8. Business Rules enforced

| Rule | Where enforced |
|---|---|
| **BR-F1**: only RESTAURANT role can submit leads | FastAPI `require_role("RESTAURANT")` + RLS INSERT `has_role('RESTAURANT')` |
| **BR-B1 (phone format)**: `^0[5-7][0-9]{8}$` | Pydantic `LeadCreate.phone_moroccan_format` (422 at API boundary) + DB CHECK constraint (final guard) |
| **BR-F4**: Brevo key never on frontend | No email triggered from this story; FAR-04 owns the Brevo call from the backend worker |
| **Buyer isolation**: each buyer sees only their own leads | RLS `farmarket_leads_select_own_buyer` using `auth.uid() = buyer_id` |
| **Farmer visibility**: farmer sees leads on their own ads | RLS `farmarket_leads_select_own_farmer` via sub-select on `m2_farmarket_ads.farmer_id` |

---

## 9. Risks & Mitigations

| Risk | Mitigation | PRD Ref |
|---|---|---|
| Restaurateur submits duplicate leads for the same ad | No unique constraint at MVD — leads are low-frequency; a UI-level debounce (disable button after submit) prevents accidental double-submit. Post-MVD: add `UNIQUE (ad_id, buyer_id)` or a rate-limit. | PRD §13 R3 |
| Phone number validation drift (frontend regex vs. DB CHECK) | Both use the identical pattern `^0[5-7][0-9]{8}$`; Pydantic `_MOROCCAN_PHONE_RE` constant and the DB CHECK are co-located comments referencing each other. CI parity check post-MVD. | PRD §6.2 BR-B1 |
| Lead inserted for an EXPIRED ad (race condition) | Handler pre-checks `status = 'ACTIVE'` before insert → returns `409 ad_not_active`. The FAR-06 CRON sets `EXPIRED` transactionally, so the window is small. | PRD §6.2 FAR-06 |
| Farmer impersonates a buyer (`buyer_id ≠ auth.uid()`) | RLS INSERT `WITH CHECK (auth.uid() = buyer_id)` prevents this; FastAPI also sets `buyer_id = user.id` server-side, never from the request body. | PRD §7.1 AUTH-04 |
| Message content abuse | MVP has no moderation; flagging via FAR-04 email gives farmer a passive signal. Post-MVD: content policy + report mechanism. | PRD §14 |

---

## 10. Time Estimate

| Sub-task | Estimate |
|---|---|
| Migration 0034 (table + indexes + RLS) | 1 h |
| Backend schemas (`LeadCreate`, `LeadOut`) | 30 min |
| Backend endpoint + tests | 1.5 h |
| Frontend `ContactAdButton` + `ContactModal` | 1.5 h |
| Frontend server action + `AdCatalogCard` edit | 30 min |
| AUTH-07 pgTAP cells | 45 min |
| End-to-end staging verification | 1 h |
| **Total active work** | **~6.75 h** |

---

## 11. Definition of Done

1. Acceptance criterion met: a RESTAURANT user submits the contact form → lead row created in `m2_farmarket_leads` with `status = 'PENDING'`, correct `buyer_id` and `ad_id`.
2. Phone validation verified: `0312345678` → `422` at API; `0312345678` → `23514` CHECK violation at DB layer (pgTAP F-03c).
3. Role gate verified: FARMER user → `403` at API layer; pgTAP F-03b green.
4. RLS isolation verified: RESTAURANT buyer cannot SELECT another buyer's lead on the same ad (pgTAP F-03e).
5. Farmer visibility verified: FARMER-A can SELECT leads for their own ads (pgTAP F-03d).
6. `ContactAdButton` enabled in the catalog; modal opens, submits, shows success state.
7. Verification checklist (§6) fully ticked.
8. `make -C db test-auth07` — F-03a through F-03e all `ok` (not SKIP).
9. `make -C backend test` green with no regressions.
10. Deliverables (§7) committed.
11. `docs/spring-status.yml` updated and committed.
12. Hand-off note posted naming the stories now unblocked: **FAR-04** (Brevo email) and **FAR-08** (admin lead dashboard).
