-- =============================================================================
-- DEMO SEED — Profil agriculteur Abderrahim (FarMarket showcase)
--
-- ÉTAPE 1 : Exécuter ce script dans Supabase SQL Editor
-- ÉTAPE 2 : Login → abderrahim.demo@vitachain.test / Demo@Abderrahim2024
-- Cleanup : décommenter le bloc en bas du fichier
-- =============================================================================
--
-- UUIDs fixes pour suppression facile :
--   Farmer Abderrahim : fa000001-0000-0000-0000-000000000000
--   Restaurant demo   : fb000001-0000-0000-0000-000000000000
--   Annonces          : ad000001..ad000006-0000-0000-0000-000000000000
--   Commandes         : 0c000001..0c000004-0000-0000-0000-000000000000
--   Lignes commande   : 0e000001..0e000007-0000-0000-0000-000000000000
--   Évaluation        : ae000001-0000-0000-0000-000000000000
-- =============================================================================

-- ── 1. Comptes Auth (DO $$ pour récupérer instance_id dynamiquement) ─────────

DO $$
DECLARE
    v_instance_id uuid;
BEGIN
    -- Récupérer le vrai instance_id depuis un user existant
    SELECT instance_id INTO v_instance_id FROM auth.users LIMIT 1;
    -- Fallback si la base est vide
    IF v_instance_id IS NULL THEN
        v_instance_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;

    -- Agriculteur Abderrahim
    INSERT INTO auth.users (
        id, instance_id, aud, role, email,
        encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
    ) VALUES (
        'fa000001-0000-0000-0000-000000000000',
        v_instance_id,
        'authenticated', 'authenticated',
        'abderrahim.demo@vitachain.test',
        crypt('Demo@Abderrahim2024', gen_salt('bf')),
        now() - interval '6 months',
        '{"provider":"email","providers":["email"]}',
        '{"role":"FARMER","locale":"fr","full_name":"Abderrahim Ouali"}',
        now() - interval '6 months',
        now()
    ) ON CONFLICT (id) DO NOTHING;

    -- Restaurant fictif Al Baraka (passe les commandes + donne les notes)
    INSERT INTO auth.users (
        id, instance_id, aud, role, email,
        encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
    ) VALUES (
        'fb000001-0000-0000-0000-000000000000',
        v_instance_id,
        'authenticated', 'authenticated',
        'albaraka.demo@vitachain.test',
        crypt('Demo@AlBaraka2024', gen_salt('bf')),
        now() - interval '4 months',
        '{"provider":"email","providers":["email"]}',
        '{"role":"RESTAURANT","locale":"fr","full_name":"Restaurant Al Baraka"}',
        now() - interval '4 months',
        now()
    ) ON CONFLICT (id) DO NOTHING;

END $$;


-- ── 1b. Identités email (obligatoire pour que Supabase Auth valide le login) ──
INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
VALUES
(
  gen_random_uuid(),
  'fa000001-0000-0000-0000-000000000000',
  'fa000001-0000-0000-0000-000000000000',
  'email',
  '{"sub":"fa000001-0000-0000-0000-000000000000","email":"abderrahim.demo@vitachain.test","email_verified":true,"phone_verified":false}',
  now() - interval '6 months', now() - interval '6 months', now()
),
(
  gen_random_uuid(),
  'fb000001-0000-0000-0000-000000000000',
  'fb000001-0000-0000-0000-000000000000',
  'email',
  '{"sub":"fb000001-0000-0000-0000-000000000000","email":"albaraka.demo@vitachain.test","email_verified":true,"phone_verified":false}',
  now() - interval '4 months', now() - interval '4 months', now()
) ON CONFLICT DO NOTHING;


-- ── 2. Compléter les profils ──────────────────────────────────────────────────
-- enforce_profile_immutability() vérifie request.jwt.claims->>'role'.
-- En connexion psql directe ce claim est absent → on le positionne explicitement.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);

UPDATE public.profiles SET
    verification_status = 'VERIFIED',
    first_name          = 'Abderrahim',
    last_name           = 'Ouali',
    phone               = '+212661234567',
    farmer_region       = 'Souss-Massa',
    created_at          = now() - interval '6 months'
WHERE id = 'fa000001-0000-0000-0000-000000000000';

UPDATE public.profiles SET
    verification_status = 'VERIFIED',
    phone               = '+212522345678',
    created_at          = now() - interval '4 months'
WHERE id = 'fb000001-0000-0000-0000-000000000000';


-- ── 3. Annonces FarMarket ─────────────────────────────────────────────────────

INSERT INTO public.m2_farmarket_ads
    (id, farmer_id, title, description, product_type,
     price_mad, quantity_kg, region, status, is_featured, expires_at, created_at)
VALUES
-- 1. Tomates BIO (mise en avant ⭐)
(
    'ad000001-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    'Tomates BIO Souss-Massa — Calibre A',
    'Récolte fraîche de cette semaine. Tomates biologiques cultivées sans pesticides chimiques, calibre A, idéales pour la restauration professionnelle. Disponibles en caisses de 10 kg. Certification bio en cours.',
    'Tomates',
    4.50, 500.00, 'Souss-Massa', 'ACTIVE', true,
    now() + interval '7 days',
    now() - interval '3 days'
),
-- 2. Oignons Doux
(
    'ad000002-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    'Oignons Doux de Souss',
    'Oignons doux de la région Souss-Massa, récoltés à maturité optimale. Excellente conservation jusqu''à 3 mois. Conditionnement en filets de 25 kg ou en vrac.',
    'Oignons',
    2.80, 800.00, 'Souss-Massa', 'ACTIVE', false,
    now() + interval '6 days',
    now() - interval '5 days'
),
-- 3. Pommes de Terre
(
    'ad000003-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    'Pommes de Terre Agadir — Variété Spunta',
    'Pommes de terre variété Spunta, chair ferme et goût exceptionnel. Parfaites pour la friture, le four ou les tajines. Production locale certifiée. Calibre 40-70mm.',
    'Pommes de terre',
    3.20, 1200.00, 'Souss-Massa', 'ACTIVE', false,
    now() + interval '5 days',
    now() - interval '2 days'
),
-- 4. Courgettes (stock faible)
(
    'ad000004-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    'Courgettes Fraîches — Récolte du Jour',
    'Courgettes fraîchement récoltées ce matin. Calibre moyen, couleur verte brillante, chair ferme. Livrables dans les 24h suivant la confirmation de commande. Stock limité.',
    'Courgettes',
    5.50, 120.00, 'Souss-Massa', 'ACTIVE', false,
    now() + interval '4 days',
    now() - interval '1 day'
),
-- 5. Oranges Navel
(
    'ad000005-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    'Oranges Navel Premium — Souss',
    'Oranges Navel de la région Souss, à la chair sucrée et juteuse, sans pépins. Idéales pour jus frais, desserts et plateaux de fruits. Calibre 3 et 4. Récoltées à maturité.',
    'Oranges',
    3.80, 2000.00, 'Souss-Massa', 'ACTIVE', false,
    now() + interval '7 days',
    now() - interval '4 days'
),
-- 6. Blé Dur (EXPIRED — montre l'état expiré dans la liste)
(
    'ad000006-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    'Blé Dur Souss — Saison Passée',
    'Blé dur de qualité supérieure, récolte de la saison passée. Teneur en protéines 13%. Idéal pour semoule et pâtes artisanales.',
    'Blé',
    2.50, 0.00, 'Souss-Massa', 'EXPIRED', false,
    now() - interval '1 day',
    now() - interval '15 days'
) ON CONFLICT (id) DO NOTHING;


-- ── 4. Commandes (pipeline complet) ───────────────────────────────────────────

-- Commande 1 : DELIVERED + PAID (pipeline terminé)
INSERT INTO public.m2_farmarket_orders
    (id, restaurant_id, status, delivery_region,
     delivery_notes, delivery_contact_name, delivery_phone,
     delivery_address, delivery_city,
     subtotal_mad, logistics_fee_mad, total_mad,
     payment_method, payment_status, paid_at, created_at)
VALUES (
    '0c000001-0000-0000-0000-000000000000',
    'fb000001-0000-0000-0000-000000000000',
    'DELIVERED', 'Casablanca-Settat',
    'Livraison avant 8h du matin svp, entrée côté cuisine',
    'Khalid Benali', '+212661987654',
    '45 Rue Ibn Battuta, Quartier Maarif', 'Casablanca',
    3040.00, 152.00, 3192.00,
    'COD', 'PAID', now() - interval '10 days',
    now() - interval '15 days'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.m2_farmarket_order_items
    (id, order_id, ad_id, farmer_id,
     quantity_kg, unit_price_mad, line_total_mad,
     status, producer_note, stock_released, created_at)
VALUES
(
    '0e000001-0000-0000-0000-000000000000',
    '0c000001-0000-0000-0000-000000000000',
    'ad000001-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    400.00, 4.50, 1800.00, 'DELIVERED',
    'Livraison effectuée en parfait état, caisses bien fermées',
    true, now() - interval '15 days'
),
(
    '0e000002-0000-0000-0000-000000000000',
    '0c000001-0000-0000-0000-000000000000',
    'ad000002-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    440.00, 2.80, 1232.00, 'DELIVERED',
    null,
    true, now() - interval '15 days'
) ON CONFLICT (id) DO NOTHING;

-- Commande 2 : IN_PROGRESS (en cours de livraison)
INSERT INTO public.m2_farmarket_orders
    (id, restaurant_id, status, delivery_region,
     delivery_contact_name, delivery_phone,
     delivery_address, delivery_city,
     subtotal_mad, logistics_fee_mad, total_mad,
     payment_method, payment_status, created_at)
VALUES (
    '0c000002-0000-0000-0000-000000000000',
    'fb000001-0000-0000-0000-000000000000',
    'IN_PROGRESS', 'Casablanca-Settat',
    'Khalid Benali', '+212661987654',
    '45 Rue Ibn Battuta, Quartier Maarif', 'Casablanca',
    3500.00, 175.00, 3675.00,
    'COD', 'DUE',
    now() - interval '3 days'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.m2_farmarket_order_items
    (id, order_id, ad_id, farmer_id,
     quantity_kg, unit_price_mad, line_total_mad,
     status, producer_note, stock_released, created_at)
VALUES
(
    '0e000003-0000-0000-0000-000000000000',
    '0c000002-0000-0000-0000-000000000000',
    'ad000003-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    500.00, 3.20, 1600.00, 'IN_TRANSIT',
    'Marchandise bien emballée et étiquetée',
    false, now() - interval '3 days'
),
(
    '0e000004-0000-0000-0000-000000000000',
    '0c000002-0000-0000-0000-000000000000',
    'ad000005-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    500.00, 3.80, 1900.00, 'IN_TRANSIT',
    null,
    false, now() - interval '3 days'
) ON CONFLICT (id) DO NOTHING;

-- Commande 3 : ACCEPTED (acceptée, pas encore expédiée)
INSERT INTO public.m2_farmarket_orders
    (id, restaurant_id, status, delivery_region,
     delivery_contact_name, delivery_phone,
     delivery_address, delivery_city,
     subtotal_mad, logistics_fee_mad, total_mad,
     payment_method, payment_status, created_at)
VALUES (
    '0c000003-0000-0000-0000-000000000000',
    'fb000001-0000-0000-0000-000000000000',
    'ACCEPTED', 'Casablanca-Settat',
    'Khalid Benali', '+212661987654',
    '45 Rue Ibn Battuta, Quartier Maarif', 'Casablanca',
    550.00, 50.00, 600.00,
    'PSP_TRANSFER', 'SIMULATED_PAID',
    now() - interval '1 day'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.m2_farmarket_order_items
    (id, order_id, ad_id, farmer_id,
     quantity_kg, unit_price_mad, line_total_mad,
     status, stock_released, created_at)
VALUES
(
    '0e000005-0000-0000-0000-000000000000',
    '0c000003-0000-0000-0000-000000000000',
    'ad000004-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    100.00, 5.50, 550.00, 'ACCEPTED',
    false, now() - interval '1 day'
) ON CONFLICT (id) DO NOTHING;

-- Commande 4 : PENDING (nouvelle commande en attente de réponse)
INSERT INTO public.m2_farmarket_orders
    (id, restaurant_id, status, delivery_region,
     delivery_notes, delivery_contact_name, delivery_phone,
     delivery_address, delivery_city,
     subtotal_mad, logistics_fee_mad, total_mad,
     payment_method, payment_status, created_at)
VALUES (
    '0c000004-0000-0000-0000-000000000000',
    'fb000001-0000-0000-0000-000000000000',
    'PENDING', 'Casablanca-Settat',
    'Appeler 30 min avant livraison',
    'Khalid Benali', '+212661987654',
    '45 Rue Ibn Battuta, Quartier Maarif', 'Casablanca',
    758.00, 50.00, 808.00,
    'COD', 'DUE',
    now() - interval '2 hours'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.m2_farmarket_order_items
    (id, order_id, ad_id, farmer_id,
     quantity_kg, unit_price_mad, line_total_mad,
     status, stock_released, created_at)
VALUES
(
    '0e000006-0000-0000-0000-000000000000',
    '0c000004-0000-0000-0000-000000000000',
    'ad000001-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    100.00, 4.50, 450.00, 'PENDING',
    false, now() - interval '2 hours'
),
(
    '0e000007-0000-0000-0000-000000000000',
    '0c000004-0000-0000-0000-000000000000',
    'ad000002-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    110.00, 2.80, 308.00, 'PENDING',
    false, now() - interval '2 hours'
) ON CONFLICT (id) DO NOTHING;


-- ── 5. Évaluation agriculteur ─────────────────────────────────────────────────

INSERT INTO public.m2_farmarket_farmer_ratings
    (id, farmer_id, restaurant_id, order_id,
     rating, review, reviewer_name, created_at)
VALUES (
    'ae000001-0000-0000-0000-000000000000',
    'fa000001-0000-0000-0000-000000000000',
    'fb000001-0000-0000-0000-000000000000',
    '0c000001-0000-0000-0000-000000000000',
    5,
    'Excellent agriculteur, produits de très haute qualité. Les tomates étaient fraîches et bien calibrées, la livraison respectée à l''heure. On recommande vivement Abderrahim pour tout restaurant qui cherche des produits locaux de qualité!',
    'Restaurant Al Baraka',
    now() - interval '9 days'
) ON CONFLICT (id) DO NOTHING;


-- ── Vérification rapide ───────────────────────────────────────────────────────
SELECT
    (SELECT count(*) FROM public.profiles        WHERE id IN ('fa000001-0000-0000-0000-000000000000','fb000001-0000-0000-0000-000000000000')) AS profiles_created,
    (SELECT count(*) FROM public.m2_farmarket_ads    WHERE farmer_id = 'fa000001-0000-0000-0000-000000000000') AS ads_created,
    (SELECT count(*) FROM public.m2_farmarket_orders WHERE restaurant_id = 'fb000001-0000-0000-0000-000000000000') AS orders_created,
    (SELECT count(*) FROM public.m2_farmarket_order_items WHERE farmer_id = 'fa000001-0000-0000-0000-000000000000') AS items_created,
    (SELECT count(*) FROM public.m2_farmarket_farmer_ratings WHERE farmer_id = 'fa000001-0000-0000-0000-000000000000') AS ratings_created;


-- =============================================================================
-- SCRIPT DE NETTOYAGE — supprimer toutes les données demo après la vidéo
-- Décommenter ce bloc et exécuter dans le SQL Editor
-- =============================================================================
/*
DELETE FROM public.m2_farmarket_farmer_ratings
    WHERE id = 'ae000001-0000-0000-0000-000000000000';

DELETE FROM public.m2_farmarket_order_items
    WHERE farmer_id = 'fa000001-0000-0000-0000-000000000000';

DELETE FROM public.m2_farmarket_orders
    WHERE restaurant_id = 'fb000001-0000-0000-0000-000000000000';

DELETE FROM public.m2_farmarket_ads
    WHERE farmer_id = 'fa000001-0000-0000-0000-000000000000';

-- identities + profiles supprimées en cascade depuis auth.users
DELETE FROM auth.users WHERE id IN (
    'fa000001-0000-0000-0000-000000000000',
    'fb000001-0000-0000-0000-000000000000'
);
*/
