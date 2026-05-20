# Guide de vérification manuelle — Module Katara (sans ESP32 physique)

> **Objectif** : valider l'intégralité du module Katara (KAT-01 → KAT-14) en utilisant le simulateur Python [scripts/katara_simulator.py](../scripts/katara_simulator.py) à la place du dispositif IoT réel.
>
> **Prérequis** : stack lancée (`docker compose up -d`), migrations appliquées (`make -C db push`), compte FARMER vérifié, accès à l'admin Supabase pour quelques sondes SQL.
>
> **Convention** : ✅ = comportement attendu | ⚠ = à investiguer | 🔒 = test de sécurité (un échec ici bloque la release).

---

## 0. Setup — à faire une seule fois

> Cette section est dense parce que les pré-requis sont **non-évidents** : un FARMER vient au monde en `PENDING`, le JWT cache son statut, l'admin ne peut pas s'inscrire seul, et plusieurs services tiers doivent répondre. Sauter une étape ici fait échouer la moitié des tests Katara avec des 403 cryptiques.

### 0.1 Stack & health

> ⚠ Le `infra/docker-compose.yml` est la stack **prod** déployée sur le VPS — il fait du build avec NGINX, Let's Encrypt, 4 workers, Sentry, Uptime Kuma, etc. Trop lourd pour itérer en local. Le dev local tourne **nativement** ; Supabase Cloud sert de DB (cf. `backend/.env` → `qyyxgdfetzjqfpygikbz.supabase.co`).
>
> Si tu lances `docker compose up -d` à la racine, tu auras `no configuration file provided` — c'est normal, n'utilise pas Docker pour le dev local.

**Lancement dev local** (3 terminaux PowerShell séparés) :

```powershell
# ── Terminal 1 — backend FastAPI ────────────────────────────────────────────
cd backend
.\.venv\Scripts\Activate.ps1                       # ou source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# ── Terminal 2 — frontend Next.js ───────────────────────────────────────────
cd frontend
npm run dev                                        # → http://localhost:3000

# ── Terminal 3 (optionnel) — un worker selon la section testée ────────────
# Pour §0.4 (email KYC) :          python -m app.workers.notifications_mailer
# Pour §5 (alertes seuil) :        python -m app.workers.katara_threshold
# Pour §6 (diagnostic IA) :        python -m app.workers.katara_diagnostic
# Pour §6 (email diagnostic) :     python -m app.workers.katara_diagnostic_email
# Pour §7 (offline detection) :    python -m app.workers.katara_offline
cd backend
.\.venv\Scripts\Activate.ps1
python -m app.workers.notifications_mailer
```

**Migrations DB** (idempotent ; à refaire après `git pull` qui apporte un nouveau `db/migrations/00XX_*.sql`) :

```powershell
cd db
.\scripts\push.sh                                  # ou : make -C db push (si Make installé via Git Bash/WSL)
```

**Sanity check** (depuis n'importe quel terminal) :

```powershell
curl.exe -sf http://localhost:8000/api/v1/healthz                 # → {"status":"ok"}
curl.exe -sf http://localhost:8000/api/v1/katara/healthz          # → {"module":"katara","status":"ok"}
curl.exe -sf http://localhost:3000                                # → HTML Next.js (status 200)
```

Si l'un des trois échoue, **stop** — inutile d'aller plus loin.

> 💡 **Pourquoi `curl.exe`** ? Sur PowerShell, `curl` est un alias d'`Invoke-WebRequest` qui ne supporte pas les mêmes flags. `curl.exe` force le vrai binaire (livré avec Windows 10+).

### 0.2 Variables d'environnement minimales

Vérifie que `backend/.env` contient les clés requises par Katara :

| Variable | Pour quoi | Vérif rapide |
|----------|-----------|--------------|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_JWT_SECRET` + `SUPABASE_ANON_KEY` | base | `Get-Content backend\.env \| Select-String '^SUPABASE'` |
| `BREVO_API_KEY` + `BREVO_SENDER_EMAIL` + 9× `BREVO_TEMPLATE_KAT_*` + 9× `BREVO_TEMPLATE_KYC_*` | mails KAT-06/09/11 + KYC (NOT-01) | `curl -sf -H "api-key: $BREVO_API_KEY" https://api.brevo.com/v3/account \| jq .email` |
| `OPENWEATHERMAP_API_KEY` | KAT-08 météo | `curl -sf "https://api.openweathermap.org/data/2.5/weather?q=Rabat&appid=$OWM_KEY" \| jq .name` |
| `SENTINEL_HUB_API_KEY` | KAT-08 NDVI | l'erreur "auth failed" t'apparaîtra dans les logs worker si elle est mauvaise |
| `GEMINI_API_KEY` + `GEMINI_MODEL` | KAT-08 LLM | `curl -sf "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_KEY" \| jq '.models[0].name'` |
| `FRONTEND_BASE_URL` | liens dans emails | `http://localhost:3000` en dev |

Le frontend, lui, doit avoir uniquement `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` dans [frontend/.env.local](../frontend/.env.local) — 🔒 **jamais** la service-role key.

### 0.3 Créer un compte ADMIN (obligatoire — l'inscription admin est bloquée par migration 0007)

Deux verrous se cumulent :

1. **`block_admin_self_signup`** (migration 0007) interdit `role='ADMIN'` via `/register`.
2. **`enforce_profile_immutability`** (migration 0005) interdit tout UPDATE de `role` ou `verification_status` si la session n'a **pas** le claim JWT `role='service_role'`.

Le SQL Editor de Supabase Studio tourne en superuser `postgres` **sans** claim JWT → le trigger te refuse l'update :

```
ERROR: 42501: role is immutable for non-service callers (was CITIZEN, attempted ADMIN)
```

**Solution** — injecter le claim `service_role` le temps de la transaction (c'est exactement ce que fait FastAPI quand il utilise la service-role key) :

```sql
-- ── Étape 1 : crée l'utilisateur auth via l'UI ──────────────────────────────
-- Supabase Studio → Authentication → Users → "Add user" (mode "Auto-confirm")
--   email : email personnel
--   password : password+admin
-- Cela déclenche le trigger on_signup qui crée une ligne profiles avec role='CITIZEN'.

-- ── Étape 2 : récupère son uuid ─────────────────────────────────────────────
select id from auth.users where email = 'admin@vitachain.test';
-- → copie l'uuid pour l'étape 3

-- ── Étape 3 : flip vers ADMIN en simulant le claim service_role ────────────
begin;
  -- IMPORTANT : set local pour ne pas polluer les sessions suivantes
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);

  update public.profiles
     set role                = 'ADMIN',
         verification_status = 'VERIFIED',
         full_name           = 'Admin Test'
   where id = '<uuid-collé-depuis-étape-2>';
commit;

-- ── Étape 4 : vérifie ───────────────────────────────────────────────────────
select id, role, verification_status, full_name from public.profiles where role = 'ADMIN';
```

**Important** : log out / log in l'admin après ce flip pour récupérer un JWT avec `user_role=ADMIN` (le claim est figé au login, pas lu live).

> 💡 **Alternative plus propre** (sans toucher au trigger) : passer par l'endpoint admin du backend FastAPI qui utilise déjà la service-role key. Mais en pratique on n'a pas d'API "promouvoir-utilisateur-en-ADMIN" — c'est volontairement absent pour éviter une porte dérobée. Le `set_config('request.jwt.claims', ...)` ci-dessus est la voie officielle en dev.
>
> ⚠ La même technique sert plus loin (§0.5) si tu veux bypasser le KYC d'un farmer en SQL : la colonne `verification_status` est protégée par le même trigger, donc même prélude `set_config(...)` requis.

### 0.4 Créer un FARMER et le faire passer VERIFIED — voie officielle (KYC)

C'est le flow que vivront tes vrais utilisateurs ; à tester au moins **une fois** bout-en-bout avant la demo.

| # | Étape | Comment |
|---|-------|---------|
| 1 | Inscription | Frontend `/register` → rôle **FARMER**, email `farmer1@test.local`, password fort |
| 2 | Vérifier le profil créé | SQL : `select role, verification_status from profiles where id=…` → `FARMER`, `PENDING` |
| 3 | Vérifier le JWT initial | DevTools → Application → Cookies → décoder le JWT sur jwt.io → `user_role=FARMER`, `verification_status=PENDING` |
| 4 | Upload KYC | UI `/onboarding/verification` → upload une CIN (PDF/JPG < 5 Mo) → submit |
| 5 | SQL : `select status from kyc_documents where user_id=…` | ✅ `PENDING` |
| 6 | Se connecter en **ADMIN** (autre navigateur ou fenêtre privée pour ne pas écraser le cookie farmer) | → `/admin/kyc` → la queue affiche le doc |
| 7 | Admin clique "Approve" + ajoute une note | API : `POST /api/v1/admin/kyc/<doc_id>/approve` |
| 8 | SQL : `select verification_status from profiles where id=<farmer-uuid>` | ✅ `VERIFIED` |
| 9 | 🚨 **Côté farmer : log out puis log in** | Sinon son JWT contient encore `verification_status=PENDING` et **tous les endpoints Katara renverront 403 `verification_required`** |
| 10 | Re-vérifier le JWT du farmer après login | ✅ `verification_status=VERIFIED` |
| 11 | Mail "KYC approuvée" reçu | ✅ Worker `notifications_mailer` doit tourner (Terminal 3) — il poll toutes les 30 s et envoie via le template `BREVO_TEMPLATE_KYC_APPROVED_FR` |

> **Piège #1** : si tu vois 403 `verification_required` sur `/api/v1/katara/parcels` après approval, c'est que le JWT n'a pas été rafraîchi — re-login obligatoire.
>
> **Piège #2** : avec Supabase, le JWT est rafraîchi par le SDK toutes les heures. En dev, log out / log in force le refresh immédiat. En prod, attendre l'expiration n'est pas acceptable — la doc ADM-02 prévoit un `auth.refreshSession()` côté frontend juste après l'approval ; vérifie qu'il est câblé.

### 0.5 (Optionnel — DEV UNIQUEMENT) Raccourci pour bypasser le KYC

Si tu veux gagner du temps pendant le développement Katara, tu peux flipper le profil directement en SQL **après** une inscription FARMER normale. Comme `verification_status` est protégé par le même trigger qu'en §0.3, il faut le même prélude `set_config` :

```sql
begin;
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.profiles
     set verification_status = 'VERIFIED'
   where id = (select id from auth.users where email = 'farmer1@test.local');
commit;
```

Sans le `set_config`, tu reçois `42501: verification_status is immutable for non-service callers`.

⚠ Refais l'étape 9 ci-dessus (log out / log in) pour rafraîchir le JWT.

🔒 **Ne fais jamais ça en staging/prod** — ça contourne l'audit `kyc_documents.reviewer_id` et casse les invariants AUTH-06.

### 0.6 Pour les tests d'isolation : 2ᵉ farmer + 1 PROFESSIONAL

Plusieurs tests 🔒 plus bas exigent un 2ᵉ farmer (FARMER B) pour vérifier la séparation des données, et un PROFESSIONAL/RESTAURANT pour vérifier les role-gates :

- Refais §0.4 pour `farmer2@test.local` (autre fenêtre privée).
- `/register` → rôle `PROFESSIONAL` → `restaurant1@test.local` (pas besoin de KYC pour les tests négatifs).

Garde une fenêtre privée par compte ouverte pour éviter de te mélanger les cookies.

### 0.7 Simulateur

```bash
python scripts/katara_simulator.py --init-config         # crée devices.json
# Édite devices.json plus tard, après le pairing en §2 — tu n'as pas encore d'api_key.
```

### 0.8 Checklist de sortie de setup (toutes ✅ avant d'attaquer §1)

- [ ] `docker compose ps` → backend, frontend, nginx, (worker si déployé) tous `running`
- [ ] `/healthz` répond 200 sur les 3 surfaces (backend, katara module, frontend)
- [ ] Migrations 0001 → 0028 toutes appliquées (`select max(version) from supabase_migrations.schema_migrations` ou équivalent)
- [ ] 4 services externes répondent : Brevo, OWM, Sentinel Hub (login OK), Gemini
- [ ] 1 admin en DB avec `role=ADMIN, verification_status=VERIFIED`
- [ ] 1 farmer `VERIFIED` (Farmer A) avec JWT rafraîchi
- [ ] 1 farmer `PENDING` ou `VERIFIED` (Farmer B) pour tests d'isolation
- [ ] 1 professional pour tests négatifs
- [ ] `devices.json` créé (vide d'api_key pour l'instant)

---

## 1. KAT-01 — Création de parcelle

**Goal** : un FARMER vérifié crée une parcelle ; un non-vérifié est bloqué.

| # | Action | Attendu |
|---|--------|---------|
| 1 | Login farmer vérifié → `/katara/parcels` → "Nouvelle parcelle" | ✅ Formulaire accessible |
| 2 | Soumettre : nom, surface (ha), culture, GPS lat/lon | ✅ Redirection vers la fiche parcelle |
| 3 | `select * from m1_katara_parcels where farmer_id = auth.uid()` | ✅ 1 ligne, `farmer_id` = ton uuid |
| 4 | 🔒 Connecte un FARMER **non-vérifié**, tente la même création | ✅ 403 `verification_required` |
| 5 | 🔒 Connecte un PROFESSIONAL, ouvre `/katara/parcels` | ✅ 403 ou redirection — l'endpoint refuse |

---

## 2. KAT-02 — Pairing ESP32

**Goal** : le farmer appaire un device "virtuel", récupère le `api_key` plaintext (une seule fois), confirme que toute requête future ne renvoie que `api_key_last4`.

| # | Action | Attendu |
|---|--------|---------|
| 1 | Sur la fiche parcelle → "Appairer un capteur" → device_id = `ESP-KAT-001` | ✅ Modale avec api_key `vk_…` plaintext (1×) |
| 2 | Copier le `vk_…` dans `devices.json` (champ `api_key`) | — |
| 3 | Recharger la page : la liste devices montre `…last4` uniquement | ✅ Plus de plaintext exposé |
| 4 | Re-tenter le pair avec le même `device_id` sur la **même** parcelle | ✅ 409 `device_already_paired` |
| 5 | 🔒 Re-tenter avec le même `device_id` sur une **autre** parcelle du même farmer | ✅ 409 (unique partial index) |
| 6 | 🔒 Connecte un autre farmer → tente de pair `ESP-KAT-001` | ✅ 409 (pas de leak existence) |
| 7 | Bouton "rotate-key" sur le device | ✅ Nouveau `vk_…` modale ; l'ancien doit échouer à l'ingest |

**Sonde SQL** :
```sql
select id, device_id, status, api_key_last4, last_seen
from m1_katara_devices where farmer_id = '<ton-uuid>';
-- attendu : status='PENDING', last_seen=NULL, api_key_last4 = 4 derniers chars du vk_…
```

---

## 3. KAT-03 — Ingest de télémétrie (cœur du module)

**Goal** : le simulateur envoie des payloads et le backend les persiste en < 50 ms p50, en flippant le statut device à `ACTIVE`.

### 3.1 Happy path

```bash
python scripts/katara_simulator.py --config devices.json --interval 5
```

| # | Vérification | Attendu |
|---|--------------|---------|
| 1 | Sortie console du simulateur | ✅ Lignes `… → 204 <uuid>` toutes les 5 s |
| 2 | `select count(*) from m1_katara_telemetry` | ✅ Compteur qui monte |
| 3 | `select status, last_seen from m1_katara_devices` | ✅ `ACTIVE`, last_seen ≈ now() |
| 4 | Mesure : `r.elapsed.total_seconds() * 1000` côté simulateur | ✅ p50 < 50 ms en réseau local |

### 3.2 Idempotence & dedup

| # | Action | Attendu |
|---|--------|---------|
| 1 | Lance le simulateur 2× avec le même `recorded_at` (modifier le script ou rejouer une requête via cURL) | ✅ 204 deux fois, **même** `X-Telemetry-Id` |
| 2 | `select count(*) from m1_katara_telemetry where recorded_at = '<ts>'` | ✅ 1 (et non 2) |

### 3.3 🔒 Authentification

| # | Test | Attendu |
|---|------|---------|
| 1 | Mauvaise api_key (ex. `vk_00000…`) | ✅ 401 `invalid_device_credentials` |
| 2 | Device_id inconnu (`ESP-KAT-999`) | ✅ 401 **avec le même message** que (1) |
| 3 | Headers manquants | ✅ 401 |
| 4 | Un device UNLINKED essaie d'ingest avec son ancien api_key | ✅ 401 (filtre `status <> 'UNLINKED'` dans `verify_device_api_key`) |

### 3.4 🔒 RLS / isolation

```sql
-- Connecté en tant que farmer A
select count(*) from m1_katara_telemetry;
-- attendu : seulement les rows de tes devices

-- Connecté en farmer B (autre compte)
select count(*) from m1_katara_telemetry where device_id = '<device-de-A>';
-- attendu : 0
```

### 3.5 Payload invalide

```bash
python scripts/katara_simulator.py --config devices.json --mode broken-sensor
```

✅ Le backend doit répondre **422** (Pydantic check `soil_moisture <= 100` échoue). Le row ne doit **pas** être inséré.

---

## 4. KAT-04 — Dashboard temps réel + historique

**Goal** : la dashboard affiche le dernier point + un chart avec ≤ 500 points (BR-K4).

### 4.1 Peupler l'historique

```bash
# 7 jours × 96 points/jour = 672 points → la dashboard doit downsampler à ≤ 500
python scripts/katara_simulator.py --config devices.json --backfill-days 7
```

| # | Action | Attendu |
|---|--------|---------|
| 1 | `/katara/parcels/<id>` → onglet "Données" | ✅ 4 charts (moisture, temp, pH, EC) + tile "dernier relevé" |
| 2 | DevTools → onglet Réseau → réponse de `/katara/.../telemetry/history` | ✅ ≤ 500 points |
| 3 | Lance en parallèle le stream temps réel `--interval 10` | ✅ Le tile "dernier relevé" se met à jour < 30 s |
| 4 | Range picker : 24 h / 7 j / 30 j | ✅ Données cohérentes pour chaque fenêtre |

---

## 5. KAT-05 & KAT-06 — Seuils + email d'alerte

**Goal** : définir un seuil, envoyer une valeur hors-seuil, recevoir un mail Brevo.

| # | Action | Attendu |
|---|--------|---------|
| 1 | Configure un seuil sur la parcelle : `soil_moisture < 20` | ✅ Sauvegardé dans `m1_katara_alert_thresholds` |
| 2 | `python scripts/katara_simulator.py --config devices.json --mode alert-moisture` (humidité 8-14 %) | ✅ Backend insère, worker NOTIFY déclenche |
| 3 | Logs du worker thresholds | ✅ "threshold breached" pour la parcelle |
| 4 | Inbox du farmer (Brevo sandbox ou vrai mail) | ✅ 1 email "Alerte humidité" — **un seul**, pas de spam (cooldown ≥ 1 h) |
| 5 | Rejoue le simulateur immédiatement après | ✅ **Pas** de 2ᵉ mail (cooldown actif) |
| 6 | Repasse en `--mode normal`, attends la fin du cooldown, repousse `alert-moisture` | ✅ Nouveau mail |

**Sonde** : `select * from notifications_outbox where event = 'katara_threshold_breached' order by created_at desc;`

---

## 6. KAT-07 → KAT-10 — Diagnostic IA asynchrone

**Goal** : demander un diagnostic, vérifier que le worker enrichit avec OWM + Sentinel + Gemini, recevoir un mail à la fin.

| # | Action | Attendu |
|---|--------|---------|
| 1 | Pré-condition : `--backfill-days 7` complété (Gemini a besoin de l'historique) | — |
| 2 | Dashboard → bouton "Demander un diagnostic" | ✅ 202 + `diagnostic_id` |
| 3 | Le bouton affiche un état "En cours" qui poll `/katara/.../diagnostics/<id>` | ✅ Status `PENDING` puis `RUNNING` puis `COMPLETED` |
| 4 | `select * from m1_katara_ai_diagnostics where id = '<id>'` | ✅ `weather_payload`, `ndvi_payload`, `gemini_text` non-null |
| 5 | Inbox farmer | ✅ Mail "Diagnostic prêt" avec lien vers le détail |
| 6 | UI → page détail diagnostic | ✅ Markdown rendu lisible (titre + sections recommandations) |
| 7 | 🔒 Demande un diagnostic sur une parcelle d'un autre farmer (changer l'id dans l'URL) | ✅ 404 (pas d'existence leak) |

---

## 7. KAT-11 — Détection device offline

**Goal** : un device qui n'a pas envoyé depuis > 60 min est marqué `OFFLINE` et un email part.

```bash
# Coupe le simulateur pendant 65 minutes
python scripts/katara_simulator.py --config devices.json --simulate-offline 65
```

| # | Vérification | Attendu |
|---|--------------|---------|
| 1 | Après 60+ min : CRON `katara_offline_detector` tourne | ✅ Logs : "marked N devices OFFLINE" |
| 2 | `select status from m1_katara_devices where id = '<dev>'` | ✅ `OFFLINE` |
| 3 | Dashboard | ✅ Badge rouge "Hors ligne depuis Xh" |
| 4 | Inbox farmer | ✅ Mail "Capteur déconnecté" |
| 5 | Relance le simulateur (`--interval 15`) | ✅ Au 1er ingest : `status` repasse `ACTIVE` |

⚠ Pour gagner du temps en dev, baisse temporairement le seuil offline dans le CRON (ex. 5 min au lieu de 60).

---

## 8. KAT-12 & KAT-13 — Unlink / relink + historique préservé

**Goal** : un device unlink ne peut plus ingest, mais l'historique reste consultable ; relink possible sur une autre parcelle.

| # | Action | Attendu |
|---|--------|---------|
| 1 | Compte total avant : `select count(*) from m1_katara_telemetry where device_id = '<dev>'` | (mémoriser N) |
| 2 | UI → bouton "Détacher" sur le device | ✅ 200, statut → `UNLINKED` |
| 3 | Relance le simulateur sur ce device | ✅ 401 sur **chaque** envoi (api_key invalidée mécaniquement) |
| 4 | Page historique (KAT-13) | ✅ Les N rows sont toujours visibles, libellées "Capteur détaché le X" |
| 5 | Crée une 2ᵉ parcelle, refais le pairing avec le même `device_id` physique | ✅ Nouvelle ligne `m1_katara_devices`, **nouvelle** api_key |
| 6 | Mets la nouvelle api_key dans `devices.json`, relance simulateur | ✅ 204, télémétrie sur la **nouvelle** parcelle (l'ancienne ne reçoit plus rien) |
| 7 | 🔒 `select count(*) from m1_katara_telemetry where device_id = '<old-uuid>'` | ✅ Inchangé (append-only, jamais de delete) |

---

## 9. KAT-14 — Multi-parcelles

**Goal** : un farmer avec plusieurs parcelles voit une vue agrégée.

| # | Action | Attendu |
|---|--------|---------|
| 1 | Crée une 3ᵉ parcelle, appaire `ESP-KAT-003`, ajoute dans `devices.json` | — |
| 2 | Lance simulateur **multi-device** sur les 3 devices | ✅ 3 streams en parallèle |
| 3 | `/katara` (overview) | ✅ Tile par parcelle, chacune avec dernier relevé + état (OK / alerte / offline) |
| 4 | `select * from m1_katara_farmer_overview where farmer_id = '<uuid>'` | ✅ 3 rows, un par parcelle |

---

## 10. 🔒 Tests de sécurité transversaux

Ces tests **doivent** passer avant tout demo / mise en production.

| # | Test | Comment | Attendu |
|---|------|---------|---------|
| 1 | Service-role key non exposée frontend | `grep -R "SUPABASE_SERVICE_ROLE_KEY" frontend/` | ✅ Aucun match |
| 2 | API key device jamais loggée | Dans le terminal uvicorn : `Get-History` ou redirige la sortie `> backend.log` puis `Select-String "vk_[A-Za-z0-9]{4,}" backend.log` | ✅ Aucun match |
| 3 | Rate-limit NGINX sur `/api/v1/katara/ingest` | `for i in {1..20}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST <url> -H "X-Device-Id: x" -H "X-Device-Api-Key: y" -d '{}'; done` | ✅ 429 à partir du 11ᵉ |
| 4 | RLS forcée sur `m1_katara_telemetry` | `select relrowsecurity, relforcerowsecurity from pg_class where relname='m1_katara_telemetry'` | ✅ `t, t` |
| 5 | `m1_katara_ingest` exécutable uniquement par service_role | `\df+ public.m1_katara_ingest` | ✅ Seul `service_role` listé dans Access privileges |
| 6 | Pas de policy INSERT/UPDATE/DELETE sur télémétrie | `select * from pg_policies where tablename='m1_katara_telemetry'` | ✅ Seulement les 2 SELECT (`select_own`, `admin_select`) |

---

## 11. Performance — gate avant demo

```bash
# Locust déjà fourni — exige p50 < 50 ms / p99 < 150 ms / 0 failure
LOAD_TARGET=http://localhost:8000 \
DEVICE_ID=ESP-KAT-001 \
DEVICE_API_KEY=<vk_...> \
locust -f load/kat03_ingest.py --headless -u 50 -r 10 -t 60s --csv=ingest
```

Cf. [docs/stories/KAT-03-esp32-telemetry-ingestion.md §5.8](./stories/KAT-03-esp32-telemetry-ingestion.md) pour le détail des critères.

---

## 12. Cleanup après session de test

```sql
-- Reset complet du tenant test (ATTENTION : seulement en dev)
delete from m1_katara_telemetry      where farmer_id = '<test-uuid>';
delete from m1_katara_ai_diagnostics where farmer_id = '<test-uuid>';
delete from m1_katara_alert_thresholds where parcel_id in
       (select id from m1_katara_parcels where farmer_id = '<test-uuid>');
delete from m1_katara_devices        where farmer_id = '<test-uuid>';
delete from m1_katara_parcels        where farmer_id = '<test-uuid>';
```

---

## 13. Tests de robustesse souvent oubliés

Ces tests "non-fonctionnels" tombent rarement dans le scope d'une story KAT-*, mais leur absence se voit en demo.

| # | Test | Comment | Attendu |
|---|------|---------|---------|
| 1 | Brevo en panne (mauvaise API key) | Stoppe le worker thresholds, relance-le avec `$env:BREVO_API_KEY="bad"; python -m app.workers.katara_threshold` puis déclenche alerte | ✅ Le worker logge l'erreur mais **n'empêche pas** l'insert de télémétrie (le ingest path n'appelle pas Brevo) |
| 2 | Gemini en panne / quota dépassé | Relance le worker diagnostic avec `$env:GEMINI_API_KEY="invalid"`, demande un diagnostic | ✅ Le diagnostic passe à `FAILED` (pas `RUNNING` perpétuel), un mail "diagnostic indisponible" est envoyé |
| 3 | Expiration JWT pendant le backfill | Lance `--backfill-days 30` (long), laisse passer 1 h | ✅ Le simulateur n'utilise pas de JWT (auth via device key) — donc aucun impact. C'est précisément pourquoi KAT-03 n'utilise pas JWT. |
| 4 | Reload backend pendant le stream | Ctrl+C sur uvicorn puis relance-le pendant que le simulateur tourne | ✅ Le simulateur logge quelques `ConnectionError`, reprend dès que le backend revient (pas de crash) |
| 5 | Migration appliquée pendant le stream | (Scénario réel : hot-patch en prod) | ✅ Aucune perte de payload — le simulateur retry |
| 6 | Race au pairing | 2 onglets pairent le même `device_id` exactement en même temps | ✅ Un seul succès, l'autre reçoit 409 (unique partial index gagne) |
| 7 | Caractères UTF-8 dans le nom de parcelle | Crée "Parcelle d'Aïcha — قطعة" | ✅ Affichage correct dans dashboard + mails (encoding `utf-8` partout) |
| 8 | Frontend hors-ligne | DevTools → Network → Offline, navigue dans `/katara` | ✅ Message clair, pas d'écran blanc |
| 9 | DST / fuseau horaire | Change l'heure du PC en `Africa/Casablanca` vs `UTC` | ✅ Les charts affichent l'heure locale, mais la DB stocke UTC (`select recorded_at at time zone 'utc'`) |
| 10 | Reset password farmer | `/forgot-password` → mail → set new → re-login | ✅ Conserve `verification_status=VERIFIED` |

---

## 14. Critères de "ready for demo"

Avant de présenter Katara à un jury / client, ces points DOIVENT être verts :

- [ ] §0 setup complet sans tricher (KYC officielle au moins 1×, pas le raccourci SQL)
- [ ] §3 happy path tourne pendant 1 h sans erreur
- [ ] §5 a déclenché ≥ 1 mail Brevo réel, reçu dans une vraie inbox
- [ ] §6 a généré ≥ 1 diagnostic IA complet (texte Gemini visible et lisible en FR)
- [ ] §7 simulation offline → mail reçu
- [ ] §10 — **tous** les tests 🔒 passent (rate-limit, RLS, no-leak, service-role isolation)
- [ ] §11 Locust : p50 < 50 ms / p99 < 150 ms / 0 failure
- [ ] §13 #1 + #2 : la stack survit à une panne Brevo et une panne Gemini sans 500 visible côté farmer
- [ ] Test pratique : un évaluateur externe (non-développeur) suit ce guide jusqu'à §6 sans aide → réussit
- [ ] Cleanup §12 testé pour pouvoir reset la demo entre deux passages

---

## Matrice de couverture

| Story  | Couvert par section | Sans device physique ? |
|--------|---------------------|------------------------|
| KAT-01 | §1                  | ✅ (UI seulement) |
| KAT-02 | §2                  | ✅ (device_id est juste une string) |
| KAT-03 | §3                  | ✅ via simulateur |
| KAT-04 | §4                  | ✅ (`--backfill-days`) |
| KAT-05 | §5                  | ✅ (`--mode alert-*`) |
| KAT-06 | §5                  | ✅ (Brevo sandbox) |
| KAT-07 | §6                  | ✅ |
| KAT-08 | §6                  | ✅ (besoin du backfill 7j) |
| KAT-09 | §6                  | ✅ |
| KAT-10 | §6                  | ✅ |
| KAT-11 | §7                  | ✅ (`--simulate-offline`) |
| KAT-12 | §8                  | ✅ |
| KAT-13 | §8                  | ✅ |
| KAT-14 | §9                  | ✅ (3+ devices simulés) |

**Le seul angle que le simulateur ne couvre pas** : latence WiFi/GSM réelle, drops réseau intermittents, calibration capteur, consommation batterie. À tester quand le hardware arrive.
