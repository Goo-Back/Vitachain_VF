-- =============================================================================
-- 0046 — M2 FarMarket: farmer ratings & reviews (verified-buyer gated).
-- Story:  FAR-12 (restaurant rates a producer it has been delivered from)
--
-- A restaurant may leave ONE editable 1–5★ rating + review per farmer, and
-- ONLY if it has at least one DELIVERED order item from that farmer. The
-- eligibility gate is enforced in the RLS WITH CHECK so it cannot be bypassed
-- by hitting PostgREST directly (defence-in-depth — the API also checks).
--
-- Reviews are public (any authenticated user may read) so the rating stats and
-- review list can render on the offer detail + farmer profile pages.
--
-- Event-trigger workaround (same pattern as 0032/0040): disable
-- trg_enforce_rls_on_public_tables before CREATE TABLE, re-enable after RLS.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── Table ─────────────────────────────────────────────────────────────────────

create table if not exists public.m2_farmarket_farmer_ratings (
    id              uuid            primary key default gen_random_uuid(),

    farmer_id       uuid            not null
                        references public.profiles(id) on delete cascade,

    restaurant_id   uuid            not null
                        references public.profiles(id) on delete cascade,

    -- Soft link to the order that established eligibility. Kept for audit; the
    -- live eligibility check below scans order_items, so a deleted order does
    -- not retroactively void an existing rating.
    order_id        uuid
                        references public.m2_farmarket_orders(id) on delete set null,

    rating          smallint        not null
                        constraint m2_farmarket_ratings_range
                            check (rating between 1 and 5),

    review          text
                        constraint m2_farmarket_ratings_review_length
                            check (review is null or char_length(review) <= 1000),

    -- Snapshot of the reviewer's display name at write time. Denormalised on
    -- purpose: profiles RLS is owner-only, so a restaurant reading another
    -- restaurant's name through a join is impossible. The API fills this from
    -- the caller's own profile (which it CAN read). Also keeps the byline
    -- stable if the reviewer later renames. Swap for an opaque handle here if
    -- reviewer anonymity is ever desired.
    reviewer_name   text,

    created_at      timestamptz     not null default now(),
    updated_at      timestamptz     not null default now(),

    -- One editable rating per (restaurant, farmer) pair.
    constraint m2_farmarket_ratings_unique_pair unique (farmer_id, restaurant_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Review list + stats aggregate for a farmer profile page.
create index if not exists m2_farmarket_ratings_farmer_idx
    on public.m2_farmarket_farmer_ratings (farmer_id, created_at desc);

-- "my rating" lookup.
create index if not exists m2_farmarket_ratings_restaurant_idx
    on public.m2_farmarket_farmer_ratings (restaurant_id);

-- ── updated_at trigger ──────────────────────────────────────────────────────

drop trigger if exists trg_far_ratings_updated_at on public.m2_farmarket_farmer_ratings;
create trigger trg_far_ratings_updated_at
    before update on public.m2_farmarket_farmer_ratings
    for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.m2_farmarket_farmer_ratings enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

-- 1. Reviews are public — any authenticated user can read them (catalog + farmer
--    profile rendering).
drop policy if exists "farmarket_ratings_select_public" on public.m2_farmarket_farmer_ratings;
create policy "farmarket_ratings_select_public"
    on public.m2_farmarket_farmer_ratings for select to authenticated
    using (true);

-- 2. Verified-buyer INSERT gate: the caller must be the restaurant on the row,
--    hold the RESTAURANT role, and have a DELIVERED order item from that farmer.
drop policy if exists "farmarket_ratings_insert_verified_buyer" on public.m2_farmarket_farmer_ratings;
create policy "farmarket_ratings_insert_verified_buyer"
    on public.m2_farmarket_farmer_ratings for insert to authenticated
    with check (
        auth.uid() = restaurant_id
        and public.has_role('RESTAURANT'::public.user_role)
        and exists (
            select 1
              from public.m2_farmarket_order_items oi
              join public.m2_farmarket_orders o on o.id = oi.order_id
             where o.restaurant_id = auth.uid()
               and oi.farmer_id = m2_farmarket_farmer_ratings.farmer_id
               and oi.status = 'DELIVERED'::public.m2_farmarket_item_status
        )
    );

-- 3. Restaurant edits its own rating (the eligibility already held at insert;
--    we don't re-require a DELIVERED item to amend an existing review).
drop policy if exists "farmarket_ratings_update_own" on public.m2_farmarket_farmer_ratings;
create policy "farmarket_ratings_update_own"
    on public.m2_farmarket_farmer_ratings for update to authenticated
    using       (auth.uid() = restaurant_id)
    with check  (auth.uid() = restaurant_id);

-- 4. Restaurant deletes its own rating.
drop policy if exists "farmarket_ratings_delete_own" on public.m2_farmarket_farmer_ratings;
create policy "farmarket_ratings_delete_own"
    on public.m2_farmarket_farmer_ratings for delete to authenticated
    using (auth.uid() = restaurant_id);

-- 5. Admin reads all (moderation / dispute handling).
drop policy if exists "farmarket_ratings_admin_select" on public.m2_farmarket_farmer_ratings;
create policy "farmarket_ratings_admin_select"
    on public.m2_farmarket_farmer_ratings for select to authenticated
    using (public.is_admin());

-- 6. Admin deletes (moderation).
drop policy if exists "farmarket_ratings_admin_delete" on public.m2_farmarket_farmer_ratings;
create policy "farmarket_ratings_admin_delete"
    on public.m2_farmarket_farmer_ratings for delete to authenticated
    using (public.is_admin());

-- ── Rating stats aggregate view ───────────────────────────────────────────────
-- security_invoker = true: the ratings table has a public SELECT policy, so the
-- aggregate sees every row regardless of the caller. One row per rated farmer.

drop view if exists public.v_farmarket_farmer_rating_stats;
create view public.v_farmarket_farmer_rating_stats
with (security_invoker = true) as
select
    farmer_id,
    round(avg(rating)::numeric, 2) as rating_avg,
    count(*)                       as rating_count
from public.m2_farmarket_farmer_ratings
group by farmer_id;

grant select on public.v_farmarket_farmer_rating_stats to authenticated;
