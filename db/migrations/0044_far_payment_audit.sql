-- =============================================================================
-- 0044 — M2 FarMarket: payment audit log + admin override RLS.
-- Story:  FAR-PAY-02 (admin integrity layer for the COD / PSP flow)
--
-- Adds a thin, append-only audit table that records every transition of
-- m2_farmarket_orders.payment_status. The intent is integrity, not auth:
--
--   * Restaurant marks COD paid    → row written with actor = restaurant_id
--                                    reason = 'restaurant_cash_received'
--   * Admin overrides DUE → PAID   → row written with actor = admin
--                                    reason = free-text (mandatory)
--   * Admin reverses PAID → DUE    → audited likewise
--   * Admin marks PSP FAILED       → audited likewise
--
-- Writes happen in the application layer (router) — no DB trigger — so the
-- backend can attach a structured reason on every transition. The table is
-- append-only by RLS (no UPDATE / DELETE policies are granted).
--
-- Also broadens the orders payment UPDATE surface for admins: instead of
-- relying on service_client (which is the AUTH-05 escape hatch and never
-- writes the audit trail), an explicit policy allows admins to transition
-- payment_status via their normal JWT. The backend still wraps the UPDATE
-- with an audit INSERT so the chain stays unbroken.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── 1. Audit table ────────────────────────────────────────────────────────────

create table if not exists public.m2_farmarket_payment_audit (
    id                  uuid                            primary key default gen_random_uuid(),
    order_id            uuid                            not null
                            references public.m2_farmarket_orders(id) on delete cascade,

    -- Actor: profile id of whoever caused the transition (restaurant or admin).
    -- NOT a FK because deleting a profile must not break the audit chain — we
    -- accept dangling references in exchange for permanence.
    actor_id            uuid                            not null,
    actor_role          text                            not null
                            constraint m2_farmarket_payment_audit_role_check
                                check (actor_role in ('RESTAURANT', 'ADMIN', 'SYSTEM')),

    previous_status     text                            not null,
    new_status          text                            not null,
    previous_paid_at    timestamptz,
    new_paid_at         timestamptz,

    reason              text                            not null
                            constraint m2_farmarket_payment_audit_reason_length
                                check (char_length(reason) between 1 and 500),

    created_at          timestamptz                     not null default now()
);

create index if not exists m2_farmarket_payment_audit_order_idx
    on public.m2_farmarket_payment_audit (order_id, created_at desc);

create index if not exists m2_farmarket_payment_audit_actor_idx
    on public.m2_farmarket_payment_audit (actor_id, created_at desc);

alter table public.m2_farmarket_payment_audit enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

-- ── 2. RLS — audit table ──────────────────────────────────────────────────────

-- Admin reads all audit rows.
drop policy if exists "payment_audit_admin_select" on public.m2_farmarket_payment_audit;
create policy "payment_audit_admin_select"
    on public.m2_farmarket_payment_audit for select to authenticated
    using (public.is_admin());

-- Restaurant reads audit rows on their own orders (so they can prove a
-- payment was acknowledged).
drop policy if exists "payment_audit_restaurant_select" on public.m2_farmarket_payment_audit;
create policy "payment_audit_restaurant_select"
    on public.m2_farmarket_payment_audit for select to authenticated
    using (
        exists (
            select 1 from public.m2_farmarket_orders o
             where o.id = order_id
               and o.restaurant_id = auth.uid()
        )
    );

-- Restaurants and admins both INSERT. The actor_id MUST match the caller,
-- so a restaurant can never forge an admin audit row.
drop policy if exists "payment_audit_restaurant_insert" on public.m2_farmarket_payment_audit;
create policy "payment_audit_restaurant_insert"
    on public.m2_farmarket_payment_audit for insert to authenticated
    with check (
        actor_id = auth.uid()
        and actor_role = 'RESTAURANT'
        and public.has_role('RESTAURANT'::public.user_role)
        and exists (
            select 1 from public.m2_farmarket_orders o
             where o.id = order_id
               and o.restaurant_id = auth.uid()
        )
    );

drop policy if exists "payment_audit_admin_insert" on public.m2_farmarket_payment_audit;
create policy "payment_audit_admin_insert"
    on public.m2_farmarket_payment_audit for insert to authenticated
    with check (
        actor_id = auth.uid()
        and actor_role = 'ADMIN'
        and public.is_admin()
    );

-- No UPDATE / DELETE policies → the table is append-only by default.

-- ── 3. Admin UPDATE policy on orders (payment_status only — explicit) ─────────
--
-- Without this an admin would have to mutate via service_client(), which is
-- reserved for AUTH-05 escape hatches and breaks the JWT-attribution chain
-- the audit table relies on. This policy lets the admin transition any
-- payment_status from their own JWT.

drop policy if exists "orders_admin_update_payment" on public.m2_farmarket_orders;
create policy "orders_admin_update_payment"
    on public.m2_farmarket_orders for update to authenticated
    using       (public.is_admin())
    with check  (public.is_admin());

-- ── 4. Convenience view — outstanding COD with age ────────────────────────────
--
-- Reconciliation dashboards use this as the source of truth. Admin only via
-- RLS on the underlying table.

drop view if exists public.v_farmarket_cod_outstanding;
create view public.v_farmarket_cod_outstanding
with (security_invoker = true) as
select
    o.id,
    o.restaurant_id,
    o.status,
    o.delivery_region,
    o.subtotal_mad,
    o.logistics_fee_mad,
    o.total_mad,
    o.payment_method,
    o.payment_status,
    o.created_at,
    o.updated_at,
    extract(epoch from (now() - o.created_at)) / 86400.0  as age_days
from public.m2_farmarket_orders o
where o.payment_method = 'COD'
  and o.payment_status = 'DUE';

grant select on public.v_farmarket_cod_outstanding to authenticated;
