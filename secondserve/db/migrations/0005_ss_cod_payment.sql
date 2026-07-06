-- =============================================================================
-- 0005 — SecondServe COD payment confirmation + audit trail
--
-- Adds:
--   1. paid_at column on ss_orders — stamped when COD cash is confirmed.
--   2. ss_payment_audit table — append-only trail of payment_status transitions.
--   3. ss_confirm_cod_payment() RPC — consumer calls this after cash handoff;
--      validates ownership + preconditions, transitions pending → successful,
--      writes audit row.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── 1. paid_at on orders ──────────────────────────────────────────────────────

alter table public.ss_orders
    add column if not exists paid_at timestamptz;

-- ── 2. Payment audit table ────────────────────────────────────────────────────

create table if not exists public.ss_payment_audit (
    id               uuid        primary key default gen_random_uuid(),
    order_id         uuid        not null references public.ss_orders(id) on delete cascade,
    actor_id         uuid        not null,
    actor_role       text        not null
                         constraint ss_payment_audit_actor_role_chk
                             check (actor_role in ('consumer', 'admin')),
    previous_status  text        not null,
    new_status       text        not null,
    previous_paid_at timestamptz,
    new_paid_at      timestamptz,
    reason           text        not null default '',
    created_at       timestamptz not null default now()
);

create index if not exists ss_payment_audit_order_id_idx
    on public.ss_payment_audit (order_id);

alter table public.ss_payment_audit enable row level security;
alter table public.ss_payment_audit replica identity full;

-- Consumer/restaurant sees audit rows for their own orders; admin sees all.
drop policy if exists ss_payment_audit_select on public.ss_payment_audit;
create policy ss_payment_audit_select on public.ss_payment_audit for select
    using (
        public.ss_is_admin()
        or exists (
            select 1 from public.ss_orders o
            where o.id = order_id
              and (o.consumer_id = auth.uid() or o.restaurant_id = auth.uid())
        )
    );

-- Direct INSERTs blocked for all — only the SECURITY DEFINER RPCs may write.
drop policy if exists ss_payment_audit_insert on public.ss_payment_audit;
create policy ss_payment_audit_insert on public.ss_payment_audit for insert
    with check (false);

-- No UPDATE or DELETE policies → deny by default (append-only).

do $$
begin
    alter publication supabase_realtime add table public.ss_payment_audit;
exception when duplicate_object then null;
end $$;

-- ── 3. RPC: consumer confirms COD payment ─────────────────────────────────────
-- Called by the citizen after handing cash to the partner. Validates:
--   • caller is the order's consumer
--   • payment_method = 'delivery'
--   • payment_status = 'pending'
-- Then atomically: flips to 'successful', stamps paid_at, writes audit row.

create or replace function public.ss_confirm_cod_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid   uuid := auth.uid();
    v_order public.ss_orders%rowtype;
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;

    select * into v_order from public.ss_orders where id = p_order_id for update;
    if not found then
        raise exception 'order_not_found' using errcode = 'P0002';
    end if;
    if v_order.consumer_id <> v_uid then
        raise exception 'not_your_order' using errcode = '42501';
    end if;
    if v_order.payment_method <> 'delivery' then
        raise exception 'not_a_cod_order' using errcode = '22023';
    end if;
    if v_order.payment_status <> 'pending' then
        raise exception 'payment_already_settled' using errcode = '22023';
    end if;

    update public.ss_orders
        set payment_status = 'successful',
            paid_at        = now()
        where id = p_order_id;

    insert into public.ss_payment_audit (
        order_id, actor_id, actor_role,
        previous_status, new_status,
        previous_paid_at, new_paid_at,
        reason
    ) values (
        p_order_id, v_uid, 'consumer',
        'pending', 'successful',
        null, now(),
        'consumer_confirmed_cod'
    );
end;
$$;

revoke all on function public.ss_confirm_cod_payment(uuid) from public, anon;
grant execute on function public.ss_confirm_cod_payment(uuid) to authenticated;

alter event trigger trg_enforce_rls_on_public_tables enable;
