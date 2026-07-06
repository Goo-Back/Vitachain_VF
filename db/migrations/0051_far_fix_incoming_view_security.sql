-- =============================================================================
-- 0051 — Fix v_farmer_incoming_items: switch from security_invoker to default
--        (security definer) so the JOIN to m2_farmarket_orders is not blocked
--        by RLS.
--
-- Root cause: 0040 created the view with `security_invoker = true`. The view
-- JOINs m2_farmarket_orders, but that table has no SELECT policy for FARMER
-- role (intentional: producers must never see restaurant_id). With
-- security_invoker the JOIN is filtered to zero rows, so every farmer sees an
-- empty incoming queue.
--
-- Fix: recreate the view WITHOUT security_invoker (PostgreSQL default =
-- security definer). The WHERE clause `oi.farmer_id = auth.uid()` still
-- enforces row-level isolation per producer — only the anonymised JOIN column
-- (delivery_region) leaks from m2_farmarket_orders, which is the intended
-- disclosure boundary (BR-F5).
-- =============================================================================

drop view if exists public.v_farmer_incoming_items;

create view public.v_farmer_incoming_items as
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

grant select on public.v_farmer_incoming_items to authenticated;
