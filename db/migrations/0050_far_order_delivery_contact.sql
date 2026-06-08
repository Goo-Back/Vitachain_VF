-- =============================================================================
-- 0050 — M2 FarMarket: delivery-contact fields + RETURNED order status.
-- Story:  FAR-COD (COD checkout + admin order management)
--
-- Two additions driven by the COD back-office work:
--
--   1. Delivery contact columns on m2_farmarket_orders. The logistics
--      intermediary (VitaChain ops) needs the buyer's name / phone / street
--      address / city to actually deliver — the coarse delivery_region alone is
--      not enough for a courier. These columns are populated at checkout.
--
--      ANONYMISATION (BR-F5) IS PRESERVED: v_farmer_incoming_items still
--      projects only delivery_region + resto_handle, never these columns, so a
--      producer can never learn who placed the order. The new fields are only
--      readable by the restaurant (own rows) and admin/ops (service role).
--
--   2. A RETURNED value on the order-status enum so admin/ops can mark an
--      order returned after delivery (failed reception, refused goods, etc.).
--      It is a terminal header state, set only by admin — the per-item state
--      machine (0042) is unchanged. The header-recompute trigger is taught to
--      treat RETURNED as sticky, exactly like CANCELLED.
-- =============================================================================

-- ── 1. Delivery contact columns ───────────────────────────────────────────────
-- Nullable for back-compat with rows created before this migration. New orders
-- inserted via POST /orders always populate name / phone / address / city.

alter table public.m2_farmarket_orders
    add column if not exists delivery_contact_name text
        constraint m2_farmarket_orders_contact_name_length
            check (delivery_contact_name is null
                   or char_length(delivery_contact_name) between 2 and 120),
    add column if not exists delivery_phone text
        constraint m2_farmarket_orders_phone_length
            check (delivery_phone is null
                   or char_length(delivery_phone) between 6 and 30),
    add column if not exists delivery_address text
        constraint m2_farmarket_orders_address_length
            check (delivery_address is null
                   or char_length(delivery_address) between 4 and 300),
    add column if not exists delivery_city text
        constraint m2_farmarket_orders_city_length
            check (delivery_city is null
                   or char_length(delivery_city) between 2 and 120);

-- ── 2. RETURNED order status ──────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE is safe here: the new label is only *referenced* by
-- the trigger function body (not executed during this migration), never used in
-- a DML literal in the same transaction.

alter type public.m2_farmarket_order_status add value if not exists 'RETURNED';

-- ── 3. Teach the header-recompute trigger that RETURNED is terminal ───────────
-- Same body as 0042 but the early-return guard now also covers RETURNED, so an
-- item-level status change can never revive an order admin marked returned.

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

    -- CANCELLED / RETURNED are terminal — once set (by resto cancel or admin
    -- return), no item action revives the order. Compare as text so this
    -- migration never resolves the freshly-added 'RETURNED' enum label inside
    -- the same transaction that ADD VALUE ran in.
    if v_current::text in ('CANCELLED', 'RETURNED') then
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
