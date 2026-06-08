-- =============================================================================
-- 0047 — M2 FarMarket: live stock reservation on ads.
-- Story:  FAR — "the quantity on an ad must go down when a restaurant buys".
--
-- Problem this fixes
-- ------------------
-- Until now place_order validated `m2_farmarket_ads.quantity_kg` against the
-- requested amount but NEVER decremented it. An ad advertising 100 kg kept
-- showing 100 kg no matter how many restaurants ordered from it. The catalog
-- card was therefore cosmetic, not a real stock figure.
--
-- Why a trigger (and not the API)
-- -------------------------------
-- An order is inserted through the RESTAURANT's user-scoped client. The ad row
-- belongs to a different user (the FARMER), and RLS policy
-- `farmarket_ads_update_own` only lets the farmer update their own ads. So the
-- restaurant's client structurally cannot decrement the ad. The adjustment is
-- therefore done by a SECURITY DEFINER trigger — exactly the pattern already
-- used by m2_farmarket_recompute_order_status() in migration 0042.
--
-- Reservation accounting (held = stock currently committed to a live item)
-- ------------------------------------------------------------------------
--   * INSERT order_item               → reserve  (quantity_kg -= item.qty)
--   * item  -> REJECTED               → release  (quantity_kg += item.qty)
--   * order -> CANCELLED              → release every still-held item
--
-- ACCEPTED / PICKED_UP / IN_TRANSIT / DELIVERED keep the stock decremented:
-- those goods really left the farm. Only a rejection or a cancellation returns
-- them to the shelf.
--
-- Idempotency: a per-item `stock_released` flag guarantees a reservation is
-- released at most once, so the reject path and the cancel path can never
-- double-credit the same item (e.g. a farmer rejecting an item on an order the
-- restaurant already cancelled).
-- =============================================================================

-- ── 1. Allow an ad to reach exactly 0 kg (fully sold) ───────────────────────────
-- The original CHECK required quantity_kg > 0, which would reject the UPDATE
-- that brings the last kilogram down to 0. Relax it to >= 0. Ad CREATION still
-- requires a positive quantity (enforced by the AdCreate / AdUpdate Pydantic
-- validators), so this only ever permits the sold-out state, never a 0-kg
-- listing created by hand.
alter table public.m2_farmarket_ads
    drop constraint if exists m2_farmarket_ads_quantity_positive;
alter table public.m2_farmarket_ads
    drop constraint if exists m2_farmarket_ads_quantity_non_negative;
alter table public.m2_farmarket_ads
    add constraint m2_farmarket_ads_quantity_non_negative
        check (quantity_kg >= 0);

-- ── 2. Per-item reservation flag ────────────────────────────────────────────────
alter table public.m2_farmarket_order_items
    add column if not exists stock_released boolean not null default false;

-- ── 3. Reserve on item insert ───────────────────────────────────────────────────
create or replace function public.m2_farmarket_reserve_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_available numeric(10, 2);
begin
    -- Lock the ad row so concurrent orders on the same ad serialise and can
    -- never both pass the availability check (oversell guard).
    select quantity_kg into v_available
      from public.m2_farmarket_ads
     where id = new.ad_id
       for update;

    if v_available is null then
        raise exception 'ad_not_found: %', new.ad_id using errcode = 'P0001';
    end if;

    if v_available < new.quantity_kg then
        raise exception
            'insufficient_stock: ad % has % kg, requested % kg',
            new.ad_id, v_available, new.quantity_kg
            using errcode = 'P0001';
    end if;

    update public.m2_farmarket_ads
       set quantity_kg = quantity_kg - new.quantity_kg
     where id = new.ad_id;

    return new;
end;
$$;

revoke execute on function public.m2_farmarket_reserve_stock() from public;

drop trigger if exists trg_far_reserve_stock on public.m2_farmarket_order_items;
create trigger trg_far_reserve_stock
    after insert on public.m2_farmarket_order_items
    for each row execute function public.m2_farmarket_reserve_stock();

-- ── 4. Release on item rejection ─────────────────────────────────────────────────
create or replace function public.m2_farmarket_release_stock_on_reject()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.status = 'REJECTED'
       and old.status is distinct from 'REJECTED'
       and old.stock_released = false
    then
        update public.m2_farmarket_ads
           set quantity_kg = quantity_kg + new.quantity_kg
         where id = new.ad_id;

        new.stock_released := true;
    end if;

    return new;
end;
$$;

revoke execute on function public.m2_farmarket_release_stock_on_reject() from public;

-- BEFORE UPDATE so we can set new.stock_released in the same write. This runs
-- alongside the existing trg_far10_item_transition guard (also BEFORE UPDATE OF
-- status); both fire, order is irrelevant since they touch disjoint state.
drop trigger if exists trg_far_release_stock_reject on public.m2_farmarket_order_items;
create trigger trg_far_release_stock_reject
    before update of status on public.m2_farmarket_order_items
    for each row execute function public.m2_farmarket_release_stock_on_reject();

-- ── 5. Release on order cancellation ─────────────────────────────────────────────
create or replace function public.m2_farmarket_release_stock_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED' then
        -- Return every reservation that is still held (not already released by
        -- an earlier rejection). Mark them released so a later reject can't
        -- credit the same kilograms twice.
        update public.m2_farmarket_ads a
           set quantity_kg = a.quantity_kg + oi.quantity_kg
          from public.m2_farmarket_order_items oi
         where oi.order_id = new.id
           and oi.stock_released = false
           and a.id = oi.ad_id;

        update public.m2_farmarket_order_items
           set stock_released = true
         where order_id = new.id
           and stock_released = false;
    end if;

    return new;
end;
$$;

revoke execute on function public.m2_farmarket_release_stock_on_cancel() from public;

drop trigger if exists trg_far_release_stock_cancel on public.m2_farmarket_orders;
create trigger trg_far_release_stock_cancel
    after update of status on public.m2_farmarket_orders
    for each row execute function public.m2_farmarket_release_stock_on_cancel();
