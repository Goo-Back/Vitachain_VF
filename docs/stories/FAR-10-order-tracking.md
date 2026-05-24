# FAR-10 — Order tracking (status timeline + producer accept/reject)

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** RESTAURANT, FARMER
> **Depends on:** [FAR-03](./FAR-03-restaurateur-places-order.md), [FAR-04](./FAR-04-anonymized-order-notification.md)
> **Unblocks:** FAR-08 admin Orders tab; future BR-S2-style 30-day cohort reports.
> **Acceptance:** Producer can accept/reject each item they own; restaurant sees the lifecycle (PENDING → ACCEPTED/REJECTED → PICKED_UP → IN_TRANSIT → DELIVERED) without learning any producer contact info beyond the name (visible since FAR-02); status transitions are enforced by a DB trigger; the producer side never sees the restaurant's identity.

---

## 1. Purpose

FAR-03 places orders. FAR-04 tells producers. FAR-10 closes the loop: producers act on what they got, restaurants follow what is happening, and VitaChain shows the truth to both sides without disclosing more than each is meant to see.

---

## 2. Scope

### In scope

- Backend endpoint `PATCH /api/v1/farmarket/orders/items/{item_id}/status` (FARMER) — accept / reject / mark picked_up / in_transit / delivered.
- Backend endpoint `PATCH /api/v1/farmarket/orders/{order_id}/cancel` (RESTAURANT, allowed only while header status is `PENDING`).
- DB trigger that re-derives the header `status` from the constituent items (e.g., all items ACCEPTED → header `ACCEPTED`; ≥ 1 ACCEPTED but ≥ 1 REJECTED → `PARTIALLY_ACCEPTED`; all DELIVERED → `DELIVERED`).
- DB trigger that enforces the allowed item-status transition graph (see §3.2). Invalid transitions raise `P0001`.
- Frontend resto: `/dashboard/restaurant/orders` list page + `/dashboard/restaurant/orders/{id}` detail page with a visual timeline.
- Frontend farmer: `/dashboard/farmer/orders` incoming queue (reads `v_farmer_incoming_items`) + per-item accept/reject buttons.
- Tests in `backend/tests/test_far10_order_tracking.py` (transition graph, role gates, header derivation).

### Out of scope

- Real logistics carrier integration — `PICKED_UP`/`IN_TRANSIT`/`DELIVERED` are still producer-driven manual marks for MVP.
- Cancellation after ACCEPTED — explicit non-goal; cancellations after producer commitment require off-platform negotiation (and BR-F5 means VitaChain cannot put resto + producer in touch). MVP solution: out of scope, contact admin.
- Refunds — gated on real payments, so not in MVP.

---

## 3. State machine

### 3.1 Per-item status graph (`m2_farmarket_item_status`)

```
PENDING ──► ACCEPTED ──► PICKED_UP ──► IN_TRANSIT ──► DELIVERED
   │
   └────► REJECTED          (terminal)
```

- `PENDING → ACCEPTED | REJECTED`: only the owning producer.
- `ACCEPTED → PICKED_UP`: only the owning producer.
- `PICKED_UP → IN_TRANSIT`: only the owning producer.
- `IN_TRANSIT → DELIVERED`: only the owning producer (MVP — no carrier integration).
- `REJECTED`, `DELIVERED`: terminal — no outgoing transitions.

Enforced by `m2_farmarket_validate_item_transition()` trigger fired BEFORE UPDATE.

### 3.2 Header status (`m2_farmarket_order_status`) — derived

A trigger `m2_farmarket_recompute_order_status()` runs AFTER UPDATE/INSERT on `m2_farmarket_order_items`:

| Items state | Header status |
|---|---|
| Any `PENDING` and no `REJECTED` | `PENDING` |
| All `ACCEPTED` | `ACCEPTED` |
| Any `ACCEPTED` and any `REJECTED` and no `PENDING` | `PARTIALLY_ACCEPTED` |
| All `REJECTED` | `REJECTED` |
| Any `PICKED_UP` / `IN_TRANSIT` | `IN_PROGRESS` |
| All non-rejected items `DELIVERED` | `DELIVERED` |
| Header explicitly `CANCELLED` (resto called the cancel endpoint) | `CANCELLED` (sticky — trigger no-ops) |

### 3.3 Cancel endpoint

`PATCH /orders/{order_id}/cancel` is allowed iff:

- Caller is RESTAURANT.
- `restaurant_id = auth.uid()`.
- Current header `status = 'PENDING'` (no producer has acted yet).

On success: header `status → 'CANCELLED'`. Items are deliberately untouched so audit history persists.

---

## 4. API contracts

### 4.1 `PATCH /api/v1/farmarket/orders/items/{item_id}/status` (FARMER)

Request:
```json
{ "new_status": "ACCEPTED", "producer_note": "Stock confirmé, prêt sous 48h." }
```

Response: the updated `OrderItemOut` with `status` and `updated_at`.

Errors:
- `403 not_item_owner` — `farmer_id != auth.uid()`.
- `409 invalid_transition` — graph violation (trigger raises `P0001`, router maps to 409).
- `404 item_not_found`.

### 4.2 `PATCH /api/v1/farmarket/orders/{order_id}/cancel` (RESTAURANT)

Body: `{}` (no payload).

Errors:
- `403 not_order_owner`.
- `409 not_cancellable` — header is no longer `PENDING`.

### 4.3 `GET /api/v1/farmarket/orders/incoming` (FARMER)

Returns the producer's queue: SELECTs from `v_farmer_incoming_items` (defined in FAR-03 §3.6).  The response is filtered to the columns the view projects — `resto_handle` is the only signal of identity.

---

## 5. Frontend

### 5.1 Restaurant

`/dashboard/restaurant/orders` — paginated list. Columns: short code, producer count, total MAD, current header status, created_at.

`/dashboard/restaurant/orders/{id}` — header summary + per-item rows. A vertical timeline shows status milestones with timestamps. Cancel button visible only when `status === 'PENDING'`.

### 5.2 Farmer

`/dashboard/farmer/orders` — incoming queue, default filter `status = 'PENDING'`. Each row shows: order short code, `resto_handle` (truncated), region, items summary, "Accept" / "Reject" buttons. After accept, the per-row action becomes "Mark picked up" → "Mark in transit" → "Mark delivered".

There is **no UI element exposing the resto's full identity** — the only handle visible is the sha256-derived `resto_handle`. The producer can choose to attach a free-form `producer_note` when rejecting; that note is shown to the resto, sanitised through the same regex redactor as FAR-04 (§6.3 sanitiser shared module).

---

## 6. RLS additions (migration 0042)

The FAR-03 baseline already lets:

- Restaurants SELECT/INSERT their own orders + items.
- Farmers SELECT items where `farmer_id = auth.uid()` (via `v_farmer_incoming_items`).
- Farmers UPDATE items they own.

FAR-10 adds:

```sql
-- Restaurant can cancel their own PENDING order (UPDATE on the header).
drop policy if exists "orders_update_cancel_own_restaurant" on public.m2_farmarket_orders;
create policy "orders_update_cancel_own_restaurant"
    on public.m2_farmarket_orders for update to authenticated
    using       (restaurant_id = auth.uid() and status = 'PENDING')
    with check  (restaurant_id = auth.uid() and status = 'CANCELLED');
```

This single policy is intentionally narrow: only PENDING → CANCELLED is allowed at the DB layer. Anything else from the resto's session gets a 42501.

---

## 7. Triggers (migration 0042)

```sql
create or replace function public.m2_farmarket_validate_item_transition()
returns trigger language plpgsql as $$
begin
    if old.status = new.status then return new; end if;
    if old.status = 'PENDING'    and new.status in ('ACCEPTED','REJECTED')          then return new; end if;
    if old.status = 'ACCEPTED'   and new.status = 'PICKED_UP'                       then return new; end if;
    if old.status = 'PICKED_UP'  and new.status = 'IN_TRANSIT'                      then return new; end if;
    if old.status = 'IN_TRANSIT' and new.status = 'DELIVERED'                       then return new; end if;
    raise exception 'invalid_transition: % → %', old.status, new.status using errcode = 'P0001';
end$$;

drop trigger if exists trg_far10_item_transition on public.m2_farmarket_order_items;
create trigger trg_far10_item_transition
    before update of status on public.m2_farmarket_order_items
    for each row execute function public.m2_farmarket_validate_item_transition();
```

And the header derivation:

```sql
create or replace function public.m2_farmarket_recompute_order_status()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    v_order uuid := coalesce(new.order_id, old.order_id);
    v_pending int; v_accepted int; v_rejected int;
    v_picked int; v_transit int; v_delivered int;
    v_total int;
    v_header_status public.m2_farmarket_order_status;
    v_current public.m2_farmarket_order_status;
begin
    select status into v_current from public.m2_farmarket_orders where id = v_order for update;
    if v_current = 'CANCELLED' then return new; end if;  -- sticky

    select
        count(*) filter (where status = 'PENDING'),
        count(*) filter (where status = 'ACCEPTED'),
        count(*) filter (where status = 'REJECTED'),
        count(*) filter (where status = 'PICKED_UP'),
        count(*) filter (where status = 'IN_TRANSIT'),
        count(*) filter (where status = 'DELIVERED'),
        count(*)
    into v_pending, v_accepted, v_rejected, v_picked, v_transit, v_delivered, v_total
    from public.m2_farmarket_order_items where order_id = v_order;

    v_header_status := case
        when v_pending > 0 and v_rejected = 0                                      then 'PENDING'
        when v_total > 0 and v_total = v_rejected                                  then 'REJECTED'
        when v_pending = 0 and v_rejected > 0 and v_accepted > 0                   then 'PARTIALLY_ACCEPTED'
        when v_pending = 0 and v_rejected = 0
             and v_picked = 0 and v_transit = 0 and v_delivered = 0                then 'ACCEPTED'
        when v_picked > 0 or v_transit > 0                                         then 'IN_PROGRESS'
        when v_total > 0 and v_total - v_rejected = v_delivered                    then 'DELIVERED'
        else v_current
    end;

    update public.m2_farmarket_orders
       set status = v_header_status, updated_at = now()
     where id = v_order
       and status is distinct from v_header_status;

    return new;
end$$;

drop trigger if exists trg_far10_recompute_header on public.m2_farmarket_order_items;
create trigger trg_far10_recompute_header
    after insert or update of status on public.m2_farmarket_order_items
    for each row execute function public.m2_farmarket_recompute_order_status();
```

---

## 8. Verification checklist

- [ ] `PATCH /orders/items/{id}/status` from a producer who owns the item with `new_status = 'ACCEPTED'` succeeds with 200 and updated row.
- [ ] Same call from a producer who does NOT own the item returns 403.
- [ ] Invalid transition (`PENDING → DELIVERED`) returns 409 (trigger raises P0001).
- [ ] Accept all items on a 2-item order → header flips to `ACCEPTED`.
- [ ] Accept 1, reject 1 → header flips to `PARTIALLY_ACCEPTED`.
- [ ] Mark `PICKED_UP` on any item → header flips to `IN_PROGRESS`.
- [ ] Mark all non-rejected items `DELIVERED` → header flips to `DELIVERED`.
- [ ] `PATCH /orders/{id}/cancel` from the owning RESTAURANT while header `= PENDING` → header `= CANCELLED`.
- [ ] Same call when header `= ACCEPTED` → 409.
- [ ] Producer-side UI never references `restaurant_id` (DOM grep on the rendered page returns 0 matches for any restaurant UUID).
- [ ] `producer_note` shown to the resto goes through the same redactor as `delivery_notes` did in FAR-04.

---

## 9. Deliverables

| Artifact | Location |
|---|---|
| Migration | `db/migrations/0042_far10_order_tracking.sql` |
| New schemas | append to `backend/app/modules/farmarket/schemas.py` |
| Endpoints | append to `backend/app/modules/farmarket/router.py` |
| Tests | `backend/tests/test_far10_order_tracking.py` |
| Resto orders list page | `frontend/src/app/dashboard/restaurant/orders/page.tsx` |
| Resto order detail page | `frontend/src/app/dashboard/restaurant/orders/[id]/page.tsx` |
| Resto cancel server action | `frontend/src/app/dashboard/restaurant/orders/[id]/actions.ts` |
| Farmer incoming page | `frontend/src/app/dashboard/farmer/orders/page.tsx` |
| Farmer item-action server actions | `frontend/src/app/dashboard/farmer/orders/actions.ts` |
| Sidebar entries | edit `frontend/src/app/dashboard/farmer/_ui/Sidebar.tsx` to add "Commandes" link |
| `spring-status.yml` flip | `FAR-10.status` → `IN_REVIEW` |

---

## 10. Definition of Done

1. Migrations 0042 applied. Triggers + new RLS policy live.
2. All transition tests green.
3. Manual cross-role smoke:
   - Place 2-producer order as RESTAURANT-A.
   - As PRODUCER-A: accept own item; check header is `PARTIALLY_ACCEPTED`.
   - As PRODUCER-B: reject own item with note `"En rupture de stock."`; check resto sees the note.
   - As RESTAURANT-A: header is now `PARTIALLY_ACCEPTED`; cancel button is hidden.
   - As PRODUCER-A: mark item `PICKED_UP → IN_TRANSIT → DELIVERED`; check header lands on `DELIVERED` (because the only non-rejected item is now delivered).
4. Anonymisation regression: as PRODUCER-A, no DOM element, network response, or log line contains RESTAURANT-A's name or contact info.
5. `spring-status.yml` flipped.
