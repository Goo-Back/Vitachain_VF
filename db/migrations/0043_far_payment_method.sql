-- =============================================================================
-- 0043 — M2 FarMarket: payment method + COD payment confirmation.
-- Story:  FAR-PAY-01 (no formal story yet — driven by product feedback)
--
-- Adds the missing payment fields so the COD ("Paiement à la livraison") flow
-- becomes truly functional instead of UI-only:
--
--   payment_method   text NOT NULL — 'COD' | 'PSP_TRANSFER'
--   paid_at          timestamptz NULL — set when payment is reconciled
--
-- The payment_status check is extended to include 'DUE' and 'PAID' alongside
-- the legacy values ('SIMULATED_PAID', 'PENDING', 'FAILED') so historical rows
-- created before this migration keep displaying correctly. New orders inserted
-- via POST /orders always start at 'DUE'.
--
-- A narrow restaurant UPDATE policy mirrors the FAR-10 cancel policy: the
-- restaurant can transition payment_status DUE → PAID on their own COD orders
-- and nothing else. Producers and admins are untouched.
-- =============================================================================

-- ── 1. Add columns ────────────────────────────────────────────────────────────

alter table public.m2_farmarket_orders
    add column if not exists payment_method  text         not null default 'COD',
    add column if not exists paid_at         timestamptz;

-- Backfill: historical rows pre-dating this migration were inserted with the
-- "SIMULATED_PAID" placeholder via the mock PSP — keep that semantic by
-- treating them as PSP_TRANSFER orders.
update public.m2_farmarket_orders
   set payment_method = 'PSP_TRANSFER'
 where payment_status = 'SIMULATED_PAID'
   and payment_method = 'COD';  -- column just defaulted, override.

-- Enforce the enum.
alter table public.m2_farmarket_orders
    drop constraint if exists m2_farmarket_orders_payment_method_check;
alter table public.m2_farmarket_orders
    add  constraint m2_farmarket_orders_payment_method_check
         check (payment_method in ('COD', 'PSP_TRANSFER'));

-- ── 2. Extend payment_status check ────────────────────────────────────────────

alter table public.m2_farmarket_orders
    drop constraint if exists m2_farmarket_orders_payment_status_check;
alter table public.m2_farmarket_orders
    add  constraint m2_farmarket_orders_payment_status_check
         check (payment_status in (
             'DUE',              -- new: order placed, payment not yet received
             'PAID',              -- new: payment reconciled (cash collected or PSP success)
             'FAILED',
             'SIMULATED_PAID',    -- legacy: pre-0043 PSP mock
             'PENDING'            -- legacy: pre-0043 default
         ));

-- New orders going forward should be inserted at 'DUE' explicitly by the
-- backend. The default stays 'SIMULATED_PAID' for one release to avoid
-- breaking any in-flight migration; the backend overrides it.
alter table public.m2_farmarket_orders
    alter column payment_status set default 'DUE';

-- ── 3. RLS — restaurant marks COD as PAID at reception ────────────────────────
--
-- Narrow policy following the same shape as orders_update_cancel_own_restaurant
-- (migration 0042). The backend confirm_payment endpoint is the only caller
-- that issues the UPDATE; the policy is the second line of defence.

drop policy if exists "orders_update_confirm_payment_own_restaurant"
    on public.m2_farmarket_orders;
create policy "orders_update_confirm_payment_own_restaurant"
    on public.m2_farmarket_orders for update to authenticated
    using       (restaurant_id = auth.uid()
                 and payment_status = 'DUE'
                 and payment_method = 'COD')
    with check  (restaurant_id = auth.uid()
                 and payment_status = 'PAID');

-- Admin already has a global UPDATE policy on the table (orders_admin_update
-- exists for items only — orders header relies on service-role for now). Keep
-- that surface intentional: admins reconcile via the back-office.

-- ── 4. Index ─────────────────────────────────────────────────────────────────
-- Ops dashboard "outstanding COD" query: list all DUE orders by region/age.

create index if not exists m2_farmarket_orders_outstanding_cod_idx
    on public.m2_farmarket_orders (delivery_region, created_at desc)
    where payment_method = 'COD' and payment_status = 'DUE';
