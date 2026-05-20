# VitaChain — Product Requirements Document (PRD)

> **Document Type:** Product Requirements Document  
> **Version:** 1.0  
> **Date:** May 2026  
> **Methodology:** BMAD (Build More Architect Dreams)  
> **Scope:** MVD (Minimum Viable Demonstration) — 8-week delivery  
> **Classification:** CONFIDENTIAL

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Vision & Goals](#3-product-vision--goals)
4. [Target Users & Personas](#4-target-users--personas)
5. [Product Scope](#5-product-scope)
6. [Module Requirements](#6-module-requirements)
   - 6.1 M1 — Katara (Smart Irrigation & IoT)
   - 6.2 M2 — FarMarket (B2B Agri-Marketplace)
   - 6.3 M3 — BotaBa9a (Restaurant IoT Showcase)
   - 6.4 M4 — SecondServe (Anti-Waste B2C Marketplace)
7. [Cross-Cutting Requirements](#7-cross-cutting-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [User Stories](#9-user-stories)
10. [Success Metrics & KPIs](#10-success-metrics--kpis)
11. [Constraints & Assumptions](#11-constraints--assumptions)
12. [Delivery Roadmap](#12-delivery-roadmap)
13. [Risk Register](#13-risk-register)
14. [Out of Scope (MVD)](#14-out-of-scope-mvd)

---

## 1. Executive Summary

**VitaChain** is a modular anti-food-waste ecosystem targeting the North African agri-food chain. It connects four critical intervention points — from farm irrigation (M1 Katara) through B2B agricultural commerce (M2 FarMarket) and restaurant gas monitoring (M3 BotaBa9a) to B2C unsold-food rescue (M4 SecondServe).

The MVD goal is to demonstrate, in 8 weeks, that technology can measurably reduce food losses at each step of the chain. The product is built for three simultaneous audiences: **farmers** in rural Morocco, **restaurateurs** in urban areas, and **citizens** looking for affordable, rescued meals.

> **Total MVD Budget:** ~624 MAD (~62 USD) — hardware + 2 months infrastructure  
> **Team:** 3 developers  
> **Timeline:** 8 weeks  
> **Primary Market:** Morocco (North Africa expansion post-MVD)

---

## 2. Problem Statement

### 2.1 Global Context

The FAO estimates that **1.3 billion tonnes** of food — one-third of all food produced — is lost or wasted annually. In Morocco specifically, post-harvest losses reach **30% for some perishables**. A 1% reduction would generate **$40 million/year** in gains for smallholder farmers.

### 2.2 Four System Failures

VitaChain addresses four distinct, measurable failures across the food chain:

| # | Failure | Impact | Module |
|---|---|---|---|
| 1 | **Irrigation Failure** — Farmers irrigate "by eye". Over-irrigation causes rapid rot; under-irrigation causes market rejection. | ~17–20% crop loss in F&V | M1 Katara |
| 2 | **Logistics Failure** — No cold chain, rough handling, long delays due to intermediaries. | 10–15% distribution loss | M2 FarMarket |
| 3 | **Technical Interruption** — Gas outage, cooking stop, cold-chain break = immediate food loss in restaurants. | Unquantified but frequent | M3 BotaBa9a |
| 4 | **Linear Consumption** — Near-expiry or "ugly" products have no rescue channel. | Waste concentrated at consumption stage | M4 SecondServe |

### 2.3 Root Causes

- **Data blindness**: farmers have no real-time crop health data
- **Commercial friction**: no direct digital channel between farmers and restaurateurs
- **No second-chance market**: unsold restaurant food goes to the bin instead of a buyer
- **No predictive alerts**: equipment failures go undetected until food is already lost

---

## 3. Product Vision & Goals

### 3.1 Vision Statement

> VitaChain is a modular technical ecosystem that connects, measures, and optimizes every link of the food chain — from field to plate — via a pragmatic microservices architecture, low-cost IoT sensors, and accessible artificial intelligence.

### 3.2 MVD Goals (8 Weeks)

| Goal | Measurable Outcome |
|---|---|
| **G1 — Prove IoT ingestion works** | ESP32 sensor data visible on farmer dashboard in < 1 minute |
| **G2 — Prove AI diagnosis works** | Gemini generates agronomic advice from real sensor + weather + NDVI data |
| **G3 — Prove B2B commerce works** | Farmer publishes ad → Restaurateur contacts → Brevo email delivered |
| **G4 — Prove B2C anti-waste works** | Citizen reserves meal → receives pickup code → Restaurateur validates |
| **G5 — Prove the system is secure** | RLS policies enforced, JWT auth functional, no cross-role data leaks |
| **G6 — Prove the system scales** | 50 concurrent users, < 200 ms median response (excluding async AI) |

### 3.3 Strategic Value Pillars

| Pillar | Description |
|---|---|
| **Data** | Katara measures soil moisture, soil temperature, soil pH, soil conductivity (EC), and battery — correlated with weather + NDVI |
| **Connection** | FarMarket and SecondServe eliminate commercial bottlenecks |
| **Cash Flow** | Reducing losses and monetizing unsold goods improves liquidity for all actors |
| **Intelligence** | Google Gemini API generates personalized agronomic diagnostics and stock recommendations |

---

## 4. Target Users & Personas

### 4.1 Persona 1 — Ahmed, the Smallholder Farmer (FARMER role)

| Attribute | Detail |
|---|---|
| **Location** | Rural Morocco (Souss-Massa, Gharb, Tadla) |
| **Tech literacy** | Moderate (smartphone user, some WhatsApp) |
| **Language** | Arabic / Darija / French |
| **Pain** | Does not know when to irrigate; loses 20-30% of crops; can't find buyers without middlemen |
| **Goal** | Reduce crop losses, sell directly to restaurants, get AI irrigation advice |
| **Modules used** | M1 Katara, M2 FarMarket (Seller) |

### 4.2 Persona 2 — Fatima, the Restaurateur (RESTAURANT role)

| Attribute | Detail |
|---|---|
| **Location** | Casablanca, Marrakech, Rabat |
| **Tech literacy** | High (POS system, delivery apps) |
| **Language** | French / Darija |
| **Pain** | Gas outages disrupt production; must buy ingredients via middlemen; surplus meals go to waste |
| **Goal** | Source fresh produce directly, monetize unsold meals, get IoT monitoring |
| **Modules used** | M2 FarMarket (Buyer), M3 BotaBa9a (Prospect), M4 SecondServe (Seller) |

### 4.3 Persona 3 — Youssef, the Urban Citizen (CITIZEN role)

| Attribute | Detail |
|---|---|
| **Location** | Major Moroccan cities |
| **Tech literacy** | High (e-commerce, food delivery apps) |
| **Language** | French / Darija / Arabic |
| **Pain** | Food is expensive; wants sustainable options |
| **Goal** | Find discounted quality meals nearby, reduce personal food waste |
| **Modules used** | M4 SecondServe (Buyer) |

### 4.4 Persona 4 — Admin, the VitaChain Operator (ADMIN role)

| Attribute | Detail |
|---|---|
| **Users** | VitaChain team members |
| **Goal** | Monitor platform health, verify professionals, manage leads, track commissions |
| **Modules used** | All (read-only + admin actions) |

---

## 5. Product Scope

### 5.1 In Scope — MVD

| Feature Area | Description |
|---|---|
| User authentication | Registration, login, role assignment (FARMER / RESTAURANT / CITIZEN), profile management |
| Professional verification | KYC-lite: document upload, admin approval for farmers/restaurateurs |
| M1 Katara — IoT Dashboard | Sensor pairing, real-time telemetry display, historical charts, threshold configuration, AI diagnostic, email alerts |
| M2 FarMarket | Ad CRUD, photo upload, search/filter, contact flow (Brevo email) |
| M3 BotaBa9a | Static showcase, product catalog, lead capture form, admin lead dashboard |
| M4 SecondServe | Meal publishing, geolocated search, reservation + secret code, pickup validation, commission reporting |
| Internationalization | French (P0), Arabic/English (P0), Darija/Tamazight (post-MVD) |
| Admin Dashboard | Lead management, user verification, commission overview |
| Notifications | Email via Brevo for alerts, diagnostics, pickup codes, leads |

### 5.2 Out of Scope — MVD

- Online payment / in-app transactions (post-MVD)
- Native mobile apps (iOS / Android)
- Darija and Tamazight language packs
- Full cold-chain IoT monitoring for BotaBa9a (gas sensor hardware not demoed live)
- Multi-tenant SaaS model
- Advanced analytics / BI dashboards
- Social features (ratings, reviews)

---

## 6. Module Requirements

### 6.1 M1 — Katara (Smart Irrigation & IoT)

#### 6.1.1 Functional Requirements

| ID | Requirement | Priority | Actor |
|---|---|---|---|
| KAT-01 | Farmer can register a parcel with a GeoJSON polygon, crop type, and surface area | Must | FARMER |
| KAT-02 | Farmer can pair an ESP32 device to a parcel using a device API key | Must | FARMER |
| KAT-03 | ESP32 sends telemetry (soil moisture, soil temp, air humidity, air temp, battery) every 15 minutes | Must | ESP32 |
| KAT-04 | Farmer dashboard displays real-time and historical sensor data as charts (hourly/daily granularity) | Must | FARMER |
| KAT-05 | Farmer can configure alert thresholds per metric (min/max) | Must | FARMER |
| KAT-06 | System sends email alert when sensor reading crosses a configured threshold | Must | System |
| KAT-07 | Farmer can request an AI agronomic diagnostic by clicking a button | Must | FARMER |
| KAT-08 | AI diagnostic integrates weather (OpenWeatherMap) + satellite NDVI (Sentinel Hub) + 7-day sensor average | Must | System |
| KAT-09 | AI diagnostic is processed asynchronously; farmer is notified by email when ready | Must | System |
| KAT-10 | Farmer sees diagnostic status (PENDING / PROCESSING / COMPLETED) via polling | Must | FARMER |
| KAT-11 | System detects offline device (no ping for > 1 hour) and alerts the farmer | Should | System |
| KAT-12 | Farmer can unlink a device from a parcel and link it to another | Should | FARMER |
| KAT-13 | Historical telemetry remains queryable after device unlink | Should | FARMER |
| KAT-14 | Dashboard supports multiple parcels per farmer account | Should | FARMER |

#### 6.1.2 Non-Negotiable Business Rules

| Rule | Description |
|---|---|
| BR-K1 | One ESP32 can only be linked to one parcel at a time |
| BR-K2 | Alert anti-spam: same device + same metric cannot trigger email more than once per 24 hours |
| BR-K3 | OpenWeatherMap data is cached for at least 3 hours |
| BR-K4 | History API never returns more than 500 data points; aggregation is mandatory |

#### 6.1.3 IoT Ingestion SLA

- Endpoint `POST /api/v1/katara/ingest` must respond in **< 50 ms**
- Endpoint must validate device API key (constant-time hash comparison)
- No AI computation is allowed on the ingestion path

---

### 6.2 M2 — FarMarket (B2B Agri-Marketplace)

#### 6.2.1 Functional Requirements

| ID | Requirement | Priority | Actor |
|---|---|---|---|
| FAR-01 | Verified farmer can create an ad with: title, description, product type, price (MAD), quantity (kg), region, up to 5 photos | Must | FARMER |
| FAR-02 | Restaurateur can browse active ads with filtering by region, product type, and price range | Must | RESTAURANT |
| FAR-03 | Restaurateur can contact a seller by submitting a message and phone number | Must | RESTAURANT |
| FAR-04 | Seller receives a Brevo email with the buyer's contact details after contact form submission | Must | System |
| FAR-05 | Farmer can edit or remove their own ads | Must | FARMER |
| FAR-06 | Ads automatically expire and are archived 7 days after creation | Must | System (CRON) |
| FAR-07 | Photos are stored in Supabase Storage, not in the database | Must | System |
| FAR-08 | Admin can view all ads and all leads | Should | ADMIN |
| FAR-09 | Featured ads are displayed at the top of the catalog (premium feature) | Could | System |

#### 6.2.2 Non-Negotiable Business Rules

| Rule | Description |
|---|---|
| BR-F1 | Only users with role `FARMER` can create ads (enforced by Supabase RLS) |
| BR-F2 | Maximum 5 photos per ad, 2 MB per photo |
| BR-F3 | Ads older than 7 days are automatically set to `EXPIRED` by the nightly CRON worker |
| BR-F4 | Brevo API key must NEVER be exposed in frontend code; all email triggers go through the FastAPI backend |

---

### 6.3 M3 — BotaBa9a (Restaurant IoT Showcase)

#### 6.3.1 Functional Requirements

| ID | Requirement | Priority | Actor |
|---|---|---|---|
| BOT-01 | Public visitor can browse the BotaBa9a solution catalog (IoT devices for restaurants) | Must | VISITOR |
| BOT-02 | Visitor can view product technical sheets (specs, price, availability) | Must | VISITOR |
| BOT-03 | Visitor can submit a contact lead form (name, restaurant, phone, email, city, message) | Must | VISITOR |
| BOT-04 | Admin receives an immediate Brevo email notification when a new lead is submitted | Must | System |
| BOT-05 | Admin can view, filter, and assign leads in a protected dashboard | Must | ADMIN |
| BOT-06 | Admin can export the lead list as a CSV file | Should | ADMIN |
| BOT-07 | Admin can log notes and actions on each lead | Should | ADMIN |

#### 6.3.2 Non-Negotiable Business Rules

| Rule | Description |
|---|---|
| BR-B1 | Phone number must match Moroccan format: `^0[5-7][0-9]{8}$` (validated frontend + DB CHECK constraint) |
| BR-B2 | Lead notification is triggered by a Supabase Database Webhook directly to Brevo — no Python backend code |

---

### 6.4 M4 — SecondServe (Anti-Waste B2C Marketplace)

#### 6.4.1 Functional Requirements

| ID | Requirement | Priority | Actor |
|---|---|---|---|
| SEC-01 | Verified restaurateur can publish a "surprise box" with: title, description, original price, discounted price, quantity, pickup window, deadline | Must | RESTAURANT |
| SEC-02 | Citizen can browse available meals on a map and a list view | Must | CITIZEN |
| SEC-03 | Citizen can search meals by geolocation (lat/lng + radius) | Must | CITIZEN |
| SEC-04 | Citizen can reserve a meal; the system generates a unique secret pickup code (format: `VITA-XXX`) | Must | CITIZEN |
| SEC-05 | Citizen receives their pickup code by email (Brevo) immediately after reservation | Must | System |
| SEC-06 | Restaurateur can validate a pickup code in their app to mark the meal as collected | Must | RESTAURANT |
| SEC-07 | Meals past their deadline are automatically expired every 15 minutes | Must | System (CRON) |
| SEC-08 | Restaurateur can view their monthly commission report (15% of total COLLECTED reservations) | Must | RESTAURANT |
| SEC-09 | Citizen can see their reservation history and pickup status | Should | CITIZEN |
| SEC-10 | Restaurateur can update quantity or deadline before the first reservation | Should | RESTAURANT |

#### 6.4.2 Non-Negotiable Business Rules

| Rule | Description |
|---|---|
| BR-S1 | Pickup secret code is generated server-side only; the frontend has no involvement in code generation |
| BR-S2 | Reservation is atomic: `quantity_remaining` is decremented in a single transaction; if stock is 0, return `409 Conflict` |
| BR-S3 | Auto-expiry worker runs every 15 minutes; expired meals are no longer bookable |
| BR-S4 | Monthly commission = `SUM(meal_price × quantity_sold) × 0.15`, computed by the reporting worker |

#### 6.4.3 Payment Strategy (MVD)

- **MVD approach**: Cash on pickup. No in-app payment.
- **Commission collection**: B2B monthly invoice sent by VitaChain to the restaurateur (bank transfer or CMI link).
- **Post-MVD roadmap**: CMI integration (Moroccan market) in Year 1; Stripe for international expansion in Year 2.
- **Architectural safeguard**: All monetary values stored as `DECIMAL(10,2)` with `currency VARCHAR(3) DEFAULT 'MAD'`. Every endpoint that could trigger a payment accepts an `Idempotency-Key` header from Day 1.

---

## 7. Cross-Cutting Requirements

### 7.1 Authentication & Authorization

| Requirement | Description |
|---|---|
| AUTH-01 | Users register with email + password via Supabase Auth |
| AUTH-02 | Each user is assigned a role: `FARMER`, `RESTAURANT`, `CITIZEN`, or `ADMIN` at registration |
| AUTH-03 | JWT tokens are signed with a 256-bit secret; access tokens expire in 1 hour; refresh tokens in 7 days |
| AUTH-04 | All sensitive tables have Supabase Row Level Security (RLS) enabled |
| AUTH-05 | The Supabase Service Key (bypasses RLS) is only available in FastAPI backend containers; never in the frontend |
| AUTH-06 | Professional actions (create ad, publish meal) require `verification_status = 'VERIFIED'` |

### 7.2 Internationalization (i18n)

| Locale | Language | MVD Priority |
|---|---|---|
| `fr` | French | P0 — Must ship |
| `ar` | Arabic (MSA) | P0 — Must ship |
| `en` | English | P1 — Should ship |
| `dar` | Darija (Moroccan Arabic) | P2 — Post-MVD |
| `ber` | Tamazight (Tifinagh) | P3 — Long-term |

Key rules:
- No hardcoded string literals in `.tsx`, `.ts`, or Python files — all strings in JSON message files
- RTL layout support for Arabic locale (`dir="rtl"` on `<html>`)
- Brevo email templates exist in FR / AR / EN variants for each email type
- AI prompts to Gemini are dynamically localized based on user's saved locale preference
- Locale fallback chain: `requested_locale → fr` (never throw an error for an unsupported locale)

### 7.3 Notifications (Email via Brevo)

| Email Type | Trigger | Recipient |
|---|---|---|
| Pickup code | Citizen reserves a meal | Citizen |
| AI diagnostic ready | Gemini completes agronomic analysis | Farmer |
| Sensor threshold alert | Sensor reading crosses configured threshold | Farmer |
| Device offline alert | No ping from device for > 1 hour | Farmer |
| Lead notification | New BotaBa9a lead submitted | Admin |
| Contact lead | Restaurateur contacts seller on FarMarket | Farmer (seller) |

---

## 8. Non-Functional Requirements

### 8.1 Performance

| Requirement | Target |
|---|---|
| IoT ingestion endpoint (`POST /ingest`) | < 50 ms response time (SLA) |
| Synchronous API endpoints | < 200 ms median response time |
| AI diagnostic (async) | < 30 s (asynchronous, non-blocking) |
| Frontend initial page load | < 3 s on 4G connection |
| Concurrent users (MVD) | 50 simultaneous users without errors |

### 8.2 Reliability

| Requirement | Target |
|---|---|
| Service uptime | > 99% during demo period |
| Container auto-restart | `restart: unless-stopped` on all containers |
| Database backup | Nightly `pg_dump` → Backblaze B2 (30-day retention) |
| Demo day RTO (VPS outage) | < 30 minutes (DNS TTL pre-set to 300s) |
| Demo day fallback | Pre-recorded video + pre-generated AI data in JSON |

### 8.3 Security

| Requirement | Mechanism |
|---|---|
| Database access control | Supabase RLS on all sensitive tables |
| API key validation | Constant-time hash comparison (prevent timing attacks) |
| Rate limiting | NGINX `limit_req_zone` on public endpoints |
| Secrets management | Never committed to Git; stored in `.env` (VPS) + shared password manager (Bitwarden) |
| HTTPS | Let's Encrypt (Certbot) for all domains |
| JWT strength | 256-bit secret, short-lived tokens (1h access / 7d refresh) |

### 8.4 Scalability

| Level | Approach | When |
|---|---|---|
| Level 1 (Vertical) | Upgrade VPS from 4 to 8 vCPU / 16 GB RAM | When CPU/RAM consistently > 70% |
| Level 2 (Horizontal) | Frontend → Vercel; IoT worker → dedicated Compute VPS | When traffic spikes become unpredictable |
| Level 3 (Database) | Supavisor pooling, read replicas, logical sharding per module | When DB size exceeds 2 GB |
| Level 4 (Edge) | Cloudflare CDN + rate limiting in front of VPS | When static assets or DDoS become a concern |

### 8.5 Observability

| Tool | Purpose |
|---|---|
| Sentry | Backend + frontend error tracking (free tier: 5K events/month) |
| Uptime Kuma | Self-hosted endpoint monitoring + Telegram/Discord alerts |
| Healthchecks.io | Cron job heartbeat monitoring (detects silent backup failures) |

---

## 9. User Stories

### 9.1 Farmer — M1 Katara

```
AS a farmer,
I WANT to see real-time soil moisture and temperature data for my parcel,
SO THAT I can decide when to irrigate without guessing.

AS a farmer,
I WANT to receive an email when my soil moisture drops below a threshold I defined,
SO THAT I can act immediately before my crops suffer.

AS a farmer,
I WANT to request an AI diagnostic that analyzes my sensor data + weather forecast + satellite imagery,
SO THAT I get personalized, expert agronomic advice for my specific parcel.
```

### 9.2 Farmer — M2 FarMarket

```
AS a verified farmer,
I WANT to publish an ad for my harvest (with photos, price, quantity, region),
SO THAT restaurateurs can find and contact me directly without a middleman.

AS a farmer,
I WANT to receive an email when a restaurateur is interested in my ad,
SO THAT I can follow up immediately and close a deal.
```

### 9.3 Restaurateur — M2 FarMarket & M4 SecondServe

```
AS a restaurateur,
I WANT to browse fresh produce ads filtered by my region and ingredient type,
SO THAT I can source ingredients directly from local farmers at better prices.

AS a restaurateur,
I WANT to publish my unsold meals at a discounted price before closing time,
SO THAT I reduce daily food waste and recover some revenue.

AS a restaurateur,
I WANT to validate a citizen's pickup code in my app,
SO THAT I can confirm the handover and trigger commission tracking.
```

### 9.4 Citizen — M4 SecondServe

```
AS a citizen,
I WANT to see affordable restaurant meals available near me on a map,
SO THAT I can reserve one, save money, and help reduce food waste.

AS a citizen,
I WANT to receive my pickup code by email immediately after reserving,
SO THAT I can go to the restaurant confidently without needing to log in again.
```

### 9.5 Visitor — M3 BotaBa9a

```
AS a restaurant owner browsing the website,
I WANT to understand what IoT monitoring BotaBa9a offers and its price,
SO THAT I can decide if I want to be contacted by the sales team.

AS a visitor,
I WANT to submit my contact details,
SO THAT a VitaChain representative calls me to explain the offering.
```

---

## 10. Success Metrics & KPIs

### 10.1 Technical KPIs (Demo Day)

| Metric | Target |
|---|---|
| IoT ingestion latency (p50) | < 50 ms |
| API response time (p50, excluding AI) | < 200 ms |
| AI diagnostic end-to-end time | < 30 s |
| Zero downtime during 30-minute demo | 100% |
| All 3 demo scenarios completed successfully | 3/3 |
| Brevo email delivered | < 2 min after trigger |

### 10.2 Business KPIs (3 months post-MVD)

| Metric | Target |
|---|---|
| Registered farmers | 50+ |
| Active ESP32 devices deployed | 10+ |
| FarMarket active ads | 100+ |
| SecondServe meals published/week | 50+ |
| SecondServe reservations/week | 200+ |
| Meal waste avoided (estimated kg/month) | 500+ kg |
| BotaBa9a qualified leads generated | 20+ |

### 10.3 Financial Targets (Year 1)

| Revenue Stream | Model | Target |
|---|---|---|
| SecondServe commission | 15% of every collected reservation | Positive unit economics by Month 3 |
| BotaBa9a hardware sales | Per-unit device + installation | 10 restaurants equipped |
| FarMarket premium listings | Featured ad subscription | Pilot with 5 farmers |

---

## 11. Constraints & Assumptions

### 11.1 Constraints

| Constraint | Impact |
|---|---|
| **3 developers** | Limits parallel feature development; prioritization is critical |
| **8-week deadline** | No time for architectural pivots after Week 2 |
| **~624 MAD total budget** | Free-tier services must be used wherever possible |
| **Supabase Free Tier** | 500 MB DB, 1 GB storage, 50K MAU — sufficient for MVD |
| **No Bank Al-Maghrib license** | In-app payments are prohibited; cash-on-pickup only for MVD |
| **Gemini Free Tier** | 1,500 requests/day — sufficient for ~50 farmers requesting 1-2 diagnostics/week |

### 11.2 Assumptions

| Assumption | Basis |
|---|---|
| WiFi is available in demo environment | Demo location is controlled |
| An Arabic native speaker is available for translation | Required for P0 Arabic locale |
| Farmers have smartphones with internet access | Target profile (Souss-Massa, irrigated agriculture) |
| Restaurateurs accept cash-on-pickup model | Standard practice for Moroccan small restaurants |
| ESP32 devices remain powered for 8h+ during demo | Fully charged + power bank backup |

---

## 12. Delivery Roadmap

### Phase 1 — Build (Weeks 1–2): Infrastructure & Auth

| Task | Acceptance Criterion |
|---|---|
| VPS + Docker + NGINX provisioned | `curl http://vitachain.ma` returns 200 |
| Supabase + `profiles` + base RLS | Register / Login working via Supabase Auth |
| Next.js scaffold + login/dashboard | Full auth journey: register → login → empty dashboard |
| CI setup (GitHub Actions + pre-commit) | First PR triggers lint + unit tests |

**End-of-phase gate:** Any user can register with a role, log in, and reach a dashboard without errors.

---

### Phase 2 — More (Weeks 3–5): Core Features

| Week | Module | Key Deliverable | Acceptance Test |
|---|---|---|---|
| W3 | M1 Katara | IoT ingestion + parcel dashboard + threshold alerts | ESP32 data visible on dashboard in < 1 min |
| W4 | M2 FarMarket + M4 SecondServe + M3 BotaBa9a | B2B/B2C marketplaces + showcase | Full journey: publish → reserve → validate code |
| W5 | AI + Async Workers | Gemini diagnostic + anomaly alerts + Brevo emails | Diagnostic email received < 5 min after request |

---

### Phase 3 — Architect (Weeks 6–7): Security, Tests & Optimization

| Week | Focus | Acceptance Criterion |
|---|---|---|
| W6 | RLS audit + load testing + business rule tests | All BR-K1..BR-S4 pass; 100 req/s on `/ingest` without errors |
| W7 | Query optimization + SSL + monitoring + i18n Arabic | HTTPS on all routes; Arabic UI renders correctly with RTL; Sentry live |

**End-of-phase gate:** 50 concurrent users, < 200 ms median response. All RLS policies verified.

---

### Phase 4 — Dreams (Week 8): Polish & Demo

| Days | Activity |
|---|---|
| D-7 to D-3 | UI polish: mobile responsiveness, loading states, animations |
| D-3 to D-1 | Demo scenario rehearsal (3 scenarios, minute-by-minute script) |
| D-1 | Full rehearsal. ESP32 field test. Brevo email verification. Backup video recorded. |
| D-Day | Live demo with fallback: "Smoke & Mirrors" pre-loaded data, backup video on standby |

#### Three Demo Scenarios

1. **Scenario A — Connected Farmer**: Login FARMER → Katara Dashboard → View chart → Request AI diagnostic → Receive advice email
2. **Scenario B — Economical Restaurateur**: Login RESTAURANT → SecondServe → Publish surprise box → Citizen reserves → Restaurateur validates `VITA-XXX` code
3. **Scenario C — B2B Commerce**: Farmer publishes tomato ad → Restaurateur browses catalog → Contact form → Brevo email delivered

---

## 13. Risk Register

| Risk | Probability | Impact | Mitigation | Fallback |
|---|---|---|---|---|
| **R1 — VPS single point of failure** | Low–Medium | Critical | `restart: unless-stopped` + automated snapshots | Emergency redeploy on 2nd VPS from snapshot (< 30 min RTO) |
| **R2 — Database contention (IoT vs. e-commerce)** | Medium | High | Strict logical isolation (module prefixes + RLS) | Redis cache for high-frequency reads |
| **R3 — Scope creep / deadline overrun** | Very High | Critical | D-15 checkpoint; CI/CD prevents last-week rewrites | "Smoke & Mirrors" — hardcode demo answers if AI/IoT unstable |
| **R4 — NGINX/Docker config failure** | Medium | High | 14-day PoC time-box; documented fallback | Monolith on Vercel + serverless functions |
| **R5 — API quota exhaustion** | Low–Medium | Medium | Aggressive caching; quota monitoring | Pre-generated AI replies in local JSON ("Eternal Cache") |
| **R6 — JWT / brute-force attack** | Low | High | NGINX rate limiting; 256-bit JWT secret | Supabase key rotation + force-logout all users |
| **R7 — ESP32 / WiFi reliability in field** | High | Medium | Circular buffer + exponential backoff retry | SPIFFS local storage until reconnect |
| **R8 — Payment regulation** | Medium | High | Cash-on-pickup model; no in-app payments during MVD | B2B invoice only; legal action threshold in T&Cs |

---

## 14. Out of Scope (MVD)

The following items are explicitly deferred to post-MVD phases. They must not be implemented during the 8-week delivery window.

| Item | Reason for Deferral |
|---|---|
| Online payment (Stripe / CMI) | Regulatory complexity; architectural readiness documented in §3.4.4 |
| Native iOS / Android apps | Time constraint; PWA with Next.js covers mobile via browser |
| Darija and Tamazight languages | Requires specialist translator; ship French + Arabic first |
| Real gas sensor IoT for BotaBa9a | Hardware procurement time; showcase is static/lead-gen only |
| Full cold-chain monitoring | Beyond MVD scope; BotaBa9a is lead-gen, not live monitoring |
| Multi-tenant architecture | Single-tenant is sufficient for MVD; Supabase RLS handles isolation |
| Ratings and reviews system | Post-traction feature |
| Advanced analytics / BI dashboards | Post-traction feature |
| Social features (DMs between farmers and restaurateurs) | Post-Brevo email model |
| Kubernetes orchestration | Single-node Docker Compose scales to 50+ concurrent users; K8s is post-scale |

---

## Document Sign-off

| Role | Name | Status |
|---|---|---|
| Product Owner / Architect | — | Pending approval |
| Technical Lead | — | Pending approval |
| Steering Committee | — | Pending approval |

> This PRD is the product-level contract for VitaChain MVD. It is read in conjunction with the **VitaChain Technical Specifications** document. Any scope change after Week 2 requires a documented Change Request approved by the steering committee.

---

*Generated under BMAD methodology — May 2026*
