-- =============================================================================
-- 0001 — SecondServe schema (Firebase → Supabase migration).
--
-- SecondServe is a food-rescue marketplace (consumer / restaurant / admin),
-- migrated 1:1 from Firestore. It shares the VitaChain Supabase project, so
-- every object is namespaced `ss_` to avoid colliding with VitaChain tables.
--
-- Source of truth for the original model:
--   secondserve/src/types.ts            (entities)
--   secondserve/firestore.rules         (access control → RLS below)
--   secondserve/firestore.indexes.json  (composite index → ss_profiles index)
--
-- Shared-project caveats handled here:
--   1. Event trigger `trg_enforce_rls_on_public_tables` (VitaChain mig 0009)
--      refuses CREATE TABLE in public without RLS. We disable it, create +
--      enable RLS, then re-arm — same scaffolding as VitaChain mig 0032.
--   2. VitaChain's `on_auth_user_created` trigger still fires on every signup
--      and writes a (harmless, CITIZEN) row into public.profiles. We do NOT
--      touch it; instead we add an additive trigger that mirrors SecondServe
--      signups into ss_profiles when raw_user_meta_data->>'ss_app'='secondserve'.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── Tables ────────────────────────────────────────────────────────────────────

-- users → ss_profiles (1:1 mirror of auth.users for the SecondServe app).
create table if not exists public.ss_profiles (
    id            uuid        primary key references auth.users(id) on delete cascade,
    role          text        not null
                      constraint ss_profiles_role_chk
                          check (role in ('consumer','restaurant','admin')),
    email         text        not null,
    name          text        not null,
    city          text        not null default ''
                      constraint ss_profiles_city_chk
                          check (city in ('Casablanca','Mohammedia','')),
    approved      boolean     not null default false,
    banned        boolean     not null default false,
    -- restaurant-only fields
    commerce_type text
                      constraint ss_profiles_commerce_type_chk
                          check (commerce_type is null
                                 or commerce_type in ('Patisserie','Superette','Buffet à volonté')),
    address       text,
    phone         text,
    lat           double precision,
    lng           double precision,
    map_link      text,
    created_at    timestamptz not null default now()
);

-- firestore.indexes.json — composite index used by the public restaurant list.
create index if not exists ss_profiles_role_approved_banned_idx
    on public.ss_profiles (role, approved, banned);

create table if not exists public.ss_offers (
    id             uuid        primary key default gen_random_uuid(),
    restaurant_id  uuid        not null references public.ss_profiles(id) on delete cascade,
    restaurant_name text       not null default '',
    name           text        not null,
    description    text        not null default '',
    original_price numeric(10,2) not null default 0,
    reduced_price  numeric(10,2) not null default 0,
    quantity       integer     not null default 0
                       constraint ss_offers_quantity_nonneg check (quantity >= 0),
    image          text        not null default '',
    time_limit     text        not null default '',
    city           text        not null default '',
    commerce_type  text        not null default '',
    meal_category  text,
    rating         numeric(3,2),
    is_surprise_box boolean    not null default false,
    address        text,
    lat            double precision,
    lng            double precision,
    map_link       text,
    created_at     timestamptz not null default now()
);
create index if not exists ss_offers_restaurant_id_idx on public.ss_offers (restaurant_id);
create index if not exists ss_offers_city_idx          on public.ss_offers (city);

create table if not exists public.ss_orders (
    id             uuid        primary key default gen_random_uuid(),
    offer_id       uuid        not null,
    consumer_id    uuid        not null references public.ss_profiles(id) on delete cascade,
    consumer_name  text,
    consumer_phone text,
    restaurant_id  uuid        not null,
    quantity       integer     not null check (quantity > 0),
    total_price    numeric(10,2) not null,
    status         text        not null default 'active'
                       constraint ss_orders_status_chk
                           check (status in ('active','cancelled','completed')),
    created_at     timestamptz not null default now(),
    offer_snapshot jsonb       not null,
    payment_method text        not null default 'delivery'
                       constraint ss_orders_payment_method_chk
                           check (payment_method in ('online','delivery')),
    payment_status text        not null default 'pending'
                       constraint ss_orders_payment_status_chk
                           check (payment_status in ('pending','successful','failed','released')),
    customer_message text      not null default '',
    pickup_code    text,
    expires_at     timestamptz
);
create index if not exists ss_orders_consumer_id_idx   on public.ss_orders (consumer_id);
create index if not exists ss_orders_restaurant_id_idx on public.ss_orders (restaurant_id);

create table if not exists public.ss_reviews (
    id            uuid        primary key default gen_random_uuid(),
    offer_id      uuid        not null,
    consumer_id   uuid        not null references public.ss_profiles(id) on delete cascade,
    consumer_name text        not null default '',
    restaurant_id uuid        not null,
    rating        integer     not null check (rating between 1 and 5),
    comment       text        not null default '',
    created_at    timestamptz not null default now()
);
create index if not exists ss_reviews_offer_id_idx on public.ss_reviews (offer_id);

create table if not exists public.ss_notifications (
    id             uuid        primary key default gen_random_uuid(),
    order_id       uuid        not null,
    customer_name  text        not null default '',
    offer_name     text        not null default '',
    total_price    numeric(10,2) not null default 0,
    payment_method text        not null default 'delivery',
    created_at     timestamptz not null default now(),
    read           boolean     not null default false,
    recipient_id   uuid        not null references public.ss_profiles(id) on delete cascade
);
create index if not exists ss_notifications_recipient_id_idx on public.ss_notifications (recipient_id);

create table if not exists public.ss_support_tickets (
    id         uuid        primary key default gen_random_uuid(),
    user_id    uuid        not null references public.ss_profiles(id) on delete cascade,
    user_email text        not null default '',
    user_name  text        not null default '',
    user_role  text        not null default '',
    subject    text        not null,
    message    text        not null,
    status     text        not null default 'pending'
                   constraint ss_support_tickets_status_chk
                       check (status in ('pending','resolved')),
    response   text,
    created_at timestamptz not null default now()
);
create index if not exists ss_support_tickets_user_id_idx on public.ss_support_tickets (user_id);

-- ── Role helpers (SECURITY DEFINER to avoid RLS recursion) ────────────────────
-- A policy on ss_profiles that itself SELECTs ss_profiles would recurse
-- (VitaChain hit the same wall in mig 0005). These run as owner, bypassing RLS.

create or replace function public.ss_role(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select role from public.ss_profiles where id = uid;
$$;

create or replace function public.ss_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.ss_role(auth.uid()) = 'admin';
$$;

create or replace function public.ss_is_partner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.ss_role(auth.uid()) = 'restaurant';
$$;

revoke all on function public.ss_role(uuid)   from public, anon;
revoke all on function public.ss_is_admin()   from public;
revoke all on function public.ss_is_partner() from public;
grant execute on function public.ss_is_admin(), public.ss_is_partner() to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Each policy below mirrors the matching rule in firestore.rules.

alter table public.ss_profiles        enable row level security;
alter table public.ss_offers          enable row level security;
alter table public.ss_orders          enable row level security;
alter table public.ss_reviews         enable row level security;
alter table public.ss_notifications   enable row level security;
alter table public.ss_support_tickets enable row level security;

-- users: read own | admin reads all | anyone reads approved, non-banned restaurants
drop policy if exists ss_profiles_select on public.ss_profiles;
create policy ss_profiles_select on public.ss_profiles for select
    using (
        auth.uid() = id
        or public.ss_is_admin()
        or (role = 'restaurant' and approved = true and banned = false)
    );

-- Self-signup. Normally performed by the security-definer trigger below, but a
-- client-side insert is allowed as a fallback and held to the same invariants.
drop policy if exists ss_profiles_insert on public.ss_profiles;
create policy ss_profiles_insert on public.ss_profiles for insert
    with check (
        auth.uid() = id
        and role in ('consumer','restaurant')
        and banned = false
        and (
            (role = 'consumer'   and approved = true)
            or (role = 'restaurant' and approved = false)
        )
    );

-- Admin updates anything; owner updates own row. The "owner cannot change
-- role/approved/banned" guarantee is enforced by ss_guard_profile_update().
drop policy if exists ss_profiles_update on public.ss_profiles;
create policy ss_profiles_update on public.ss_profiles for update
    using (public.ss_is_admin() or auth.uid() = id)
    with check (public.ss_is_admin() or auth.uid() = id);

drop policy if exists ss_profiles_delete on public.ss_profiles;
create policy ss_profiles_delete on public.ss_profiles for delete
    using (public.ss_is_admin());

-- offers: world-readable; writes by owning partner or admin
drop policy if exists ss_offers_select on public.ss_offers;
create policy ss_offers_select on public.ss_offers for select using (true);

drop policy if exists ss_offers_insert on public.ss_offers;
create policy ss_offers_insert on public.ss_offers for insert
    with check (public.ss_is_partner() and restaurant_id = auth.uid());

drop policy if exists ss_offers_update on public.ss_offers;
create policy ss_offers_update on public.ss_offers for update
    using (restaurant_id = auth.uid() or public.ss_is_admin())
    with check (restaurant_id = auth.uid() or public.ss_is_admin());

drop policy if exists ss_offers_delete on public.ss_offers;
create policy ss_offers_delete on public.ss_offers for delete
    using (restaurant_id = auth.uid() or public.ss_is_admin());

-- orders: visible to its consumer, its restaurant, or admin
drop policy if exists ss_orders_select on public.ss_orders;
create policy ss_orders_select on public.ss_orders for select
    using (
        consumer_id = auth.uid()
        or restaurant_id = auth.uid()
        or public.ss_is_admin()
    );

drop policy if exists ss_orders_insert on public.ss_orders;
create policy ss_orders_insert on public.ss_orders for insert
    with check (consumer_id = auth.uid());

drop policy if exists ss_orders_update on public.ss_orders;
create policy ss_orders_update on public.ss_orders for update
    using (
        consumer_id = auth.uid()
        or restaurant_id = auth.uid()
        or public.ss_is_admin()
    )
    with check (
        consumer_id = auth.uid()
        or restaurant_id = auth.uid()
        or public.ss_is_admin()
    );

drop policy if exists ss_orders_delete on public.ss_orders;
create policy ss_orders_delete on public.ss_orders for delete
    using (public.ss_is_admin());

-- reviews: world-readable; author writes; author or admin updates; admin deletes
drop policy if exists ss_reviews_select on public.ss_reviews;
create policy ss_reviews_select on public.ss_reviews for select using (true);

drop policy if exists ss_reviews_insert on public.ss_reviews;
create policy ss_reviews_insert on public.ss_reviews for insert
    with check (consumer_id = auth.uid());

drop policy if exists ss_reviews_update on public.ss_reviews;
create policy ss_reviews_update on public.ss_reviews for update
    using (consumer_id = auth.uid() or public.ss_is_admin())
    with check (consumer_id = auth.uid() or public.ss_is_admin());

drop policy if exists ss_reviews_delete on public.ss_reviews;
create policy ss_reviews_delete on public.ss_reviews for delete
    using (public.ss_is_admin());

-- notifications: recipient (or admin) reads/updates/deletes; any signed-in creates
drop policy if exists ss_notifications_select on public.ss_notifications;
create policy ss_notifications_select on public.ss_notifications for select
    using (recipient_id = auth.uid() or public.ss_is_admin());

drop policy if exists ss_notifications_insert on public.ss_notifications;
create policy ss_notifications_insert on public.ss_notifications for insert
    to authenticated with check (true);

drop policy if exists ss_notifications_update on public.ss_notifications;
create policy ss_notifications_update on public.ss_notifications for update
    using (recipient_id = auth.uid() or public.ss_is_admin())
    with check (recipient_id = auth.uid() or public.ss_is_admin());

drop policy if exists ss_notifications_delete on public.ss_notifications;
create policy ss_notifications_delete on public.ss_notifications for delete
    using (recipient_id = auth.uid() or public.ss_is_admin());

-- support tickets: owner (or admin) reads; any signed-in creates; admin updates/deletes
drop policy if exists ss_support_tickets_select on public.ss_support_tickets;
create policy ss_support_tickets_select on public.ss_support_tickets for select
    using (user_id = auth.uid() or public.ss_is_admin());

drop policy if exists ss_support_tickets_insert on public.ss_support_tickets;
create policy ss_support_tickets_insert on public.ss_support_tickets for insert
    with check (user_id = auth.uid());

drop policy if exists ss_support_tickets_update on public.ss_support_tickets;
create policy ss_support_tickets_update on public.ss_support_tickets for update
    using (public.ss_is_admin()) with check (public.ss_is_admin());

drop policy if exists ss_support_tickets_delete on public.ss_support_tickets;
create policy ss_support_tickets_delete on public.ss_support_tickets for delete
    using (public.ss_is_admin());

-- ── Guard: non-admins cannot self-elevate role/approved/banned ────────────────
create or replace function public.ss_guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.ss_is_admin() then
        return new;   -- admin may change anything
    end if;
    if new.role <> old.role
       or new.approved is distinct from old.approved
       or new.banned   is distinct from old.banned then
        raise exception 'role/approved/banned are admin-controlled'
            using errcode = '42501';   -- insufficient_privilege
    end if;
    return new;
end;
$$;

drop trigger if exists trg_ss_guard_profile_update on public.ss_profiles;
create trigger trg_ss_guard_profile_update
    before update on public.ss_profiles
    for each row execute function public.ss_guard_profile_update();

-- ── Signup mirror: auth.users → ss_profiles (additive; VitaChain trigger kept) ─
-- Fires only for SecondServe signups, identified by ss_app metadata. Restaurant
-- accounts start unapproved; consumers are auto-approved (mirrors firestore.rules).
create or replace function public.handle_new_ss_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    md       jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    ss_role  text  := md->>'ss_role';
begin
    if md->>'ss_app' is distinct from 'secondserve' then
        return new;   -- not a SecondServe signup; leave to VitaChain's trigger
    end if;

    if ss_role not in ('consumer','restaurant') then
        ss_role := 'consumer';
    end if;

    insert into public.ss_profiles (
        id, role, email, name, city,
        approved, banned,
        commerce_type, address, phone, lat, lng, map_link
    )
    values (
        new.id,
        ss_role,
        new.email,
        coalesce(md->>'ss_name', split_part(new.email, '@', 1)),
        coalesce(md->>'ss_city', 'Casablanca'),
        ss_role = 'consumer',            -- consumers auto-approved
        false,
        nullif(md->>'ss_commerce_type', ''),
        nullif(md->>'ss_address', ''),
        nullif(md->>'ss_phone', ''),
        (md->>'ss_lat')::double precision,
        (md->>'ss_lng')::double precision,
        nullif(md->>'ss_map_link', '')
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

revoke all on function public.handle_new_ss_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_ss on auth.users;
create trigger on_auth_user_created_ss
    after insert on auth.users
    for each row execute function public.handle_new_ss_user();

-- ── Atomic order placement (fixes the Firestore latent bug) ───────────────────
-- In Firestore the consumer tried to decrement offer.quantity directly, which
-- the rules forbid (offers are owner/admin-writable only). Here a SECURITY
-- DEFINER RPC performs stock check + decrement + order + notification in one
-- transaction, after verifying the caller is the ordering consumer.
create or replace function public.ss_place_order(
    p_offer_id         uuid,
    p_quantity         integer,
    p_consumer_name    text default null,
    p_consumer_phone   text default null,
    p_customer_message text default '',
    p_payment_method   text default 'delivery',
    p_payment_status   text default 'pending'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid        uuid := auth.uid();
    v_offer      public.ss_offers%rowtype;
    v_profile    public.ss_profiles%rowtype;
    v_order_id   uuid := gen_random_uuid();
    v_pickup     text := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
    v_expires    timestamptz;
    v_total      numeric(10,2);
    v_hh         int;
    v_mm         int;
begin
    if v_uid is null then
        raise exception 'not authenticated' using errcode = '28000';
    end if;
    if p_quantity is null or p_quantity <= 0 then
        raise exception 'quantity must be positive' using errcode = '22023';
    end if;

    select * into v_profile from public.ss_profiles where id = v_uid;
    if not found then
        raise exception 'no SecondServe profile for caller' using errcode = 'P0002';
    end if;

    -- Lock the offer row so concurrent orders cannot oversell stock.
    select * into v_offer from public.ss_offers where id = p_offer_id for update;
    if not found then
        raise exception 'offer no longer exists' using errcode = 'P0002';
    end if;
    if p_quantity > v_offer.quantity then
        raise exception 'requested quantity not available' using errcode = '23514';
    end if;

    -- Pickup expiry from the offer's "HH:MM" time_limit; +24h fallback.
    if v_offer.time_limit ~ '^\d{1,2}:\d{2}$' then
        v_hh := split_part(v_offer.time_limit, ':', 1)::int;
        v_mm := split_part(v_offer.time_limit, ':', 2)::int;
        v_expires := date_trunc('day', now()) + make_interval(hours => v_hh, mins => v_mm);
        if v_expires <= now() then
            v_expires := v_expires + interval '1 day';
        end if;
    else
        v_expires := now() + interval '24 hours';
    end if;

    v_total := v_offer.reduced_price * p_quantity;

    update public.ss_offers
        set quantity = quantity - p_quantity
        where id = p_offer_id;

    insert into public.ss_orders (
        id, offer_id, consumer_id, consumer_name, consumer_phone,
        restaurant_id, quantity, total_price, status, offer_snapshot,
        payment_method, payment_status, customer_message, pickup_code, expires_at
    ) values (
        v_order_id, p_offer_id, v_uid,
        coalesce(p_consumer_name, v_profile.name),
        coalesce(p_consumer_phone, v_profile.phone, '0600000000'),
        v_offer.restaurant_id, p_quantity, v_total, 'active', to_jsonb(v_offer),
        coalesce(p_payment_method, 'delivery'),
        coalesce(p_payment_status, 'pending'),
        coalesce(p_customer_message, ''),
        v_pickup, v_expires
    );

    insert into public.ss_notifications (
        order_id, customer_name, offer_name, total_price,
        payment_method, recipient_id
    ) values (
        v_order_id,
        coalesce(p_consumer_name, v_profile.name),
        v_offer.name, v_total,
        coalesce(p_payment_method, 'delivery'),
        v_offer.restaurant_id
    );

    return v_order_id;
end;
$$;

revoke all on function public.ss_place_order(uuid, integer, text, text, text, text, text)
    from public, anon;
grant execute on function public.ss_place_order(uuid, integer, text, text, text, text, text)
    to authenticated;

-- ── Cancel order (atomic restock + status flip) ───────────────────────────────
create or replace function public.ss_cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid   uuid := auth.uid();
    v_order public.ss_orders%rowtype;
begin
    select * into v_order from public.ss_orders where id = p_order_id for update;
    if not found then
        raise exception 'order not found' using errcode = 'P0002';
    end if;
    if not (v_order.consumer_id = v_uid
            or v_order.restaurant_id = v_uid
            or public.ss_is_admin()) then
        raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_order.status = 'active' then
        update public.ss_offers set quantity = quantity + v_order.quantity
            where id = v_order.offer_id;
    end if;
    update public.ss_orders set status = 'cancelled' where id = p_order_id;
end;
$$;

revoke all on function public.ss_cancel_order(uuid) from public, anon;
grant execute on function public.ss_cancel_order(uuid) to authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Firestore onSnapshot → Supabase Realtime. FULL replica identity so UPDATE/
-- DELETE events carry the columns the client filters on (recipient_id, etc.).
alter table public.ss_profiles        replica identity full;
alter table public.ss_offers          replica identity full;
alter table public.ss_orders          replica identity full;
alter table public.ss_reviews         replica identity full;
alter table public.ss_notifications   replica identity full;
alter table public.ss_support_tickets replica identity full;

do $$
begin
    alter publication supabase_realtime add table public.ss_profiles;
    alter publication supabase_realtime add table public.ss_offers;
    alter publication supabase_realtime add table public.ss_orders;
    alter publication supabase_realtime add table public.ss_reviews;
    alter publication supabase_realtime add table public.ss_notifications;
    alter publication supabase_realtime add table public.ss_support_tickets;
exception when duplicate_object then null;
end $$;

-- Re-arm the RLS-enforcement event trigger.
alter event trigger trg_enforce_rls_on_public_tables enable;
