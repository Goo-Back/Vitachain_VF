---
marp: true
theme: default
paginate: true
header: 'VitaChain — État d''avancement'
footer: 'PFE 2026 — Yasser'
---

# VitaChain
## État d'avancement de la plateforme

**Présentation technique**
Base de données · Backend · Frontend · Sécurité

PFE 2026 — Yasser
2026-05-25

---

## Vue d'ensemble de la plateforme

VitaChain = **3 modules métier** sur une seule plateforme cloud :

| Module | Rôle |
|---|---|
| **M0 — Auth** | Inscription, rôles, KYC-lite, vérification admin |
| **M1 — Katara** | IoT agricole (ESP32) + diagnostic IA des parcelles |
| **M2 — FarMarket** | Marketplace anonymisée producteur → restaurateur |

**Stack** : PostgreSQL (Supabase) · FastAPI (Python) · Next.js 15 / React 19 · Nginx · Docker · VPS

**Avancement** : 42 migrations SQL, 41 user stories spécifiées, 32 livrées (M0 + M1 + M2 phases A→G)

---

# 1. Base de données

---

## Choix techniques — DB

- **PostgreSQL 15** managé via **Supabase** (single-project, multi-tenant logique)
- Migrations **append-only**, numérotées (`0001_…` → `0042_…`), appliquées via `psql` (pas le CLI Supabase) — pour CI reproductible
- Toute table créée avec **`enable row level security`** + au moins une policy explicite dans la même migration
- **Event trigger** `trg_enforce_rls_on_public_tables` qui refuse au `ddl_command_end` toute table `public.*` sans RLS — *garde-fou DDL*

```sql
-- exemple — db/migrations/0010
create event trigger trg_enforce_rls_on_public_tables
  on ddl_command_end when tag in ('CREATE TABLE')
  execute function public.enforce_rls_on_new_public_tables();
```

---

## Schéma — modules

**M0 — Auth & KYC**
`profiles`, `kyc_documents`, `notifications_outbox`
+ trigger `on_auth_user_created` → crée le profil
+ JWT hook PostgreSQL → injecte `role` + `verification_status` dans le token

**M1 — Katara (IoT)**
`m1_katara_parcels` (polygone GeoJSON), `m1_katara_devices` (ESP32), `m1_katara_telemetry` (ingestion brute), `m1_katara_telemetry_history` (agrégat horaire), `m1_katara_alert_thresholds`, `m1_katara_diagnostics`

**M2 — FarMarket**
`m2_farmarket_ads`, `m2_farmarket_orders`, `m2_farmarket_order_items`
+ vue `v_farmer_incoming_items` qui **masque l'identité du restaurant** (hash SHA-256)

---

## Patterns DB notables

- **Idempotence** : `create … if not exists`, `do $$ … exception when duplicate_object`, `drop policy if exists` → réapplication = no-op
- **Triggers d'audit-guard** : sur `m1_katara_diagnostics`, certains champs (`status`, `result_text`, `started_at`, `completed_at`) sont **verrouillés au `service_role`** uniquement — l'utilisateur ne peut jamais mentir sur l'état d'un diagnostic
- **Anonymisation côté DB** : `v_farmer_incoming_items` projette `sha256(restaurant_id||':'||farmer_id)` au lieu de l'ID brut → règle métier **BR-F5** appliquée par la base, pas par le code applicatif
- **Provenance des données** : après un *unlink/relink* d'un capteur, l'historique reste rattaché au capteur d'origine via `device_id` archivé

---

## Tests SQL (assertions)

Fichiers `db/tests/*.sql` exécutés en CI :

- `auth02_jwt_role.sql` — le rôle dans le JWT correspond bien au rôle DB
- `auth04_rls_contract.sql` — chaque table sensible a `FORCE RLS` activé
- `auth04_cross_role_isolation.sql` — un farmer ne voit pas les parcelles d'un autre
- `auth06_kyc_documents_rls.sql` — un user ne lit que ses propres docs KYC
- `auth07_business_rules.sql` — règles métier (BR-K5, BR-K6, BR-F5…)

→ **Le contrat de sécurité est testé, pas seulement documenté.**

---

# 2. Backend

---

## Choix techniques — Backend

- **FastAPI 0.115** (Python 3.12) — async natif, validation Pydantic, OpenAPI auto
- **uvicorn** en dev, **gunicorn + uvicorn workers** en prod
- **Supabase Python SDK** côté serveur uniquement (jamais en front)
- **structlog** pour logs JSON structurés
- **Sentry SDK** pour error tracking
- **PyJWT** pour vérifier les JWT Supabase

**Organisation modulaire**
```
backend/app/
├── core/          # middleware, logging, supabase client
├── routers/       # health
└── modules/
    ├── katara/        (M1 — IoT + diagnostic)
    ├── farmarket/     (M2 — marketplace)
    ├── secondserve/   (M3 — futur)
    ├── botabaqa/      (M4 — futur)
    └── notifications/ (transverse — Brevo)
```

---

## Rôle du backend

Le backend ne sert **pas** la donnée du métier classique (le frontend Next.js parle directement à Supabase via RLS).

Le backend gère uniquement **ce que RLS ne peut pas faire** :

1. **Workers asynchrones** — pipeline diagnostic Katara :
   `requête IA → OWM (météo) → Sentinel (satellite) → Gemini (analyse) → email Brevo`
2. **Webhooks IoT** — ingestion ESP32 (lock service-role only)
3. **Règles métier multi-tables** — BR-K5 (1 diagnostic actif/parcelle), BR-K6 (max 3/24h)
4. **Notifications transactionnelles** — Brevo templates (FR/EN/AR)
5. **Cron jobs** — expiration des annonces FarMarket, détection capteurs offline

---

## Pipeline diagnostic IA (Katara)

```
Farmer clique "Diagnostiquer" (frontend)
       │
       ▼
INSERT m1_katara_diagnostics (status = PENDING)   ← RLS
       │
       ▼
NOTIFY pg_notify → worker FastAPI (service_role)
       │
       ├──► OpenWeatherMap (météo 7j)
       ├──► Sentinel Hub (NDVI satellite)
       └──► Gemini API (analyse multimodale)
       │
       ▼
UPDATE status = COMPLETED + result_text
       │
       ▼
Trigger DB → outbox → Brevo email (FR/EN/AR)
```

---

# 3. Frontend

---

## Choix techniques — Frontend

- **Next.js 15** (App Router) + **React 19** + **TypeScript 5.7**
- **Tailwind CSS v4** (config minimaliste, design tokens)
- **Server Actions** partout pour les mutations — pas d'API REST côté front
- **`@supabase/ssr`** pour auth cookie-based (compatible SSR)
- **Zod** pour validation côté serveur ET client
- **Leaflet + react-leaflet** pour la carte (sélection parcelle polygonale)
- **Vitest** + Testing Library pour les tests unitaires
- **Sentry** pour le monitoring d'erreurs côté navigateur

---

## Architecture frontend

```
frontend/src/
├── middleware.ts           # gate sur /dashboard/* — vérifie rôle + KYC
├── lib/
│   ├── supabase/           # 3 clients : browser / server / service
│   ├── auth/               # rôles, errors, hash email
│   └── cart.tsx            # contexte panier (FarMarket)
├── components/
│   └── PolygonMapPicker    # carte Leaflet + dessin polygone
└── app/
    ├── login / register / onboarding
    ├── dashboard/farmer/   # KPI, parcelles, ads, orders, weather, satellite
    ├── dashboard/restaurant/ # marketplace, cart, orders, tracking
    └── admin/              # KYC review, FarMarket admin
```

---

## Server Actions — exemple

Aucune route `/api/…` métier : tout passe par des **Server Actions** (RPC implicite, type-safe end-to-end).

```ts
// frontend/src/app/dashboard/farmer/ads/actions.ts
'use server';
export async function createAd(formData: FormData) {
  const supabase = await createServerClient();
  const parsed = AdSchema.safeParse(...);          // Zod
  if (!parsed.success) return { error: ... };
  const { error } = await supabase
    .from('m2_farmarket_ads')
    .insert(parsed.data);                          // RLS gère la sécurité
  revalidatePath('/dashboard/farmer/ads');
}
```

→ **Validation Zod + RLS = double barrière** sans dupliquer la logique.

---

## Parcours utilisateurs livrés

| Rôle | Parcours |
|---|---|
| **Citoyen / Farmer / Restaurant** | Inscription → email → choix rôle → KYC-lite → dashboard |
| **Farmer** | Crée parcelle (polygone carte) → pair ESP32 → voit télémétrie temps réel + historique → définit seuils d'alerte → demande diagnostic IA → publie annonce marketplace → reçoit commandes (anonymisées) |
| **Restaurateur** | Parcourt catalogue → filtres → ajoute au panier → commande → suit livraison (4 statuts) |
| **Admin** | Valide KYC, supervise annonces et commandes |

UI multilingue : FR / EN / AR (templates Brevo + libellés)

---

# 4. Sécurité

---

## Modèle de sécurité — défense en profondeur

```
┌──────────────────────────────────────────────────┐
│ 1.  Nginx       — TLS, HSTS, rate-limit          │
├──────────────────────────────────────────────────┤
│ 2.  Next.js     — middleware (rôle + KYC gate)   │
├──────────────────────────────────────────────────┤
│ 3.  Server Action — Zod validation               │
├──────────────────────────────────────────────────┤
│ 4.  PostgreSQL  — RLS + triggers + JWT hooks     │
└──────────────────────────────────────────────────┘
```

Chaque couche **suppose les couches au-dessus compromises**. Une RLS valide protège la donnée même si le frontend est bypassé.

---

## Authentification & rôles

- **Auth Supabase** (email + password, JWT HS256, accessToken 1h / refresh 7d)
- 4 rôles métier (enum DB) : `citizen`, `farmer`, `restaurant`, `admin`
- **Auto-signup admin bloqué** par trigger DB (`0007_auth02_block_admin_self_signup`)
- Profil créé automatiquement par trigger `on_auth_user_created`
- **JWT hook Postgres** (`0006`, `0014`) — injecte `role` + `verification_status` dans le token → RLS peut décider sans rejouer un SELECT sur `profiles`

```sql
-- extrait du hook JWT
claims := jsonb_set(claims, '{user_role}', to_jsonb(p.role));
claims := jsonb_set(claims, '{verification_status}',
                    to_jsonb(p.verification_status));
```

---

## Row Level Security (RLS) — le cœur

Toutes les tables sensibles : `FORCE ROW LEVEL SECURITY` + policies explicites.

**Exemples de garanties exprimées en RLS :**

- Un farmer **ne voit que ses propres** parcelles, devices, télémétrie, diagnostics, annonces
- Un restaurateur **ne voit que ses propres** commandes ; ne voit **jamais l'identité** d'un producteur via l'annonce
- Un producteur reçoit les `order_items` via **vue projetée** qui hash le `restaurant_id`
- Les champs `status` / `result_text` d'un diagnostic sont **verrouillés au `service_role`** par un trigger BEFORE UPDATE
- L'ingestion télémétrie ESP32 est **lockée au `service_role`** (clés API webhook)

**Tests** : `db/tests/auth04_*.sql` rejouent des SELECT cross-role et assertent 0 ligne.

---

## KYC-lite (AUTH-06)

Workflow professionnels (farmer / restaurant) :

1. Utilisateur upload pièce + justificatif → bucket Supabase Storage **privé**
2. Storage policies : seul le propriétaire **ou** un admin peut lire
3. Admin valide via dashboard → `verification_status = APPROVED`
4. JWT hook re-émet un token avec le nouveau statut
5. Middleware Next.js débloque les pages métier

Avant approbation : statut `PENDING_VERIFICATION` → l'utilisateur voit une page d'attente, peut quand même se connecter.

Email transactionnel (Brevo) à chaque transition : `submitted` / `approved` / `rejected`.

---

## Couche Nginx (AUTH-08)

- **HTTPS forcé** (Let's Encrypt + certbot auto-renew)
- **HSTS** + modern TLS (TLSv1.2+)
- **Rate-limiting** zones par endpoint :
  - `/login`, `/register` → 5 req/min/IP
  - `/api/v1/*` → 30 req/s/IP avec burst
- Headers de sécurité standards (CSP, X-Frame-Options, Referrer-Policy)
- Healthcheck `/healthz` en clair sur :80 — uptime Kuma le pingue
- **Bench** des rate-limits scripté (`infra/scripts/bench-rate-limits.sh`)

---

## Isolation des secrets (AUTH-05)

Règle : **`SUPABASE_SERVICE_ROLE_KEY` ne doit JAMAIS atteindre le navigateur.**

Vérification en 3 endroits :

1. **Code** : le SDK service-role n'est importé que sous `backend/` et dans `frontend/src/lib/supabase/server.ts` (Server Action uniquement)
2. **Build** : CI grep le bundle Next.js compilé — fail si la clé apparaît
3. **Runtime** : Sentry alerte si la string apparaît dans une trace côté client

Tous les secrets viennent de Bitwarden → `.env` (gitignored) → variables d'environnement Docker.

---

## Observabilité

- **Sentry** (front + back) — exceptions, traces, source maps
- **Uptime Kuma** — ping `/healthz` toutes les 60s, dashboard public
- **structlog** côté backend — logs JSON ingérables par tout outil
- **Backup nocturne pg_dump** vers Backblaze B2 (`infra/scripts/backup-db.sh`)
- **Brevo** — logs de délivrabilité email (KYC, alerts seuils, diagnostic complete, capteur offline)

---

# Bilan & suite

---

## Ce qui est livré

✅ Infra : VPS Docker + Nginx + HTTPS + backups + observabilité (INF-01 → INF-08)
✅ Auth complète : signup, rôles, RLS, KYC, JWT hooks (AUTH-01 → AUTH-08)
✅ **Katara** complet : parcelles, IoT, télémétrie, seuils, diagnostic IA, multi-parcelles (KAT-01 → KAT-14)
✅ **FarMarket** : annonces + marketplace + commandes anonymisées + tracking (FAR-01 → FAR-10)
✅ 42 migrations SQL, ~30 fichiers de tests, suite CI verte

## Prochaines étapes

- M3 **SecondServe** (anti-gaspi restaurant → bénéficiaire)
- M4 **Botabaqa** (traçabilité chaîne du froid)
- Mise à jour Katara : capteurs ESP32 envoient désormais `soil_pH` + `soil_conductivity` (au lieu d'`air_humidity` / `air_temperature`) → adapter schéma télémétrie

---

# Questions ?

**Démo** : https://vitachain.ma
**Code** : monorepo `db/` · `backend/` · `frontend/` · `infra/`
**Docs** : `docs/stories/` (41 user stories spécifiées)

Merci.
