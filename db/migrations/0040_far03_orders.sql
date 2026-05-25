-- =============================================================================
-- 0040 — M2 FarMarket: orders + order_items + producer projection view.
-- Story:  FAR-03 (docs/stories/FAR-03-restaurateur-places-order.md)
--
-- This migration is the data backbone of the FarMarket logistics-intermediary
-- pivot. The previous lead-contact model (migrations 0034/0035) was removed
-- in 0039. From this migration onward the only path between a restaurant and
-- a producer is an order — and even that path strips buyer identifiers via
-- the v_farmer_incoming_items projection view (BR-F5).
--
-- Anonymisation contract (BR-F5)
-- ------------------------------
-- 1. m2_farmarket_orders has NO producer SELECT policy. Direct queries from a
--    farmer return zero rows.
-- 2. m2_farmarket_order_items HAS a producer SELECT policy (own farmer_id),
--    but producers MUST be served through v_farmer_incoming_items which
--    projects an opaque resto_handle (sha256(restaurant_id||':'||farmer_id))
--    instead of the raw restaurant_id.
-- 3. Snapshot pricing (unit_price_mad, line_total_mad, farmer_id) lives on
--    order_items so historical orders are immune to later ad edits/deletes.
--
-- Event-trigger workaround (same pattern as 0032/0034): disable
-- trg_enforce_rls_on_public_tables before CREATE TABLE, re-enable after RLS
-- is enabled.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── Enums ─────────────────────────────────────────────────────────────────────

do $$ begin
    create type public.m2_farmarket_order_status as enum (
        'PENDING',
        'PARTIALLY_ACCEPTED',
        'ACCEPTED',
        'REJECTED',
        'IN_PROGRESS',
        'DELIVERED',
        'CANCELLED'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.m2_farmarket_item_status as enum (
        'PENDING',
        'ACCEPTED',
        'REJECTED',
        'PICKED_UP',
        'IN_TRANSIT',
        'DELIVERED'
    );
exception when duplicate_object then null; end $$;

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists public.m2_farmarket_orders (
    id                  uuid                                primary key default gen_random_uuid(),

    restaurant_id       uuid                                not null
                            references public.profiles(id) on delete restrict,

    status              public.m2_farmarket_order_status    not null default 'PENDING',

    delivery_region     public.m2_farmarket_region          not null,

    delivery_notes      text
                            constraint m2_farmarket_orders_notes_length
                                check (delivery_notes is null
                                       or char_length(delivery_notes) <= 500),

    subtotal_mad        numeric(12, 2)                      not null
                            constraint m2_farmarket_orders_subtotal_positive
                                check (subtotal_mad >= 0),

    logistics_fee_mad   numeric(12, 2)                      not null
                            constraint m2_farmarket_orders_logistics_positive
                                check (logistics_fee_mad >= 0),

    total_mad           numeric(12, 2)                      not null
                            constraint m2_farmarket_orders_total_consistent
                                check (total_mad = subtotal_mad + logistics_fee_mad),

    payment_status      text                                not null default 'SIMULATED_PAID'
                            constraint m2_farmarket_orders_payment_status_check
                                check (payment_status in ('SIMULATED_PAID', 'PENDING', 'FAILED')),

    created_at          timestamptz                         not null default now(),
    updated_at          timestamptz                         not null default now()
);

create table if not exists public.m2_farmarket_order_items (
    id                  uuid                                primary key default gen_random_uuid(),

    order_id            uuid                                not null
                            references public.m2_farmarket_orders(id) on delete cascade,

    ad_id               uuid                                not null
                            references public.m2_farmarket_ads(id) on delete restrict,

    -- Snapshot at order time. Survives ad soft-delete.
    farmer_id           uuid                                not null
                            references public.profiles(id) on delete restrict,

    quantity_kg         numeric(10, 2)                      not null
                            constraint m2_farmarket_items_qty_positive
                                check (quantity_kg > 0),

    -- Snapshot at order time. Future ad edits never mutate historical orders.
    unit_price_mad      numeric(10, 2)                      not null
                            constraint m2_farmarket_items_price_positive
                                check (unit_price_mad > 0),

    line_total_mad      numeric(12, 2)                      not null
                            constraint m2_farmarket_items_line_consistent
                                check (line_total_mad = round(quantity_kg * unit_price_mad, 2)),

    status              public.m2_farmarket_item_status     not null default 'PENDING',

    producer_note       text
                            constraint m2_farmarket_items_note_length
                                check (producer_note is null
                                       or char_length(producer_note) <= 500),

    created_at          timestamptz                         not null default now(),
    updated_at          timestamptz                         not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Resto order history page (FAR-03 GET /orders/me).
create index if not exists m2_farmarket_orders_restaurant_idx
    on public.m2_farmarket_orders (restaurant_id, created_at desc);

-- Worker scan for unnotified orders (FAR-04). Backstop predicate uses this.
create index if not exists m2_farmarket_orders_unnotified_idx
    on public.m2_farmarket_orders (created_at desc)
    where status = 'PENDING';

-- Farmer incoming queue (FAR-10 GET /orders/incoming via the view).
create index if not exists m2_farmarket_order_items_farmer_idx
    on public.m2_farmarket_order_items (farmer_id, status, created_at desc);

-- Cascade lookup.
create index if not exists m2_farmarket_order_items_order_idx
    on public.m2_farmarket_order_items (order_id);

-- ── Touched_at maintenance triggers ───────────────────────────────────────────

create or replace function public.m2_farmarket_orders_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end$$;

drop trigger if exists trg_far03_orders_touch on public.m2_farmarket_orders;
create trigger trg_far03_orders_touch
    before update on public.m2_farmarket_orders
    for each row execute function public.m2_farmarket_orders_touch_updated_at();

drop trigger if exists trg_far03_items_touch on public.m2_farmarket_order_items;
create trigger trg_far03_items_touch
    before update on public.m2_farmarket_order_items
    for each row execute function public.m2_farmarket_orders_touch_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.m2_farmarket_orders       enable row level security;
alter table public.m2_farmarket_order_items  enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

-- ── Orders header RLS ─────────────────────────────────────────────────────────

-- 1. Restaurant reads their own orders.
drop policy if exists "orders_select_own_restaurant" on public.m2_farmarket_orders;
create policy "orders_select_own_restaurant"
    on public.m2_farmarket_orders for select to authenticated
    using (
        auth.uid() = restaurant_id
        and public.has_role('RESTAURANT'::public.user_role)
    );

-- 2. Restaurant creates orders only as themselves.
drop policy if exists "orders_insert_own_restaurant" on public.m2_farmarket_orders;
create policy "orders_insert_own_restaurant"
    on public.m2_farmarket_orders for insert to authenticated
    with check (
        auth.uid() = restaurant_id
        and public.has_role('RESTAURANT'::public.user_role)
    );

-- 3. Admin SELECT (FAR-08).
drop policy if exists "orders_admin_select" on public.m2_farmarket_orders;
create policy "orders_admin_select"
    on public.m2_farmarket_orders for select to authenticated
    using (public.is_admin());

-- NOTE: There is intentionally NO producer SELECT policy on
-- m2_farmarket_orders. Producers must use v_farmer_incoming_items (below).

-- ── Order items RLS ───────────────────────────────────────────────────────────

-- 4. Restaurant reads items on their own orders.
drop policy if exists "order_items_select_own_restaurant" on public.m2_farmarket_order_items;
create policy "order_items_select_own_restaurant"
    on public.m2_farmarket_order_items for select to authenticated
    using (
        exists (
            select 1 from public.m2_farmarket_orders o
             where o.id = order_id
               and o.restaurant_id = auth.uid()
        )
    );

-- 5. Restaurant inserts items only for their own orders.
drop policy if exists "order_items_insert_own_restaurant" on public.m2_farmarket_order_items;
create policy "order_items_insert_own_restaurant"
    on public.m2_farmarket_order_items for insert to authenticated
    with check (
        exists (
            select 1 from public.m2_farmarket_orders o
             where o.id = order_id
               and o.restaurant_id = auth.uid()
        )
        and public.has_role('RESTAURANT'::public.user_role)
    );

-- 6. Farmer reads items where they are the seller. This row-level access is
--    necessary so the v_farmer_incoming_items view can run with
--    security_invoker = true.
drop policy if exists "order_items_select_own_farmer" on public.m2_farmarket_order_items;
create policy "order_items_select_own_farmer"
    on public.m2_farmarket_order_items for select to authenticated
    using (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
    );

-- 7. Admin SELECT (FAR-08).
drop policy if exists "order_items_admin_select" on public.m2_farmarket_order_items;
create policy "order_items_admin_select"
    on public.m2_farmarket_order_items for select to authenticated
    using (public.is_admin());

-- 8. Farmer UPDATEs status / producer_note on items they own. Allowed
--    transitions are enforced by a BEFORE UPDATE trigger added in 0042.
drop policy if exists "order_items_update_status_farmer" on public.m2_farmarket_order_items;
create policy "order_items_update_status_farmer"
    on public.m2_farmarket_order_items for update to authenticated
    using       (auth.uid() = farmer_id)
    with check  (auth.uid() = farmer_id);

-- 9. Admin UPDATE (rescue lane).
drop policy if exists "order_items_admin_update" on public.m2_farmarket_order_items;
create policy "order_items_admin_update"
    on public.m2_farmarket_order_items for update to authenticated
    using       (public.is_admin())
    with check  (public.is_admin());

-- ── Producer projection view ──────────────────────────────────────────────────

-- BR-F5: the view returns only what a producer is allowed to learn —
-- their own items, a stable opaque resto_handle (sha256 with farmer_id as
-- salt, so different farmers see different handles for the same resto),
-- and the coarse delivery_region. The restaurant_id is never selected.
--
-- security_invoker = true keeps RLS firing on the underlying tables so the
-- view does not become a privilege escalation vector.

drop view if exists public.v_farmer_incoming_items;
create view public.v_farmer_incoming_items
with (security_invoker = true) as
select
    oi.id,
    oi.order_id,
    encode(
        digest(o.restaurant_id::text || ':' || oi.farmer_id::text, 'sha256'),
        'hex'
    )::text                                  as resto_handle,
    oi.ad_id,
    oi.quantity_kg,
    oi.unit_price_mad,
    oi.line_total_mad,
    oi.status,
    oi.producer_note,
    o.delivery_region,
    oi.created_at,
    oi.updated_at
from public.m2_farmarket_order_items oi
join public.m2_farmarket_orders o on o.id = oi.order_id
where oi.farmer_id = auth.uid();

-- Grant SELECT on the view to authenticated callers (RLS still applies on
-- the underlying tables because of security_invoker).
grant select on public.v_farmer_incoming_items to authenticated;
