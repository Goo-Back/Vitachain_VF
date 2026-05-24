# FAR-03 — Restaurateur places order via cart (logistics intermediary)

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace
> **Phase:** P2 — More (Weeks 3–5)
> **Priority:** Must
> **Status:** TODO
> **Actor:** RESTAURANT (authenticated)
> **Depends on:** [FAR-02](./FAR-02-restaurateur-browses-ads.md), [AUTH-03](./AUTH-03-jwt-config-256bit-1h-7d.md)
> **Unblocks:** [FAR-04](./FAR-04-anonymized-order-notification.md), [FAR-10](./FAR-10-order-tracking.md)
> **Acceptance:** Cart → order persisted in `m2_farmarket_orders` + `m2_farmarket_order_items`; producer name visible in the catalog/cart, but **zero buyer identifiers** ever cross to the producer; RLS enforces anonymisation at the DB layer.
> **Supersedes:** the original FAR-03 lead-contact flow (removed in migration 0039 — see [FAR-03-restaurateur-contacts-seller.md](./FAR-03-restaurateur-contacts-seller.md) marked OBSOLETE).

---

## 1. Purpose

FAR-02 makes ads discoverable. FAR-03 lets a restaurant **buy** without ever exchanging contact information with the producer. VitaChain sits between the two parties as the logistics intermediary:

- Restaurant builds a cart of multiple ads (different producers OK).
- Restaurant places one order; VitaChain persists it.
- Producer is notified ([FAR-04](./FAR-04-anonymized-order-notification.md)) with **no buyer identifiers** — only an opaque order ID, item details, and a delivery region.
- Subsequent status transitions (accept / reject / pickup / delivery) are tracked in [FAR-10](./FAR-10-order-tracking.md).

The model removes the BR-F4 risk of a producer harvesting buyer phone numbers off-platform.

---

## 2. Scope

### In scope

- New tables `m2_farmarket_orders` (header) + `m2_farmarket_order_items` (lines).
- RLS policies enforcing **strict anonymisation**:
  - Restaurant SELECTs/INSERTs only their own orders.
  - Producer SELECTs only the items where they're the seller — and never sees `restaurant_id` (column hidden via a SECURITY DEFINER projection function).
- Backend endpoint `POST /api/v1/farmarket/orders` — places an order from cart payload.
- Backend endpoint `GET /api/v1/farmarket/orders/me` — restaurant's own order history.
- Frontend: client-side cart (`CartContext` with localStorage persistence).
- Frontend: `/dashboard/restaurant/cart` page with line-item edit + place-order button.
- Frontend: enable "Ajouter au panier" on `AdCatalogCard`.
- Backend unit tests in `backend/tests/test_far03_place_order.py`.

### Out of scope

- Producer-side accept/reject UI → **FAR-10**.
- Producer notification email → **FAR-04**.
- Real payment integration (Stripe) — MVP uses a simulated `payment_status` field.
- Real logistics integration (third-party carrier) — MVP uses a simulated `logistics_status` field.

---

## 3. Data Model

### 3.1 `m2_farmarket_orders` (order header)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `restaurant_id` | `uuid` NOT NULL | FK → `public.profiles(id)`. Filled from `auth.uid()` at INSERT. |
| `status` | `m2_farmarket_order_status` NOT NULL | Header-level lifecycle: `PENDING`, `PARTIALLY_ACCEPTED`, `ACCEPTED`, `REJECTED`, `IN_PROGRESS`, `DELIVERED`, `CANCELLED`. Derived from item statuses by trigger (FAR-10). |
| `delivery_region` | `m2_farmarket_region` NOT NULL | One of the 12 Moroccan regions. **No street address** in MVP — coarse-grained location only. |
| `delivery_notes` | `text` | Optional, ≤ 500 chars. Free text *but the worker (FAR-04) MUST strip identifiers before forwarding*. Phase D will redact email/phone patterns. |
| `subtotal_mad` | `numeric(12,2)` NOT NULL | Σ of line totals. |
| `logistics_fee_mad` | `numeric(12,2)` NOT NULL | Computed at order time. MVP formula: `max(50, 0.05 * subtotal)`. |
| `total_mad` | `numeric(12,2)` NOT NULL | `subtotal + logistics_fee`. |
| `payment_status` | `text` NOT NULL DEFAULT `'SIMULATED_PAID'` | Placeholder for Stripe (post-MVP). |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | Touched by trigger. |

### 3.2 `m2_farmarket_order_items` (order lines)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `order_id` | `uuid` NOT NULL | FK → `m2_farmarket_orders(id)` ON DELETE CASCADE |
| `ad_id` | `uuid` NOT NULL | FK → `m2_farmarket_ads(id)` ON DELETE RESTRICT (preserve audit) |
| `farmer_id` | `uuid` NOT NULL | Snapshot at order time. Mirrors `m2_farmarket_ads.farmer_id` but persists even if the ad is later soft-deleted. |
| `quantity_kg` | `numeric(10,2)` NOT NULL | CHECK > 0 |
| `unit_price_mad` | `numeric(10,2)` NOT NULL | Snapshot of `m2_farmarket_ads.price_mad` at order time |
| `line_total_mad` | `numeric(12,2)` NOT NULL | `quantity_kg * unit_price_mad` (CHECK) |
| `status` | `m2_farmarket_item_status` NOT NULL DEFAULT `'PENDING'` | Per-item lifecycle: `PENDING`, `ACCEPTED`, `REJECTED`, `PICKED_UP`, `IN_TRANSIT`, `DELIVERED`. |
| `producer_note` | `text` | Optional reason for `REJECTED`. ≤ 500 chars. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

### 3.3 Enums

```sql
create type public.m2_farmarket_order_status as enum (
  'PENDING', 'PARTIALLY_ACCEPTED', 'ACCEPTED', 'REJECTED',
  'IN_PROGRESS', 'DELIVERED', 'CANCELLED'
);
create type public.m2_farmarket_item_status as enum (
  'PENDING', 'ACCEPTED', 'REJECTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'
);
```

### 3.4 Indexes

- `orders (restaurant_id, created_at desc)` — resto history page.
- `order_items (farmer_id, status, created_at desc)` — farmer's incoming queue.
- `order_items (order_id)` — join lookup.

### 3.5 RLS (the anonymisation contract)

**On `m2_farmarket_orders`:**

1. `orders_select_own_restaurant` — `SELECT` where `restaurant_id = auth.uid()` AND `has_role('RESTAURANT')`.
2. `orders_insert_own_restaurant` — `INSERT WITH CHECK (restaurant_id = auth.uid() AND has_role('RESTAURANT'))`.
3. `orders_admin_select` — `SELECT` for `is_admin()` (FAR-08 admin view).
4. **No producer SELECT policy on the orders table.** Producers must NEVER see the header (which contains `restaurant_id`, `delivery_notes`, `payment_status`).

**On `m2_farmarket_order_items`:**

5. `order_items_select_own_restaurant` — `SELECT` where the parent order's `restaurant_id = auth.uid()`.
6. `order_items_select_own_farmer` — `SELECT` where `farmer_id = auth.uid() AND has_role('FARMER')`.
   - **Producer-side queries MUST go through the view `v_farmer_incoming_items`** (defined below) which projects an anonymised row shape. Direct table access via this policy is allowed at the row level but the column list is gated by an updateable view (3.6).
7. `order_items_update_status_farmer` — `UPDATE` where `farmer_id = auth.uid()`, with `WITH CHECK (farmer_id = auth.uid())` and an additional constraint trigger to limit the allowed status transitions (per FAR-10).
8. `order_items_admin_all` — full access for `is_admin()`.

### 3.6 The producer projection view

```sql
create view public.v_farmer_incoming_items
with (security_invoker = true) as
select
    oi.id,
    oi.order_id,
    -- Anonymised resto handle. Stable per (restaurant, farmer) pair so the
    -- producer can build a sense of repeat customers without ever learning
    -- which legal entity sits behind the handle.
    encode(
        digest(o.restaurant_id::text || ':' || oi.farmer_id::text, 'sha256'),
        'hex'
    )::text as resto_handle,
    oi.ad_id,
    oi.quantity_kg,
    oi.unit_price_mad,
    oi.line_total_mad,
    oi.status,
    oi.producer_note,
    o.delivery_region,    -- coarse only (the 12 regions)
    oi.created_at,
    oi.updated_at
  from public.m2_farmarket_order_items oi
  join public.m2_farmarket_orders o on o.id = oi.order_id
 where oi.farmer_id = auth.uid();
```

The view has `security_invoker = true` so RLS on the underlying tables still fires (defence-in-depth). The producer reads `v_farmer_incoming_items`, never `m2_farmarket_orders`.

---

## 4. API contract

### 4.1 `POST /api/v1/farmarket/orders` (RESTAURANT)

Request body:

```json
{
  "delivery_region": "Souss-Massa",
  "delivery_notes": "Livraison de préférence en matinée.",
  "items": [
    { "ad_id": "uuid", "quantity_kg": "25.00" },
    { "ad_id": "uuid", "quantity_kg": "10.50" }
  ]
}
```

Server-side:

1. `require_role("RESTAURANT")` — FastAPI gate.
2. Validate ≥ 1 item, ≤ 20 items, all ad_ids distinct.
3. For each ad_id: fetch the ad row, check `status = 'ACTIVE'`, snapshot `farmer_id` and `price_mad`. Reject (`409`) if any ad is missing or inactive.
4. Compute `subtotal`, `logistics_fee` (`max(50, 0.05*subtotal)`), `total`.
5. Single transaction:
   - INSERT into `m2_farmarket_orders`.
   - INSERT N rows into `m2_farmarket_order_items` with the snapshot `farmer_id` / `unit_price_mad`.
6. Emit `pg_notify('farmarket_order_placed', order_id::text)` — picked up by the FAR-04 worker.
7. Return the full order (header + items) as `OrderOut`.

### 4.2 `GET /api/v1/farmarket/orders/me` (RESTAURANT)

Paginated list of the caller's own orders, newest first. Each row includes the items array. RLS `orders_select_own_restaurant` enforces ownership.

### 4.3 Errors

- `400 invalid_items` — empty items array, duplicate ad_ids, or > 20 items.
- `409 ad_not_purchasable` — at least one ad is not `ACTIVE`.
- `409 quantity_exceeds_stock` — requested `quantity_kg` > the ad's `quantity_kg`.

---

## 5. Frontend

### 5.1 Cart state (client-side)

`frontend/src/lib/cart.tsx`:

- `CartProvider` wraps `RestaurantLayout`.
- State shape: `{ items: { ad_id, ad_snapshot, quantity_kg }[] }`.
- Persistence: localStorage key `vita_cart_v1`. Hydrate on mount, write on every change.
- Helpers: `addToCart(ad)`, `updateQuantity(ad_id, qty)`, `removeFromCart(ad_id)`, `clearCart()`, `cartTotal()`.
- The ad snapshot is stored so the cart survives ad removal/edits — server still re-validates at placement.

### 5.2 `/dashboard/restaurant/cart` page

- List cart items grouped by producer (just display — DB constraint allows mixed orders).
- Show producer name + region per group (NO contact info).
- Per-line: quantity input, line total, remove button.
- Order summary: subtotal, logistics fee (`max(50, 0.05*subtotal)`), total.
- Region selector (defaults to a profile field if one exists; otherwise a required field).
- Delivery notes textarea (≤ 500 chars).
- "Passer commande" button — calls server action that hits `POST /orders`, then redirects to `/dashboard/restaurant/orders/{id}` (FAR-10).

### 5.3 `AdCatalogCard` change

Replace the disabled stub `<button>Ajouter au panier</button>` with a real client-side `AddToCartButton` that calls `addToCart(ad)`.

---

## 6. Verification checklist

- [ ] Cart persists across page reloads (localStorage).
- [ ] Adding the same ad twice consolidates the quantity (or warns, depending on UX choice — spec defaults to consolidate).
- [ ] `POST /orders` returns `201` with the full order + items for a valid cart.
- [ ] `POST /orders` returns `409 quantity_exceeds_stock` when any item's `quantity_kg` > the ad's stock.
- [ ] `POST /orders` returns `409 ad_not_purchasable` when at least one ad is EXPIRED/DELETED.
- [ ] `GET /orders/me` returns only the caller's own orders (RLS check).
- [ ] A producer querying `m2_farmarket_orders` directly returns 0 rows (no SELECT policy for them).
- [ ] A producer querying `v_farmer_incoming_items` returns only rows where `farmer_id = auth.uid()`, and `resto_handle` is opaque (no `restaurant_id` column).
- [ ] An anonymised view sanity check: the producer cannot derive the restaurant's identity from `resto_handle` + a separate query (the salt is the producer's own UID, so different producers see different handles for the same restaurant).
- [ ] FAR-09's `is_featured` ordering still applies on the catalog (regression check).

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| New migration | `db/migrations/0040_far03_orders.sql` |
| Pydantic schemas | append to `backend/app/modules/farmarket/schemas.py` (`OrderItemCreate`, `OrderCreate`, `OrderItemOut`, `OrderOut`) |
| Router endpoints | append to `backend/app/modules/farmarket/router.py` |
| Backend tests | `backend/tests/test_far03_place_order.py` |
| Cart provider | `frontend/src/lib/cart.tsx` |
| Cart page | `frontend/src/app/dashboard/restaurant/cart/page.tsx` |
| Add-to-cart button | `frontend/src/app/dashboard/restaurant/marketplace/AddToCartButton.tsx` |
| `AdCatalogCard` wiring | edit existing file |
| Layout wrap | edit `frontend/src/app/dashboard/restaurant/layout.tsx` to mount `CartProvider` |
| `spring-status.yml` flip | `FAR-03.status` → `IN_REVIEW` |

---

## 8. Business rules

| Rule | Where enforced |
|---|---|
| BR-F4 (Brevo key only on backend) | Preserved — no email work in this story. Belongs to FAR-04. |
| **NEW: BR-F5 — Zero buyer info to producer** | `m2_farmarket_orders` has no producer SELECT policy; `v_farmer_incoming_items` projects only `resto_handle` (sha256). |
| **NEW: BR-F6 — Snapshot pricing** | `unit_price_mad` is copied at order time. Future ad edits never mutate historical orders. |
| Order can only contain ACTIVE ads | Router pre-check + 409 response. |

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Stock race — two restos order the last kg simultaneously | MVP accepts it (no stock reservation). The producer reconciles at accept time and uses `REJECTED` with `producer_note = 'out_of_stock'`. Post-MVP: SELECT … FOR UPDATE on the ad row inside the order tx. |
| Free-text `delivery_notes` leaks resto identity | Phase D adds an email/phone regex redactor before passing the field to FAR-04 worker. Hard problem at MVP scale — accept the risk and document. |
| `resto_handle` could be brute-forced if the restaurant set is small | The salt is the producer's UUID — and there is no API to enumerate restaurants. Accepting at MVP. |

---

## 10. Definition of Done

1. Migration 0040 applied; new tables + view + RLS in place.
2. `POST /orders`, `GET /orders/me` endpoints live and tested.
3. Cart + cart page + add-to-cart wired, dev server smoke test green.
4. Backend tests for FAR-03 green (`make -C backend test`).
5. Manual cross-role check: as RESTAURANT-A I see only my orders; as FARMER-B I see only items where I'm the seller (via the view); as FARMER-B I get 0 rows from the orders header.
6. `spring-status.yml` flipped; hand-off note that **FAR-04 and FAR-10 are now unblocked**.
