-- =============================================================================
-- 0042 — M2 FarMarket: order tracking state machine + cancel policy.
-- Story:  FAR-10 (docs/stories/FAR-10-order-tracking.md)
--
-- This migration adds:
--   1. m2_farmarket_validate_item_transition() — BEFORE UPDATE trigger on
--      m2_farmarket_order_items.status that enforces the per-item state
--      machine (PENDING → ACCEPTED|REJECTED → PICKED_UP → IN_TRANSIT →
--      DELIVERED). Invalid transitions raise P0001.
--   2. m2_farmarket_recompute_order_status() — AFTER trigger on the same
--      table that derives the header status from the item statuses.
--      CANCELLED is sticky: once a resto cancels, the trigger no-ops.
--   3. orders_update_cancel_own_restaurant — a deliberately narrow UPDATE
--      policy that allows a RESTAURANT to flip ONLY PENDING → CANCELLED on
--      their own orders. Anything else is rejected at the RLS layer.
-- =============================================================================

-- ── 1. Transition guard (per-item) ────────────────────────────────────────────

create or replace function public.m2_farmarket_validate_item_transition()
returns trigger
language plpgsql
as $$
begin
    if old.status = new.status then
        return new;
    end if;

    if old.status = 'PENDING'    and new.status in ('ACCEPTED', 'REJECTED')          then return new; end if;
    if old.status = 'ACCEPTED'   and new.status = 'PICKED_UP'                        then return new; end if;
    if old.status = 'PICKED_UP'  and new.status = 'IN_TRANSIT'                       then return new; end if;
    if old.status = 'IN_TRANSIT' and new.status = 'DELIVERED'                        then return new; end if;

    raise exception 'invalid_transition: % -> %', old.status, new.status
        using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_far10_item_transition on public.m2_farmarket_order_items;
create trigger trg_far10_item_transition
    before update of status on public.m2_farmarket_order_items
    for each row execute function public.m2_farmarket_validate_item_transition();

-- ── 2. Header status derivation ───────────────────────────────────────────────

create or replace function public.m2_farmarket_recompute_order_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order_id      uuid := coalesce(new.order_id, old.order_id);
    v_pending       int;
    v_accepted      int;
    v_rejected      int;
    v_picked        int;
    v_transit       int;
    v_delivered     int;
    v_total         int;
    v_current       public.m2_farmarket_order_status;
    v_next          public.m2_farmarket_order_status;
begin
    select status into v_current
      from public.m2_farmarket_orders
     where id = v_order_id
       for update;

    -- CANCELLED is terminal — once a resto cancels, no item action revives
    -- the order. The audit row in m2_farmarket_order_items is preserved as-is.
    if v_current = 'CANCELLED' then
        return new;
    end if;

    select
        count(*) filter (where status = 'PENDING'),
        count(*) filter (where status = 'ACCEPTED'),
        count(*) filter (where status = 'REJECTED'),
        count(*) filter (where status = 'PICKED_UP'),
        count(*) filter (where status = 'IN_TRANSIT'),
        count(*) filter (where status = 'DELIVERED'),
        count(*)
    into v_pending, v_accepted, v_rejected, v_picked, v_transit, v_delivered, v_total
    from public.m2_farmarket_order_items
    where order_id = v_order_id;

    v_next := case
        when v_total = 0                                                                 then v_current
        when v_pending > 0 and v_rejected = 0
             and v_picked = 0 and v_transit = 0 and v_delivered = 0                      then 'PENDING'
        when v_pending = 0 and v_total = v_rejected                                      then 'REJECTED'
        when v_pending = 0 and v_rejected > 0 and v_accepted > 0
             and v_picked = 0 and v_transit = 0 and v_delivered = 0                      then 'PARTIALLY_ACCEPTED'
        when v_pending = 0 and v_rejected = 0
             and v_picked = 0 and v_transit = 0 and v_delivered = 0                      then 'ACCEPTED'
        when v_picked > 0 or v_transit > 0                                               then 'IN_PROGRESS'
        when v_total > 0 and (v_total - v_rejected) = v_delivered                        then 'DELIVERED'
        else v_current
    end;

    if v_next is distinct from v_current then
        update public.m2_farmarket_orders
           set status = v_next
         where id = v_order_id;
    end if;

    return new;
end;
$$;

revoke execute on function public.m2_farmarket_recompute_order_status() from public;

drop trigger if exists trg_far10_recompute_header_ins on public.m2_farmarket_order_items;
create trigger trg_far10_recompute_header_ins
    after insert on public.m2_farmarket_order_items
    for each row execute function public.m2_farmarket_recompute_order_status();

drop trigger if exists trg_far10_recompute_header_upd on public.m2_farmarket_order_items;
create trigger trg_far10_recompute_header_upd
    after update of status on public.m2_farmarket_order_items
    for each row execute function public.m2_farmarket_recompute_order_status();

-- ── 3. Restaurant cancel-while-PENDING UPDATE policy ──────────────────────────

drop policy if exists "orders_update_cancel_own_restaurant" on public.m2_farmarket_orders;
create policy "orders_update_cancel_own_restaurant"
    on public.m2_farmarket_orders for update to authenticated
    using       (restaurant_id = auth.uid() and status = 'PENDING')
    with check  (restaurant_id = auth.uid() and status = 'CANCELLED');
