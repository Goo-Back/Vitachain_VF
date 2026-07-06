-- =============================================================================
-- 0052 — M2 FarMarket: open farmer ratings to any restaurant (drop the
-- verified-buyer gate introduced in 0046).
--
-- Product decision: a restaurant can now rate/review any verified farmer
-- without first holding a DELIVERED order item from them. `order_id` on the
-- ratings row remains a nullable audit link (populated when a DELIVERED item
-- exists at write time) — see backend/app/modules/farmarket/router.py
-- upsert_rating().
-- =============================================================================

drop policy if exists "farmarket_ratings_insert_verified_buyer" on public.m2_farmarket_farmer_ratings;
create policy "farmarket_ratings_insert_any_restaurant"
    on public.m2_farmarket_farmer_ratings for insert to authenticated
    with check (
        auth.uid() = restaurant_id
        and public.has_role('RESTAURANT'::public.user_role)
    );
