-- =============================================================================
-- 0041 — M2 FarMarket: order-placed NOTIFY trigger + notified_at column.
-- Story:  FAR-04 (docs/stories/FAR-04-anonymized-order-notification.md)
--
-- Adds notified_at to m2_farmarket_orders so the farmarket_order_notify worker
-- can use it as an idempotency anchor (worker only sends when NULL).
--
-- The AFTER INSERT trigger fires NOTIFY farmarket_order_placed with the new
-- order UUID as payload. The worker's listener picks it up and dispatches
-- one Brevo email per distinct producer on the order — each producer sees
-- only the items they own and an opaque resto_handle (never the resto's
-- identity).
--
-- BR-F5: this trigger MUST NOT expose restaurant_id in the payload. Only
-- the order_id (which the worker uses for an authenticated lookup against
-- the v_farmer_incoming_items view per producer) is forwarded.
--
-- SECURITY DEFINER on the trigger function is required so pg_notify() runs
-- even when the caller is the authenticated role. search_path is locked.
-- =============================================================================

-- 1. notified_at column.

alter table public.m2_farmarket_orders
    add column if not exists notified_at timestamptz;

create index if not exists m2_farmarket_orders_notify_pending_idx
    on public.m2_farmarket_orders (created_at desc)
    where notified_at is null;

-- 2. Notify function.

create or replace function public.m2_farmarket_notify_order_placed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform pg_notify('farmarket_order_placed', new.id::text);
    return new;
end;
$$;

revoke execute on function public.m2_farmarket_notify_order_placed() from public;

-- 3. Trigger.

drop trigger if exists trg_far04_notify_order_placed on public.m2_farmarket_orders;
create trigger trg_far04_notify_order_placed
    after insert on public.m2_farmarket_orders
    for each row
    execute function public.m2_farmarket_notify_order_placed();
