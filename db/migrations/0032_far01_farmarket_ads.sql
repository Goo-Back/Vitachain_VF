-- =============================================================================
-- 0032 — M2 FarMarket: farmer ad registry.
-- Story:  FAR-01 (docs/stories/FAR-01-farmer-creates-ad.md)
--
-- Root entity of the FarMarket module.  Subsequent stories attach here:
--   FAR-02 — SELECT with region / product_type / price filters
--   FAR-03 — m2_farmarket_leads.ad_id FK
--   FAR-05 — UPDATE / soft-DELETE by owner
--   FAR-06 — CRON sets status = 'EXPIRED' where now() > expires_at
--   FAR-08 — admin read-all
--   FAR-09 — is_featured ORDER BY logic
--
-- BR-F1 gate: only a VERIFIED FARMER may INSERT — mirrored at the FastAPI
-- layer (require_verified("FARMER")) AND this RLS WITH CHECK.  Defence-in-
-- depth follows the KAT-01 / AUTH-06 kyc_documents pattern.
--
-- Event-trigger workaround: migration 0009 refuses CREATE TABLE in public
-- without RLS at ddl_command_end.  Disable the trigger, create + enable RLS,
-- then re-arm — same scaffolding as migrations 0011, 0015, 0016.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── Enums ─────────────────────────────────────────────────────────────────────

do $$ begin
    create type public.m2_farmarket_ad_status as enum (
        'ACTIVE',
        'EXPIRED',
        'DELETED'
    );
exception when duplicate_object then null; end $$;

-- 12 Moroccan administrative regions (Official 2015 regionalisation).
-- Stored as a named DB enum so the frontend dropdown and DB are always in sync;
-- FAR-02 can filter on an indexed enum column rather than a text ILIKE.
do $$ begin
    create type public.m2_farmarket_region as enum (
        'Tanger-Tétouan-Al Hoceïma',
        'Oriental',
        'Fès-Meknès',
        'Rabat-Salé-Kénitra',
        'Béni Mellal-Khénifra',
        'Casablanca-Settat',
        'Marrakech-Safi',
        'Drâa-Tafilalet',
        'Souss-Massa',
        'Guelmim-Oued Noun',
        'Laâyoune-Sakia El Hamra',
        'Dakhla-Oued Ed-Dahab'
    );
exception when duplicate_object then null; end $$;

-- ── Table ─────────────────────────────────────────────────────────────────────

create table if not exists public.m2_farmarket_ads (
    id              uuid                            primary key default gen_random_uuid(),
    farmer_id       uuid                            not null
                        references public.profiles(id) on delete cascade,

    title           text                            not null
                        constraint m2_farmarket_ads_title_length
                            check (char_length(trim(title)) between 3 and 100),

    description     text                            not null
                        constraint m2_farmarket_ads_description_length
                            check (char_length(trim(description)) between 10 and 2000),

    product_type    text                            not null
                        constraint m2_farmarket_ads_product_type_length
                            check (char_length(trim(product_type)) between 2 and 80),

    -- Price in MAD per kg.  DECIMAL(10,2) per PRD §6.4.3 monetary safeguard.
    price_mad       decimal(10,2)                   not null
                        constraint m2_farmarket_ads_price_positive
                            check (price_mad > 0),

    quantity_kg     decimal(10,2)                   not null
                        constraint m2_farmarket_ads_quantity_positive
                            check (quantity_kg > 0),

    region          public.m2_farmarket_region      not null,

    -- BR-F2: ≤5 storage object paths; binary data NEVER stored here (FAR-07).
    -- Path format: {farmer_id}/{ad_id}/{filename}
    -- NULL array_length means the array is empty — both branches pass the check.
    photo_paths     text[]                          not null default '{}'
                        constraint m2_farmarket_ads_max_photos
                            check (
                                array_length(photo_paths, 1) is null
                                or array_length(photo_paths, 1) <= 5
                            ),

    status          public.m2_farmarket_ad_status   not null default 'ACTIVE',

    -- FAR-09 premium slot: schema ready; feature logic deferred to FAR-09.
    is_featured     boolean                         not null default false,

    -- FAR-06 CRON: flip status = 'EXPIRED' where now() > expires_at.
    expires_at      timestamptz                     not null
                        default (now() + interval '7 days'),

    created_at      timestamptz                     not null default now(),
    updated_at      timestamptz                     not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- FAR-02 primary scan: active ads filtered by region (and optionally product_type).
create index if not exists m2_farmarket_ads_region_status_idx
    on public.m2_farmarket_ads (region, status)
    where status = 'ACTIVE';

-- FAR-05 + farmer's own view: all ads regardless of status.
create index if not exists m2_farmarket_ads_farmer_idx
    on public.m2_farmarket_ads (farmer_id);

-- FAR-06 CRON: "ACTIVE ads past expiry".  Partial — skips already-expired rows.
create index if not exists m2_farmarket_ads_expiry_idx
    on public.m2_farmarket_ads (expires_at)
    where status = 'ACTIVE';

-- FAR-02 price filter: active ads ordered by price.
create index if not exists m2_farmarket_ads_price_idx
    on public.m2_farmarket_ads (price_mad)
    where status = 'ACTIVE';

-- FAR-09 featured ads: partial, tiny — only active featured rows.
create index if not exists m2_farmarket_ads_featured_idx
    on public.m2_farmarket_ads (is_featured, created_at desc)
    where status = 'ACTIVE' and is_featured = true;

-- pg_trgm fuzzy search on product_type (FAR-02 search box).
-- Requires the pg_trgm extension (created in migration 0001).
create index if not exists m2_farmarket_ads_product_type_trgm_idx
    on public.m2_farmarket_ads using gin (product_type gin_trgm_ops)
    where status = 'ACTIVE';

-- ── Trigger ───────────────────────────────────────────────────────────────────

drop trigger if exists trg_m2_farmarket_ads_updated_at on public.m2_farmarket_ads;
create trigger trg_m2_farmarket_ads_updated_at
    before update on public.m2_farmarket_ads
    for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.m2_farmarket_ads enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

-- ── Policies ──────────────────────────────────────────────────────────────────

-- 1. Active ads are visible to any authenticated user (FAR-02 catalog —
--    restaurateurs browse; citizens may browse in future).
drop policy if exists "farmarket_ads_select_active" on public.m2_farmarket_ads;
create policy "farmarket_ads_select_active"
    on public.m2_farmarket_ads for select to authenticated
    using (status = 'ACTIVE');

-- 2. Farmer sees ALL their own ads regardless of status (FAR-05 manage view,
--    including expired + deleted).
drop policy if exists "farmarket_ads_select_own" on public.m2_farmarket_ads;
create policy "farmarket_ads_select_own"
    on public.m2_farmarket_ads for select to authenticated
    using (auth.uid() = farmer_id);

-- 3. Admin reads every ad (FAR-08 admin dashboard).
--    public.is_admin() is the SECURITY DEFINER helper from migration 0005.
drop policy if exists "farmarket_ads_admin_select" on public.m2_farmarket_ads;
create policy "farmarket_ads_admin_select"
    on public.m2_farmarket_ads for select to authenticated
    using (public.is_admin());

-- 4. BR-F1 + AUTH-06: only a VERIFIED FARMER may create an ad.
--    Three-gate check mirrors the KAT-01 katara_parcels_insert_verified_farmer
--    pattern and the AUTH-06 kyc_documents insert policy.
drop policy if exists "farmarket_ads_insert_verified_farmer" on public.m2_farmarket_ads;
create policy "farmarket_ads_insert_verified_farmer"
    on public.m2_farmarket_ads for insert to authenticated
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
    );

-- 5. Farmer edits their own ads (FAR-05).
--    The service-role CRON worker (FAR-06) bypasses RLS to flip status to EXPIRED.
drop policy if exists "farmarket_ads_update_own" on public.m2_farmarket_ads;
create policy "farmarket_ads_update_own"
    on public.m2_farmarket_ads for update to authenticated
    using       (auth.uid() = farmer_id)
    with check  (auth.uid() = farmer_id);

-- 6. Farmer soft-deletes (status = 'DELETED') or hard-deletes their own ads.
drop policy if exists "farmarket_ads_delete_own" on public.m2_farmarket_ads;
create policy "farmarket_ads_delete_own"
    on public.m2_farmarket_ads for delete to authenticated
    using (auth.uid() = farmer_id);
