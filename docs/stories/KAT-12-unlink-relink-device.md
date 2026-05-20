# KAT-12 — Unlink a device from a parcel + relink to another

> **Epic:** E2 — M1 Katara — Smart Irrigation & IoT
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Should
> **Status:** TODO
> **Actor:** FARMER (verified, owner of both source and destination parcels)
> **Depends on:** [KAT-02](./KAT-02-esp32-device-pairing.md) (ships `public.m1_katara_devices`, the `device_status` enum with the `UNLINKED` variant, the two partial unique indexes on `(parcel_id) where status <> 'UNLINKED'` and `(device_id) where status <> 'UNLINKED'` that KAT-12 is the *only* legitimate user of, the bcrypt-based `verify_device_api_key()` helper that KAT-12 must extend to refuse `UNLINKED` rows, and the `katara_devices_update_own` / `katara_devices_insert_verified_farmer_owns_parcel` RLS policies that KAT-12 invokes under user JWT) · [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) (ingest path writes `last_seen` + flips `status = 'ACTIVE'`; KAT-12 must guarantee that an ingest with an UNLINKED row's api-key is rejected with the same `invalid_device_credentials` constant string as a forged key — i.e. the unlink takes effect on the next ESP32 transmission with zero further user action) · [KAT-11](./KAT-11-offline-device-detection.md) (already filters `status = 'ACTIVE'` in its scan — UNLINKED rows are naturally skipped, no contract change here) · [AUTH-04](./AUTH-04-enable-rls-on-sensitive-tables.md) (the `katara_devices_update_own` policy gates the unlink UPDATE; KAT-12 adds zero new RLS policies) · [AUTH-06](./AUTH-06-professional-kyc-lite-doc-upload-admin-verification.md) (verification gate on relink — re-pairing a device on a new parcel goes through KAT-02's existing `_require_verified_farmer` dependency)
> **Unblocks:** [KAT-13](./KAT-13-historical-telemetry-after-unlink.md) (the *only* story that genuinely depends on KAT-12 — KAT-13's premise "history is still queryable after the device moves" requires KAT-12 to have soft-detached the old device row rather than DELETE-cascading the telemetry; with KAT-12 `DONE`, KAT-13 is a pure read-path story against `m1_katara_telemetry` filtered by `parcel_id` rather than `device_id`)
> **Acceptance:** A verified FARMER who owns parcel A with paired device `ESP-KAT-001` (status `ACTIVE`) clicks "Unlink device" on the parcel A detail page, confirms the modal, and the device row flips to `status = 'UNLINKED'` in `m1_katara_devices`. The next telemetry payload from the physical ESP32 — still firmware-pinned to the old api-key — is rejected by `/api/v1/katara/ingest` with `401 invalid_device_credentials`. The same farmer then navigates to parcel B (which they also own), clicks "Pair a new device", types the same physical `device_id` `ESP-KAT-001`, and receives a *fresh* api-key in the single-use modal. A brand-new row is inserted in `m1_katara_devices` with the same `device_id` literal, the new `parcel_id`, `status = 'PENDING'`, a different `api_key_hash`. The OLD row stays untouched: its `parcel_id` still points to parcel A, its telemetry history is intact, and KAT-13 will surface those rows under parcel A's history view. BR-K1 is preserved end-to-end (at no point are two non-UNLINKED rows for the same `device_id` *or* the same `parcel_id` allowed to coexist). The ingest p50 < 50 ms (KAT-03 SLA) is unaffected — KAT-12 changes the verifier's WHERE clause but not its index plan.

---

## 1. Purpose

KAT-02 shipped the device registry with deliberate forethought for KAT-12: the `device_status` enum already carries the `UNLINKED` variant; the two partial unique indexes (on `parcel_id` and `device_id`) already filter `where status <> 'UNLINKED'`; the `katara_devices_update_own` RLS policy already lets a farmer UPDATE rows they own. The data shape is complete. **KAT-12 is the application + verifier surface that turns those affordances into a user-facing flow.**

Concretely the farmer needs two operations:

1. **Unlink** — "this physical ESP32 is no longer on this parcel". The OLD row stays in the database with `status = 'UNLINKED'` so KAT-13 can still surface its telemetry under the parcel it was originally paired to. The old api-key stops working on the next ingest.
2. **Re-pair on a new parcel** — "I moved the physical ESP32 to parcel B; issue me a new api-key for it." This is the *existing* KAT-02 pairing endpoint with no signature change; KAT-12's contribution is verifying that the partial-unique-index machinery from KAT-02 lets the same `device_id` insert again *because* the old row is now UNLINKED.

The verifier change is the load-bearing piece. KAT-02's `public.verify_device_api_key()` SQL function currently looks up by `device_id` only — without the status filter, an UNLINKED row's stale api-key would still authenticate, and KAT-03 would happily insert telemetry into a soft-detached device, breaking KAT-13's parcel-history boundary. KAT-12's migration tightens the function to `where status <> 'UNLINKED'` so an unlinked api-key is mechanically dead within the next ESP32 transmission.

Concretely KAT-12 delivers:

- **One small migration** ([`db/migrations/0026_kat12_unlink_relink.sql`](../../db/migrations/)) — `create or replace function public.verify_device_api_key(...)` adding the `status <> 'UNLINKED'` filter, plus a trigger `trg_m1_katara_devices_unlink_freeze` that refuses UPDATEs to an `UNLINKED` row's `parcel_id`, `farmer_id`, `device_id`, `api_key_hash`, or `api_key_last4` (UNLINKED is a terminal state — only KAT-13's read path may touch those rows after).
- **Two FastAPI endpoints** under [`backend/app/modules/katara/devices.py`](../../backend/app/modules/katara/devices.py) — `POST /api/v1/katara/devices/{device_uuid}/unlink` (the new one) and a small contract clarification on the existing `POST /api/v1/katara/parcels/{parcel_id}/devices` pairing route (KAT-02's endpoint already works correctly for re-pair via the partial unique index; KAT-12 adds a single docstring + one test asserting the re-pair flow round-trips). No new pairing endpoint — the cognitive cost of "unlink uses POST /unlink, relink reuses the existing POST /devices" is lower than introducing a third "POST /relink" verb.
- **Frontend** — a destructive-action button on the device card in [`frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx`](../../frontend/src/app/dashboard/farmer/parcels/) opening a confirmation modal ("This will disconnect ESP-KAT-001 from this parcel. The device will stop reporting until you pair it to a new parcel. Historical data stays under this parcel. Are you sure?"). On confirm, calls the unlink endpoint and refreshes the device card to show "No device paired — pair a new one" with the KAT-02 pairing button enabled.
- **Verifier contract update** — KAT-03's hot ingest path reads `verify_device_api_key()` once per request; the post-KAT-12 version returns NULL for UNLINKED rows, which KAT-03's existing 401 path renders as `invalid_device_credentials`. No KAT-03 code change.
- **AUTH-07 pgTAP cells** — one cell verifying the verifier's `UNLINKED → NULL` behaviour; one cell verifying the freeze-trigger refuses post-unlink mutation; one cell verifying the re-pair flow inserts a new row without violating either partial unique index.
- **Unit + e2e tests** — backend tests covering the unlink endpoint's positive path, cross-farmer rejection (403), idempotency (un-unlink-ing an already-UNLINKED row returns 409 not 500), and the full unlink → forged-ingest-401 → re-pair → fresh-ingest-204 round-trip.
- **`spring-status.yml` flip** to `IN_REVIEW` and a §10 hand-off note for KAT-13.

Once `DONE`, the M1 device lifecycle is fully expressed in the schema: `PENDING → ACTIVE ↔ OFFLINE → UNLINKED` is now end-to-end achievable through user action, and KAT-13 has a clean substrate to build its parcel-scoped history view on.

---

## 2. Scope

### In scope

- New `POST /api/v1/katara/devices/{device_uuid}/unlink` endpoint — verified-farmer-only, owner-only, flips `status` from `ACTIVE | OFFLINE | PENDING` to `UNLINKED`.
- Migration `0026_kat12_unlink_relink.sql` — verifier function tightened with `status <> 'UNLINKED'` filter; freeze trigger on UNLINKED rows.
- Frontend confirmation modal + button on the parcel detail device card. Destructive styling (red), explicit copy naming the device_id and parcel name, "Are you sure?" two-step confirm (button → modal → typed-confirmation OR explicit "I understand" checkbox).
- Documentation that re-pairing happens via the existing KAT-02 pairing endpoint — the farmer types the same physical `device_id` (printed on the ESP32 case) targeting a new parcel; the partial unique indexes from KAT-02 already enforce BR-K1.
- AUTH-07 pgTAP cells covering: (a) verifier returns NULL for UNLINKED rows, (b) UPDATE on UNLINKED row refused by trg_m1_katara_devices_unlink_freeze, (c) INSERT with same device_id on a different parcel succeeds when the original is UNLINKED.
- Backend tests: 5 unit scenarios + 1 e2e round-trip.
- `spring-status.yml` flip + §10 hand-off note for KAT-13.

### Out of scope

- **An atomic "relink" endpoint** that does unlink + new-pair in one transaction. Deliberately deferred. The two-step flow is correct: the farmer may unlink a broken device with no intention of re-pairing it, and the cognitive cost of two clicks (unlink, then pair on the new parcel) is lower than introducing a third API verb whose only safety win is "if the new pair fails, the old device is silently re-linked" — which is a behaviour we *do not want* (an unlink is an explicit user action, not a transactional artefact).
- **"Move device to parcel X" UI shortcut** — could combine unlink + re-pair in a single dialog. Post-MVD UX polish; the same outcome is achievable with two clicks today, and the dialog requires designing a parcel-picker component that does not exist yet.
- **Recovery of an UNLINKED row** — an UNLINKED row is terminal by design. To re-pair the same physical device on the same parcel after an unlink, the farmer creates a *new* row (via the KAT-02 pairing endpoint) which gets a fresh `id`, fresh `api_key_hash`, and the old UNLINKED row stays in place to anchor KAT-13's history. Promoting UNLINKED → ACTIVE in place would either (a) keep the old api-key (security regression — the unlink was the user's signal that the key should die) or (b) require a key-rotation flow that already exists as "pair again", at which point we have built the same thing twice.
- **Bulk-unlink** (e.g. "unlink all devices on this parcel"). Single-device operation only; the demo flow needs one device.
- **Admin-side force-unlink** — admins can already update any row via `katara_devices_admin_select` + the corresponding admin update policy from AUTH-04. No KAT-12 surface needed.
- **Email notification on unlink** — PRD §7.3 does not list "device unlinked" as an email type. The action is user-initiated (the farmer clicked the button), so there is no recipient who would benefit from an asynchronous notification. If the device is unlinked by an admin in some future flow, that future story owns the email.
- **Audit log of unlink events** — `m1_katara_devices.updated_at` already moves on the unlink (the existing `set_updated_at()` trigger fires); the row history is implicit in the row itself. A formal `m1_katara_device_audit_log` table is post-MVD if compliance ever requires it.
- **Per-device unlink confirmation via typed device_id** (e.g. "type ESP-KAT-001 to confirm"). The simple checkbox + button confirm is sufficient for the demo's blast radius (one device, one farmer, one parcel) and the destructive copy makes the action's consequences explicit. Promote to typed-confirm post-MVD if the user base ever scales past 10 devices per farmer.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [KAT-02](./KAT-02-esp32-device-pairing.md) `IN_REVIEW` or `DONE` | Ships every piece KAT-12 builds on: the table, the enum (with `UNLINKED` already declared), the two partial unique indexes, the verifier function (KAT-12 only swaps its body), the RLS policies (KAT-12 reuses them as-is), the pairing endpoint (KAT-12 reuses it for re-pair). If KAT-02 is not at least `IN_REVIEW`, none of the affordances KAT-12 needs exist yet. |
| [KAT-03](./KAT-03-esp32-telemetry-ingestion.md) `IN_REVIEW` or `DONE` | Provides the `/api/v1/katara/ingest` endpoint whose 401 path KAT-12's e2e test asserts against. KAT-03's verifier callsite is unchanged by KAT-12 — only the verifier function body changes. |
| Frontend parcel detail page exists | KAT-02 added the device card on `/dashboard/farmer/parcels/[id]`. KAT-12 adds one button + one modal to that existing card; no new route. |
| `pgcrypto` available | Unchanged from KAT-02. |

KAT-12 has **no dependency on KAT-11**. KAT-11's WHERE clause filters `status = 'ACTIVE'`, so UNLINKED rows are naturally skipped — the two stories are independent and can ship in either order.

---

## 4. Data Contract

### 4.1 Verifier function — tighten the WHERE clause

KAT-02 shipped `public.verify_device_api_key(p_device_id text, p_plaintext text) returns uuid` returning the matching `m1_katara_devices.id` on a successful bcrypt compare, NULL otherwise. KAT-12 amends the body:

```sql
create or replace function public.verify_device_api_key(
    p_device_id text,
    p_plaintext text
) returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
    select id
      from public.m1_katara_devices
     where device_id = p_device_id
       and status <> 'UNLINKED'                 -- ← KAT-12: added
       and api_key_hash = crypt(p_plaintext, api_key_hash)
     limit 1;
$$;
```

Two design points:

- The filter is `status <> 'UNLINKED'`, not `status in ('PENDING','ACTIVE','OFFLINE')`. The negative form survives any future enum additions (KAT-15 might add `MAINTENANCE`; we want maintenance-mode devices to still authenticate — only UNLINKED is the terminal "this api-key is dead" state).
- The filter is placed *before* the bcrypt compare in the SQL text. Postgres does not guarantee predicate order (the planner may reorder), but it does guarantee that a row excluded by either predicate is not returned. The bcrypt cost (≈10 ms at cost factor 10) is paid on every successful lookup either way; the status filter shaves it from cases where an UNLINKED row's api-key is replayed by a still-running ESP32.

### 4.2 Freeze trigger — UNLINKED rows are read-only

KAT-12 introduces a trigger that refuses post-unlink mutation of identity columns. Without it, a farmer could (in theory, via direct SQL or a future buggy admin UI) re-point an UNLINKED row's `parcel_id` to a different parcel, smuggling telemetry history across parcels and breaking KAT-13's invariant.

```sql
create or replace function public.m1_katara_devices_unlink_freeze()
returns trigger
language plpgsql
as $$
begin
    if old.status = 'UNLINKED' then
        if new.parcel_id    is distinct from old.parcel_id
        or new.farmer_id    is distinct from old.farmer_id
        or new.device_id    is distinct from old.device_id
        or new.api_key_hash is distinct from old.api_key_hash
        or new.api_key_last4 is distinct from old.api_key_last4
        or new.status       is distinct from old.status then
            raise exception 'm1_katara_devices: UNLINKED row is read-only (KAT-12)'
                using errcode = 'check_violation';
        end if;
    end if;
    return new;
end;
$$;

create trigger trg_m1_katara_devices_unlink_freeze
    before update on public.m1_katara_devices
    for each row execute function public.m1_katara_devices_unlink_freeze();
```

The trigger explicitly allows `updated_at` and `last_seen` mutations to flow through — those columns are operational state (timestamps) and the existing `set_updated_at()` trigger needs to keep stamping them even on UNLINKED rows for KAT-13's "last activity on the device, even after unlink" surface.

Note on RLS interaction: this is a BEFORE UPDATE trigger, not an RLS policy. It fires *after* RLS has decided whether the user can see the row at all — so a cross-farmer attempt is already 0-rows by RLS, never reaches the trigger. The trigger's role is purely to enforce the terminal-state invariant against the same farmer who legitimately owns the row.

### 4.3 The unlink UPDATE (one statement)

The new endpoint issues exactly one statement under the user's JWT (RLS-scoped):

```sql
update public.m1_katara_devices
   set status = 'UNLINKED'
 where id = $1
   and status <> 'UNLINKED'
returning id, device_id, parcel_id;
```

- `where status <> 'UNLINKED'` makes the operation idempotent at the DB layer: a second attempt returns 0 rows, which the FastAPI handler maps to a 409 `device_already_unlinked`. This is a small UX win for the rare double-click case.
- `auth.uid() = farmer_id` is **not** in the WHERE clause — the `katara_devices_update_own` RLS policy from KAT-02 already enforces it; adding the predicate explicitly is dead weight that obscures the role of RLS in the read.
- `RETURNING` carries the `device_id` + `parcel_id` back for the response body (the frontend uses them to update its local state without a follow-up GET).

### 4.4 The re-pair INSERT — unchanged from KAT-02

The relink path is the existing KAT-02 pairing flow:

```http
POST /api/v1/katara/parcels/{new_parcel_id}/devices
Authorization: Bearer <farmer_jwt>
Content-Type: application/json

{
    "device_id": "ESP-KAT-001"
}
```

The partial unique indexes from KAT-02 do the heavy lifting:

- `m1_katara_devices_one_active_per_device_id` — refuses the INSERT if any non-UNLINKED row exists for `ESP-KAT-001`. Post-unlink, the only row for that device_id is UNLINKED, so the filter excludes it and the INSERT succeeds.
- `m1_katara_devices_one_active_per_parcel` — refuses the INSERT if `new_parcel_id` already has a non-UNLINKED device. The farmer is responsible for unlinking the destination parcel's current device first if applicable; the 409 surface from KAT-02 is the explicit feedback.

KAT-12 adds one *docstring* update to the pairing endpoint pointing the reader at KAT-12's re-pair flow for cross-reference. No code change.

### 4.5 Status-transition matrix after KAT-12

| From | To | Trigger | KAT story |
|---|---|---|---|
| `PENDING` | `ACTIVE` | First ingest | KAT-03 |
| `ACTIVE` | `OFFLINE` | CRON scan (silent > 1 h) | KAT-11 |
| `OFFLINE` | `ACTIVE` | Next ingest | KAT-03 (recovery path) |
| `PENDING` | `UNLINKED` | Farmer unlinks before first ingest | **KAT-12** |
| `ACTIVE` | `UNLINKED` | Farmer unlinks a live device | **KAT-12** |
| `OFFLINE` | `UNLINKED` | Farmer unlinks a silent device | **KAT-12** |
| `UNLINKED` | * | — | Forbidden by trg_m1_katara_devices_unlink_freeze |

The matrix is now complete: every transition has exactly one writer story, and the terminal UNLINKED state is structurally locked.

---

## 5. Step-by-Step Implementation

### 5.1 Migration — verifier tightening + freeze trigger

Create [`db/migrations/0026_kat12_unlink_relink.sql`](../../db/migrations/) (replace `0026` with the next available migration number after KAT-11's `0025`):

```sql
-- 0026 — M1 Katara: KAT-12 unlink/relink contract.
--
-- Two changes, both load-bearing for KAT-13:
--   1. verify_device_api_key() now refuses UNLINKED rows, so a still-running
--      ESP32 with a stale api-key is mechanically rejected by KAT-03's ingest
--      path on the next transmission with no further user action.
--   2. trg_m1_katara_devices_unlink_freeze refuses any post-unlink mutation
--      to identity columns (parcel_id, farmer_id, device_id, api_key_*, status)
--      so an UNLINKED row cannot be smuggled back into another parcel — the
--      row + its telemetry history are frozen under the parcel it was paired
--      to at unlink time, which is the invariant KAT-13 reads on.

-- ── Verifier with UNLINKED filter ─────────────────────────────────────────────
create or replace function public.verify_device_api_key(
    p_device_id text,
    p_plaintext text
) returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
    select id
      from public.m1_katara_devices
     where device_id = p_device_id
       and status <> 'UNLINKED'
       and api_key_hash = crypt(p_plaintext, api_key_hash)
     limit 1;
$$;

comment on function public.verify_device_api_key(text, text) is
    'KAT-02 verifier, tightened by KAT-12: returns the device row id on a '
    'successful bcrypt compare against an active (non-UNLINKED) row. Called '
    'from KAT-03 ingest path under service_role. Constant-time bcrypt compare.';

-- ── Freeze trigger for UNLINKED rows ──────────────────────────────────────────
create or replace function public.m1_katara_devices_unlink_freeze()
returns trigger
language plpgsql
as $$
begin
    if old.status = 'UNLINKED' then
        if new.parcel_id     is distinct from old.parcel_id
        or new.farmer_id     is distinct from old.farmer_id
        or new.device_id     is distinct from old.device_id
        or new.api_key_hash  is distinct from old.api_key_hash
        or new.api_key_last4 is distinct from old.api_key_last4
        or new.status        is distinct from old.status then
            raise exception 'm1_katara_devices: UNLINKED row is read-only (KAT-12)'
                using errcode = 'check_violation';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_m1_katara_devices_unlink_freeze
    on public.m1_katara_devices;

create trigger trg_m1_katara_devices_unlink_freeze
    before update on public.m1_katara_devices
    for each row execute function public.m1_katara_devices_unlink_freeze();

comment on function public.m1_katara_devices_unlink_freeze() is
    'KAT-12: refuses post-unlink mutation of identity columns. updated_at and '
    'last_seen are allowed through (operational state, not identity).';
```

Apply with the existing migration runner (`make -C db migrate`). The migration is fully idempotent:
- `create or replace function` on the verifier is a no-op if the function body already matches.
- `drop trigger if exists` + `create trigger` re-installs cleanly.

### 5.2 FastAPI — unlink endpoint

Edit [`backend/app/modules/katara/devices.py`](../../backend/app/modules/katara/devices.py) (the router file shipped by KAT-02). Add the unlink handler alongside the existing pair/list/rotate-key/unpair handlers:

```python
@router.post(
    "/devices/{device_uuid}/unlink",
    status_code=status.HTTP_200_OK,
    response_model=UnlinkDeviceResponse,
    responses={
        403: {"description": "Caller is not a verified farmer or does not own the device"},
        404: {"description": "Device not found (or not visible to caller)"},
        409: {"description": "Device is already UNLINKED"},
    },
    summary="Unlink a device from its parcel (KAT-12)",
    description=(
        "Soft-detaches the device from its parcel by flipping status to UNLINKED. "
        "The api-key of the unlinked device is mechanically invalidated on the next "
        "ESP32 transmission (KAT-03 ingest will return 401 invalid_device_credentials). "
        "Historical telemetry remains under the original parcel (KAT-13). "
        "To pair the same physical device on a different parcel, POST to "
        "/api/v1/katara/parcels/{new_parcel_id}/devices with the same device_id."
    ),
)
async def unlink_device(
    device_uuid: UUID,
    user: AuthUser = Depends(require_role("FARMER")),
    db: Client = Depends(get_db_for_user),
) -> UnlinkDeviceResponse:
    # RLS enforces farmer_id = auth.uid(); the WHERE id-only is intentional.
    # Idempotency: a second unlink returns 0 rows → 409.
    result = (
        db.table("m1_katara_devices")
          .update({"status": "UNLINKED"})
          .eq("id", str(device_uuid))
          .neq("status", "UNLINKED")
          .execute()
    )

    if not result.data:
        # Either RLS hid the row (cross-farmer / not visible) or already UNLINKED.
        # Distinguish with a follow-up read under the same RLS context.
        probe = (
            db.table("m1_katara_devices")
              .select("id,status")
              .eq("id", str(device_uuid))
              .maybe_single()
              .execute()
        )
        if probe.data is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "device_not_found")
        if probe.data["status"] == "UNLINKED":
            raise HTTPException(status.HTTP_409_CONFLICT, "device_already_unlinked")
        # Defensive: should not reach. RLS + the .neq() should cover both branches.
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "unexpected_unlink_state")

    row = result.data[0]
    return UnlinkDeviceResponse(
        id=row["id"],
        device_id=row["device_id"],
        parcel_id=row["parcel_id"],
        status="UNLINKED",
    )
```

Add the Pydantic response model to [`backend/app/modules/katara/schemas.py`](../../backend/app/modules/katara/schemas.py) (extend the existing module — do not create a parallel file):

```python
class UnlinkDeviceResponse(BaseModel):
    id: UUID
    device_id: str
    parcel_id: UUID
    status: Literal["UNLINKED"]
```

Three non-obvious choices in the handler:

1. **The 404/409 disambiguation via a follow-up SELECT.** The first UPDATE either returns 0 rows because RLS hid it (not the caller's device → 404) or because the row was already UNLINKED (→ 409). The follow-up probe under the same RLS context distinguishes the two without leaking existence (an unrelated farmer's device id surfaces as 404, not 409). The cost is one extra round-trip on the rare miss path; the happy path is unaffected.
2. **No explicit verification gate on unlink.** KAT-02's verification gate exists on the *insert* path (only verified farmers can pair). An unlink is a destructive walk-back of a prior valid action; if a farmer's verification status was later revoked, they should still be able to unlink the devices they paired pre-revocation. The `require_role("FARMER")` dependency is the right check.
3. **`.neq("status", "UNLINKED")` in the UPDATE WHERE.** Postgres would happily UPDATE an UNLINKED row to UNLINKED again (no-op) without this clause, returning the row — and the handler would render that as a 200 success, which is wrong for the idempotency contract we want. The `.neq` forces the 0-row result that flows into the 409 branch.

### 5.3 Frontend — unlink button + confirmation modal

Edit the device card on [`frontend/src/app/dashboard/farmer/parcels/[id]/page.tsx`](../../frontend/src/app/dashboard/farmer/parcels/) (the file shipped by KAT-02). Add an "Unlink device" button beside the existing "Rotate api-key" button:

```tsx
{device && device.status !== "UNLINKED" && (
  <Button
    variant="destructive"
    size="sm"
    onClick={() => setUnlinkModalOpen(true)}
  >
    {t("katara.device.unlink")}
  </Button>
)}
```

Create [`frontend/src/app/dashboard/farmer/parcels/[id]/UnlinkDeviceModal.tsx`](../../frontend/src/app/dashboard/farmer/parcels/) (mirrors the existing KAT-02 pairing modal's structure):

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { unlinkDevice } from "./device-actions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deviceId: string;
  deviceUuid: string;
  parcelName: string;
  onUnlinked: () => void;
}

export function UnlinkDeviceModal({
  open, onOpenChange, deviceId, deviceUuid, parcelName, onUnlinked,
}: Props) {
  const t = useTranslations("katara.device.unlink_modal");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await unlinkDevice(deviceUuid);
      onUnlinked();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error_generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("title", { deviceId })}</DialogTitle>
        <DialogDescription>
          {t("body", { deviceId, parcelName })}
        </DialogDescription>
        <div className="flex items-center gap-2 py-2">
          <Checkbox
            id="unlink-ack"
            checked={acknowledged}
            onCheckedChange={(v) => setAcknowledged(v === true)}
          />
          <label htmlFor="unlink-ack" className="text-sm">
            {t("ack")}
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={!acknowledged || submitting}
            onClick={handleConfirm}
          >
            {submitting ? t("submitting") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Create the server action [`frontend/src/app/dashboard/farmer/parcels/[id]/device-actions.ts`](../../frontend/src/app/dashboard/farmer/parcels/) (or extend the existing one if KAT-02 already created it):

```ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function unlinkDevice(deviceUuid: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/v1/katara/devices/${deviceUuid}/unlink`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `unlink_failed_${res.status}`);
  }
}
```

i18n message file additions under [`frontend/messages/{fr,ar,en}.json`](../../frontend/messages/) — add the `katara.device.unlink` and `katara.device.unlink_modal.*` keys. The Arabic file must keep `dir="rtl"` on the modal's container (the existing `<Dialog>` from KAT-02 already inherits the page-level `dir` attribute from PRD §7.2; no extra work).

### 5.4 AUTH-07 pgTAP cells

Append to [`db/tests/auth07_business_rules.sql`](../../db/tests/auth07_business_rules.sql) (the file extended by KAT-06 and KAT-11):

```sql
-- ── KAT-12 cells (K-12a / K-12b / K-12c) ──────────────────────────────────────

-- K-12a: verify_device_api_key returns NULL for an UNLINKED row, even with a
-- matching api_key_hash. This is the load-bearing contract KAT-03's 401 path
-- depends on after an unlink.
do $$
declare
    v_device_uuid uuid;
    v_plain text := 'vk_test_kat12_K12a_plaintext_32hex';
    v_result uuid;
begin
    -- Seed: a paired ACTIVE device with a known api-key
    insert into public.m1_katara_devices (
        device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status
    ) values (
        'ESP-KAT-K12', '<seed-parcel-id>', '<seed-farmer-id>',
        public.crypt(v_plain, public.gen_salt('bf', 10)),
        right(v_plain, 4),
        'ACTIVE'
    ) returning id into v_device_uuid;

    -- Positive: ACTIVE row authenticates
    select public.verify_device_api_key('ESP-KAT-K12', v_plain) into v_result;
    perform ok(v_result is not null, 'K-12a.1: ACTIVE row authenticates');

    -- Unlink
    update public.m1_katara_devices set status = 'UNLINKED' where id = v_device_uuid;

    -- Negative: UNLINKED row returns NULL (the verifier filter bites)
    select public.verify_device_api_key('ESP-KAT-K12', v_plain) into v_result;
    perform ok(v_result is null, 'K-12a.2: UNLINKED row does not authenticate');

    -- Cleanup
    delete from public.m1_katara_devices where id = v_device_uuid;
end$$;

-- K-12b: trg_m1_katara_devices_unlink_freeze refuses post-unlink mutation of
-- identity columns. updated_at + last_seen pass through.
do $$
declare
    v_device_uuid uuid;
begin
    insert into public.m1_katara_devices (
        device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status
    ) values (
        'ESP-KAT-K12B', '<seed-parcel-id>', '<seed-farmer-id>',
        public.crypt('seed', public.gen_salt('bf', 4)),
        'seed',
        'UNLINKED'
    ) returning id into v_device_uuid;

    -- Negative: parcel_id mutation refused
    perform throws_ok(
        format($q$update public.m1_katara_devices set parcel_id = '<other-parcel-id>' where id = '%s'$q$, v_device_uuid),
        '23514',  -- check_violation per the trigger's errcode
        null,
        'K-12b.1: parcel_id mutation on UNLINKED row refused'
    );

    -- Negative: status flip back to ACTIVE refused
    perform throws_ok(
        format($q$update public.m1_katara_devices set status = 'ACTIVE' where id = '%s'$q$, v_device_uuid),
        '23514',
        null,
        'K-12b.2: status revival on UNLINKED row refused'
    );

    -- Positive: last_seen stamp passes through (operational state)
    update public.m1_katara_devices set last_seen = now() where id = v_device_uuid;
    perform ok(true, 'K-12b.3: last_seen mutation on UNLINKED row allowed');

    delete from public.m1_katara_devices where id = v_device_uuid;
end$$;

-- K-12c: re-pair flow inserts a new row with the same device_id when the
-- prior row is UNLINKED; the partial unique index allows it.
do $$
declare
    v_old uuid;
    v_new uuid;
begin
    insert into public.m1_katara_devices (
        device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status
    ) values (
        'ESP-KAT-K12C', '<seed-parcel-A>', '<seed-farmer-id>',
        public.crypt('old', public.gen_salt('bf', 4)),
        'oldX',
        'UNLINKED'
    ) returning id into v_old;

    insert into public.m1_katara_devices (
        device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status
    ) values (
        'ESP-KAT-K12C', '<seed-parcel-B>', '<seed-farmer-id>',
        public.crypt('new', public.gen_salt('bf', 4)),
        'newY',
        'PENDING'
    ) returning id into v_new;

    perform ok(v_new is distinct from v_old, 'K-12c.1: re-pair created a NEW row');
    perform ok(
        (select status from public.m1_katara_devices where id = v_old) = 'UNLINKED',
        'K-12c.2: old row still UNLINKED'
    );

    -- Negative: a third row with same device_id while v_new is PENDING is refused
    perform throws_ok(
        $q$insert into public.m1_katara_devices (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status) values ('ESP-KAT-K12C', '<seed-parcel-C>', '<seed-farmer-id>', public.crypt('third', public.gen_salt('bf', 4)), 'thrZ', 'PENDING')$q$,
        '23505',  -- unique_violation from the partial index
        null,
        'K-12c.3: third concurrent non-UNLINKED row refused'
    );

    delete from public.m1_katara_devices where id in (v_old, v_new);
end$$;
```

The `'<seed-...>'` placeholders reference the shared seed identities from `db/tests/_auth07_seed.psql` (created by AUTH-07; KAT-12 reuses the existing FARMER-A + two parcel seeds without adding new identities). Adjust the literal UUIDs to match the seed file's exports.

Wrap each `do $$` block in the project's pgTAP `plan()` accounting following the convention used by the KAT-11 cells. Run with `make -C db test-auth07`.

### 5.5 Backend tests

Create [`backend/tests/test_kat12_unlink.py`](../../backend/tests/test_kat12_unlink.py) — 5 unit scenarios under `pytest-asyncio` with the existing `staging_supabase` fixture from AUTH-07's conftest:

| # | Scenario | Expected |
|---|---|---|
| S1 | FARMER-A unlinks own ACTIVE device | 200; response contains `status: "UNLINKED"`; DB row reflects the flip |
| S2 | FARMER-A unlinks a device that is already UNLINKED | 409 `device_already_unlinked` |
| S3 | FARMER-B attempts to unlink FARMER-A's device | 404 `device_not_found` (RLS hides it; no existence leak) |
| S4 | FARMER-A unlinks a non-existent device uuid | 404 `device_not_found` |
| S5 | CITIZEN-A attempts to unlink any device | 403 `forbidden_role` (require_role rejects pre-RLS) |

Sample S1:

```python
@pytest.mark.asyncio
async def test_s1_owner_unlinks_active_device(
    farmer_a_jwt, staging_db, staging_device_factory, api_base_url,
):
    device = await staging_device_factory(
        farmer="FARMER-A", parcel="PARCEL-A1", status="ACTIVE",
    )

    async with httpx.AsyncClient(base_url=api_base_url) as client:
        res = await client.post(
            f"/api/v1/katara/devices/{device['id']}/unlink",
            headers={"Authorization": f"Bearer {farmer_a_jwt}"},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "UNLINKED"
    assert body["device_id"] == device["device_id"]

    row = await staging_db.fetchrow(
        "select status from public.m1_katara_devices where id = $1",
        device["id"],
    )
    assert row["status"] == "UNLINKED"
```

Create [`backend/tests/test_kat12_unlink_e2e.py`](../../backend/tests/test_kat12_unlink_e2e.py) gated behind `--run-e2e` — one end-to-end round-trip covering the full KAT-12 + KAT-03 + KAT-02 chain:

```python
@pytest.mark.e2e
@pytest.mark.asyncio
async def test_kat12_unlink_then_ingest_401_then_repair_then_ingest_204(
    farmer_a_jwt, staging_db, staging_parcel_factory, api_base_url, monkeypatch,
):
    """Full KAT-12 round-trip:
      1. pair ESP-KAT-E2E on parcel A → record the plaintext api-key
      2. ingest one telemetry payload → 204
      3. unlink the device → 200
      4. ingest with the SAME plaintext api-key → 401 invalid_device_credentials
      5. re-pair ESP-KAT-E2E on parcel B → 201, new plaintext api-key
      6. ingest with the new key → 204
      7. assert the old row's parcel_id is still parcel A; the new row's is parcel B
      8. assert the old row's telemetry is still queryable under parcel A
    """
    # See conftest for the helper factories; the body assembles the 8 calls
    # and asserts the response codes + final DB state.
    ...
```

The e2e test is the single highest-signal acceptance gate — if it passes, the KAT-12 contract holds end-to-end including the KAT-03 verifier change.

### 5.6 Deploy checklist

Before flipping `spring-status.yml` to `IN_REVIEW`:

1. **Migration applied** — `make -C db migrate` on staging, then on production. Confirm with `\df public.verify_device_api_key` that the function body contains `status <> 'UNLINKED'`, and `\d+ public.m1_katara_devices` that the `trg_m1_katara_devices_unlink_freeze` trigger is listed.
2. **Backend deployed** — the new endpoint is callable: `curl -X POST https://api.vitachain.ma/api/v1/katara/devices/<bogus-uuid>/unlink` (without auth) returns 401 (the FastAPI auth dependency, not RLS — RLS is for valid JWTs).
3. **Frontend deployed** — the parcel detail page shows the "Unlink device" button when a non-UNLINKED device is paired, hides it otherwise.
4. **i18n keys present** — `frontend/messages/fr.json`, `frontend/messages/ar.json`, and `frontend/messages/en.json` all contain `katara.device.unlink` and `katara.device.unlink_modal.*`. A missing key surfaces as the raw key string in the UI — that is the smoke signal.
5. **Manual smoke test on staging** — see §7.3.
6. **No regressions on KAT-03 ingest p50** — re-run the KAT-03 Locust profile (50 users / 60 s) and confirm p50 < 50 ms. The verifier change adds one indexed predicate; the impact should be negligible, but a regression here would be a release blocker.

### 5.7 `spring-status.yml` flip

Once §7 manual rehearsal passes and `pytest backend/tests/test_kat12_unlink.py` is green, edit [`docs/spring-status.yml`](../spring-status.yml):

```yaml
      - id: KAT-12
        title: Unlink/relink device between parcels
        priority: Should
        status: IN_REVIEW   # ← was TODO
        actor: FARMER
        acceptance: "Re-pair flow works; old data preserved"
        depends_on: [KAT-02]
```

Update `progress_pct` on the E2 epic line accordingly. The KAT-13 row stays `TODO` — its `depends_on: [KAT-12]` now resolves to an `IN_REVIEW` story, which is sufficient to start KAT-13 work (same convention as KAT-11 starting against an `IN_REVIEW` KAT-06).

---

## 6. Design Decisions & Risks

### 6.1 Why soft-detach via `status = 'UNLINKED'`, not DELETE

A DELETE would either (a) CASCADE the telemetry rows away (loses KAT-13's history) or (b) RESTRICT (FK on `m1_katara_telemetry.device_id` would refuse the delete). Soft-detach with a terminal status is the only design that satisfies both BR-K1 (one active device per parcel) and the KAT-13 contract (history queryable after unlink) without introducing a separate `m1_katara_devices_archive` table whose rows would need their own RLS policies and partial unique indexes.

The cost is one row per unlink, indefinitely retained. At the demo scale (≤ 50 devices, ≤ 1 unlink per device per month) the storage footprint is < 1 KB/month. Post-MVD, an `m1_katara_devices_archive` migration could move UNLINKED rows older than 12 months to cold storage; that is a separate story whose trigger is real, not hypothetical.

### 6.2 Why no atomic "relink" endpoint

Considered: `POST /api/v1/katara/devices/{device_uuid}/relink {"new_parcel_id": "..."}` that wraps unlink + new-pair in a single transaction. Rejected for three reasons:

- **Semantic mismatch.** The two operations are *not* atomic in the user's mental model. A farmer who unlinks a broken device has no intention of re-pairing it; an atomic endpoint would force them to think of the unlink as a "move" with no destination, which is wrong.
- **Key generation.** The new-pair half generates a fresh api-key that must be shown to the farmer in a modal *once*. Wrapping this in a "relink" response leaks the api-key into a response body the frontend now has to handle in a third UI surface (alongside the pair modal and the rotate-key modal). Duplication for no win.
- **Failure modes.** If the new-pair half fails (e.g. destination parcel is owned by a different farmer post-permission-change), the unlink would have to roll back — except the unlink was the user's *explicit* action, and rolling it back silently is worse than leaving the device unlinked and surfacing the new-pair error.

The two-step flow ("unlink, then pair on the new parcel") matches the user's mental model, reuses the KAT-02 modal verbatim, and has no surprising rollback behaviour.

### 6.3 Why the verifier filter, not an RLS policy on ingest

KAT-03's ingest endpoint runs under `service_role` (per AUTH-05's allow-list) so RLS is bypassed by design. The filter has to live in the verifier function body to be effective. Placing it elsewhere — say, in the FastAPI ingest handler — would mean a tightly-coupled trio (KAT-02 ships the function, KAT-03 ships the handler, KAT-12 patches the handler) that is much harder to reason about than a self-contained `create or replace function` in one migration.

The verifier already runs on every ingest. Adding one indexed predicate (`status <> 'UNLINKED'`) is cheaper than every alternative.

### 6.4 Why the freeze trigger raises `check_violation`, not a custom errcode

Postgres has no "user-defined errcode" namespace. The closest fit is `check_violation` (23514), which is semantically aligned ("a check on this row's state failed") and is already what the AUTH-07 `throws_ok` cells in KAT-12 §5.4 K-12b assert against. Using a generic `RAISE EXCEPTION` without an errcode would produce `P0001` (raise_exception), which is fine but loses the semantic hint to a future debugger reading the Sentry trace.

### 6.5 Risk — concurrent unlink + ingest race

The window: farmer clicks unlink at T=0; KAT-03 ingest from the same device arrives at T=0+ε.

- If the ingest's `verify_device_api_key()` call lands *before* the unlink UPDATE commits, the verifier returns a non-NULL device id, KAT-03 inserts the telemetry row, KAT-03's status-flip UPDATE on `m1_katara_devices` runs (under service_role, bypassing RLS) and races the unlink's UPDATE. Postgres serialises the two UPDATEs via row-level locks; the later one wins.
- If the unlink wins last-write — status is `UNLINKED`. The telemetry row landed but the device is correctly marked unlinked. The telemetry row's `parcel_id` (denormalised by KAT-03's trigger) points to the OLD parcel, which is correct for KAT-13's purposes.
- If the ingest's status-flip wins last-write — status is `ACTIVE` despite the user's unlink action. **This is a bug.** The next ingest, however, will see the verifier filter and fail; the second ingest after that is the recovery point.

Mitigation: the unlink UPDATE in §4.3 uses `where id = $1 and status <> 'UNLINKED'`, and KAT-03's status-flip UPDATE only fires *if* the verifier returned a row — which it cannot have for an already-UNLINKED row. So the race window is strictly between the verifier read and the ingest's status UPDATE, both of which take row-level locks. In Postgres this is bounded by `FOR UPDATE` semantics: KAT-12's unlink UPDATE will block on the ingest's UPDATE (or vice versa) and the second-arriving statement will see the post-commit state of the first.

Concretely: the race window is the duration of the ingest's UPDATE (single-row, indexed, ≪ 1 ms). The probability of a real-world race is sub-ppm at the demo's traffic profile. **Acceptable risk.** Documented as a §10 hand-off note for post-MVD hardening.

### 6.6 Risk — frontend modal abandoned mid-flow

The destructive-action modal has two states the user can leave in: (a) closed without confirming, (b) modal open during a network failure on the unlink POST. Both are recoverable — closing without confirming is a no-op, and a network failure leaves the device in its prior state. The modal must not show a transient "device unlinked" state until the POST returns 200.

### 6.7 Risk — verifier change affects the AUTH-07 K-02 (KAT-02 verifier round-trip) cell

KAT-02's AUTH-07 cell asserts that a freshly-paired device's api-key authenticates. With KAT-12's filter, the cell still passes for ACTIVE/PENDING rows — the filter only excludes UNLINKED, which the K-02 cell does not seed. **Verify on first run** that the KAT-02 cell stays green after the migration applies; if not, the cell needs updating to assert against status = 'PENDING' or 'ACTIVE' explicitly.

---

## 7. Tests

### 7.1 Backend unit tests — `backend/tests/test_kat12_unlink.py`

See §5.5 for the 5-scenario matrix. All scenarios use the existing AUTH-07 conftest fixtures (`farmer_a_jwt`, `farmer_b_jwt`, `citizen_a_jwt`, `staging_db`, `staging_device_factory`, `api_base_url`). Target: 5/5 green in < 3 s under `pytest backend/tests/test_kat12_unlink.py -v`.

### 7.2 Backend e2e test — `backend/tests/test_kat12_unlink_e2e.py` (gated)

The full 8-step round-trip from §5.5. Gated behind `--run-e2e` per the project convention. Target: green against staging in < 30 s end-to-end.

### 7.3 Manual staging rehearsal

Run before flipping `spring-status.yml` to `IN_REVIEW`:

1. Log in as FARMER-A. Navigate to a parcel with an ACTIVE device. Confirm the "Unlink device" button is visible.
2. Click "Unlink device". Confirm the modal copy names the device_id + parcel name correctly in the current locale.
3. Check the "I understand" checkbox. Click "Confirm". Observe the modal closing and the device card flipping to "No device paired".
4. Open a separate terminal and POST to `/api/v1/katara/ingest` with the unlinked device's plaintext api-key (recorded during the original pairing). Expect 401 `invalid_device_credentials`.
5. Navigate to a *different* parcel owned by FARMER-A. Click "Pair a new device". Type the same physical `device_id` (e.g. `ESP-KAT-001`). Submit.
6. Confirm the pairing modal shows a *new* api-key (different last4 from the one recorded in step 4).
7. POST to `/api/v1/katara/ingest` with the *new* plaintext api-key. Expect 204 No Content.
8. SQL: `select id, parcel_id, status from public.m1_katara_devices where device_id = 'ESP-KAT-001' order by created_at;` — expect exactly two rows, the first with `status = 'UNLINKED'` and the original parcel_id, the second with `status = 'ACTIVE'` (KAT-03 just flipped it from PENDING on the ingest in step 7) and the new parcel_id.
9. As FARMER-B (separate session in a private window), navigate to the API directly and POST `/api/v1/katara/devices/<FARMER-A's-device-uuid>/unlink`. Expect 404 `device_not_found` — no existence leak.
10. As FARMER-A, attempt to unlink the already-UNLINKED original row via direct API call. Expect 409 `device_already_unlinked`.

### 7.4 Smoke checks against the KAT-03 ingest SLA

Re-run the KAT-03 Locust profile (`make -C load kat03-ingest LOCUST_USERS=50 LOCUST_DURATION=60s`) on staging after the migration applies. Compare:

| Metric | Pre-KAT-12 baseline | Post-KAT-12 target |
|---|---|---|
| p50 ingest latency | < 50 ms | < 50 ms (≤ +2 ms tolerance) |
| p99 ingest latency | < 150 ms | < 150 ms (≤ +5 ms tolerance) |
| Failure rate | 0% | 0% |

A regression beyond the tolerances is a release blocker. The verifier change adds one indexed predicate on an existing scan; a > 2 ms p50 regression suggests the query plan flipped to a sequential scan and needs investigation.

---

## 8. Observability

KAT-12 adds no new worker, no new CRON, no new long-running process. The unlink endpoint is a single HTTP call; its observability surface is the existing FastAPI middleware (X-Request-Id, Sentry-on-exception).

| Signal | Source | What it tells us |
|---|---|---|
| `katara.devices.unlink.*` HTTP access logs | NGINX | Per-unlink request count + status code. Anomalous 4xx clusters (e.g. many 404s from the same JWT) suggest an enumeration probe. |
| Sentry exception captures | FastAPI handler `except` paths | Unexpected DB errors, partial commits. |
| `m1_katara_devices` direct queries | Manual SQL | `select count(*) from m1_katara_devices where status = 'UNLINKED'` is the at-a-glance KAT-12 usage metric. |
| Brevo dashboard | N/A | KAT-12 does not send emails. |
| Healthchecks.io | N/A | KAT-12 has no worker. |

The notable absence of a worker, a Brevo template, and a Healthchecks heartbeat is itself a design feature — KAT-12 is a synchronous user action with no background machinery to operate, monitor, or fail.

---

## 9. Acceptance Verification Checklist

Run before flipping `spring-status.yml` to `IN_REVIEW`:

- [ ] Migration `0026_kat12_unlink_relink.sql` applied on staging; `\df public.verify_device_api_key` shows the new body; `\d+ public.m1_katara_devices` lists `trg_m1_katara_devices_unlink_freeze`.
- [ ] `pytest backend/tests/test_kat12_unlink.py -v` — all 5 scenarios green.
- [ ] `pytest backend/tests/test_kat12_unlink_e2e.py --run-e2e` — passes on staging.
- [ ] `make -C db test-auth07` — three new pgTAP cells (K-12a / K-12b / K-12c) green.
- [ ] `pytest backend/tests/test_service_client_callsite_allowlist.py` — passes unchanged (KAT-12 adds no service-role callsites).
- [ ] Frontend build green; `pnpm --filter frontend lint && pnpm --filter frontend typecheck` clean.
- [ ] Manual staging rehearsal (§7.3) steps 1–10 all observed.
- [ ] KAT-03 Locust re-run (§7.4) shows p50 < 50 ms, no regression beyond tolerance.
- [ ] No Sentry errors during the rehearsal.
- [ ] i18n keys present in all three locale JSON files (FR / AR / EN); the Arabic modal renders RTL.
- [ ] `spring-status.yml` KAT-12 row updated to `IN_REVIEW`; E2 epic `progress_pct` updated.

---

## 10. Hand-off Notes for Future Work

1. **KAT-13 (history queryable after unlink)** — KAT-12's contract is the substrate. KAT-13's read queries should filter `m1_katara_telemetry` by `parcel_id` (not `device_id`), so that a parcel's history view includes telemetry from *every* device ever paired to it — the currently-active one plus any UNLINKED predecessors. The `m1_katara_telemetry` table already denormalises `parcel_id` (per KAT-03), so this is a single-table scan. KAT-13 needs no schema change beyond what KAT-12 ships.
2. **Concurrent unlink + ingest race (§6.5 follow-up)** — the sub-ppm race is acceptable for MVD but post-MVD hardening could wrap the unlink in `select ... for update` against the device row before the UPDATE, so an in-flight ingest's status-flip blocks behind the unlink. Estimated effort: 1 hour + a new pgTAP race-condition cell.
3. **UNLINKED row archival** — see §6.1. A post-MVD cron job moves UNLINKED rows older than 12 months into `m1_katara_devices_archive` and updates the AUTH-07 matrix accordingly. Trigger: when the demo population exceeds ~100 devices and the unlinked-row count starts to dominate dashboard queries.
4. **Bulk-unlink** — out-of-scope here. If a future user research surfaces "I have 20 devices and want to retire them all", a `POST /api/v1/katara/parcels/{id}/devices/unlink-all` endpoint can be built on top of the same single-device handler with a server-side loop. The freeze trigger and the verifier filter already cover the correctness invariants.
5. **Atomic relink endpoint (§6.2 reconsideration)** — if post-MVD UX research shows that the two-step flow has a measurable drop-off rate, an atomic endpoint is a 4-hour build on top of KAT-12's primitives. The reason to *not* build it now is that we have no evidence the drop-off exists.
6. **Audit log of unlink events** — a `m1_katara_device_audit_log (id, device_id, action, actor_id, at)` table populated by an AFTER UPDATE trigger when `status` transitions to UNLINKED. Post-MVD compliance feature; trivial to add later because the existing `updated_at` stamp gives us the temporal hook for backfill.
7. **AUTH-07 RLS matrix** — the matrix gains three new BR cells (K-12a / K-12b / K-12c per §5.4). The matrix doc (`docs/auth07-rls-matrix.md` or equivalent) is updated by the AUTH-07 audit story owner; KAT-12 only ships the pgTAP cells.
