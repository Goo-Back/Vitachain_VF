# VitaChain — Rapport de Projet de Fin d'Études

---

# Chapitre 1 : Cahier des charges

## 1.1 Introduction

Dans un contexte mondial marqué par des défis croissants liés à la sécurité alimentaire, à la durabilité agricole et à la gestion des ressources naturelles, les technologies numériques et l'Internet des objets (IoT) offrent des opportunités sans précédent pour transformer les pratiques du secteur agroalimentaire. Le présent rapport documente la conception, l'analyse et la réalisation de **VitaChain**, une plateforme numérique intégrée dédiée à l'agriculture intelligente et à la chaîne d'approvisionnement alimentaire au Maroc.

Ce premier chapitre établit le cadre général du projet à travers une présentation du contexte, des problématiques identifiées, des objectifs visés et des besoins fonctionnels et non fonctionnels auxquels la solution doit répondre.

---

## 1.2 Contexte du projet

Le secteur agricole marocain représente une composante stratégique de l'économie nationale. Cependant, les agriculteurs marocains, en particulier les petits et moyens exploitants, font face à des difficultés structurelles : manque d'accès aux données agronomiques en temps réel, absence de canaux directs vers les acheteurs professionnels, et gaspillage alimentaire important dans la restauration et la grande distribution.

VitaChain s'inscrit dans le cadre des initiatives de transformation numérique du secteur agricole. Le projet vise à proposer un écosystème numérique unifié combinant :

- **La surveillance IoT des parcelles agricoles** via des capteurs de sol connectés (module Katara).
- **Une place de marché agricole directe** entre agriculteurs et restaurateurs (module FarMarket).
- **Une solution anti-gaspillage alimentaire** permettant aux restaurants de redistribuer leurs surplus aux citoyens (module SecondServe).
- **Un panneau d'administration centralisé** pour la gouvernance de la plateforme.

Le projet est réalisé dans le cadre d'un Projet de Fin d'Études (PFE) en ingénierie logicielle, avec une architecture orientée production déployée sur un VPS Linux avec PostgreSQL, FastAPI, Next.js et Supabase.

---

## 1.3 Présentation du problème

Plusieurs problèmes structurels freinent le développement du secteur agroalimentaire marocain :

**1. Manque d'informations agronomiques en temps réel**
Les agriculteurs prennent leurs décisions d'irrigation et de fertilisation sur la base d'observations empiriques, sans disposer de données précises sur l'état du sol (humidité, température, pH, conductivité). Cela entraîne une surconsommation d'eau et d'intrants, réduisant les rendements et augmentant les coûts.

**2. Désintermédiation insuffisante dans la chaîne alimentaire**
La chaîne de distribution agricole au Maroc repose sur des intermédiaires traditionnels (grossistes, souk), qui captent une part importante de la valeur ajoutée au détriment des agriculteurs. Les restaurateurs, de leur côté, ont du mal à s'approvisionner directement auprès de producteurs locaux de confiance.

**3. Gaspillage alimentaire dans la restauration**
Le secteur de la restauration génère des surplus alimentaires considérables chaque jour. En l'absence de canaux adaptés, ces invendus finissent généralement au rebut, alors qu'ils pourraient être redistribués à prix réduit aux citoyens.

**4. Absence de vérification et de traçabilité**
Dans les transactions entre professionnels (agriculteurs et restaurateurs), il n'existe pas de mécanisme fiable de vérification d'identité et de statut professionnel, ce qui génère une méfiance et freine les échanges.

---

## 1.4 Motivation du projet

La motivation principale de VitaChain est de proposer une solution technologique holistique qui s'attaque simultanément à ces quatre problèmes à travers une architecture modulaire, extensible et sécurisée.

Les motivations spécifiques sont :

- **Impact social et environnemental** : réduction du gaspillage alimentaire, optimisation de l'usage de l'eau et des engrais, création de liens directs entre producteurs et acheteurs.
- **Modernisation agricole** : adoption de l'agriculture de précision grâce à des capteurs IoT accessibles aux agriculteurs marocains.
- **Inclusion économique** : permettre aux petits agriculteurs de valoriser leur production en accédant directement au marché de la restauration.
- **Défi technologique** : concevoir et déployer en production une architecture full-stack moderne intégrant IoT, RLS (Row-Level Security), workers asynchrones, et authentification multi-rôle.

---

## 1.5 Étude de l'existant

Plusieurs solutions numériques existent sur le marché international et national, mais aucune ne couvre l'intégralité du périmètre de VitaChain :

[Tableau 1.1 : Comparaison des solutions existantes]

| Solution | IoT Agricole | Marketplace B2B | Anti-gaspillage | Marché marocain |
|---|---|---|---|---|
| **Agromonitoring** | ✓ | ✗ | ✗ | ✗ |
| **FoodChéri / Too Good To Go** | ✗ | ✗ | ✓ | Partiel |
| **AgriApp** | ✗ | ✓ | ✗ | ✗ |
| **Fellah Trade** | ✗ | ✓ | ✗ | ✓ |
| **VitaChain** | ✓ | ✓ | ✓ | ✓ |

**Limites des solutions existantes :**

- Les solutions IoT agricoles (Agromonitoring, Farmonaut) sont conçues pour des exploitations industrielles avec un coût d'entrée élevé.
- Les marketplaces B2B agricoles marocaines (Fellah Trade) n'intègrent pas de mécanisme de vérification KYC ni de suivi de commande en temps réel.
- Les applications anti-gaspillage (Too Good To Go) ne sont pas adaptées au contexte marocain et ne permettent pas l'intégration avec un écosystème professionnel agricole.
- Aucune solution existante ne propose un tableau de bord de surveillance IoT couplé à une place de marché et une fonctionnalité anti-gaspillage dans une même plateforme.

---

## 1.6 Objectifs du projet

Les objectifs de VitaChain sont organisés en quatre axes :

**Axe 1 — Module Katara (Surveillance IoT)**
- Permettre aux agriculteurs de créer et gérer leurs parcelles agricoles géoréférencées.
- Intégrer des capteurs ESP32 envoyant des données de sol (humidité, température, pH, conductivité électrique) en temps réel.
- Afficher des graphiques d'historique et des alertes déclenchées sur des seuils configurables.
- Fournir des diagnostics agronomiques automatisés via intelligence artificielle (Gemini).
- Intégrer des données météorologiques (OpenWeatherMap) et satellitaires (Sentinel-2 NDVI).

**Axe 2 — Module FarMarket (Marketplace Agricole)**
- Permettre aux agriculteurs vérifiés de publier des annonces de vente de produits agricoles avec photos.
- Permettre aux restaurateurs de parcourir le catalogue, filtrer par région/produit/prix, et passer des commandes.
- Gérer le cycle de vie complet d'une commande (acceptation, suivi, livraison, paiement).
- Protéger la confidentialité des restaurateurs vis-à-vis des agriculteurs (anonymisation).
- Intégrer un système de notation agriculteur par les restaurateurs.

**Axe 3 — Module SecondServe (Anti-gaspillage)**
- Permettre aux restaurants de publier leurs surplus alimentaires sous forme d'offres à prix réduit.
- Permettre aux citoyens de réserver et commander ces offres.
- Assurer la continuité de session entre la plateforme VitaChain et l'application SecondServe via SSO.

**Axe 4 — Gouvernance et Administration**
- Mettre en place un processus de vérification KYC (Know Your Customer) pour les professionnels.
- Permettre aux administrateurs de gérer les utilisateurs, les rôles et les contenus de la plateforme.

---

## 1.7 Périmètre du projet

VitaChain couvre les périmètres fonctionnels suivants :

**Inclus dans le périmètre :**
- Inscription multi-rôle (agriculteur, restaurateur, citoyen, administrateur)
- Vérification d'identité professionnelle (KYC) avec téléchargement de documents
- Module Katara : parcelles, dispositifs IoT, télémétrie, alertes, diagnostics IA
- Module FarMarket : annonces, catalogue, commandes, paiements, évaluations
- Module SecondServe : offres surplus, commandes citoyens, SSO inter-application
- Panneau d'administration : gestion KYC, utilisateurs, modération
- Infrastructure de production : Docker, NGINX, TLS, sauvegardes, monitoring

**Hors périmètre :**
- Module BotaBa9a (surveillance chaîne du froid) : architecture définie, implémentation différée
- Application mobile native (iOS/Android) : non prévue dans ce projet
- Intégration de passerelles de paiement réelles (simulation COD uniquement)
- Gestion logistique propre (livraison par tiers non intégrée)

[Figure 1.1 : Périmètre fonctionnel de VitaChain — diagramme en couches des quatre modules]

---

## 1.8 Acteurs

VitaChain implique quatre types d'acteurs principaux et un acteur système :

[Figure 1.2 : Diagramme des acteurs de VitaChain]

**Acteurs humains :**

| Acteur | Rôle | Description |
|---|---|---|
| **Agriculteur** | FARMER | Producteur agricole. Crée des parcelles, associe des capteurs, publie des annonces, reçoit des commandes. Doit être vérifié (KYC) pour agir en professionnel. |
| **Restaurateur** | RESTAURANT | Acheteur professionnel. Consulte le catalogue, passe des commandes, évalue les agriculteurs, publie des offres surplus. Doit être vérifié. |
| **Citoyen** | CITIZEN | Consommateur final. Consulte et commande des offres surplus via SecondServe. |
| **Administrateur** | ADMIN | Gestionnaire de la plateforme. Approuve les KYC, modère les contenus, gère les utilisateurs et les rôles. |

**Acteur système :**

| Acteur | Description |
|---|---|
| **Dispositif ESP32** | Capteur IoT embarqué. Envoie des données télémétriques de sol via HTTP au backend (authentification par clé d'API). |

---

## 1.9 Besoins fonctionnels

Les besoins fonctionnels sont organisés par module :

### Module Authentification & KYC
- **BF-AUTH-01** : L'utilisateur peut s'inscrire avec une adresse email, un mot de passe et un rôle (FARMER, RESTAURANT, CITIZEN).
- **BF-AUTH-02** : L'utilisateur peut se connecter et obtenir un jeton JWT portant son rôle et son statut de vérification.
- **BF-AUTH-03** : Un professionnel (FARMER/RESTAURANT) peut soumettre des documents KYC (CIN, RC, carte agricole).
- **BF-AUTH-04** : L'administrateur peut approuver ou rejeter une demande KYC, ce qui met à jour le statut de l'utilisateur.
- **BF-AUTH-05** : Les actions professionnelles (créer une annonce, enregistrer une parcelle) sont bloquées pour les profils non vérifiés.

### Module Katara (IoT)
- **BF-KAT-01** : L'agriculteur peut créer, modifier et supprimer des parcelles géoréférencées (polygone GeoJSON).
- **BF-KAT-02** : L'agriculteur peut associer un dispositif ESP32 à une parcelle et recevoir une clé d'API unique.
- **BF-KAT-03** : Le dispositif ESP32 peut envoyer des données de télémétrie (humidité sol, température sol, pH, conductivité, batterie).
- **BF-KAT-04** : L'agriculteur peut visualiser les données en temps réel et l'historique sous forme de graphiques (24h, 7j, 30j).
- **BF-KAT-05** : L'agriculteur peut configurer des seuils d'alerte par métrique et recevoir un email en cas de dépassement.
- **BF-KAT-06** : L'agriculteur peut demander un diagnostic agronomique IA et le consulter une fois généré.
- **BF-KAT-07** : L'agriculteur peut consulter les prévisions météorologiques pour sa parcelle.
- **BF-KAT-08** : L'agriculteur peut consulter les images NDVI Sentinel-2 pour sa parcelle.
- **BF-KAT-09** : Le système détecte automatiquement les dispositifs hors ligne (aucune donnée depuis > 1 heure).

### Module FarMarket (Marketplace)
- **BF-FAR-01** : L'agriculteur vérifié peut créer une annonce de vente avec titre, description, type de produit, prix, quantité, région et jusqu'à 5 photos.
- **BF-FAR-02** : Le restaurateur vérifié peut parcourir le catalogue d'annonces et filtrer par région, type de produit et fourchette de prix.
- **BF-FAR-03** : Le restaurateur peut passer une commande multi-articles auprès de plusieurs agriculteurs.
- **BF-FAR-04** : L'agriculteur reçoit les commandes entrant de manière anonymisée (identité restaurateur masquée).
- **BF-FAR-05** : L'agriculteur peut accepter, rejeter et mettre à jour le statut de chaque article commandé.
- **BF-FAR-06** : Le restaurateur peut confirmer un paiement en espèces à la livraison (COD).
- **BF-FAR-07** : Le restaurateur peut laisser une évaluation (1–5 étoiles + commentaire) à un agriculteur après livraison.
- **BF-FAR-08** : Les annonces expirent automatiquement après 7 jours.

### Module SecondServe (Anti-gaspillage)
- **BF-SEC-01** : Le restaurateur peut publier des offres de surplus alimentaires avec description, prix réduit et quantité.
- **BF-SEC-02** : Le citoyen peut consulter les offres disponibles, les filtrer par ville, et passer une commande.
- **BF-SEC-03** : L'utilisateur VitaChain (RESTAURANT/CITIZEN) peut accéder à SecondServe via un lien magique SSO sans ressaisir ses identifiants.

### Module Administration
- **BF-ADM-01** : L'administrateur peut consulter et traiter la file d'attente des demandes KYC.
- **BF-ADM-02** : L'administrateur peut lister, filtrer, bannir/débannir et changer le rôle d'un utilisateur.
- **BF-ADM-03** : L'administrateur peut consulter le tableau de bord FarMarket (annonces, commandes, statistiques).

---

## 1.10 Besoins non fonctionnels

| Catégorie | Exigence |
|---|---|
| **Performance** | Le point d'ingestion télémétrique (POST /api/v1/katara/ingest) doit répondre en moins de 50 ms (p50) sous charge normale. |
| **Disponibilité** | La plateforme doit être accessible 24h/24, 7j/7, avec un objectif de disponibilité de 99,5%. |
| **Sécurité** | Toutes les communications doivent être chiffrées (HTTPS/TLS 1.3). Les données utilisateur sont protégées par RLS au niveau de la base de données. |
| **Authentification** | Les jetons JWT ont une durée de vie de 1 heure. Le rafraîchissement automatique des sessions est activé. |
| **Isolation des données** | Chaque rôle ne peut accéder qu'aux données qui lui appartiennent ou qui lui sont autorisées (matrice RLS 22 cellules). |
| **Scalabilité** | L'architecture Docker/Gunicorn/NGINX permet une montée en charge horizontale. |
| **Maintenabilité** | Le code est couvert par des tests unitaires (pytest) et des pipelines CI/CD (GitHub Actions). |
| **Sauvegarde** | La base de données est sauvegardée chaque nuit via pg_dump + rclone vers Backblaze B2. |
| **Observabilité** | Les erreurs sont capturées par Sentry. La disponibilité est surveillée par Uptime Kuma. |
| **Internationalisation** | L'interface SecondServe supporte le français et l'arabe. |

---

## 1.11 Contraintes techniques

**Contraintes d'infrastructure :**
- Déploiement sur un VPS Linux avec ressources limitées (1 vCPU, 2 Go RAM pour l'environnement de développement).
- Utilisation de Supabase comme backend-as-a-service pour la base de données, l'authentification et le stockage.
- Conteneurisation obligatoire via Docker pour assurer la reproductibilité des déploiements.

**Contraintes de sécurité :**
- La clé de service Supabase (service-role key) ne doit jamais être exposée côté client (AUTH-05).
- Toutes les mutations de données doivent passer par les politiques RLS de PostgreSQL.
- Les clés d'API des dispositifs IoT doivent être hachées avec bcrypt avant stockage.
- Aucune donnée personnelle du restaurateur ne doit être visible par l'agriculteur dans le flux de commande.

**Contraintes de développement :**
- Le backend FastAPI doit respecter la structure de routeurs modulaires par domaine métier.
- Le frontend Next.js doit utiliser les composants serveur (RSC) pour les lectures d'état d'authentification.
- Les migrations de base de données doivent être idempotentes et versionnées séquentiellement.

**Contraintes matérielles (IoT) :**
- Le microcontrôleur utilisé est un ESP32 avec connectivité Wi-Fi.
- Le protocole de communication est HTTP/1.1 (POST JSON) vers le backend FastAPI.
- L'authentification du dispositif se fait par en-têtes HTTP (`X-Device-Id` + `X-Device-Api-Key`).

---

## 1.12 Planning prévisionnel

Le développement de VitaChain a été planifié selon une méthodologie agile Scrum, organisée en sprints de deux semaines. Le planning prévisionnel couvre cinq grandes phases :

[Figure 1.3 : Diagramme de Gantt prévisionnel — planning des sprints VitaChain]

[Tableau 1.2 : Planning prévisionnel des sprints]

| Phase | Sprints | Durée | Contenu |
|---|---|---|---|
| **Phase 0 — Infrastructure** | Sprint 0 | 2 semaines | VPS, Supabase, CI/CD, Docker, NGINX, HTTPS |
| **Phase 1 — Authentification** | Sprint 1 | 2 semaines | Inscription, connexion, rôles, JWT, RLS, KYC |
| **Phase 2 — Katara IoT** | Sprints 2–4 | 6 semaines | Parcelles, dispositifs, télémétrie, alertes, IA |
| **Phase 3 — FarMarket** | Sprints 5–7 | 6 semaines | Annonces, catalogue, commandes, paiements, évaluations |
| **Phase 4 — SecondServe** | Sprint 8 | 2 semaines | Offres surplus, commandes citoyens, SSO |
| **Phase 5 — Administration** | Sprint 9 | 2 semaines | KYC admin, gestion utilisateurs, tableau de bord |
| **Phase 6 — Tests & Finalisation** | Sprint 10 | 2 semaines | Tests d'intégration, tests de charge, corrections |

---

## 1.13 Conclusion

Ce premier chapitre a permis d'établir le cadre complet du projet VitaChain : son contexte dans la transformation numérique agricole marocaine, les problèmes structurels qu'il adresse, ses objectifs fonctionnels et non fonctionnels, ainsi que les contraintes techniques qui guident sa conception. La plateforme couvre quatre modules complémentaires — Katara, FarMarket, SecondServe et Administration — répondant chacun à un besoin identifié dans la chaîne agroalimentaire. Le chapitre suivant détaille l'analyse et la conception de ces modules.

---

# Chapitre 2 : Analyse et Conception

## 2.1 Introduction

Ce chapitre présente la démarche d'analyse et de conception adoptée pour VitaChain. Nous commençons par identifier les sous-modules du système et les cas d'utilisation associés à chaque acteur, puis nous décrivons l'architecture logicielle et le modèle de données. La conception s'appuie sur des patterns architecturaux éprouvés pour garantir la sécurité, la modularité et la maintenabilité de la plateforme.

---

## 2.2 Analyse

### 2.2.1 Identification des sous-modules

L'analyse fonctionnelle de VitaChain révèle une architecture modulaire organisée autour de cinq sous-systèmes indépendants mais interconnectés :

[Figure 2.1 : Diagramme de décomposition modulaire de VitaChain]

**Sous-module 1 — Auth & KYC**
Gère l'inscription, la connexion, la gestion des sessions JWT et le processus de vérification d'identité professionnelle (KYC). Ce sous-module est transversal : il conditionne l'accès aux fonctionnalités de tous les autres modules.

Composants :
- Service d'inscription multi-rôle (FARMER / RESTAURANT / CITIZEN / ADMIN)
- Générateur de jetons JWT avec claims personnalisés (`user_role`, `verification_status`)
- Gestionnaire de documents KYC (upload sécurisé, soumission, révision admin)
- Hook Supabase Custom Access Token pour la propagation des rôles dans les JWT

**Sous-module 2 — Katara (IoT Agricole)**
Gère le cycle de vie des parcelles et des dispositifs IoT, l'ingestion et la visualisation des données télémétriques, ainsi que les services à valeur ajoutée (alertes, diagnostics IA, météo, NDVI).

Composants :
- Registre de parcelles (CRUD géoréférencé)
- Gestionnaire de dispositifs ESP32 (appairage, clé d'API, historique)
- Pipeline d'ingestion télémétrique (hot-path < 50 ms)
- Service de visualisation (graphiques temps réel et historique)
- Moteur d'alertes sur seuils (LISTEN/NOTIFY + worker email)
- Orchestrateur de diagnostics IA (Gemini + OWM + Sentinel-2)
- Détecteur de dispositifs hors ligne (CRON worker)

**Sous-module 3 — FarMarket (Marketplace)**
Gère la publication et la consultation d'annonces agricoles, le cycle de vie des commandes entre restaurateurs et agriculteurs, et le système de notation.

Composants :
- Gestionnaire d'annonces (CRUD, photos, expiration)
- Catalogue public (filtres, pagination, recherche textuelle pg_trgm)
- Moteur de commandes (multi-articles, anonymisation, suivi de statut)
- Service de paiement (COD simulation, audit log)
- Système d'évaluation (1–5 étoiles, contrainte achat vérifié)

**Sous-module 4 — SecondServe (Anti-gaspillage)**
Application distincte (Vite/React) connectée au même backend Supabase, gérant les offres surplus des restaurants et les commandes des citoyens.

Composants :
- Gestionnaire d'offres surplus (publication restaurant, visibilité conditionnelle)
- Catalogue citoyen (filtres par ville)
- Moteur de commandes citizen (checkout, suivi)
- SSO inter-application (magic-link OTP depuis VitaChain)

**Sous-module 5 — Administration**
Interface d'administration centralisée pour la gouvernance de la plateforme.

Composants :
- File d'attente KYC (revue, approbation, rejet)
- Gestion des utilisateurs (liste, rôle, ban)
- Tableau de bord FarMarket (statistiques, modération)

---

### 2.2.2 Scénarios des cas d'utilisation

#### Cas d'utilisation — Module Authentification

[Figure 2.2 : Diagramme de cas d'utilisation — Module Authentification]

**UC-AUTH-01 : Inscription d'un professionnel**
- **Acteur** : Agriculteur / Restaurateur
- **Précondition** : L'utilisateur n'a pas de compte VitaChain.
- **Scénario nominal** :
  1. L'utilisateur accède à la page d'inscription.
  2. Il saisit son adresse email, son mot de passe et sélectionne son rôle (FARMER ou RESTAURANT).
  3. Le système crée un compte Supabase Auth et un profil `profiles` avec statut PENDING.
  4. L'utilisateur est redirigé vers le tableau de bord avec accès limité.
- **Postcondition** : Compte créé avec `verification_status = PENDING`.

**UC-AUTH-02 : Soumission KYC**
- **Acteur** : Agriculteur / Restaurateur (PENDING)
- **Scénario nominal** :
  1. L'utilisateur accède à la section "Vérification".
  2. Il télécharge ses documents (CIN, RC ou carte agricole) dans le bucket Supabase Storage.
  3. Il soumet sa demande via `POST /api/v1/kyc/submit`.
  4. L'administrateur reçoit une notification et la demande apparaît dans la file d'attente KYC.
- **Postcondition** : Demande KYC créée avec statut EN_ATTENTE.

**UC-AUTH-03 : Approbation KYC par l'administrateur**
- **Acteur** : Administrateur
- **Scénario nominal** :
  1. L'administrateur consulte la file d'attente des demandes KYC.
  2. Il télécharge et examine les documents soumis.
  3. Il approuve ou rejette la demande.
  4. Le système met à jour `profiles.verification_status` à VERIFIED ou REJECTED.
  5. Un email de notification est envoyé à l'utilisateur via Brevo.
- **Postcondition** : L'utilisateur peut désormais réaliser des actions professionnelles.

#### Cas d'utilisation — Module Katara

[Figure 2.3 : Diagramme de cas d'utilisation — Module Katara]

**UC-KAT-01 : Enregistrement d'une parcelle**
- **Acteur** : Agriculteur (VERIFIED)
- **Scénario nominal** :
  1. L'agriculteur accède à son tableau de bord Katara.
  2. Il clique sur "Nouvelle parcelle" et saisit le nom, le type de culture et la surface.
  3. Il dessine le contour de la parcelle sur la carte interactive (Leaflet).
  4. Il soumet le formulaire via `POST /api/v1/katara/parcels`.
  5. La parcelle apparaît dans son tableau de bord avec statut "sans dispositif".
- **Postcondition** : Parcelle créée avec géométrie GeoJSON stockée.

**UC-KAT-02 : Appairage d'un dispositif ESP32**
- **Acteur** : Agriculteur (VERIFIED)
- **Scénario nominal** :
  1. L'agriculteur sélectionne une parcelle et clique sur "Associer un capteur".
  2. Il saisit l'identifiant du dispositif (format `ESP-KAT-NNN`).
  3. Le backend génère une clé d'API unique (`vk_<32 hex>`), la hache et la stocke.
  4. La clé en clair est affichée une seule fois à l'agriculteur.
  5. L'agriculteur configure l'ESP32 avec cette clé.
- **Postcondition** : Dispositif associé à la parcelle avec statut PENDING → ACTIVE à la première télémétrie reçue.

**UC-KAT-03 : Ingestion de données télémétriques**
- **Acteur** : Dispositif ESP32
- **Scénario nominal** :
  1. Le dispositif envoie une requête HTTP POST avec les en-têtes `X-Device-Id` et `X-Device-Api-Key`.
  2. Le backend appelle la fonction SQL `m1_katara_ingest()` (SECURITY DEFINER).
  3. La fonction vérifie la clé d'API (bcrypt), insère la mesure, met à jour `last_seen` et envoie un NOTIFY.
  4. Le worker de seuils écoute le NOTIFY et vérifie les dépassements.
  5. Si un seuil est franchi, un email d'alerte est envoyé à l'agriculteur.
- **Postcondition** : Mesure enregistrée dans `m1_katara_telemetry`. Durée totale < 50 ms (p50).

**UC-KAT-04 : Demande de diagnostic IA**
- **Acteur** : Agriculteur (VERIFIED)
- **Scénario nominal** :
  1. L'agriculteur clique sur "Demander un diagnostic" pour sa parcelle.
  2. Le backend crée un enregistrement de diagnostic avec statut PENDING.
  3. Un worker asynchrone collecte les données : dernières mesures télémétriques, prévisions météo (OWM), images NDVI (Sentinel-2).
  4. Les données agrégées sont envoyées à l'API Gemini.
  5. Le résumé diagnostique est stocké et le statut passe à COMPLETED.
  6. Un email de notification est envoyé à l'agriculteur.
- **Postcondition** : Diagnostic consultable dans l'interface avec résumé en langage naturel.

#### Cas d'utilisation — Module FarMarket

[Figure 2.4 : Diagramme de cas d'utilisation — Module FarMarket]

**UC-FAR-01 : Publication d'une annonce agricole**
- **Acteur** : Agriculteur (VERIFIED)
- **Scénario nominal** :
  1. L'agriculteur accède à "Mes annonces" et clique sur "Nouvelle annonce".
  2. Il renseigne le titre, la description, le type de produit, le prix (MAD/kg), la quantité (kg) et la région.
  3. Il télécharge jusqu'à 5 photos du produit.
  4. Il soumet l'annonce via `POST /api/v1/farmarket/ads` (multipart/form-data).
  5. L'annonce est créée avec statut ACTIVE et une expiration à J+7.
- **Postcondition** : Annonce visible dans le catalogue pour tous les restaurateurs.

**UC-FAR-02 : Passage d'une commande**
- **Acteur** : Restaurateur (VERIFIED)
- **Scénario nominal** :
  1. Le restaurateur parcourt le catalogue et ajoute des articles au panier.
  2. Il procède au paiement : sélectionne COD ou PSP_TRANSFER, saisit la région de livraison.
  3. Le système calcule les frais logistiques selon la région.
  4. La commande est créée avec des instantanés de prix (unit_price_snapshot) pour chaque article.
  5. Chaque agriculteur concerné reçoit une notification de nouvelle commande.
- **Postcondition** : Commande créée avec statut PENDING. Les agriculteurs voient leurs articles entrants anonymisés.

**UC-FAR-03 : Suivi et livraison d'une commande**
- **Acteur** : Agriculteur (pour chaque article), Restaurateur (vue globale)
- **Scénario nominal** :
  1. L'agriculteur consulte ses articles entrants (vue anonymisée).
  2. Il accepte ou rejette chaque article : `PATCH /api/v1/farmarket/order-items/{id}`.
  3. Le statut de l'article évolue : PENDING → ACCEPTED → PICKED_UP → IN_TRANSIT → DELIVERED.
  4. La commande globale passe à PARTIALLY_ACCEPTED, ACCEPTED, IN_PROGRESS puis DELIVERED selon les articles.
  5. Le restaurateur confirme le paiement COD après réception.
- **Postcondition** : Commande livrée, paiement confirmé. Le restaurateur peut désormais noter l'agriculteur.

#### Cas d'utilisation — Module SecondServe

[Figure 2.5 : Diagramme de cas d'utilisation — Module SecondServe]

**UC-SEC-01 : Accès SSO depuis VitaChain**
- **Acteur** : Restaurateur / Citoyen
- **Scénario nominal** :
  1. L'utilisateur clique sur "Accéder à SecondServe" depuis son tableau de bord VitaChain.
  2. Le backend génère un OTP Supabase à usage unique via `POST /api/v1/secondserve/handoff`.
  3. L'utilisateur est redirigé vers l'application SecondServe avec le token dans l'URL.
  4. SecondServe échange le token contre une session Supabase valide.
- **Postcondition** : L'utilisateur est connecté à SecondServe sans ressaisie d'identifiants.

---

### 2.2.3 Diagramme de classes d'analyse

L'analyse orientée objet du domaine de VitaChain identifie les classes principales suivantes :

[Figure 2.6 : Diagramme de classes d'analyse — domaine complet VitaChain]

**Classes du domaine Auth :**
- `User` (email, password_hash, created_at) — géré par Supabase Auth
- `Profile` (id, role: UserRole, verification_status: VerificationStatus, full_name, phone, locale)
- `KycDocument` (id, user_id, type: DocType, storage_path, status, reviewed_at, reviewed_by)

**Classes du domaine Katara :**
- `Parcel` (id, farmer_id, name, geojson: GeoJSON, crop_type, surface_area_ha)
- `Device` (id, device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status: DeviceStatus, last_seen)
- `TelemetryReading` (id, device_id, parcel_id, soil_moisture, soil_temperature, soil_ph, soil_conductivity, battery_level, recorded_at)
- `AlertThreshold` (id, parcel_id, device_id, metric, min_value, max_value, enabled)
- `AiDiagnostic` (id, parcel_id, initiated_by, status: DiagStatus, diagnostic_summary, external_api_calls)

**Classes du domaine FarMarket :**
- `FarmarketAd` (id, farmer_id, title, description, product_type, price_mad, quantity_kg, region, photo_paths[], status, expires_at)
- `Order` (id, restaurant_id, status: OrderStatus, delivery_region, subtotal_mad, logistics_fee_mad, total_mad, payment_method, payment_status)
- `OrderItem` (id, order_id, ad_id, farmer_id, quantity_kg, unit_price_mad, line_total_mad, status: ItemStatus, producer_note)
- `FarmerRating` (id, farmer_id, restaurant_id, order_id, rating, review, reviewer_name)

**Classes du domaine SecondServe :**
- `SsOffer` (id, place_id, title, description, price_mad, quantity, available_until, status)
- `SsOrder` (id, consumer_id, offer_id, quantity, total_mad, payment_method, status)
- `SsPlace` (id, owner_id, name, city, commerce_type, approved)

**Relations clés :**
- `Profile` 1—N `Parcel` (un agriculteur possède plusieurs parcelles)
- `Parcel` 1—N `Device` (une parcelle peut avoir plusieurs dispositifs dans son historique, 1 actif max)
- `Device` 1—N `TelemetryReading` (un dispositif génère de nombreuses mesures)
- `Profile` (RESTAURANT) 1—N `Order`
- `Order` 1—N `OrderItem`
- `OrderItem` N—1 `FarmarketAd`

---

## 2.3 Conception

### 2.3.1 Génération du modèle physique de données (MPD)

Le modèle physique de données est implémenté en PostgreSQL 17 via Supabase. Il comprend 12 tables principales, 5 vues, 8 types ENUM et plusieurs fonctions et triggers de sécurité.

[Figure 2.7 : Modèle Physique de Données (MPD) complet — VitaChain]

**Tables principales :**

```
auth.users (géré par Supabase)
  └── public.profiles (mirror + role, verification_status)
      └── public.kyc_documents (type, storage_path, status)

public.m1_katara_parcels (farmer_id FK, name, geojson, crop_type, surface_area_ha)
  ├── public.m1_katara_devices (device_id, api_key_hash, status, last_seen)
  │   └── public.m1_katara_telemetry (soil_moisture, soil_temperature, soil_ph,
  │                                    soil_conductivity, battery_level, recorded_at)
  ├── public.m1_katara_alert_thresholds (metric, min_value, max_value, enabled)
  └── public.m1_katara_ai_diagnostics (status, diagnostic_summary, external_api_calls)

public.m2_farmarket_ads (farmer_id, title, product_type, price_mad, region, status)
  └── public.m2_farmarket_order_items (quantity_kg, unit_price_mad, status)
      └── public.m2_farmarket_orders (restaurant_id, status, payment_method, total_mad)
          └── public.m2_farmarket_payment_audit (event, amount, metadata)

public.m2_farmarket_farmer_ratings (farmer_id, restaurant_id, order_id, rating, review)
public.notifications_outbox (recipient, template, payload, sent_at)
```

**Types ENUM définis :**

[Tableau 2.1 : Types énumérés PostgreSQL de VitaChain]

| Type | Valeurs |
|---|---|
| `user_role` | FARMER, RESTAURANT, CITIZEN, ADMIN |
| `verification_status` | PENDING, VERIFIED, REJECTED |
| `device_status` | PENDING, ACTIVE, OFFLINE, UNLINKED |
| `m2_farmarket_ad_status` | ACTIVE, EXPIRED, DELETED |
| `m2_farmarket_order_status` | PENDING, PARTIALLY_ACCEPTED, ACCEPTED, REJECTED, IN_PROGRESS, DELIVERED, CANCELLED |
| `m2_farmarket_item_status` | PENDING, ACCEPTED, REJECTED, PICKED_UP, IN_TRANSIT, DELIVERED |
| `m2_farmarket_region` | Tanger-Tétouan-Al Hoceïma, Oriental, Fès-Meknès, Rabat-Salé-Kénitra, Béni Mellal-Khénifra, Casablanca-Settat, Marrakech-Safi, Drâa-Tafilalet, Souss-Massa, Guelmim-Oued Noun, Laâyoune-Sakia El Hamra, Dakhla-Oued Ed-Dahab |

**Vues de sécurité et d'agrégation :**

[Tableau 2.2 : Vues PostgreSQL de VitaChain]

| Vue | Description |
|---|---|
| `m1_katara_telemetry_latest` | Dernière mesure par parcelle (DISTINCT ON) |
| `m1_katara_parcel_device_history` | Historique de tous les dispositifs associés à une parcelle |
| `v_farmer_incoming_items` | Articles entrants pour les agriculteurs avec `resto_handle = sha256(restaurant_id \|\| farmer_id)` |
| `v_farmarket_farmer_public` | Profil public d'un agriculteur pour le catalogue |
| `v_farmarket_farmer_rating_stats` | Moyenne et nombre d'évaluations par agriculteur |

---

### 2.3.2 Génération du script SQL

Les migrations de base de données sont organisées en 50 fichiers SQL numérotés séquentiellement dans le répertoire `db/migrations/`. Chaque fichier est idempotent (utilise `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc.) et suit une convention de nommage `NNNN_description_courte.sql`.

[Tableau 2.3 : Extrait des migrations SQL de VitaChain]

| N° | Fichier | Contenu |
|---|---|---|
| 0001 | `0001_extensions_enums.sql` | Extensions pg_trgm, pgcrypto ; types ENUM |
| 0002 | `0002_profiles.sql` | Table `profiles`, contraintes, index |
| 0003 | `0003_signup_trigger.sql` | Trigger `handle_new_user()` pour création automatique du profil |
| 0006 | `0006_jwt_role_hook.sql` | Hook Supabase Custom Access Token (role dans JWT) |
| 0007 | `0007_admin_signup_blocker.sql` | Trigger bloquant l'auto-inscription en rôle ADMIN |
| 0008 | `0008_rls_has_role_helper.sql` | Fonctions `has_role()`, `is_admin()` SECURITY DEFINER |
| 0016 | `0016_katara_parcels.sql` | Table `m1_katara_parcels`, RLS, index |
| 0017 | `0017_katara_devices.sql` | Table `m1_katara_devices`, contraintes unicité, `verify_device_api_key()` |
| 0018 | `0018_katara_telemetry.sql` | Table `m1_katara_telemetry`, fonction `m1_katara_ingest()`, FORCE RLS |
| 0021 | `0021_katara_thresholds.sql` | Table `m1_katara_alert_thresholds`, RLS |
| 0022 | `0022_katara_diagnostics.sql` | Table `m1_katara_ai_diagnostics`, RLS |
| 0031 | `0031_farmarket_ads.sql` | Table `m2_farmarket_ads`, index trgm, storage policies |
| 0040 | `0040_farmarket_orders.sql` | Tables `m2_farmarket_orders` et `m2_farmarket_order_items`, anonymisation |
| 0043 | `0043_farmarket_payment.sql` | Colonne `payment_method`, `payment_status`, table audit |
| 0046 | `0046_farmarket_ratings.sql` | Table `m2_farmarket_farmer_ratings`, contrainte achat vérifié |
| 0048 | `0048_ss_signup.sql` | Trigger SecondServe : bypass profil VitaChain pour `ss_app` metadata |

**Extrait du script d'ingestion télémétrique :**

```sql
-- Fonction atomique : vérification clé + INSERT + touch + NOTIFY
CREATE OR REPLACE FUNCTION public.m1_katara_ingest(
  p_device_id    TEXT,
  p_api_key      TEXT,
  p_soil_moisture    NUMERIC,
  p_soil_temperature NUMERIC,
  p_soil_ph          NUMERIC,
  p_soil_conductivity NUMERIC,
  p_battery_level    NUMERIC,
  p_recorded_at      TIMESTAMPTZ DEFAULT now()
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parcel_id UUID;
  v_farmer_id UUID;
BEGIN
  -- Vérification bcrypt de la clé d'API
  IF NOT public.verify_device_api_key(p_device_id, p_api_key) THEN
    RAISE EXCEPTION 'invalid_device_credentials';
  END IF;
  -- Récupération du contexte
  SELECT parcel_id, farmer_id INTO v_parcel_id, v_farmer_id
    FROM m1_katara_devices WHERE device_id = p_device_id AND status = 'ACTIVE';
  -- Insertion idempotente
  INSERT INTO m1_katara_telemetry (device_id, parcel_id, farmer_id,
    soil_moisture, soil_temperature, soil_ph, soil_conductivity,
    battery_level, recorded_at)
  VALUES (p_device_id, v_parcel_id, v_farmer_id,
    p_soil_moisture, p_soil_temperature, p_soil_ph, p_soil_conductivity,
    p_battery_level, p_recorded_at)
  ON CONFLICT (device_id, recorded_at) DO NOTHING;
  -- Mise à jour last_seen
  UPDATE m1_katara_devices SET last_seen = now(),
    status = CASE WHEN status = 'PENDING' THEN 'ACTIVE' ELSE status END
  WHERE device_id = p_device_id;
  -- Notification aux workers
  PERFORM pg_notify('katara_telemetry',
    json_build_object('device_id', p_device_id, 'parcel_id', v_parcel_id,
                      'farmer_id', v_farmer_id)::text);
END;
$$;
```

---

### 2.3.3 Design Patterns utilisés

VitaChain s'appuie sur plusieurs design patterns architecturaux reconnus :

[Tableau 2.4 : Design Patterns utilisés dans VitaChain]

| Pattern | Module | Description |
|---|---|---|
| **Repository Pattern** | Backend | `db.py` expose `service_client()` et `user_scoped_client()` — abstraction de l'accès Supabase |
| **Router Pattern** | Backend FastAPI | Chaque domaine métier est encapsulé dans un routeur (`APIRouter`) monté de manière modulaire |
| **Dependency Injection** | Backend FastAPI | `get_current_user()`, `require_role()`, `require_verified()`, `get_db_for_user()` sont des dépendances FastAPI |
| **Outbox Pattern** | Notifications | Table `notifications_outbox` — les mutations applicatives écrivent dans l'outbox, un worker lit et envoie les emails |
| **CQRS léger** | FarMarket | Séparation lecture (catalogue public, vue anonymisée) / écriture (commandes, articles) avec politiques RLS distinctes |
| **SECURITY DEFINER** | Base de données | Fonctions critiques (`m1_katara_ingest`, `verify_device_api_key`, `has_role`) s'exécutent avec les droits du propriétaire, pas de l'appelant |
| **Snapshot** | FarMarket | Prix et identifiant agriculteur copiés au moment de la commande (`unit_price_mad`, `farmer_id` dans `order_items`) |
| **Magic Link SSO** | SecondServe | OTP Supabase à usage unique pour le handoff inter-application sans partage de session |
| **Observer (LISTEN/NOTIFY)** | Katara | La base de données publie des événements ; les workers Python s'abonnent via LISTEN et réagissent |
| **FORCE RLS** | Télémétrie | `ALTER TABLE m1_katara_telemetry FORCE ROW LEVEL SECURITY` — même le propriétaire de la table est soumis aux politiques |

---

### 2.3.4 Architecture du module

VitaChain suit une architecture **N-tiers** organisée en couches distinctes :

[Figure 2.8 : Architecture globale de VitaChain — diagramme en couches]

**Couche Présentation (Tier 1)**
- **Frontend Next.js 15** : Interface principale (agriculteurs, restaurateurs, admin). Composants serveur (RSC) pour les lectures d'état auth. Middleware Supabase SSR pour la protection des routes `/dashboard`.
- **Application SecondServe (Vite/React)** : Application SPA indépendante pour les citoyens et la fonctionnalité anti-gaspillage.

**Couche API (Tier 2)**
- **FastAPI (Python 3.12)** : API REST versionnée (`/api/v1/`). Validation Pydantic v2. Authentification Bearer JWT. Routeurs modulaires par domaine.
- **Workers asynchrones** : Processus Python dédiés pour les tâches longues (diagnostics IA, emails, détection hors ligne, expiration annonces).

**Couche Données (Tier 3)**
- **PostgreSQL 17 (Supabase)** : Base de données relationnelle avec RLS, fonctions SECURITY DEFINER, LISTEN/NOTIFY.
- **Supabase Storage** : Stockage objet pour photos d'annonces et documents KYC (buckets RLS).
- **Supabase Auth** : Gestion des utilisateurs, sessions JWT, Custom Access Token Hook.

**Couche Infrastructure (Tier 4)**
- **NGINX 1.27** : Reverse proxy, terminaison TLS, rate-limiting, routage upstream.
- **Docker Compose** : Orchestration des services (frontend, backend, nginx, certbot, uptime-kuma, db-backup).
- **Backblaze B2** : Stockage des sauvegardes nocturnes (pg_dump gzippé via rclone).
- **Sentry** : Capture des erreurs et suivi des releases.
- **Uptime Kuma** : Monitoring de disponibilité et alertes.

[Figure 2.9 : Diagramme de déploiement VitaChain — infrastructure Docker/VPS]

**Architecture de sécurité :**

```
Internet
   │
   ▼
NGINX (443/TLS 1.3, Let's Encrypt)
   │  rate-limit : 30 req/s /api/v1/katara/ingest
   │  rate-limit : 10 req/s /api/v1/
   ├──▶ Next.js (frontend :3000)
   ├──▶ FastAPI (backend :8000)
   └──▶ Uptime Kuma (:3001)
          │
          ▼
   Supabase (cloud)
   ├── PostgreSQL 17 (RLS)
   ├── Auth (JWT HS256)
   └── Storage (buckets RLS)
```

---

## 2.4 Conclusion

Ce chapitre a présenté l'analyse et la conception de VitaChain. L'identification des sous-modules a permis de délimiter clairement les responsabilités de chaque composant du système. Les cas d'utilisation ont formalisé les interactions entre les acteurs et le système. Le modèle physique de données, avec ses 12 tables, ses fonctions SECURITY DEFINER et ses vues d'agrégation, constitue le socle de sécurité et de performance de la plateforme. Enfin, l'architecture N-tiers et les design patterns adoptés garantissent la modularité et la maintenabilité de la solution. Le chapitre suivant détaille la phase de réalisation.

---

# Chapitre 3 : Réalisation

## 3.1 Introduction

Ce chapitre présente la réalisation concrète du projet VitaChain. Nous y décrivons la méthodologie de développement adoptée, les sprints réalisés, les technologies et outils utilisés, ainsi qu'une présentation des interfaces de chaque module de l'application.

---

## 3.2 Planning réel

### 3.2.1 Méthodologie adoptée

Le développement de VitaChain a suivi une méthodologie **Scrum** adaptée au contexte d'un projet académique solo. Les principes appliqués sont :

- **Développement itératif** : 10 sprints de 2 semaines couvrant les 5 grandes phases du projet.
- **Story-driven development** : chaque fonctionnalité est définie par une user story formalisée dans un fichier YAML (`docs/spring-status.yml`, `docs/stories/`), avec critères d'acceptation, tâches techniques et définition of done.
- **Intégration continue** : pipeline GitHub Actions en 5 jobs (frontend, backend, db, infra, détection de fuites de secrets) exécuté à chaque push.
- **Tests automatisés** : tests unitaires pytest pour le backend, tests RLS via pgTAP, tests E2E pour les flux KYC et multi-parcelles.
- **Pre-commit hooks** : validation locale (ruff, ESLint, shellcheck, vérification AUTH-05) avant chaque commit.

[Figure 3.1 : Diagramme de processus Scrum adapté — VitaChain]

---

### 3.2.2 Tableau des sprints réalisés

[Tableau 3.1 : Sprints réalisés — VitaChain]

| Sprint | Durée | Stories livrées | Résultat |
|---|---|---|---|
| **Sprint 0 — Infrastructure** | 2 sem. | INF-01 à INF-08 | VPS, Supabase, CI/CD, Docker, NGINX, HTTPS, backups, monitoring |
| **Sprint 1 — Authentification** | 2 sem. | AUTH-01 à AUTH-07 | Inscription, connexion, JWT, RLS, KYC, matrice de droits |
| **Sprint 2 — Katara Parcelles** | 2 sem. | KAT-01, KAT-02, KAT-03 | Registre parcelles, appairage ESP32, ingestion télémétrie |
| **Sprint 3 — Katara Tableaux** | 2 sem. | KAT-04, KAT-05, KAT-08 | Graphiques, historique, dispositif hors ligne, multi-parcelles |
| **Sprint 4 — Katara Services** | 2 sem. | KAT-06, KAT-07, KAT-09–14 | Alertes email, diagnostics IA, météo, NDVI, détecteur offline |
| **Sprint 5 — FarMarket Annonces** | 2 sem. | FAR-01, FAR-02, FAR-07, FAR-08 | Création annonces, photos, catalogue, suppression soft, expiration |
| **Sprint 6 — FarMarket Commandes** | 2 sem. | FAR-03, FAR-04, FAR-05 | Commandes multi-articles, anonymisation, suivi statut |
| **Sprint 7 — FarMarket Avancé** | 2 sem. | FAR-06, FAR-09, FAR-10 | Paiement COD, évaluations, tableau de bord admin, annonces vedettes |
| **Sprint 8 — SecondServe** | 2 sem. | SEC-01 à SEC-04 | Offres surplus, commandes citoyens, SSO magic-link |
| **Sprint 9 — Administration** | 2 sem. | ADM-01 à ADM-04 | File KYC, gestion utilisateurs, modération FarMarket |
| **Sprint 10 — Tests & Livraison** | 2 sem. | — | Tests de charge (Locust), corrections, documentation |

---

### 3.2.3 Répartition des tâches et charges

[Tableau 3.2 : Répartition des charges par composant]

| Composant | Tâches principales | Charge estimée |
|---|---|---|
| **Infrastructure & DevOps** | VPS, Docker, NGINX, CI/CD, HTTPS, backups, monitoring | ~60 h |
| **Base de données** | 50 migrations SQL, RLS, fonctions, vues, tests pgTAP | ~80 h |
| **Backend FastAPI** | Routeurs, schémas Pydantic, workers, sécurité, tests pytest | ~120 h |
| **Frontend Next.js** | Pages, composants, auth, cartes Leaflet, graphiques | ~100 h |
| **Application SecondServe** | SPA Vite, routing, Supabase, SSO | ~40 h |
| **IoT / ESP32** | Firmware, protocole HTTP, intégration | ~20 h |
| **Tests & Documentation** | Tests E2E, tests de charge, runbook, rapport | ~40 h |
| **Total** | | **~460 h** |

[Figure 3.2 : Diagramme de répartition des charges par composant (camembert)]

---

## 3.3 Technologies utilisées

### 3.3.1 Langages et Frameworks

[Tableau 3.3 : Langages et frameworks — VitaChain]

| Technologie | Version | Usage |
|---|---|---|
| **Python** | 3.12 | Langage du backend FastAPI et des workers |
| **FastAPI** | 0.115.14 | Framework API REST asynchrone, validation Pydantic v2 |
| **TypeScript** | 5.x | Langage frontend (Next.js et SecondServe) |
| **Next.js** | 15.1.6 | Framework React SSR/RSC pour le frontend principal |
| **React** | 19.0.0 | Bibliothèque UI (Next.js et SecondServe) |
| **Vite** | 6.2.0 | Build tool pour l'application SecondServe (SPA) |
| **React Router** | v7 | Routage SPA dans SecondServe |
| **SQL (PostgreSQL)** | 17 | Langage de requête et de définition du schéma |
| **C++ / Arduino** | — | Firmware ESP32 pour la télémétrie IoT |

[Figure 3.3 : Logos des principaux langages et frameworks utilisés]

---

### 3.3.2 Logiciels et outils de développement

[Tableau 3.4 : Outils de développement — VitaChain]

| Outil | Usage |
|---|---|
| **VS Code** | Éditeur principal (extensions Python, TypeScript, ESLint, Tailwind) |
| **Git / GitHub** | Contrôle de version, collaboration, CI/CD |
| **GitHub Actions** | Pipeline CI/CD automatisé (5 jobs) |
| **Docker / Docker Compose** | Conteneurisation et orchestration des services |
| **Postman** | Test manuel des endpoints API REST |
| **Locust** | Tests de charge sur l'endpoint d'ingestion Katara |
| **pgAdmin / DBeaver** | Administration et inspection de la base de données PostgreSQL |
| **Leaflet** | Cartes interactives pour la sélection et affichage des parcelles |
| **Arduino IDE** | Développement du firmware ESP32 |
| **Pre-commit** | Hooks de validation locale (ruff, ESLint, shellcheck) |
| **Ruff** | Linter et formateur Python ultra-rapide |
| **ESLint** | Linter TypeScript/JavaScript |
| **pytest** | Framework de tests unitaires Python |

[Figure 3.4 : Logos des principaux outils de développement]

---

### 3.3.3 Serveurs et services Cloud

[Tableau 3.5 : Services Cloud et infrastructure — VitaChain]

| Service | Rôle |
|---|---|
| **Supabase** | Backend-as-a-Service : PostgreSQL 17, Auth (JWT), Storage (S3-compatible), Realtime, Edge Functions |
| **VPS Linux** | Hébergement de production : Docker Compose (frontend, backend, nginx, certbot, kuma, backup) |
| **NGINX 1.27** | Reverse proxy, terminaison TLS, rate-limiting, compression gzip |
| **Let's Encrypt / Certbot** | Certificats TLS/HTTPS gratuits avec renouvellement automatique |
| **Backblaze B2** | Stockage objet pour les sauvegardes nocturnes de la base de données |
| **rclone** | Synchronisation des sauvegardes pg_dump vers B2 |
| **Sentry** | Capture d'erreurs et tracking des releases (frontend + backend) |
| **Uptime Kuma** | Monitoring de disponibilité, alertes Telegram/email |
| **OpenWeatherMap API** | Prévisions météo pour les parcelles Katara |
| **Sentinel-2 (Copernicus)** | Images satellites NDVI pour l'analyse végétale des parcelles |
| **Google Gemini API** | Intelligence artificielle pour les diagnostics agronomiques |
| **Brevo (Sendinblue)** | Service d'envoi d'emails transactionnels (alertes, KYC, diagnostics) |

[Figure 3.5 : Architecture Cloud de VitaChain — diagramme des services externes intégrés]

---

## 3.4 Interfaces de l'application

### 3.4.1 Module Authentification

Le module d'authentification est le point d'entrée de VitaChain. Il propose une interface claire et sécurisée pour l'inscription, la connexion et la vérification d'identité.

**Page d'inscription**

La page d'inscription présente un formulaire en deux panneaux : à gauche, un aperçu de l'écosystème VitaChain avec les bénéfices de chaque module ; à droite, le formulaire de création de compte avec sélection du rôle (Agriculteur / Restaurateur / Citoyen).

[Figure 3.6 : Interface — Page d'inscription VitaChain avec sélecteur de rôle]

**Page de connexion**

[Figure 3.7 : Interface — Page de connexion VitaChain]

**Page d'onboarding KYC**

Après inscription, les professionnels (FARMER/RESTAURANT) sont invités à soumettre leurs documents de vérification. L'interface guide l'utilisateur étape par étape : sélection du type de document, téléchargement du fichier, confirmation de soumission.

[Figure 3.8 : Interface — Formulaire de soumission KYC avec upload de documents]

---

### 3.4.2 Module Katara — Surveillance IoT

Le module Katara constitue le cœur technologique de VitaChain. Il offre aux agriculteurs un tableau de bord complet pour la surveillance de leurs parcelles.

**Tableau de bord Katara (vue multi-parcelles)**

La page d'accueil du module Katara présente une vue synthétique de toutes les parcelles de l'agriculteur avec les indicateurs clés de performance : dernières mesures de sol, statut des dispositifs, nombre d'alertes actives et résumé météo.

[Figure 3.9 : Interface — Tableau de bord Katara multi-parcelles avec KPI strip]

**Création d'une parcelle**

Le formulaire de création de parcelle intègre une carte Leaflet permettant à l'agriculteur de dessiner le contour géographique exact de son champ (polygone GeoJSON).

[Figure 3.10 : Interface — Formulaire de création de parcelle avec carte Leaflet interactive]

**Vue détaillée d'une parcelle — Télémétrie en temps réel**

Chaque parcelle dispose d'une vue détaillée avec des onglets : Télémétrie, Seuils, Diagnostics, Dispositifs, Historique. L'onglet télémétrie affiche des graphiques Sparkline pour les 4 métriques de sol (humidité, température, pH, conductivité) sur les périodes 24h, 7j et 30j.

[Figure 3.11 : Interface — Graphiques de télémétrie temps réel pour une parcelle (4 métriques)]

**Gestion des seuils d'alerte**

L'agriculteur peut configurer des seuils min/max pour chaque métrique. Le dépassement d'un seuil déclenche automatiquement un email d'alerte via le worker Katara.

[Figure 3.12 : Interface — Configuration des seuils d'alerte par métrique]

**Diagnostic IA**

L'interface de diagnostic permet à l'agriculteur de demander une analyse agronomique complète. Le système agrège les données télémétriques, météorologiques et satellitaires, puis génère un résumé en langage naturel via Gemini.

[Figure 3.13 : Interface — Résultat d'un diagnostic agronomique IA (Gemini)]

**Vue météo et satellite NDVI**

[Figure 3.14 : Interface — Prévisions météo OpenWeatherMap pour une parcelle]

[Figure 3.15 : Interface — Image NDVI Sentinel-2 pour une parcelle agricole]

**Gestion des dispositifs ESP32**

[Figure 3.16 : Interface — Liste des dispositifs IoT associés à une parcelle avec statut (ACTIVE/OFFLINE)]

---

### 3.4.3 Module FarMarket — Marketplace Agricole

Le module FarMarket connecte directement les agriculteurs vérifiés aux restaurateurs pour la vente de produits agricoles.

**Tableau de bord agriculteur — Mes annonces**

L'agriculteur peut consulter la liste de ses annonces actives, expirées ou supprimées, avec les indicateurs : nombre de vues, prix, quantité disponible et date d'expiration.

[Figure 3.17 : Interface — Tableau de bord agriculteur FarMarket avec liste des annonces]

**Création d'une annonce avec photos**

Le formulaire de création d'annonce permet d'uploader jusqu'à 5 photos du produit. Les photos sont stockées dans le bucket Supabase `farmarket-photos` avec des politiques RLS garantissant que seul le propriétaire peut gérer ses fichiers.

[Figure 3.18 : Interface — Formulaire de création d'annonce agricole avec galerie photos]

**Catalogue restaurateur**

Le restaurateur accède à un catalogue paginé d'annonces actives avec filtres par région (12 régions du Maroc), type de produit et fourchette de prix. Une recherche textuelle floue (pg_trgm) est disponible.

[Figure 3.19 : Interface — Catalogue FarMarket avec filtres et cartes d'annonces]

**Détail d'une annonce avec profil agriculteur et évaluations**

[Figure 3.20 : Interface — Page détail d'une annonce avec profil agriculteur, note moyenne et avis]

**Panier et processus de commande**

Le restaurateur ajoute des articles au panier depuis plusieurs agriculteurs différents. Au moment de la commande, le système calcule automatiquement les frais logistiques selon la région de livraison.

[Figure 3.21 : Interface — Panier restaurateur avec résumé de commande et frais logistiques]

**Suivi de commande — vue restaurateur**

[Figure 3.22 : Interface — Timeline de suivi de commande pour le restaurateur (statuts visuels)]

**Articles entrants — vue agriculteur (anonymisée)**

L'agriculteur voit ses articles entrants via la vue `v_farmer_incoming_items`. Le nom et l'identifiant du restaurateur sont masqués, remplacés par un `resto_handle` opaque (sha256).

[Figure 3.23 : Interface — Articles entrants pour l'agriculteur (vue anonymisée)]

**Confirmation de paiement COD**

[Figure 3.24 : Interface — Confirmation de paiement en espèces (COD) par le restaurateur]

**Laisser une évaluation**

[Figure 3.25 : Interface — Formulaire d'évaluation agriculteur (1–5 étoiles + commentaire)]

---

### 3.4.4 Module SecondServe — Anti-gaspillage

SecondServe est une application distincte (Vite/React), partagée sur le même projet Supabase, dédiée à la redistribution des surplus alimentaires des restaurants aux citoyens.

**Page d'accueil SecondServe**

[Figure 3.26 : Interface — Page d'accueil SecondServe avec liste des offres surplus disponibles]

**Catalogue des offres**

Le citoyen peut filtrer les offres par ville et par type de cuisine. Chaque carte d'offre affiche le nom du plat, le prix réduit, la quantité restante et l'heure limite de réservation.

[Figure 3.27 : Interface — Catalogue des offres surplus avec filtres par ville]

**Tableau de bord citoyen**

[Figure 3.28 : Interface — Tableau de bord citoyen SecondServe avec historique des commandes]

**Tableau de bord restaurateur SecondServe**

Le restaurateur peut publier ses offres surplus, consulter les commandes reçues et confirmer les retraits.

[Figure 3.29 : Interface — Tableau de bord restaurateur SecondServe (gestion des offres)]

**Reçu de commande**

[Figure 3.30 : Interface — Reçu de commande SecondServe avec QR code]

---

### 3.4.5 Module Administration

Le panneau d'administration centralisé permet à l'administrateur de gouverner l'ensemble de la plateforme.

**File d'attente KYC**

L'administrateur voit la liste des demandes de vérification en attente avec accès aux documents soumis. Il peut approuver ou rejeter chaque demande. L'action déclenche immédiatement la mise à jour du statut et l'envoi d'un email à l'utilisateur.

[Figure 3.31 : Interface — File d'attente KYC avec téléchargement de documents et boutons d'action]

**Gestion des utilisateurs**

L'administrateur peut lister tous les utilisateurs, les filtrer par rôle et statut de vérification, modifier leur rôle ou les bannir/débannir.

[Figure 3.32 : Interface — Console de gestion des utilisateurs avec filtres et actions]

**Tableau de bord FarMarket (administration)**

[Figure 3.33 : Interface — Tableau de bord admin FarMarket avec statistiques globales]

---

### 3.4.6 Dispositif IoT — ESP32

Le dispositif IoT au cœur du module Katara est un microcontrôleur **ESP32** équipé de capteurs de sol. Il mesure périodiquement les paramètres agronomiques et les transmet au backend VitaChain via HTTP.

**Architecture matérielle**

[Figure 3.34 : Schéma du dispositif IoT — ESP32 avec capteurs de sol connectés]

**Capteurs intégrés :**
- Capteur d'humidité du sol (résistif ou capacitif)
- Capteur de température du sol (DS18B20)
- Capteur de pH du sol (électrode pH + module analogique)
- Capteur de conductivité électrique du sol (EC meter)
- Mesure de niveau de batterie (diviseur résistif sur ADC)

**Protocole de communication**

Le firmware envoie une requête HTTP POST toutes les N minutes (configurable) vers l'endpoint `POST /api/v1/katara/ingest` avec :

```json
{
  "soil_moisture": 42.5,
  "soil_temperature": 21.3,
  "soil_ph": 6.8,
  "soil_conductivity": 1.2,
  "battery_level": 78.0,
  "recorded_at": "2026-06-17T10:30:00Z"
}
```

L'authentification se fait par les en-têtes HTTP :
```
X-Device-Id: ESP-KAT-001
X-Device-Api-Key: vk_a1b2c3d4e5f6...
```

**Flux d'appairage**

[Figure 3.35 : Diagramme de séquence — Flux d'appairage d'un ESP32 avec VitaChain]

Le fichier `devices.json` sur la carte SD ou en mémoire flash de l'ESP32 contient la configuration :
```json
{
  "wifi_ssid": "MonReseau",
  "wifi_password": "monmotdepasse",
  "vitachain_host": "https://vitachain.example.com",
  "device_id": "ESP-KAT-001",
  "api_key": "vk_a1b2c3d4e5f6...",
  "parcel_id": "uuid-de-la-parcelle",
  "send_interval_sec": 300
}
```

[Figure 3.36 : Photo du prototype ESP32 avec capteurs de sol assemblés sur breadboard]

---

## 3.5 Conclusion

Ce chapitre a présenté la réalisation complète de VitaChain. La méthodologie Scrum a permis de livrer 50+ stories réparties sur 10 sprints en ~460 heures de développement. La plateforme intègre un stack technologique moderne (Python/FastAPI, Next.js 15, React 19, PostgreSQL 17, Supabase) et couvre quatre modules fonctionnels complets : Katara (IoT agricole), FarMarket (marketplace B2B), SecondServe (anti-gaspillage) et Administration. Le dispositif ESP32 assure la collecte des données agronomiques en temps réel avec une latence d'ingestion inférieure à 50 ms.

---

# Chapitre 4 : Conclusion Générale

## 4.1 Bilan

VitaChain est une plateforme numérique agroalimentaire complète, conçue et réalisée de A à Z dans le cadre de ce Projet de Fin d'Études. Le projet a atteint l'ensemble de ses objectifs initiaux :

**Objectifs techniques atteints :**
- Architecture full-stack production-ready : FastAPI, Next.js 15, PostgreSQL 17, Docker, NGINX, TLS.
- Système d'authentification robuste avec JWT multi-rôle, Row-Level Security (22 politiques) et processus KYC.
- Module Katara opérationnel : ingestion IoT < 50 ms (p50), alertes temps réel via LISTEN/NOTIFY, diagnostics IA via Gemini, intégration OWM et Sentinel-2.
- Module FarMarket complet : cycle de vie des annonces, commandes multi-agriculteurs, anonymisation B2B, paiement COD, évaluations.
- Module SecondServe fonctionnel : offres surplus, commandes citoyens, SSO inter-application via magic-link.
- Administration centralisée : KYC, gestion utilisateurs, modération.
- Infrastructure DevOps : 50 migrations SQL, CI/CD GitHub Actions 5 jobs, sauvegardes nocturnes, monitoring Sentry + Uptime Kuma.

**Défis surmontés :**
- **Sécurité multi-rôle complexe** : La conception et le test de la matrice RLS 22-cellules (rôle × table × verbe) a nécessité une rigueur élevée pour éviter les fuites de données inter-utilisateurs.
- **Performance IoT** : L'atteinte de la cible < 50 ms sur l'ingestion télémétrique a requis la conception d'une fonction SQL atomique SECURITY DEFINER combinant vérification, insertion, dénormalisation et notification en un seul appel.
- **Anonymisation B2B** : L'implémentation de la vue `v_farmer_incoming_items` avec hash sha256 déterministe a requis une conception soignée pour préserver l'utilité (le farmer peut suivre UN restau à travers ses commandes) tout en protégeant l'identité.
- **SSO inter-application** : Le handoff SecondServe par OTP Supabase à usage unique a demandé une compréhension approfondie de l'API Supabase Auth.

**Chiffres clés du projet :**
- 50 migrations SQL
- 12 tables PostgreSQL
- 5 vues de sécurité et d'agrégation
- ~60 endpoints REST API
- ~460 heures de développement
- 10 sprints Scrum
- 4 modules fonctionnels livrés

---

## 4.2 Perspectives

VitaChain ouvre plusieurs pistes d'évolution pour les versions futures :

**Court terme :**
- **Module BotaBa9a** : Finaliser l'implémentation du module de surveillance de chaîne du froid, dont l'architecture est déjà définie (skeleton + schéma DB en place).
- **Notifications push** : Ajouter des notifications push web (Web Push API) en complément des emails pour les alertes Katara et les mises à jour de commandes FarMarket.
- **Application mobile** : Développer une application mobile (React Native ou Flutter) pour améliorer l'accessibilité aux agriculteurs en zone rurale.

**Moyen terme :**
- **Paiement en ligne** : Intégrer une vraie passerelle de paiement (CMI, PayZone Maroc) pour remplacer la simulation COD actuelle.
- **Intelligence artificielle avancée** : Enrichir les diagnostics Katara avec des modèles ML spécialisés (prédiction de rendement, recommandation d'irrigation) entraînés sur les données collectées.
- **Traçabilité blockchain** : Explorer l'ajout d'une couche de traçabilité sur la chaîne d'approvisionnement FarMarket (de la parcelle à la livraison) pour répondre aux exigences de traçabilité alimentaire.
- **Extension géographique** : Adapter la plateforme à d'autres pays du Maghreb (Tunisie, Algérie) avec localisation multi-langue (arabe, français, amazigh).

**Long terme :**
- **Marketplace de données agronomiques** : Permettre aux agriculteurs de monétiser leurs données télémétriques anonymisées auprès d'instituts de recherche et d'assureurs agricoles.
- **Intégration API nationale** : Connecter VitaChain aux systèmes d'information du Ministère de l'Agriculture marocain (MAPMDREF) pour automatiser les déclarations de parcelles.
- **Réseau de capteurs mutualisé** : Déployer des nœuds IoT communautaires permettant à plusieurs agriculteurs d'une même zone de partager l'infrastructure de capteurs.

VitaChain démontre la faisabilité technique et la pertinence d'une plateforme numérique intégrée pour le secteur agroalimentaire marocain. La combinaison de l'IoT, du marketplace B2B et de l'anti-gaspillage dans un seul écosystème constitue une proposition de valeur différenciante et un point de départ solide pour un déploiement à grande échelle.

---

# Annexe A — Configuration du dispositif ESP32

## A.1 Schéma de câblage des capteurs

[Figure A.1 : Schéma de câblage complet ESP32 — capteurs de sol, alimentation et connectivité Wi-Fi]

## A.2 Format du payload télémétrique

Le dispositif ESP32 envoie un payload JSON à intervalle configurable (défaut : 5 minutes) :

```json
{
  "soil_moisture": 45.2,
  "soil_temperature": 22.1,
  "soil_ph": 6.75,
  "soil_conductivity": 1.35,
  "battery_level": 82.0,
  "recorded_at": "2026-06-17T10:30:00.000Z"
}
```

En-têtes HTTP requis :
```
Content-Type: application/json
X-Device-Id: ESP-KAT-001
X-Device-Api-Key: vk_<32_hex_chars>
```

Réponse attendue en succès :
```json
{"status": "ok", "recorded_at": "2026-06-17T10:30:00.000Z"}
```

## A.3 Procédure d'appairage d'un nouveau dispositif

1. L'agriculteur crée une parcelle dans l'interface VitaChain.
2. Il accède à l'onglet "Dispositifs" de la parcelle et clique sur "Associer un capteur".
3. Il saisit l'identifiant du dispositif imprimé sur le boîtier ESP32 (format `ESP-KAT-NNN`).
4. Le backend génère la clé d'API et l'affiche **une seule fois** dans l'interface.
5. L'agriculteur note la clé et la saisit dans le fichier `devices.json` de l'ESP32.
6. L'ESP32 envoie sa première mesure ; le dispositif passe automatiquement en statut ACTIVE.

## A.4 Codes d'erreur de l'endpoint d'ingestion

[Tableau A.1 : Codes d'erreur de l'endpoint POST /api/v1/katara/ingest]

| Code HTTP | Erreur | Cause |
|---|---|---|
| 200 | OK | Mesure enregistrée avec succès |
| 401 | invalid_device_credentials | Clé d'API incorrecte ou dispositif inexistant |
| 409 | duplicate_timestamp | Mesure déjà reçue pour ce (device_id, recorded_at) |
| 422 | validation_error | Payload JSON invalide ou valeurs hors plage |
| 429 | rate_limited | Trop de requêtes (limite NGINX : 30 req/s) |
| 503 | service_unavailable | Base de données Supabase inaccessible |

---

# Annexe B — Matrice des droits d'accès (RLS)

## B.1 Matrice rôle × table × verbe

La matrice suivante résume les politiques Row-Level Security (RLS) implémentées dans PostgreSQL pour VitaChain. Chaque cellule indique si l'opération est autorisée (✓), interdite (✗) ou conditionnelle (C).

[Tableau B.1 : Matrice complète RLS — VitaChain (22 cellules vérifiées)]

| Table | FARMER (vérifié) | RESTAURANT (vérifié) | CITIZEN | ADMIN | Service-role |
|---|---|---|---|---|---|
| **profiles** (SELECT) | C (own) | C (own) | C (own) | ✓ (all) | ✓ |
| **profiles** (UPDATE) | C (own) | C (own) | C (own) | ✓ | ✓ |
| **kyc_documents** (SELECT) | C (own) | C (own) | ✗ | ✓ | ✓ |
| **kyc_documents** (INSERT) | ✓ | ✓ | ✗ | ✗ | ✓ |
| **m1_katara_parcels** (SELECT) | C (own) | ✗ | ✗ | ✓ | ✓ |
| **m1_katara_parcels** (INSERT) | ✓ (VERIFIED) | ✗ | ✗ | ✗ | ✓ |
| **m1_katara_devices** (SELECT) | C (own) | ✗ | ✗ | ✓ | ✓ |
| **m1_katara_telemetry** (SELECT) | C (own parcel) | ✗ | ✗ | ✓ | ✓ |
| **m1_katara_telemetry** (INSERT) | ✗ (service only) | ✗ | ✗ | ✗ | ✓ |
| **m2_farmarket_ads** (SELECT) | ✓ (active) | ✓ (active) | ✓ (active) | ✓ | ✓ |
| **m2_farmarket_ads** (INSERT) | ✓ (VERIFIED) | ✗ | ✗ | ✗ | ✓ |
| **m2_farmarket_orders** (SELECT) | ✗ | C (own) | ✗ | ✓ | ✓ |
| **m2_farmarket_orders** (INSERT) | ✗ | ✓ (VERIFIED) | ✗ | ✗ | ✓ |
| **m2_farmarket_order_items** (SELECT) | C (via v_farmer_incoming_items anonymisée) | C (own order) | ✗ | ✓ | ✓ |
| **m2_farmarket_farmer_ratings** (SELECT) | ✓ (public) | ✓ (public) | ✓ (public) | ✓ | ✓ |
| **m2_farmarket_farmer_ratings** (INSERT) | ✗ | C (DELIVERED item requis) | ✗ | ✗ | ✓ |

**Légende :**
- ✓ : Accès autorisé sans condition supplémentaire
- ✗ : Accès interdit
- C (own) : Accès conditionnel — seulement ses propres données (`auth.uid() = user_id`)
- ✓ (VERIFIED) : Accès autorisé uniquement si `verification_status = 'VERIFIED'` (WITH CHECK)

## B.2 Fonctions SECURITY DEFINER

[Tableau B.2 : Fonctions PostgreSQL SECURITY DEFINER — VitaChain]

| Fonction | Signature | Description |
|---|---|---|
| `has_role(role)` | `has_role(user_role) → boolean` | Vérifie le rôle JWT sans récursion RLS |
| `is_admin()` | `is_admin() → boolean` | Raccourci pour `has_role('ADMIN')` |
| `verify_device_api_key(device_id, api_key)` | `(text, text) → boolean` | Comparaison bcrypt en temps constant |
| `m1_katara_ingest(...)` | `(...) → void` | Ingestion atomique : vérif + INSERT + UPDATE + NOTIFY |
| `ss_place_order(...)` | `(...) → uuid` | Création de commande SecondServe avec contrôle de stock |

---

*Rapport rédigé dans le cadre du Projet de Fin d'Études — VitaChain v3*
*Auteur : Yasser — Juin 2026*
