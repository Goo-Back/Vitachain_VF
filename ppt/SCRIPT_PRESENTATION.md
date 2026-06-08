# Script de présentation — VitaChain
**Durée cible : 25 min (présentation) + 10 min (Q&A)**
**25 slides**

> Conseils de timing : 1 slide ≈ 60 s en moyenne ; les slides "preuve" (code) prennent 90 s, les transitions (dividers) 15 s.

---

## INTRO — 3 min

### 🎬 Slide 1 — Couverture (30 s)
> Bonjour, je m'appelle Yasser et je vais vous présenter aujourd'hui **l'état d'avancement technique de VitaChain**, une plateforme agricole connectée qui combine **IoT, IA et logistique**.
>
> La présentation se décompose en trois axes techniques : la **base de données**, le couple **backend / frontend**, et la **sécurité** — avec à chaque fois des preuves tirées directement du code en production.

**Action** : afficher la slide quelques secondes, laisser le titre s'imprégner.

---

### 🎬 Slide 2 — Sommaire (45 s)
> Voici le plan : on commence par cinq minutes de contexte sur l'architecture globale et les modules métier. Ensuite on attaque les trois axes techniques — la base, le back/front, la sécurité — chaque axe étant ponctué de **slides "preuve"** où je vous montrerai des extraits de code réels.
>
> On termine par une démo live et la roadmap. Comptez à peu près 25 minutes au total, et je garde 10 minutes pour vos questions.

**Pause** : "Pas de questions sur le plan ? On démarre."

---

### 🎬 Slide 3 — Architecture globale (60 s)
> VitaChain repose sur **quatre couches** très classiques mais avec un choix structurant : on s'appuie à fond sur **Supabase** côté base, et FastAPI côté backend.
>
> — En bas, **PostgreSQL 15** managé par Supabase. C'est lui qui porte la sécurité (RLS), l'authentification, et le stockage.
> — Au-dessus, **FastAPI** en Python : 16 routers REST, et surtout **7 workers asynchrones** qui réagissent en temps réel via LISTEN/NOTIFY.
> — Encore au-dessus, **Next.js 15 avec React 19** — App Router, Server Components, et un middleware Edge pour l'auth.
> — Tout en haut, les clients : navigateurs et capteurs ESP32 qui envoient leur télémétrie.

**Point fort** : insister sur "une seule plateforme, mais 4 couches étanches".

---

### 🎬 Slide 4 — Modules métier & métriques (60 s)
> La plateforme est organisée en **modules métier indépendants** — c'est ce qui m'a permis d'avancer story par story sans tout casser.
>
> À gauche, les quatre modules : **AUTH** pour l'authentification et la vérification KYC, **KAT** pour Katara — toute la partie IoT terrain — **FAR** pour FarMarket — la marketplace logistique — et **SCN** pour SecondServe, qui arrivera après le PFE.
>
> À droite, les chiffres clés en l'état actuel :
> - **40 migrations SQL** versionnées et idempotentes,
> - **54 policies RLS** — donc 100% des tables sensibles sont protégées,
> - **63 fonctions et triggers SQL** custom,
> - **74 fichiers Python** côté backend,
> - **25 pages Next.js**, et
> - plus de **200 fichiers de tests** entre back et front.

**Effet** : "ces chiffres ne sont pas des estimations, ils sortent directement de `git ls-files` et `grep`."

---

## AXE 01 — BASE DE DONNÉES — 6 min

### 🎬 Slide 5 — Divider 01 (15 s)
> On entre dans le premier axe : **la base de données**. Je vais vous montrer comment les migrations sont organisées, le modèle de données, et surtout **deux preuves techniques** : un event trigger qui rend la RLS obligatoire, et le hook PL/pgSQL qui enrichit le JWT à la connexion.

---

### 🎬 Slide 6 — Migrations versionnées (75 s)
> Le schéma de la base est versionné dans **40 fichiers SQL** numérotés. Chaque fichier représente un changement atomique, lié à une story.
>
> On les a regroupés en trois grandes époques : **AUTH** (les 15 premières — profiles, KYC, JWT, contrats RLS), **Katara** (les 16 suivantes — parcelles, devices, télémétrie, IA), et **FarMarket** (les 11 dernières — annonces, commandes, tracking).
>
> Les bonnes pratiques appliquées : **idempotence systématique** (tout est `IF NOT EXISTS` ou `CREATE OR REPLACE`), un format de nom strict, et un commentaire d'en-tête qui rappelle la story et la justification.
>
> Et côté CI, **trois garde-fous** : un test pgSQL qui assert sur l'état du schéma, un script shell qui refuse les tables sans RLS, et un event trigger Postgres que je vais vous détailler dans deux slides.

---

### 🎬 Slide 7 — Modèle de données (90 s)
> À gauche, les **tables principales** par module. Vous remarquerez le préfixage `m1_` pour Katara et `m2_` pour FarMarket — ça scope la base par module et facilite la lecture.
>
> Quelques choix techniques que je veux souligner à droite :
>
> — **Index uniques partiels** : par exemple, "un ESP32 = une parcelle active", mais on autorise le re-pairing après unlink. C'est exactement ce que fait un `unique index ... where status <> 'UNLINKED'`.
>
> — **NOTIFY canaux** : on diffuse `telemetry_inserted`, `threshold_breach`, `order_status_changed`. Les workers backend écoutent ces canaux en direct.
>
> — **Vues SECURITY INVOKER** : c'est crucial — ça force la vue à hériter de la RLS de celui qui l'appelle. Le défaut, SECURITY DEFINER, aurait bypassé la RLS. C'est un fix qu'on a appliqué dans KAT-13 après revue.
>
> — Et le **snapshot pricing** sur order_items : quand on commande, le prix est figé dans la ligne — comme ça, si un farmer édite son ad après, ça ne change rien pour la commande.

---

### 🎬 Slide 8 — PREUVE 1 — Event trigger RLS (90 s)
> **Première preuve technique.** Le problème classique : un dev oublie d'ajouter `ENABLE ROW LEVEL SECURITY` sur une nouvelle table. Résultat : les données sont publiques. Le test CI peut passer à côté.
>
> Notre solution, c'est trois lignes de défense. Les deux premières — test pgSQL et script shell — sont externes. La troisième, et c'est la plus puissante, est **dans la base elle-même**.
>
> Regardez à droite : on définit un **event trigger Postgres** qui s'exécute sur `ddl_command_end` pour tous les `CREATE TABLE`. La fonction vérifie `pg_class.relrowsecurity` — c'est le flag réel — et si la RLS n'est pas activée, **`raise exception`** et la transaction est annulée.
>
> Conséquence : même si quelqu'un crée une table via le SQL editor du dashboard Supabase, sans passer par les migrations, la base elle-même refuse. C'est ce que j'appelle un garde-fou **non contournable**.

---

### 🎬 Slide 9 — PREUVE 2 — JWT hook (90 s)
> **Deuxième preuve.** Sans cette astuce, chaque évaluation de policy RLS devrait faire `SELECT role FROM profiles WHERE id = auth.uid()` — un lookup par évaluation, et il y en a beaucoup.
>
> Avec le hook : zéro lookup, le rôle est dans le token.
>
> Le code PL/pgSQL est simple : à chaque émission de token, Supabase appelle notre fonction `custom_access_token_hook`. On lit le `user_id`, on récupère le rôle dans `profiles`, et on ajoute la claim `user_role` au JWT.
>
> Trois subtilités :
> 1. **Défensive** : si le profil n'existe pas, on retourne l'event tel quel — pas de 500 côté Auth.
> 2. **Verrouillage** : seul `supabase_auth_admin` peut exécuter la fonction. Tout le reste — anon, authenticated, public — est révoqué explicitement.
> 3. Le `search_path` est forcé à `public, pg_temp` pour empêcher une injection de schéma.
>
> À droite, l'effet observable : on voit le `user_role` directement dans le payload JWT après login. Les policies RLS peuvent alors faire `WHERE has_role('FARMER')` sans round-trip.

---

### 🎬 Slide 10 — Flux temps réel & anonymisation (75 s)
> Deux mécanismes pour finir cet axe.
>
> **En haut**, le pipeline télémétrie. L'ESP32 fait POST sur `/ingest`, FastAPI appelle une RPC SQL en SECURITY DEFINER qui fait tout d'un coup : vérif bcrypt, insert, et `NOTIFY katara_telemetry_inserted`. Le worker écoute en direct via asyncpg LISTEN, évalue les seuils, et envoie une notification si dépassement. **Latence mesurée : moins de 100 ms** de bout en bout — vs 1 à 5 secondes en polling classique.
>
> **En bas**, un détail métier important : sur FarMarket, le farmer ne doit **pas** voir l'identité du restaurant qui commande, mais doit pouvoir traiter ses items. La solution : la table `orders` n'a **aucune** policy SELECT pour les farmers — direct query, zéro ligne. À la place, ils accèdent à la vue `v_farmer_incoming_items` qui projette un `resto_handle` opaque, calculé comme un SHA-256 du couple (restaurant_id, farmer_id). C'est anonyme mais cohérent dans le temps.

---

## AXE 02 — BACKEND & FRONTEND — 9 min

### 🎬 Slide 11 — Divider 02 (15 s)
> Deuxième axe : **le backend FastAPI et le frontend Next.js**. Trois preuves techniques au menu : l'endpoint d'ingestion ultra-rapide, le pipeline IA, et le middleware d'authentification côté Edge.

---

### 🎬 Slide 12 — Backend stack + routers + workers (90 s)
> Vue d'ensemble du backend en trois colonnes.
>
> **La stack** : FastAPI 0.115, Pydantic v2 pour la validation stricte, **deux clients DB** — supabase-py pour PostgREST et asyncpg en direct pour le LISTEN/NOTIFY. Bcrypt pour les clés device. Jinja2 avec **autoescape** pour les prompts IA — c'est anti prompt-injection. Et le SDK Google pour Gemini 1.5 Flash.
>
> **16 routers REST** au centre — vous voyez la séparation : auth/KYC, devices Katara, ingest, diagnostics IA, overview farmer, FarMarket, admin, notifications.
>
> Et à droite, **7 workers asynchrones** — chacun est un process séparé, ce qui me permet de scaler indépendamment. Le worker `katara_threshold` écoute les inserts de télémétrie, `katara_diagnostic` orchestre le pipeline IA, `farmarket_expiry` expire les annonces dépassées, etc.

---

### 🎬 Slide 13 — PREUVE 3 — Ingest hot path (90 s)
> **Troisième preuve.** L'endpoint d'ingestion télémétrie a un SLA strict : **moins de 50 ms en p50**. C'est le hot path — l'ESP32 envoie une mesure toutes les 15 minutes, et avec des milliers de devices ça doit absorber.
>
> Regardez le code : c'est volontairement **minimaliste**. On lit deux headers, on parse le body, on fait **un seul appel DB** — la RPC `m1_katara_ingest`. Cette RPC fait dans une seule transaction : verify bcrypt + insert telemetry + touch device.last_seen + NOTIFY. Un seul round-trip réseau.
>
> Trois décisions clés à droite :
> 1. **Auth par device, pas par user** — l'ESP32 n'a pas de JWT. Headers `X-Device-Id` + `X-Device-Api-Key`.
> 2. **service-role client** — c'est l'un des deux seuls callsites autorisés à utiliser le service_role, parce que la table est en FORCE RLS et n'a aucune INSERT policy. C'est documenté et testé.
> 3. **Erreur constante** `invalid_device_credentials` — on ne dit jamais lequel des deux champs est faux. C'est de l'anti-énumération : sinon un attaquant pourrait deviner les device_ids existants.

---

### 🎬 Slide 14 — PREUVE 4 — Pipeline IA (90 s)
> **Quatrième preuve.** Quand un farmer demande un diagnostic, on enchaîne **6 étapes** : claim (avec FOR UPDATE SKIP LOCKED pour éviter le double-traitement), récupération de la météo via OpenWeather, calcul du NDVI sur une image Sentinel-2 — c'est un TIFF float32 qu'on lit avec numpy — agrégation de la télémétrie sur 7 jours, build du prompt Jinja2, et enfin appel à Gemini.
>
> Le code à gauche montre la structure : **chaque étape est dans un try/except indépendant** avec une raison d'échec précise. Si OWM tombe, on marque le row `FAILED` avec `owm_unavailable`. Si Gemini est rate-limité, c'est `gemini_rate_limited`. C'est une **taxonomie d'erreurs explicite** — pour debug, et pour les métriques.
>
> Sur la droite, un choix qu'on m'a souvent questionné : **pourquoi séquentiel et pas en parallèle ?** La réponse : Gemini domine la latence (5 à 15 secondes). Un `asyncio.gather` ferait gagner à peine 100 ms, au prix d'un raisonnement bien plus complexe sur les modes d'échec. Tradeoff lisibilité contre micro-perf.
>
> Et tout en bas : **autoescape Jinja2** activé. Une donnée utilisateur avec `<script>` ne pourra pas s'évader du prompt — c'est de la défense préventive contre la prompt-injection.

---

### 🎬 Slide 15 — Frontend stack (75 s)
> Côté frontend : **Next.js 15.1 avec App Router**, donc React 19 et Server Components. TypeScript en mode strict, Tailwind v4, et le wrapper officiel `@supabase/ssr` pour gérer les cookies.
>
> L'architecture est segmentée **par rôle** : `/dashboard/farmer`, `/restaurant`, `/admin`. Le middleware redirige automatiquement.
>
> Côté qualité : **161 fichiers de tests** — Vitest, Testing Library — type-check CI obligatoire, et Sentry qui remonte les source-maps pour débugger les erreurs prod côté navigateur.
>
> En bas, les **écrans livrés** par rôle. Côté farmer, le plus dense : carte Leaflet pour dessiner les parcelles GeoJSON, gestion des devices, télémétrie temps réel, diagnostics IA, et configuration des seuils d'alerte.

---

### 🎬 Slide 16 — PREUVE 5 — Middleware (90 s)
> **Cinquième preuve.** Le middleware tourne à l'**Edge** — donc très près de l'utilisateur, latence minimale.
>
> Trois choses qu'il fait :
> 1. **Refresh des cookies** Supabase via `setAll` — c'est le pattern canonique recommandé, et il est fragile : retirer une ligne casse silencieusement le refresh.
> 2. **Auth gate** : si la route commence par `/dashboard` ou `/admin` et qu'il n'y a pas de user, redirect vers `/login?next=...`.
> 3. **Verification gate** — la partie la plus subtile. Sur les routes "pro" (`/farmarket/new`), on décode manuellement le JWT côté Edge — pas de DB call — pour lire la claim `verification_status`. Si l'utilisateur est un pro non vérifié, on le renvoie vers l'onboarding KYC.
>
> Et à droite, une nuance importante : **le middleware n'est pas la sécurité**. C'est de l'UX — éviter qu'un user voie une page qu'il ne devrait pas. La vraie sécurité, ce sont les deux couches en bas : la RLS Postgres en lecture/écriture, et la dépendance `require_verified()` côté FastAPI. Si on contourne le middleware, la base refuse de toute façon.

---

### 🎬 Slide 17 — Communication Front ↔ Back (60 s)
> Deux canaux complémentaires, c'est un choix architectural important.
>
> **Canal 1** — direct Supabase : le frontend parle à PostgREST. JWT propagé par cookies, RLS appliquée côté base. **C'est la majorité du trafic** : listes d'annonces, lectures de parcelles, upload de fichiers. Pas de boilerplate.
>
> **Canal 2** — FastAPI : pour la logique métier complexe et les intégrations. Pairing d'un device — il faut générer le secret côté serveur et le hasher. Déclencher un diagnostic IA — c'est un workflow. Modération KYC — transitions d'état.
>
> Règle : **on n'utilise FastAPI que là où Supabase direct ne suffit pas**. Ça évite la duplication.

---

## AXE 03 — SÉCURITÉ — 6 min

### 🎬 Slide 18 — Divider 03 (15 s)
> Troisième axe : **la sécurité**, conçue dès le début en défense en profondeur. Deux preuves techniques pour cet axe : le bcrypt sur les clés device et une vraie policy RLS en production.

---

### 🎬 Slide 19 — 4 piliers (75 s)
> Quatre piliers couvrent les quatre niveaux du stack.
>
> **AUTH** — authentification : Supabase Auth en email/password, JWT HS256, cookies HttpOnly. Un trigger SQL bloque même la possibilité de s'inscrire avec le rôle admin — la création se fait par script CLI.
>
> **AUTHZ** — autorisation : c'est le hook JWT qu'on a vu, la fonction `has_role()`, et les **54 policies RLS** sur la totalité des tables. Toutes en **FORCE ROW LEVEL SECURITY** — pas de bypass, même pour le owner de la table.
>
> **DATA** — données : buckets Storage séparés selon la sensibilité, audit guards SQL qui lèvent des exceptions si on tente d'insérer en bypassant les RPC, et la fameuse allowlist des callsites service_role.
>
> **DEVICES** — IoT : clé 128 bits, hashée bcrypt cost 10, affichée une seule fois au pairing, vérifiée en constant-time côté Postgres. Et on peut rotate ou unlink à tout moment.

---

### 🎬 Slide 20 — PREUVE 6 — Bcrypt + pgcrypto (90 s)
> **Sixième preuve.** Le cycle de vie de la clé device, en deux halves.
>
> **À gauche, côté Python** : on génère un secret `vk_` suivi de 32 hex (128 bits d'entropie via `secrets.token_hex`). On le hashe avec bcrypt cost 10 — environ 10 ms sur notre VPS. Petite subtilité : Python bcrypt émet le préfixe `$2b$`, mais pgcrypto attend `$2a$`. Mêmes algorithmes, juste le préfixe diffère — donc on substitue. Et on stocke aussi les 4 derniers caractères pour l'UI, parce qu'on ne reverra jamais le plaintext.
>
> **À droite, côté SQL** : la fonction `verify_device_api_key` utilise `extensions.crypt(p_api_key, d.api_key_hash)`. `crypt()` recompute bcrypt avec le même salt et le même cost, et compare **en constant-time** au niveau C dans pgcrypto. Pas de leak par timing attack.
>
> Verrouillage final : `REVOKE all from public; GRANT execute to service_role`. **Seul l'ingest backend peut appeler cette fonction.**

---

### 🎬 Slide 21 — PREUVE 7 — RLS policy (90 s)
> **Septième et dernière preuve.** Une vraie policy RLS, telle qu'elle est en prod, sur la table devices.
>
> Elle vérifie **quatre conditions cumulatives** à chaque INSERT :
> 1. `auth.uid() = farmer_id` — anti-spoofing, on ne peut pas créer un device au nom d'un autre farmer.
> 2. `has_role('FARMER')` — la claim du JWT, pas un lookup.
> 3. Le `verification_status` est `VERIFIED` — sous-select dans `profiles`.
> 4. La parcelle visée appartient bien au caller — EXISTS sur `m1_katara_parcels`.
>
> Si l'une de ces quatre conditions échoue, l'INSERT renvoie zéro ligne. Pas d'erreur 403 — **zéro ligne**, ce qui évite de leak l'existence des objets.
>
> Et bien sûr, le code Python valide **les mêmes conditions**. C'est la défense en profondeur : deux barrières indépendantes, l'une peut tomber sans leak.

---

### 🎬 Slide 22 — Surface d'attaque (75 s)
> Sept risques identifiés, sept contre-mesures déjà en place :
>
> - **Vol de clé device** → jamais en clair, rotate dispo.
> - **Prompt injection Gemini** → Jinja2 autoescape.
> - **Élévation via signup** → trigger bloque l'auto-admin.
> - **Leak KYC** → bucket privé, signed URLs.
> - **Bypass RLS** → FORCE RLS impossible à contourner.
> - **Énumération par timing** → erreur constante + constant-time compare.
> - **XSS / CSRF** → React escape, cookies HttpOnly SameSite, CORS strict.
>
> Je ne dis pas qu'il n'y a aucune vulnérabilité — un audit externe est dans la roadmap. Mais chaque risque connu a une mitigation **explicite et documentée**.

---

### 🎬 Slide 23 — Tests & garde-fous (60 s)
> Ce qui empêche une régression de passer en prod :
>
> **Côté Postgres** : tests pgSQL qui assertent sur l'état du schéma — RLS activée, policies présentes, etc. Et des scénarios cross-farmer pour vérifier qu'un farmer ne voit pas les données d'un autre.
>
> **Côté Python** : 41 fichiers de tests. Le plus intéressant : `test_service_client_callsite_allowlist.py` qui **grep tous les usages de `service_role`** dans le code, et fail si un callsite n'est pas listé explicitement avec sa justification. Ça empêche un dev d'ajouter discrètement un bypass RLS.
>
> **Côté CI** : ruff + mypy strict en Python, tsc --noEmit en TypeScript, et Sentry en prod pour les erreurs inattendues.

---

## CONCLUSION — 2 min

### 🎬 Slide 24 — Roadmap (75 s)
> Pour finir, ce qui reste à faire.
>
> **Court terme**, 2-3 semaines : finir les stories Katara restantes (le schéma pH/EC évolue), terminer FAR-11 à FAR-13 — factures PDF et gestion des litiges — et automatiser le déploiement Vercel + Fly.io.
>
> **Moyen terme**, 1-2 mois : ouvrir le chantier SecondServe — récupération d'invendus — passer en PWA mobile, et compléter l'internationalisation AR/EN.
>
> **Industrialisation** : un audit sécurité externe est prévu, ainsi qu'un setup Grafana/Prometheus pour le monitoring et des backups Postgres testés régulièrement.

---

### 🎬 Slide 25 — Merci / Q&A (15 s)
> Voilà ! Merci pour votre attention. Si vous voulez, on peut maintenant passer à la **démo live** : pairing d'un ESP32, télémétrie temps réel, diagnostic IA, et le cycle complet d'une commande FarMarket.
>
> Sinon, je suis prêt pour vos questions.

---

## 🎯 Questions fréquentes — réponses préparées

| Question probable | Réponse courte |
|---|---|
| Pourquoi Supabase et pas un Postgres standard ? | Gain de temps énorme sur Auth + Storage + Realtime ; on garde la portabilité car tout est Postgres pur (migrations SQL, RLS standard). Migration possible vers un Postgres self-hosted en 1-2 jours. |
| Pourquoi pas un message broker (Kafka/Rabbit) ? | LISTEN/NOTIFY suffit à notre échelle (< 100k devices). Pas de complexité opérationnelle supplémentaire. Migration vers Redis Streams/Kafka possible si besoin. |
| Comment scalez-vous le bcrypt cost=10 si vous avez 100k devices ? | Le bcrypt ne fire QUE au pairing (rare) et à la vérification (15 min). Avec un pool asyncpg + workers Postgres, ~1000 verify/s par node. Largement suffisant. |
| Pourquoi Gemini et pas un modèle self-hosted ? | Latence/qualité supérieures pour le français, coût négligeable au volume actuel. Le pipeline est designed pour switcher (juste `call_gemini` à remplacer). |
| Comment gérez-vous les RGPD / données personnelles ? | KYC dans bucket privé, anonymisation FarMarket via `resto_handle`, droit à l'effacement via cascade `on delete` sur profiles. Audit pen-test prévu. |
| Pourquoi PostGIS pas utilisé pour les parcelles ? | GeoJSON + numpy suffisent pour notre besoin (centroïde, NDVI). PostGIS ajoutable plus tard pour des requêtes spatiales avancées (ex: "parcelles dans un rayon"). |
| Avez-vous fait du load testing ? | Le dossier `load/` contient des scripts k6 pour l'ingest. Validé > 1000 req/s sur un node de dev. Pas encore stressé en charge soutenue. |
| Comment versionnez-vous le firmware ESP32 ? | Repo séparé, build Arduino. OTA est dans la roadmap "industrialisation". |

---

## 🛠️ Pense-bête démo live

**Avant de démarrer la démo, vérifier :**
- [ ] Backend FastAPI tourne : `cd backend && uvicorn app.main:app --reload`
- [ ] Frontend Next.js tourne : `cd frontend && npm run dev`
- [ ] DB Supabase accessible (env vars chargées)
- [ ] Un ESP32 simulé prêt (ou script Python qui POST sur `/ingest`)
- [ ] Compte farmer VERIFIED + compte restaurant + compte admin
- [ ] Au moins une parcelle existante avec des données de télémétrie

**Scénario démo (8 min max) :**
1. **Login farmer** → dashboard → carte des parcelles (montrer le GeoJSON Leaflet) — 1 min
2. **Pair un nouveau ESP32** → montrer la clé `vk_...` affichée 1 seule fois — 1 min
3. **Lancer le simulateur** qui POST une donnée → la télémétrie apparaît live — 1 min
4. **Cliquer "Demander un diagnostic IA"** → attendre le pipeline (~10 s) → montrer la réponse Gemini en Markdown — 2 min
5. **Switcher sur compte restaurant** → catalogue FarMarket → ajouter au panier → passer commande — 2 min
6. **Switcher sur compte farmer** → notification reçue → voir `resto_handle` opaque (pas l'identité du resto) — 1 min

**Fallback si la démo plante :**
- Screenshots préparés dans `docs/screenshots/`
- Vidéo de secours dans `docs/demo-video.mp4`

---

*Dernière mise à jour : 2026-05-25*
