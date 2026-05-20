# VitaChain — Technical Specifications & Implementation

> **ULTIMATE TECHNICAL DOCUMENT**
> Ecosystem for the fight against food waste
> M1 Katara | M2 FarMarket | M3 BotaBa9a | M4 SecondServe
> Architecture, Security, Scalability & Roadmap

| Field | Value |
|---|---|
| Classification | CONFIDENTIAL — MVD (Minimum Viable Demonstration) |
| Version | 1.0 (English Edition) |
| Date | April 2026 |
| Methodology | BMAD (Build More Architect Dreams) |
| Recipients | Technical Team (3 Devs), Solution Architects, Steering Committee |

---

## Table of Contents

1. [Contextual Analysis & Vision (Dreams)](#1-contextual-analysis--vision-dreams)
2. [Technical Architecture & Foundations (Build)](#2-technical-architecture--foundations-build)
   - 2.1 Complete Technical Stack
   - 2.2 Pragmatic Microservices
   - 2.3 NGINX Reverse Proxy
   - 2.4 Docker Compose
   - 2.5 IoT Data Flow
   - **2.6 Internationalization (i18n) Strategy** *(new)*
3. [Functional Specifications & Modularity (More)](#3-functional-specifications--modularity-more)
   - 3.1 M1 — Katara
   - 3.2 M2 — FarMarket
   - 3.3 M3 — BotaBa9a
   - 3.4 M4 — SecondServe (incl. **3.4.4 Payment Processing Strategy** *(new)*)
   - 3.5 External Integrations
4. [Governance, Security & Scalability (Architect)](#4-governance-security--scalability-architect)
   - 4.1 Row Level Security
   - 4.2 Roles & JWT
   - 4.3 CI/CD & Deployment
   - 4.4 Scalability Strategy
   - **4.5 Testing & CI/CD Strategy** *(new)*
   - **4.6 Backup & Disaster Recovery** *(new)*
5. [Financial Analysis & Resources](#5-financial-analysis--resources)
6. [Constraints & Risk Management](#6-constraints--risk-management)
7. [BMAD Execution Roadmap](#7-bmad-execution-roadmap)
8. [Technical Annexes](#8-technical-annexes)

---

## 1. Contextual Analysis & Vision (Dreams)

### 1.1 Global Food Waste Context

Food waste is one of the most underestimated structural challenges of the 21st century. According to the FAO, about one third of the food produced for human consumption is lost or wasted every year — roughly **1.3 billion tonnes out of 4 billion tonnes** produced. This is not just lost food: it is a hemorrhage of natural resources (land, water, energy, inputs) coupled with avoidable CO₂ emissions.

The geographical breakdown reveals a fundamental split:

- **Industrialized countries**: waste concentrates **downstream** — distribution and consumption. European and North American consumers waste 95–115 kg/year/person.
- **Developing countries**: losses happen **upstream** — production, post-harvest, and storage. Household waste is limited (6–11 kg/year/person) due to economic constraints.

This dichotomy is critical for VitaChain: our ecosystem simultaneously targets upstream losses (agriculture) and downstream losses (food service/consumption) in an emerging region — **North Africa**.

> **Shock Data Point (FAO 2012)**
> Food wasted by consumers in industrialized countries (222 million tonnes) is nearly equal to the total net food production of Sub-Saharan Africa (230 million tonnes).

### 1.2 Regional Focus: North Africa & Morocco

In the NENA region (Near East and North Africa), the figures are alarming:

**Table 1 — Food losses per stage of the chain — North Africa region**

| Product | Agriculture | Post-Harvest / Storage | Processing | Distribution | Consumption |
|---|---|---|---|---|---|
| Fruits & Vegetables | 17% | 10% | 20% | 15% | 12% |
| Cereals | 6% | 8% | 5% | 4% | 12% |
| Roots & Tubers | 6% | 10% | 12% | 8% | 5% |
| Meat | 3% | 2% | 4% | 5% | 8% |

Morocco specifically suffers post-harvest losses reaching **30% for some perishables**. A reduction of just 1% in post-harvest losses would generate gains of **$40 million per year**, benefiting smallholder farmers directly. Over a farmer's work week, the equivalent of **3 days** is spent producing food that will eventually be discarded.

#### The 4 System Failures VitaChain Addresses

1. **Irrigation Failure (Katara)** — Farmers irrigate "by eye". Over-irrigation makes fruit fragile (fast rot); under-irrigation makes it off-spec (rejected by market). Katara brings connected data (IoT sensors) and AI irrigation advice.
2. **Logistics Failure (FarMarket)** — No cold chain, rough handling, long delays. FarMarket connects farmer directly to restaurateur, cutting middlemen and trips.
3. **Technical Interruption Failure (BotaBa9a)** — Gas outage, cooking stop, cold-chain break = immediate loss. BotaBa9a provides IoT detectors and an integrated POS to anticipate issues.
4. **Linear Consumption Failure (SecondServe)** — Near-expiry or "ugly" products have no rescue channel. SecondServe creates a B2C Click & Collect marketplace for unsold goods.

### 1.3 VitaChain Vision: The Anti-Waste Platform

> **VISION STATEMENT**
> VitaChain is a modular technical ecosystem that connects, measures, and optimizes every link of the food chain — from field to plate — via a pragmatic microservices architecture, low-cost IoT sensors, and accessible artificial intelligence. The MVD (Minimum Viable Demonstration) goal is to validate, in 8 weeks, that technology can measurably reduce losses at each critical step.

The four pillars of value:

- **Data** — Katara measures soil moisture, temperature, sensor battery, and correlates with weather + satellite NDVI imagery.
- **Connection** — FarMarket and SecondServe eliminate commercial bottlenecks by directly linking supply and demand.
- **Cash Flow** — By reducing losses and monetizing unsold goods, VitaChain improves liquidity for every actor — avoiding premature harvest driven by cash shortage.
- **Intelligence (AI)** — Google Gemini API generates personalized agronomic diagnostics and stock/replenishment recommendations.

---

## 2. Technical Architecture & Foundations (Build)

### 2.1 Complete Technical Stack

VitaChain's architecture relies on a modern, low-cost stack perfectly suited to a small team (3 developers). Every component was picked on a "best tool for the job" basis, with a systematic fallback plan.

**Table 2 — VitaChain Technical Stack — Components and Justifications**

| Layer | Technology (Best) | Alternative (Good) | Justification |
|---|---|---|---|
| Web Frontend | Next.js 15 (React + TypeScript) | React (Vite) | SEO, SSR, performance, professional structure |
| IoT & AI Backend | Python 3.12 + FastAPI | Node.js (NestJS) | Perfect for REST API + AI + data ingestion |
| Auth & DB | Supabase (PostgreSQL + Auth) | Firebase Auth + MongoDB | Relational ideal for marketplace, native RLS |
| API Gateway | NGINX (Reverse Proxy) | Traefik | Stable, fast, industry standard |
| Containerization | Docker + Docker Compose | Local setup | Dev/prod consistency, private virtual network |
| Frontend Hosting | Vercel | Netlify | Optimized for Next.js, edge deployment |
| Backend Hosting | VPS Ubuntu 24.04 (DigitalOcean) | AWS / Azure | Simple, cheap, full control |
| Notifications | Brevo (formerly Sendinblue) | SendGrid / Twilio | 300 free emails/day, easy integration |
| **Generative AI** | **Google Gemini API** (replaces Anthropic Claude) | OpenAI GPT-4 / Groq Llama 3 | **Free tier (1,500 requests/day), strong reasoning, easy SDK** |
| Weather | OpenWeatherMap API | WeatherAPI | Free and sufficient for 3h cache |
| Satellite NDVI | Sentinel Hub | Agromonitoring | European agri-tech standard, cloud-free images |
| Mapping | Leaflet.js + OpenStreetMap | Google Maps API | Free, open source, offline-capable |
| IoT Hardware | ESP32 + DHT11/22 sensors | Arduino + Ethernet Shield | Native WiFi, low-cost, mature ecosystem |

#### 🔄 Migration Note: Claude → Gemini

The original specification referenced Anthropic's Claude API. For an MVD on a tight budget with student-style usage patterns, **Google Gemini** is a stronger choice because:

| Criterion | Gemini (Free Tier) | Claude API |
|---|---|---|
| Free plan | ✅ Yes — 15 RPM, 1M TPM, 1,500 RPD on `gemini-2.0-flash` | ❌ No persistent free tier (credits expire) |
| Credit card required | ❌ No (Google account only) | ✅ Yes |
| SDK quality | ✅ Excellent (`google-genai` package) | ✅ Excellent |
| Reasoning quality | Very good (multi-modal too) | Excellent |
| Latency | Very fast (Flash family) | Moderate |
| Pricing if scaling | $0.075 / 1M input tokens (Flash) | $3 / 1M input tokens (Sonnet) |

### 2.2 Pragmatic Microservices: Architectural Justification

The retained architectural choice is **Pragmatic Microservices** (sometimes called "distributed monolith"). It is not a "pure" microservices architecture with 4 databases and a message bus, but rather a **containerized separation of business domains on a single node** (Single-Node Docker).

**Why this approach?**

1. **Isolation of asynchronous processes** — Katara (IoT + AI) generates very different load profiles than SecondServe (synchronous e-commerce). Without separation, 500 students reserving meals at noon would block farm alerts.
2. **Parallelized development** — The network team works on `backend-katara` in Python while the frontend team works on `frontend-nextjs` in TypeScript. Neither needs the other's stack installed.
3. **Incremental deployment** — `docker compose pull && docker compose up -d` updates only the modified container in seconds, without interrupting other services.
4. **Contained cost** — A single VPS (4 vCPU / 6 GB RAM) hosts everything. No $500/month Kubernetes cluster.

> **Critical: Logical Isolation Principle**
> All services share the same Supabase instance, but tables **MUST** carry strict prefixes: `m1_katara_sensors`, `m1_katara_alerts`, `m2_farmarket_ads`, `m4_secondserve_orders`. No cross-domain joins allowed. This rule is stronger than physical DB separation for a 3-person team.

### 2.3 NGINX: Reverse Proxy & Network Brain

In VitaChain, 100% of inbound traffic hits NGINX first. No request reaches an application container directly. NGINX is configured via a strict `nginx.conf` implementing the following routing rules:

**Table 3 — VitaChain NGINX Routing Rules**

| Rule | URL Pattern | Destination | Port | Container |
|---|---|---|---|---|
| R1 — B2C/B2B Frontend | `vitachain.ma` / `vitachain.ma/*` | Next.js SSR | 3000 | `frontend` |
| R2 — IoT API | `api.vitachain.ma/katara/*` | FastAPI Katara | 8000 | `katara` |
| R3 — SecondServe API | `api.vitachain.ma/secondserve/*` | FastAPI SecondServe | 8001 | `secondserve` |
| R4 — FarMarket API | `api.vitachain.ma/farmarket/*` | FastAPI FarMarket | 8002 | `farmarket` |
| R5 — Brevo Webhook | `api.vitachain.ma/webhooks/*` | FastAPI Webhooks | 8003 | `webhooks` |
| R6 — Supabase direct (RLS) | `db.vitachain.ma` | Supabase API | 54321 | `supabase` (external) |

```nginx
# nginx.conf — VitaChain Routing (excerpt)
server {
    listen 80;
    server_name vitachain.ma;

    location / {
        proxy_pass http://frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/v1/katara/ {
        proxy_pass http://katara:8000/api/v1/katara/;
        proxy_read_timeout 300s;  # AI can be slow
    }

    location /api/v1/secondserve/ {
        proxy_pass http://secondserve:8001/api/v1/secondserve/;
        proxy_read_timeout 60s;
    }

    location /api/v1/farmarket/ {
        proxy_pass http://farmarket:8002/api/v1/farmarket/;
    }
}
```

> **Why this matters**
> If 500 students hit SecondServe at lunchtime, the Next.js container heats up. NGINX keeps routing tiny ESP32 sensor packets to the Python container without interruption. The two systems ignore each other entirely.

### 2.4 Docker Compose: Internal Virtual Network

The `docker-compose.yml` file defines a **private virtual network** (an invisible LAN) inside the VPS. Containers don't address each other by complex IPs but by service name, resolved automatically by Docker's internal DNS.

```yaml
# docker-compose.yml — VitaChain Infrastructure
version: "3.9"
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - frontend
      - katara
      - secondserve
      - farmarket
    networks:
      - vitachain-net

  frontend:
    build: ./frontend
    container_name: frontend
    environment:
      - NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
    networks:
      - vitachain-net

  katara:
    build: ./backend-katara
    container_name: katara
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}   # ⬅ Replaces CLAUDE_API_KEY
      - OPENWEATHER_API_KEY=${OPENWEATHER_API_KEY}
      - SENTINEL_HUB_API_KEY=${SENTINEL_HUB_API_KEY}
      - BREVO_API_KEY=${BREVO_API_KEY}
    networks:
      - vitachain-net

  secondserve:
    build: ./backend-secondserve
    container_name: secondserve
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - BREVO_API_KEY=${BREVO_API_KEY}
    networks:
      - vitachain-net

  farmarket:
    build: ./backend-farmarket
    container_name: farmarket
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - BREVO_API_KEY=${BREVO_API_KEY}
    networks:
      - vitachain-net

  worker-cron:
    build: ./backend-katara
    container_name: worker-cron
    command: python worker_alerts.py
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - BREVO_API_KEY=${BREVO_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    networks:
      - vitachain-net

networks:
  vitachain-net:
    driver: bridge
```

> **Inter-Service Internal Communication**
> If Next.js needs to call Katara for an AI analysis, it writes: `fetch("http://katara:8000/api/v1/katara/analyze")`. Docker's DNS resolves `katara` to an internal IP. Communication runs at RAM speed, no internet latency.

### 2.5 IoT Data Flow: From ESP32 Sensor to Dashboard

The end-to-end IoT data journey, from field to farmer's screen, is the technical heart of VitaChain. Every step is optimized for speed and reliability.

#### Step 1 — Field Acquisition (ESP32)

- **Hardware**: ESP32-WROOM-32 + capacitive soil moisture sensor + DS18B20 soil-temp probe + soil pH probe + soil EC (conductivity) probe. GSM module supplies the UTC timestamp.
- **Frequency**: Telemetry every 15 minutes. Status ping every hour.
- **Format**: Minimal JSON, compressed if possible:

```json
{
  "device_id": "ESP-KAT-001",
  "api_key": "vk_7f3a9c2e4b8d1f6a0e5c3b9d2a7e4f1c",
  "timestamp": "2026-04-30T14:30:00Z",
  "readings": {
    "soil_moisture": 42.5,
    "soil_temperature": 24.1,
    "soil_ph": 6.8,
    "soil_conductivity": 1.25,
    "battery_level": 87
  }
}
```

#### Step 2 — FastAPI Ingestion (Katara)

The endpoint `POST /api/v1/katara/ingest` is the most-hit critical path. The golden rule:

> **IoT Ingestion SLA: < 50 ms**

The code does only one thing: validate the JSON (via Pydantic), check the `api_key`, and raw-insert into Supabase. No heavy computation allowed here. The `200 OK` must be returned in under 50 ms to avoid ESP32 timeouts.

```python
# katara/routers/ingest.py — critical path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from supabase import create_client
import os

router = APIRouter(prefix="/api/v1/katara", tags=["IoT"])

class TelemetryPayload(BaseModel):
    device_id: str = Field(..., pattern=r"^ESP-KAT-\d{3}$")
    api_key: str
    timestamp: str
    readings: dict

    @field_validator("api_key")
    @classmethod
    def validate_key(cls, v):
        # Constant-time hash to avoid timing attacks
        if not verify_api_key(v):
            raise ValueError("Invalid API key")
        return v

@router.post("/ingest", status_code=200)
async def ingest_telemetry(payload: TelemetryPayload):
    supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

    # Direct insert — ZERO computation
    response = supabase.table("m1_katara_telemetry").insert({
        "device_id": payload.device_id,
        "timestamp": payload.timestamp,
        "soil_moisture": payload.readings.get("soil_moisture"),
        "soil_temperature": payload.readings.get("soil_temperature"),
        "soil_ph": payload.readings.get("soil_ph"),
        "soil_conductivity": payload.readings.get("soil_conductivity"),
        "battery_level": payload.readings.get("battery_level"),
        "raw_json": payload.model_dump_json()
    }).execute()

    return {"status": "ok", "inserted_id": response.data[0]["id"]}
```

#### Step 3 — Storage & Aggregation (Supabase)

Supabase stores raw data. A CRON job (or a `pg_cron` PostgreSQL function) aggregates data by hour to avoid sending 10,000 points to the frontend. Aggregation computes mean, min, and max per hourly bucket.

#### Step 4 — Dashboard Visualization (Next.js)

The frontend calls the internal API `GET /api/v1/katara/history?device_id=ESP-KAT-001&granularity=hour` which returns aggregated data. Charts are rendered with Recharts or Chart.js (frontend team's choice).

#### Step 5 — AI Diagnostic (Gemini API) — Asynchronous

When the farmer clicks "Request a diagnostic", an async task is triggered:

1. Fetch ESP32 history (last 7 days).
2. Call OpenWeatherMap API (rain and wind over 7 days, cached 3h).
3. Call Sentinel Hub API (NDVI imagery for the parcel GeoJSON polygon, latest cloud-free image).
4. Compile the **Contextual Prompt**: "You are an expert agronomist. Here is data for this wheat parcel in Morocco: [data]... What is your advice?"
5. Call **Gemini API** (recommended model: `gemini-2.0-flash`).
6. Format the response and store in `m1_katara_diagnostics`.
7. Brevo notification to the farmer.

> **Mandatory Asynchronous Processing**
> A Gemini API call can take 2–10 seconds. The code must **NEVER** dumbly wait for the AI response in a synchronous HTTP request. Use Celery + Redis, or FastAPI `BackgroundTasks` with a polling system (status: `PENDING` → `PROCESSING` → `COMPLETED`).

### 2.6 Internationalization (i18n) Strategy

VitaChain operates in Morocco, a country where the population speaks **Darija (Moroccan Arabic)**, **Modern Standard Arabic**, **French**, and **Tamazight (Berber)**. English is also useful for the technical/investor audience. Designing for monolingual French only would exclude a large fraction of farmers and citizens. **i18n is therefore a first-class architectural concern**, not a post-launch nice-to-have.

#### 2.6.1 Target Languages — MVD Scope

**Table 2.6 — Supported Locales**

| Locale Code | Language | Audience | MVD Priority |
|---|---|---|---|
| `fr` | French | Default — most agronomists, restaurateurs, urban citizens | **P0 (must)** |
| `ar` | Arabic (MSA) | Farmers in rural areas, official communications | **P0 (must)** |
| `en` | English | Investor demos, technical docs, international partners | **P1 (should)** |
| `dar` | Darija (Moroccan Arabic, Latin script) | Citizens, informal channels | P2 (post-MVD) |
| `ber` | Tamazight (Tifinagh script) | Rural Atlas/Rif farmers | P3 (long-term) |

**MVD commitment: French + Arabic + English from Day 1.** Darija and Tamazight come post-MVD once the JSON file structure is validated.

#### 2.6.2 Frontend — `next-intl` (Next.js 15)

The frontend uses **`next-intl`**, which is the de-facto standard for Next.js App Router internationalization. Key reasons:

- Native App Router + Server Components support (no client bundle bloat).
- Automatic locale routing: `/fr/dashboard`, `/ar/dashboard`, `/en/dashboard`.
- ICU MessageFormat for plurals/genders (critical for Arabic grammar).
- TypeScript-safe message keys.
- Built-in **RTL (Right-to-Left)** detection for Arabic.

**Installation:**

```bash
npm install next-intl
```

**Project structure:**

```
frontend/
├── messages/
│   ├── fr.json          # source of truth
│   ├── ar.json
│   └── en.json
├── src/
│   ├── i18n/
│   │   ├── routing.ts   # locale config
│   │   └── request.ts   # message loader
│   ├── middleware.ts    # locale detection + redirect
│   └── app/
│       └── [locale]/    # all pages live under [locale]
│           ├── layout.tsx
│           └── ...
```

**Example message file** (`messages/fr.json`):

```json
{
  "Katara": {
    "dashboard_title": "Tableau de bord — Mes parcelles",
    "request_diagnostic": "Demander un diagnostic IA",
    "alerts_count": "{count, plural, =0 {Aucune alerte} one {# alerte} other {# alertes}}"
  },
  "SecondServe": {
    "reserve_button": "Réserver",
    "pickup_code": "Votre code de retrait : {code}"
  }
}
```

**Example component (Server Component with i18n):**

```tsx
// app/[locale]/dashboard/page.tsx
import { useTranslations } from 'next-intl';

export default function Dashboard() {
  const t = useTranslations('Katara');
  return (
    <main>
      <h1>{t('dashboard_title')}</h1>
      <button>{t('request_diagnostic')}</button>
      <p>{t('alerts_count', { count: 3 })}</p>
    </main>
  );
}
```

#### 2.6.3 RTL (Right-to-Left) Support for Arabic

When `locale === 'ar'`, the entire layout must flip. This is handled at the `<html>` level:

```tsx
// app/[locale]/layout.tsx
export default function LocaleLayout({ children, params: { locale } }) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <html lang={locale} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
```

**Tailwind CSS** automatically respects `dir="rtl"` for utilities like `ml-4` / `mr-4` via the `rtl:` modifier. Use **logical properties** (`ms-4` for margin-start, `me-4` for margin-end) wherever possible to avoid double-coding layouts.

> **⚠ Common RTL Pitfalls (to avoid)**
> - Icons that have directional meaning (arrows, "next" chevrons) must mirror in RTL → use Tailwind `rtl:rotate-180` or the `lucide-react` `-rtl` variants.
> - Charts (Recharts) do **not** auto-mirror — set `reverseDirection={true}` on Arabic locale.
> - Numbers stay LTR even in Arabic context — wrap in `<bdi>` tags if mixing with Arabic text.
> - Date pickers: use `react-day-picker` with locale prop, never hardcode month order.

#### 2.6.4 Backend (FastAPI) — Localized Responses

The backend mostly returns data, not human text. But **three things must be localized server-side**:

1. **Email content (Brevo)** — Confirmation emails, alert emails, pickup-code emails.
2. **AI prompts to Gemini** — The system instruction tells Gemini what language to respond in.
3. **Error messages returned in `detail` field** — for user-facing validation errors.

**Pattern:** the frontend sends the locale in an `Accept-Language` header. The backend uses **`python-babel`** + JSON message files to localize.

```python
# katara/i18n.py
import json
from pathlib import Path
from fastapi import Header

MESSAGES_DIR = Path(__file__).parent / "messages"
_cache: dict[str, dict] = {}

def get_messages(locale: str) -> dict:
    if locale not in _cache:
        path = MESSAGES_DIR / f"{locale}.json"
        if not path.exists():
            locale = "fr"  # fallback
            path = MESSAGES_DIR / "fr.json"
        _cache[locale] = json.loads(path.read_text(encoding="utf-8"))
    return _cache[locale]

def resolve_locale(accept_language: str | None = Header(None, alias="Accept-Language")) -> str:
    if not accept_language:
        return "fr"
    primary = accept_language.split(",")[0].split("-")[0].lower()
    return primary if primary in ("fr", "ar", "en") else "fr"
```

**Localized AI prompt example:**

```python
SYSTEM_INSTRUCTIONS = {
    "fr": "Tu es un expert agronome marocain. Réponds en français.",
    "ar": "أنت خبير زراعي مغربي. أجب باللغة العربية.",
    "en": "You are a Moroccan agronomist expert. Respond in English.",
}

response = client.models.generate_content(
    model="gemini-2.0-flash",
    contents=prompt,
    config=types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTIONS[user_locale],
        temperature=0.3,
    ),
)
```

#### 2.6.5 Database — Storing User Locale Preference

Add a `locale` column to `public.profiles`:

```sql
ALTER TABLE public.profiles
ADD COLUMN locale VARCHAR(5) DEFAULT 'fr'
    CHECK (locale IN ('fr', 'ar', 'en', 'dar', 'ber'));
```

The user's saved preference takes priority over `Accept-Language`. When sending emails (asynchronous, no HTTP context), the worker reads `profiles.locale` to pick the right Brevo template.

#### 2.6.6 Brevo Email Templates — Multi-Language

Brevo supports per-template multi-language variants. Create **one template per language per email type**:

| Email Type | French Template ID | Arabic Template ID | English Template ID |
|---|---|---|---|
| Pickup code (SecondServe) | `BREVO_TPL_PICKUP_FR` | `BREVO_TPL_PICKUP_AR` | `BREVO_TPL_PICKUP_EN` |
| AI diagnostic ready (Katara) | `BREVO_TPL_DIAG_FR` | `BREVO_TPL_DIAG_AR` | `BREVO_TPL_DIAG_EN` |
| Alert threshold (Katara) | `BREVO_TPL_ALERT_FR` | `BREVO_TPL_ALERT_AR` | `BREVO_TPL_ALERT_EN` |
| Lead contact (FarMarket) | `BREVO_TPL_LEAD_FR` | `BREVO_TPL_LEAD_AR` | `BREVO_TPL_LEAD_EN` |

The worker chooses the template ID based on `profiles.locale`:

```python
TEMPLATE_MAP = {
    ("pickup", "fr"): int(os.getenv("BREVO_TPL_PICKUP_FR")),
    ("pickup", "ar"): int(os.getenv("BREVO_TPL_PICKUP_AR")),
    ("pickup", "en"): int(os.getenv("BREVO_TPL_PICKUP_EN")),
    # ... etc
}
template_id = TEMPLATE_MAP[(email_type, user.locale)]
```

#### 2.6.7 i18n Business Rules

> **BR-I1 — Locale Fallback Chain**
> Every locale resolution must follow this fallback: `requested_locale → 'fr' (default)`. Never throw an error for an unsupported locale; serve French and log a warning.

> **BR-I2 — No Hardcoded Strings**
> Code-review rule: **no English/French string literals** in `.tsx`, `.ts`, or Python files outside of message JSON files. CI lint enforces this via `eslint-plugin-i18next` (frontend) and a custom `pre-commit` hook (backend).

> **BR-I3 — Locale-Aware Number/Date Formatting**
> Use `Intl.NumberFormat(locale)` for prices ("23,50 MAD" in fr vs "23.50 MAD" in en) and `Intl.DateTimeFormat(locale)` for dates. Never format manually.

> **BR-I4 — Arabic-Indic Numerals**
> Prices and quantities stay in Western Arabic numerals (0-9) even in Arabic UI — this is the standard in Morocco. Do not auto-convert to Eastern Arabic numerals (٠-٩) unless the user explicitly requests it.

#### 2.6.8 i18n Estimated Effort

| Task | Owner | Est. Effort |
|---|---|---|
| Set up `next-intl` + routing + middleware | Frontend | 1 day |
| Extract all UI strings to `fr.json` (source) | Frontend | 2 days (during dev, not one-shot) |
| Translate `fr.json` → `en.json` (manual + DeepL/Gemini-assisted) | Frontend + native speaker review | 1 day |
| Translate `fr.json` → `ar.json` (manual, native Arabic speaker required) | Native speaker review | 2 days |
| RTL CSS audit (mirror layouts, fix icons) | Frontend | 1 day |
| Backend `Accept-Language` parsing + locale prop | Backend | half day |
| Brevo: create 12 templates (4 types × 3 langs) | Backend + content | 1 day |
| Locale-aware worker (email selection) | Backend | half day |
| **Total** | | **~9 days** |

> **💡 Pragmatic Recommendation**
> For MVD, ship **French + English** in Week 7 (Phase Architect). Add **Arabic in Week 8** (Phase Dreams) only if a native Arabic speaker is available on the team. **Do not ship a half-translated Arabic UI** — broken Arabic is worse than no Arabic for trust with farmers.

---

## 3. Functional Specifications & Modularity (More)

This section is the **executable specification** for VitaChain. For each module we define: the database schema (tables, types, constraints), critical API routes with their Pydantic payloads, and the non-negotiable business rules.

### 3.1 M1 — Katara (FastAPI Backend & IoT)

#### 3.1.1 Database Schema

**Table 4 — Katara tables (M1) — prefix `m1_katara_`**

| Table | Main Columns | Type | Constraints |
|---|---|---|---|
| `m1_katara_devices` | id, device_id, api_key_hash, parcelle_id, status, last_seen, created_at | UUID, VARCHAR, VARCHAR, UUID, ENUM, TIMESTAMPTZ, TIMESTAMPTZ | PK(id), UQ(device_id), FK(parcelle_id) |
| `m1_katara_telemetry` | id, device_id, timestamp, soil_moisture, soil_temperature, soil_ph, soil_conductivity, battery_level, raw_json | UUID, VARCHAR, TIMESTAMPTZ, FLOAT, FLOAT, FLOAT, FLOAT, INT, JSONB | PK(id), FK(device_id), IDX(timestamp) |
| `m1_katara_parcelles` | id, user_id, name, culture_type, geojson_polygon, surface_ha, created_at | UUID, UUID, VARCHAR, VARCHAR, JSONB, FLOAT, TIMESTAMPTZ | PK(id), FK(user_id), CHECK(surface_ha > 0) |
| `m1_katara_diagnostics` | id, parcelle_id, weather_data, ndvi_data, prompt, ai_response, status, created_at | UUID, UUID, JSONB, JSONB, TEXT, TEXT, ENUM, TIMESTAMPTZ | PK(id), FK(parcelle_id), IDX(created_at) |
| `m1_katara_alerts` | id, device_id, alert_type, threshold_value, actual_value, message, sent_at, is_resolved | UUID, VARCHAR, ENUM, FLOAT, FLOAT, TEXT, TIMESTAMPTZ, BOOLEAN | PK(id), FK(device_id), IDX(sent_at) |
| `m1_katara_thresholds` | id, parcelle_id, metric, min_value, max_value, enabled | UUID, UUID, ENUM, FLOAT, FLOAT, BOOLEAN | PK(id), FK(parcelle_id), UQ(parcelle_id, metric) |

#### 3.1.2 Critical API Routes

**Table 5 — Katara API Endpoints — v1.0**

| Method | Route | Actor | Description | Response |
|---|---|---|---|---|
| POST | `/api/v1/katara/ingest` | ESP32 | Telemetry injection (critical path) | `200 OK {status, inserted_id}` |
| POST | `/api/v1/katara/ping` | ESP32 | Update `last_seen` | `200 OK {status}` |
| POST | `/api/v1/katara/parcelles` | Farmer | Create parcel (GeoJSON) | `201 Created {id}` |
| PUT | `/api/v1/katara/parcelles/{id}` | Farmer | Update parcel | `200 OK {id}` |
| DELETE | `/api/v1/katara/parcelles/{id}` | Farmer | Delete parcel | `204 No Content` |
| POST | `/api/v1/katara/parcelles/{id}/link-device` | Farmer | Link an ESP32 to a parcel | `200 OK {device_id, linked_at}` |
| GET | `/api/v1/katara/history` | Farmer | Aggregated history (hour/day) | `200 OK [{timestamp, avg_moisture, ...}]` |
| POST | `/api/v1/katara/diagnostic` | Farmer | Request AI diagnostic (async) | `202 Accepted {job_id, status: PENDING}` |
| GET | `/api/v1/katara/diagnostic/{job_id}` | Farmer | Retrieve AI result | `200 OK {status, ai_response}` |
| POST | `/api/v1/katara/thresholds` | Farmer | Configure alert thresholds | `201 Created {id}` |
| GET | `/api/v1/katara/alerts` | Farmer | List unresolved alerts | `200 OK [{alert_type, message, ...}]` |

#### 3.1.3 Non-Negotiable Business Rules

> **BR-K1 — Device-Parcel Unique Link**
> An ESP32 box can only be linked to one parcel at a time. If the farmer moves the sensor, the old link is closed (`unlinked_at` filled in) and a new link is created. The old parcel's history remains queryable.

> **BR-K2 — Alert Anti-Spam (24h)**
> If an alert was sent for a given anomaly (same device, same metric), the system blocks re-sending the same email for 24h. This prevents spamming the farmer if the sensor keeps detecting the same anomaly. Implemented via a `m1_katara_alert_log` table with a composite index `(device_id, alert_type, date_trunc('day', sent_at))`.

> **BR-K3 — Weather Cache 3h**
> OpenWeatherMap data is cached for at least 3 hours to avoid blowing the free-tier quota (60 calls/min on the Free plan). Cache key: `weather:{lat}:{lon}:{date_trunc('hour', now())}` stored in a `m1_katara_cache` table or Redis.

> **BR-K4 — Frontend Data Aggregation**
> The `/api/v1/katara/history` endpoint NEVER returns more than 500 points to the frontend. The backend must aggregate by hour or day before sending. A `granularity` parameter (hour, day, week) is mandatory.

### 3.2 M2 — FarMarket (B2B)

#### 3.2.1 Database Schema

**Table 6 — FarMarket tables (M2) — prefix `m2_farmarket_`**

| Table | Main Columns | Type | Constraints |
|---|---|---|---|
| `m2_farmarket_ads` | id, user_id, title, description, product_type, price_mad, quantity_kg, region, status, is_featured, photos_urls, created_at, expires_at | UUID, UUID, VARCHAR, TEXT, VARCHAR, DECIMAL, FLOAT, VARCHAR, ENUM, BOOLEAN, JSONB, TIMESTAMPTZ, TIMESTAMPTZ | PK(id), FK(user_id), CHECK(price_mad >= 0), CHECK(status IN ('ACTIVE','EXPIRED','SOLD','ARCHIVED')) |
| `m2_farmarket_leads` | id, ad_id, buyer_id, seller_id, message, buyer_phone, status, created_at | UUID, UUID, UUID, UUID, TEXT, VARCHAR, ENUM, TIMESTAMPTZ | PK(id), FK(ad_id), FK(buyer_id), FK(seller_id) |
| `m2_farmarket_email_log` | id, lead_id, brevo_message_id, template_used, sent_at, status | UUID, UUID, VARCHAR, VARCHAR, TIMESTAMPTZ, ENUM | PK(id), FK(lead_id) |

#### 3.2.2 Critical API Routes

**Table 7 — FarMarket API Endpoints**

| Method | Route | Actor | Description |
|---|---|---|---|
| GET | `/api/v1/farmarket/ads` | Restaurateur | List active ads (Supabase direct via PostgREST) |
| GET | `/api/v1/farmarket/ads?region=X&min_price=Y` | Restaurateur | Filter by region/price |
| POST | `/api/v1/farmarket/ads` | Farmer | Create ad (RLS: role = FARMER) |
| PUT | `/api/v1/farmarket/ads/{id}` | Farmer | Update ad (owner only) |
| DELETE | `/api/v1/farmarket/ads/{id}` | Farmer | Remove ad (status → SOLD or ARCHIVED) |
| POST | `/api/v1/farmarket/contact` | Restaurateur | Contact seller (triggers Brevo email) |
| POST | `/api/v1/farmarket/upload` | Farmer | Upload photo to Supabase Storage (max 5 photos, 2 MB each) |

#### 3.2.3 Non-Negotiable Business Rules

> **BR-F1 — RLS Security on Ad Creation**
> Only a user with the `FARMER` role can insert into `m2_farmarket_ads`. The Supabase RLS policy:
> `CREATE POLICY "only_farmers_create" ON m2_farmarket_ads FOR INSERT WITH CHECK (auth.role() = 'FARMER');`

> **BR-F2 — Photo Limits**
> Maximum 5 photos per ad, 2 MB per photo. Images stored in Supabase Storage (bucket `farmarket-photos`), not in PostgreSQL. The frontend uploads the image, retrieves the public URL, and saves it in `photos_urls` (JSONB array).

> **BR-F3 — Auto-Archive (Worker CRON)**
> A Python worker runs nightly at 3:00 AM via APScheduler. SQL: `UPDATE m2_farmarket_ads SET status = 'EXPIRED' WHERE created_at < NOW() - INTERVAL '7 days' AND status = 'ACTIVE';`. Goal: prevent a restaurateur from contacting a farmer about tomatoes that rotted two weeks ago.

> **BR-F4 — Email From Backend Only (Never Frontend)**
> The Brevo API key must NEVER appear in Next.js code. Emails are always triggered by the FastAPI backend. Flow: Restaurateur clicks "Contact" → Next.js calls `POST /api/v1/farmarket/contact` → FastAPI retrieves seller's email → Brevo sends an HTML email.

### 3.3 M3 — BotaBa9a (Showcase & Leads)

#### 3.3.1 Database Schema

**Table 8 — BotaBa9a tables (M3) — prefix `m3_botaba9a_`**

| Table | Main Columns | Type | Constraints |
|---|---|---|---|
| `m3_botaba9a_leads` | id, full_name, restaurant_name, phone, email, city, message, status, assigned_to, created_at | UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, ENUM, UUID, TIMESTAMPTZ | PK(id), UQ(phone), CHECK(phone ~ '^0[5-7][0-9]{8}$') |
| `m3_botaba9a_products` | id, name, category, description, technical_specs, price_mad, is_available | UUID, VARCHAR, VARCHAR, TEXT, JSONB, DECIMAL, BOOLEAN | PK(id) |
| `m3_botaba9a_assignments` | id, lead_id, admin_id, action, notes, created_at | UUID, UUID, UUID, VARCHAR, TEXT, TIMESTAMPTZ | PK(id), FK(lead_id), FK(admin_id) |

#### 3.3.2 API Routes & Implementation

BotaBa9a is mostly a static frontend (Next.js static generation). The product catalog can be hardcoded or stored in a local JSON file. No database is needed for marketing content.

**Table 9 — BotaBa9a Implementation — Front & Back**

| Action | Technical Implementation |
|---|---|
| Browse solutions | Static Next.js pages, `getStaticProps` + local JSON |
| Tech sheets | Modal / dedicated page, data in `products.json` |
| Submit lead | Form → Supabase: `supabase.from('m3_botaba9a_leads').insert(...)` |
| Notify admin | Supabase Webhook → Brevo. Zero Python backend code |
| Admin dashboard | Protected Next.js page, RLS: role = ADMIN |
| CSV export | Client-side JS function: JSON → CSV, direct download |

#### 3.3.3 Non-Negotiable Business Rules

> **BR-B1 — Moroccan Phone Format**
> Phone number is required and must match the Moroccan format: `^0[5-7][0-9]{8}$` (10 digits, starting with 05, 06, or 07). Validation on the frontend (regex) AND in the database (CHECK constraint).

> **BR-B2 — Zero-Code Notification**
> Use a Supabase **Database Webhook**. As soon as a row is inserted into `m3_botaba9a_leads`, Supabase calls the Brevo API to send the alert. No Python backend code to write here. Configured in Supabase UI (Database → Webhooks).

### 3.4 M4 — SecondServe (B2C Anti-Waste)

#### 3.4.1 Database Schema

**Table 10 — SecondServe tables (M4) — prefix `m4_secondserve_`**

| Table | Main Columns | Type | Constraints |
|---|---|---|---|
| `m4_secondserve_meals` | id, restaurant_id, title, description, original_price, discounted_price, quantity_initial, quantity_remaining, photo_url, pickup_start, pickup_end, deadline, status, created_at | UUID, UUID, VARCHAR, TEXT, DECIMAL, DECIMAL, INT, INT, VARCHAR, TIME, TIME, TIMESTAMPTZ, ENUM, TIMESTAMPTZ | PK(id), FK(restaurant_id), CHECK(quantity_remaining >= 0), CHECK(discounted_price < original_price) |
| `m4_secondserve_reservations` | id, meal_id, citizen_id, quantity, secret_code, status, created_at, collected_at | UUID, UUID, UUID, INT, VARCHAR, ENUM, TIMESTAMPTZ, TIMESTAMPTZ | PK(id), FK(meal_id), FK(citizen_id), UQ(secret_code) |
| `m4_secondserve_commissions` | id, restaurant_id, month, total_sales, commission_rate, commission_amount, status, created_at | UUID, UUID, VARCHAR, DECIMAL, FLOAT, DECIMAL, ENUM, TIMESTAMPTZ | PK(id), FK(restaurant_id) |

#### 3.4.2 Critical API Routes

**Table 11 — SecondServe API Endpoints**

| Method | Route | Actor | Description |
|---|---|---|---|
| GET | `/api/v1/secondserve/meals` | Citizen | List available meals (map + list) |
| GET | `/api/v1/secondserve/meals?lat=X&lng=Y&radius=Z` | Citizen | Geolocated search |
| POST | `/api/v1/secondserve/meals` | Restaurateur | Publish unsold batch |
| PUT | `/api/v1/secondserve/meals/{id}` | Restaurateur | Update quantities / deadline |
| POST | `/api/v1/secondserve/reserve` | Citizen | Reserve (generates secret code) |
| POST | `/api/v1/secondserve/validate` | Restaurateur | Validate pickup code |
| GET | `/api/v1/secondserve/commissions` | Restaurateur | Commission report (15%) |

#### 3.4.3 Non-Negotiable Business Rules

> **BR-S1 — Secret Code Generated Server-Side**
> The pickup secret code (e.g. `VITA-123`) is generated only by the FastAPI backend. The frontend doesn't take part in generation to avoid tampering. The backend verifies stock atomically (`quantity_remaining = quantity_remaining - 1`) before generating the code.

> **BR-S2 — Reservation Atomicity**
> Reservations must be atomic to prevent over-booking (race condition). Use a PostgreSQL transaction or the `quantity_remaining = quantity_remaining - 1 WHERE quantity_remaining > 0` trick. If 0 rows affected, return `409 Conflict`.

> **BR-S3 — Auto-Expiry (Worker every 15 min)**
> A Python worker runs every 15 minutes. SQL: `UPDATE m4_secondserve_meals SET status = 'EXPIRED' WHERE deadline < NOW() AND status = 'AVAILABLE';`. Ensures no citizen books a meal already thrown out by the restaurant.

> **BR-S4 — 15% Commission**
> The system computes monthly amounts owed:
> `Commission_Total = SUM(Meal_Price * Quantity_Sold) * 0.15`
> Computed monthly by the reporting worker and stored in `m4_secondserve_commissions`.

#### 3.4.4 Payment Processing Strategy

The 15% commission business model assumes VitaChain can collect money from restaurateurs (or from citizens, depending on flow). The MVD ships **without payment integration**, but the architecture must accommodate it cleanly post-demo. This subsection documents the decision tree and the three viable paths.

##### A. MVD Approach — Cash on Pickup (No Online Payment)

**For the demo and the first 3-6 months**, the flow is:

1. Citizen reserves a meal in the app → receives pickup code (`VITA-XXX`).
2. Citizen goes to the restaurant, gives the code, **pays the restaurant directly in cash** (or by local POS / card terminal the restaurant already has).
3. Restaurateur validates the code in their app → marks the reservation as `COLLECTED`.
4. At month-end, VitaChain invoices the restaurateur for 15% of all `COLLECTED` reservations.
5. The restaurateur pays VitaChain via **bank transfer** (RIB) or **CMI link** sent in the invoice email.

**Why this is the right MVD choice:**

- **Zero integration cost** — no Stripe/CMI/PayPal account, no PCI compliance audit, no risk of payment outage during the demo.
- **Trust model matches reality** — Moroccan small restaurants prefer cash; forcing card payment kills adoption.
- **No regulatory risk** — collecting money in-app would trigger Bank Al-Maghrib (Morocco's central bank) regulations for payment service providers.
- **VitaChain only handles a B2B monthly invoice**, not consumer transactions. Simple.

**Tables to add (post-MVD, anticipated):**

```sql
CREATE TABLE m4_secondserve_invoices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id UUID NOT NULL REFERENCES public.profiles(id),
    period VARCHAR(7) NOT NULL,         -- "2026-04"
    amount_due_mad DECIMAL(10,2) NOT NULL,
    invoice_number VARCHAR(50) UNIQUE,
    pdf_url TEXT,
    payment_status VARCHAR(20) DEFAULT 'PENDING'
        CHECK (payment_status IN ('PENDING','SENT','PAID','OVERDUE','CANCELLED')),
    sent_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    payment_method VARCHAR(20),         -- 'BANK_TRANSFER', 'CMI_LINK', 'CASH'
    payment_reference TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

##### B. Post-MVD Option 1 — CMI (Centre Monétique Interbancaire) — Moroccan Local

**CMI** is Morocco's national card processor. Best long-term choice for serving the Moroccan market.

| Aspect | Detail |
|---|---|
| Fees | ~1.5–2.5% per transaction (negotiable by volume) |
| Setup | Requires a Moroccan business entity (SARL/SA), bank account, ~2-month KYC process |
| Cards accepted | Local Moroccan cards (CMI network), Visa/Mastercard via the same gateway |
| Integration | REST API + redirect-based hosted payment page |
| Currency | MAD natively (no conversion fees) |
| Settlement | T+1 to T+3 to Moroccan bank account |

**Use case:** B2B — restaurateurs pay their monthly commission invoice via a CMI link emailed by VitaChain.

##### C. Post-MVD Option 2 — Stripe — International / Scale

**Stripe** is the international gold standard. Use it if/when VitaChain expands beyond Morocco (Tunisia, Algeria, Egypt, France).

| Aspect | Detail |
|---|---|
| Fees | 2.9% + 0.30 EUR for European cards; higher for non-EU |
| Setup | Stripe doesn't yet support Moroccan entities directly. Requires an EU/US holding company OR using **Stripe Atlas** (US LLC) — adds complexity. |
| Cards accepted | All international cards |
| Integration | Best-in-class SDK, `stripe-python` + `@stripe/stripe-js` |
| Currency | Multi-currency, but MAD is **not supported** — must charge in EUR/USD with conversion loss |
| Settlement | T+2 to T+7 to foreign bank account, FX risk |
| Compliance | Stripe handles PCI-DSS; VitaChain stays out of scope |

**Use case:** International expansion, or if VitaChain pivots to a SaaS subscription model for restaurants.

##### D. Post-MVD Option 3 — Hybrid (Recommended for Year 2)

| Flow | Channel | Reason |
|---|---|---|
| Citizen → Restaurant (consumer payment) | **Cash at pickup** | No friction, no fees, no regulation |
| Restaurant → VitaChain (commission) | **CMI link** in monthly invoice | Local cards, low fees, Moroccan compliance |
| Restaurant → VitaChain (annual SaaS) | **Stripe** (if going international) | Recurring subscriptions, dunning automation |

##### E. Architectural Decisions (Locked Today, Even Without Payment)

To avoid expensive refactoring later, lock these decisions **now**:

1. **Money values are always stored as `DECIMAL(10,2)`** — never `FLOAT`. Add a `currency VARCHAR(3) DEFAULT 'MAD'` column to every money-bearing table.
2. **All amounts in cents internally?** No — Moroccan accounting works in MAD with 2 decimals. Stay in MAD as `DECIMAL`. (Stripe-style integer cents is a Western pattern not worth adopting here.)
3. **Idempotency from Day 1** — every endpoint that could one day trigger a payment (`POST /reserve`, `POST /validate`) accepts an `Idempotency-Key` header. Even without payment today, this prevents double-reservations and is free to add.
4. **Audit log table** — `audit_log` records every state change on `reservations` and (future) `invoices`. Critical for accounting reconciliation when payment goes live.
5. **No payment logic in `secondserve` service** — when added, payment becomes its own container (`backend-payments`) for PCI scope isolation.

##### F. Demo-Day Talking Point

During the MVD presentation, the payment question **will** be asked. Suggested answer:

> *"For the MVD we deliberately use cash-on-pickup, which is how 95% of Moroccan small restaurants already operate. The 15% commission is collected B2B via monthly CMI-linked invoices — we've architected the system idempotently and currency-aware so adding CMI is a 2-week task, but we didn't want payment risk on the demo critical path. International expansion would layer Stripe on top in Year 2."*

This shows commercial maturity, not a gap.

### 3.5 External Integrations (AI, Weather, Satellite)

#### 3.5.1 Google Gemini API — Agronomic Diagnostic *(replaces Claude)*

**Table 12 — Gemini API configuration for Katara**

| Parameter | Value | Justification |
|---|---|---|
| Model | `gemini-2.0-flash` | Free tier (1,500 requests/day), fast, multilingual, strong reasoning |
| Fallback Model | `gemini-2.5-flash` | Slightly better quality, also free tier |
| Max Output Tokens | 2048 | Enough for a detailed diagnostic in French/English |
| Temperature | 0.3 | Deterministic, factual replies |
| System Instruction | "You are a Moroccan agronomist expert..." | Geographic and business context injected |
| API Timeout | 30s | User feedback via async polling |
| SDK | `google-genai` (Python) | Official, actively maintained |

**Installation:**

```bash
pip install google-genai
```

**Implementation example:**

```python
# katara/services/ai_diagnostic.py
import os
from google import genai
from google.genai import types

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

SYSTEM_INSTRUCTION = """You are an expert Moroccan agronomist specialized in perishable crops.
You analyze IoT sensor data, weather, and NDVI satellite imagery to formulate
concise, actionable recommendations. Reply in French unless asked otherwise.
Structure your answer as: 1) Diagnostic, 2) Top 3 priority recommendations."""

def build_user_prompt(parcelle, sensor_avg, weather, ndvi):
    return f"""
Parcel: {parcelle['name']} ({parcelle['culture_type']})
Location: {parcelle['lat']}, {parcelle['lng']}
Period: {parcelle['start_date']} to {parcelle['end_date']}

Sensor data (7-day averages):
- Soil moisture: {sensor_avg['soil_moisture']} %
- Soil temperature: {sensor_avg['soil_temperature']} °C
- Soil pH: {sensor_avg['soil_ph']}
- Soil conductivity (EC): {sensor_avg['soil_conductivity']} mS/cm

Weather (OpenWeatherMap):
- Forecast precipitation: {weather['rain_forecast']} mm
- Wind: {weather['wind_speed']} km/h

Vegetation health (Sentinel NDVI):
- Mean value: {ndvi['mean']} (scale -1 to 1)
- Trend: {ndvi['trend']}

Question: What is your diagnostic and your 3 priority recommendations?
"""

async def get_agronomic_diagnostic(parcelle, sensor_avg, weather, ndvi):
    prompt = build_user_prompt(parcelle, sensor_avg, weather, ndvi)

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0.3,
            max_output_tokens=2048,
        ),
    )
    return response.text
```

**Free tier quotas (gemini-2.0-flash):**
- 15 requests per minute (RPM)
- 1 million tokens per minute (TPM)
- 1,500 requests per day (RPD)
- No credit card required

For an MVD with ~50 farmers requesting 1-2 diagnostics/week, this is **largely sufficient** and stays free.

#### 3.5.2 OpenWeatherMap API — Cache & Quotas

**Table 13 — OpenWeatherMap Strategy**

| Aspect | Implementation |
|---|---|
| Plan | Free Tier (60 calls/min, 1M calls/month) |
| Endpoint | `/data/2.5/forecast?lat={lat}&lon={lon}&appid={key}` |
| Cache | `m1_katara_cache` table with 3h TTL |
| Cache key | `weather:{lat}:{lon}:{date_trunc('hour', now())}` |
| Fallback | If quota exhausted, return last valid cache or generic message |

#### 3.5.3 Sentinel Hub — NDVI Imagery

**Table 14 — Sentinel Hub Strategy**

| Aspect | Implementation |
|---|---|
| Service | Sentinel Hub OAuth2 + Process API |
| Query | `NDVI = (B08 - B04) / (B08 + B04)` over the parcel's GeoJSON polygon |
| Resolution | 10m (Sentinel-2 B04 & B08 bands) |
| Cloud filter | `MaxCloudCoverage < 20%` |
| Period | Latest image available within last 30 days |
| Cache | `m1_katara_cache` table with 24h TTL (satellite images change slowly) |

```json
// Sentinel Hub payload (example)
{
  "input": {
    "bounds": {
      "geometry": { "type": "Polygon", "coordinates": [] }
    },
    "data": [{
      "type": "sentinel-2-l2a",
      "dataFilter": {
        "timeRange": {"from": "2026-04-01", "to": "2026-04-30"},
        "maxCloudCoverage": 20
      }
    }]
  },
  "output": {
    "responses": [{
      "identifier": "ndvi",
      "format": { "type": "image/tiff" }
    }]
  }
}
```

---

## 4. Governance, Security & Scalability (Architect)

### 4.1 Supabase Row Level Security (RLS)

RLS is VitaChain's core security mechanism. It guarantees that each user can only access data they own or are authorized to see. Without RLS, a simple JWT would expose the entire database.

> **Fundamental Principle**
> Every table containing sensitive data must have `ENABLE ROW LEVEL SECURITY` activated. Policies define who can do what on which rows.

#### RLS Policies by Module

**Table 15 — Key RLS Policies — VitaChain**

| Table | Operation | RLS Policy | Description |
|---|---|---|---|
| `m1_katara_parcelles` | SELECT | `auth.uid() = user_id OR auth.role() = 'ADMIN'` | Farmer sees only their parcels |
| `m1_katara_parcelles` | INSERT | `auth.role() = 'FARMER'` | Only farmers create parcels |
| `m2_farmarket_ads` | SELECT | `status = 'ACTIVE' OR auth.uid() = user_id OR auth.role() = 'ADMIN'` | Public sees actives, owner sees own |
| `m2_farmarket_ads` | UPDATE | `auth.uid() = user_id OR auth.role() = 'ADMIN'` | Only owner can modify |
| `m4_secondserve_meals` | SELECT | `status = 'AVAILABLE' OR auth.uid() = restaurant_id OR auth.role() = 'ADMIN'` | Public sees available |
| `m4_secondserve_reservations` | SELECT | `auth.uid() = citizen_id OR auth.uid() IN (SELECT restaurant_id FROM m4_secondserve_meals WHERE id = meal_id) OR auth.role() = 'ADMIN'` | Citizen or related restaurant |
| `m3_botaba9a_leads` | SELECT | `auth.role() = 'ADMIN'` | Admins only |

```sql
-- Example: RLS policy for m1_katara_parcelles
ALTER TABLE m1_katara_parcelles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parcelles_select_own" ON m1_katara_parcelles
    FOR SELECT USING (
        auth.uid() = user_id
        OR auth.role() = 'ADMIN'
    );

CREATE POLICY "parcelles_insert_farmer" ON m1_katara_parcelles
    FOR INSERT WITH CHECK (
        auth.role() = 'FARMER'
    );

CREATE POLICY "parcelles_update_own" ON m1_katara_parcelles
    FOR UPDATE USING (
        auth.uid() = user_id
        OR auth.role() = 'ADMIN'
    );
```

> **Service Key vs. Anon Key**
> - **Anon Key (frontend)** — Used by Next.js for direct Supabase calls. Subject to RLS policies. Cannot bypass security.
> - **Service Key (backend)** — Used by FastAPI containers. Has `postgres` privileges and ignores RLS. Must live exclusively in backend container env vars (never exposed to clients).

### 4.2 Roles & JWT Management

Supabase Auth centralizes authentication. Every user in `auth.users` is linked to a `public.profiles` row storing additional info and role.

**Table 16 — VitaChain Role Enum**

| Role | Code | Description | Accessible Modules |
|---|---|---|---|
| Farmer | FARMER | Agricultural producer | M1 (Katara), M2 (Seller) |
| Restaurateur | RESTAURANT | Food service business | M2 (Buyer), M3 (Prospect), M4 (Seller) |
| Citizen | CITIZEN | End consumer | M4 (Buyer) |
| Administrator | ADMIN | VitaChain team | All + Admin Dashboard |
| Visitor | VISITOR | Unauthenticated | M3 (public showcase only) |

```sql
-- Profiles table
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    role VARCHAR(20) NOT NULL CHECK (role IN ('FARMER','RESTAURANT','CITIZEN','ADMIN')),
    full_name VARCHAR(255),
    phone VARCHAR(20),
    city VARCHAR(100),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_status VARCHAR(20) DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED')),
    is_premium BOOLEAN DEFAULT FALSE,
    premium_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Lightweight Professional Verification (KYC-lite)

The `pro_verifications` table stores proofs (ID photo, business registry). An admin clicks "Approve", which flips `verification_status` from `PENDING` to `VERIFIED`. Required to:

- Publish an ad on FarMarket (role FARMER)
- Publish a meal on SecondServe (role RESTAURANT)

### 4.3 CI/CD & Ubuntu 24.04 VPS Deployment

#### Deployment Architecture

The CI/CD pipeline is deliberately simple for a 3-person team. No complex GitHub Actions, no Kubernetes. The workflow: **Git + Docker Compose + SSH**.

#### VPS Configuration

**Table 17 — Recommended VPS Specs**

| Component | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS (server) |
| vCPU | 2 cores | 4 cores |
| RAM | 4 GB | 6–8 GB |
| Storage | 50 GB SSD | 80 GB SSD |
| Bandwidth | 1 TB/month | 2 TB/month |
| Provider | DigitalOcean / OVH | DigitalOcean (simplicity) |

#### Initial Provisioning Script

```bash
#!/bin/bash
# setup_vps.sh — Initial Ubuntu 24.04 provisioning

# System update
apt update && apt upgrade -y

# Docker install
apt install -y apt-transport-https ca-certificates curl gnupg lsb-release
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Docker Compose standalone (legacy)
curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Docker without sudo
usermod -aG docker $USER

# Clone repo
git clone https://github.com/vitachain/vitachain-mvd.git /opt/vitachain
cd /opt/vitachain

# .env file (to be filled before first run)
cp .env.example .env

# Launch
docker-compose up -d --build

# SSL with Certbot (NGINX + Let's Encrypt)
apt install -y certbot python3-certbot-nginx
certbot --nginx -d vitachain.ma -d api.vitachain.ma -d db.vitachain.ma
```

#### Git Workflow & Deployment

1. **Local dev** — Each dev works on a feature branch (`feat/katara-iot`, `feat/secondserve-reservation`).
2. **Pull Request** — Mandatory code review (at least 1 approval).
3. **Merge to main** — `main` is protected.
4. **Deployment** — Tech lead SSHes in and runs:

```bash
cd /opt/vitachain
git pull origin main
docker-compose pull
docker-compose up -d --build
# Rolling update: Docker recreates only changed containers
```

> **Rolling Update & Zero-Downtime**
> `docker-compose up -d` only recreates containers whose image or config changed. NGINX stays up. Downtime per container is under 2 seconds.

### 4.4 Post-MVD Scalability Strategy

The Single-Node Docker architecture is **designed to evolve** into a distributed model without rewriting application code. The transition uses 4 progressive levels:

#### Level 1 — Vertical Scalability (Scale-Up) — Immediate

Increase the single VPS resources. Go from 4 vCPU / 6 GB RAM to 8 vCPU / 16 GB RAM. Generally needs a <5-minute reboot. Docker auto-reallocates resources.

#### Level 2 — Horizontal Scalability (Scale-Out) — Modular

Separate containers across distinct servers when traffic demands:

- **Frontend / Web** — Migrate to Vercel (serverless edge). Student traffic spikes are absorbed automatically.
- **Worker / IoT** — Deploy on a dedicated "Compute-Optimized" VPS for continuous ESP32 telemetry + AI calls.
- **Orchestration** — Docker Swarm (lightweight) or Kubernetes (if complexity warrants).

#### Level 3 — Data Layer Scalability

- **Connection Pooling** — Use Supavisor (PgBouncer) to absorb thousands of simultaneous connections.
- **Read Replicas** — On Supabase Pro, deploy read replicas to offload analytical queries.
- **Logical Sharding** — When DB hits several GB, migrate `m1_katara_*` tables to a dedicated Supabase instance (IoT), keeping `m4_secondserve_*` on the main one (transactions).

#### Level 4 — Edge & CDN Distribution

- **Cloudflare** — In front of the VPS to cache static assets (meal photos, BotaBa9a scripts). Drastic load reduction.
- **Rate Limiting** — Cloudflare + NGINX absorb anomalous traffic spikes; anti-DDoS protection ensures farm alerts (Katara) aren't disrupted by an attack on the consumer marketplace.
- **Optimized Images** — Cloudflare Polish auto-compresses JPEG/PNG, reducing bandwidth.

### 4.5 Testing & CI/CD Strategy

A 3-developer team merging into a shared `main` branch **will** break things — repeatedly. Manual SSH deployment without automated tests turns every release into a coin flip. This section locks the minimum viable testing pyramid and a GitHub Actions CI pipeline that costs **0 MAD** (free tier) and ~half a day to set up.

#### 4.5.1 Testing Philosophy — Pragmatic, Not Dogmatic

We do **not** aim for 100% code coverage. We aim to **catch the 20% of bugs that would cause 80% of demo-day disasters**. Priority order:

1. **Critical-path smoke tests** — Can a user log in, see their dashboard, complete the Happy Path?
2. **Business rule unit tests** — The BR-K1..BR-S4 rules are the contract; each gets a dedicated test.
3. **Schema contract tests** — Pydantic models match real API responses (no silent breakage).
4. **Integration tests** — Backend + Supabase interaction (rare, expensive, but valuable).
5. **Load tests** — Only `/ingest` and `/meals` matter for MVD (already covered in Phase Architect, §7.3).

What we **deliberately skip** for MVD: end-to-end Cypress with real DB, mutation testing, contract testing across services, chaos engineering. Re-evaluate post-MVD.

#### 4.5.2 The Testing Pyramid — VitaChain Edition

**Table 4.5 — Test Layers and Tools**

| Layer | Tool | Scope | Expected Count | Run When |
|---|---|---|---|---|
| **Unit (Backend)** | `pytest` + `pytest-asyncio` | Pure functions, Pydantic validators, business rules, formula computations | ~80-150 tests | Every commit, every PR |
| **Unit (Frontend)** | `vitest` + `@testing-library/react` | React components, hooks, utility functions | ~30-60 tests | Every commit, every PR |
| **Integration (Backend)** | `pytest` + Supabase test project | API endpoint → DB round-trip with seeded data | ~20-30 tests | Every PR (not every commit) |
| **E2E Smoke** | `Playwright` | 3 happy paths (Farmer login → diagnostic, Citizen reserve → code, Restaurant validate code) | 3 scenarios | Every PR + pre-deploy |
| **Load** | `k6` or `locust` | `/ingest` 100 req/s, `/meals` 50 req/s | 2 scripts | Manually, before demo |
| **Lint / Type** | `ruff`, `mypy`, `eslint`, `tsc --noEmit` | Code quality, type safety | All files | Every commit (pre-commit hook) |

#### 4.5.3 Backend Testing — pytest Patterns

**Setup** (`backend-katara/pyproject.toml`):

```toml
[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "pytest-cov>=4.1",
    "httpx>=0.27",          # async test client for FastAPI
    "respx>=0.21",          # mock external HTTP calls (Gemini, OpenWeather)
    "ruff>=0.4",
    "mypy>=1.10",
]
```

**Example — Unit test for a business rule (BR-S2 — Atomic Reservation):**

```python
# tests/test_business_rules.py
import pytest
from secondserve.services.reservation import attempt_reservation, OutOfStockError

@pytest.mark.asyncio
async def test_BR_S2_atomic_reservation_prevents_overbooking(db_session):
    """BR-S2: Two parallel reservations for the last item must not both succeed."""
    meal = await create_test_meal(db_session, quantity_remaining=1)

    # Simulate two concurrent reservations
    import asyncio
    results = await asyncio.gather(
        attempt_reservation(meal.id, citizen_id="u1"),
        attempt_reservation(meal.id, citizen_id="u2"),
        return_exceptions=True,
    )

    # Exactly one succeeds, exactly one raises OutOfStockError
    successes = [r for r in results if not isinstance(r, Exception)]
    failures = [r for r in results if isinstance(r, OutOfStockError)]

    assert len(successes) == 1
    assert len(failures) == 1
```

**Example — Mocking the Gemini API** (no real API call in tests, no quota burn):

```python
# tests/test_ai_diagnostic.py
import respx
import httpx
from katara.services.ai_diagnostic import get_agronomic_diagnostic

@respx.mock
async def test_gemini_diagnostic_returns_french_text():
    respx.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent").mock(
        return_value=httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": "Diagnostic: parcelle stressée hydriquement..."}]}}]
        })
    )

    result = await get_agronomic_diagnostic(...)
    assert "Diagnostic" in result
```

#### 4.5.4 Frontend Testing — Vitest + Testing Library

```ts
// __tests__/components/MealCard.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MealCard } from '@/components/MealCard';

test('MealCard shows discounted price strikethrough', () => {
  render(<MealCard meal={{ title: 'Couscous', original_price: 50, discounted_price: 20 }} />);
  expect(screen.getByText('50 MAD')).toHaveClass('line-through');
  expect(screen.getByText('20 MAD')).toBeVisible();
});

test('Reserve button calls API on click', async () => {
  const onReserve = vi.fn();
  render(<MealCard meal={mockMeal} onReserve={onReserve} />);
  await userEvent.click(screen.getByRole('button', { name: /réserver/i }));
  expect(onReserve).toHaveBeenCalledWith(mockMeal.id);
});
```

#### 4.5.5 E2E Smoke Tests — Playwright

**Three scenarios match the three demo paths in §7.4.** Each scenario is a single Playwright test that runs against a deployed staging environment.

```ts
// e2e/citizen-reserves-meal.spec.ts
import { test, expect } from '@playwright/test';

test('Citizen reserves a meal and receives a pickup code', async ({ page }) => {
  await page.goto('https://staging.vitachain.ma/fr/login');
  await page.fill('input[name="email"]', 'citizen-demo@vitachain.ma');
  await page.fill('input[name="password"]', process.env.DEMO_CITIZEN_PASSWORD!);
  await page.click('button[type="submit"]');

  await page.goto('/fr/secondserve');
  await page.click('text=Réserver').first();

  const code = await page.locator('[data-testid="pickup-code"]').textContent();
  expect(code).toMatch(/^VITA-\d{3}$/);
});
```

#### 4.5.6 GitHub Actions CI Pipeline

**File: `.github/workflows/ci.yml`** — runs on every push and PR, takes ~3-5 minutes total, **free** under GitHub's open-source / 2000-minutes/month quota.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  backend:
    name: Backend (FastAPI)
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [backend-katara, backend-secondserve, backend-farmarket]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }

      - name: Install dependencies
        working-directory: ${{ matrix.service }}
        run: |
          pip install -e ".[dev]"

      - name: Lint (ruff)
        working-directory: ${{ matrix.service }}
        run: ruff check .

      - name: Type check (mypy)
        working-directory: ${{ matrix.service }}
        run: mypy .

      - name: Unit tests
        working-directory: ${{ matrix.service }}
        run: pytest -v --cov=. --cov-report=term-missing --cov-fail-under=60

  frontend:
    name: Frontend (Next.js)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: frontend/package-lock.json }

      - name: Install
        working-directory: frontend
        run: npm ci

      - name: Lint (eslint)
        working-directory: frontend
        run: npm run lint

      - name: Type check
        working-directory: frontend
        run: npx tsc --noEmit

      - name: Unit tests (vitest)
        working-directory: frontend
        run: npm test -- --run

      - name: Build (catches build-time errors)
        working-directory: frontend
        run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder

  e2e:
    name: E2E Smoke (Playwright)
    runs-on: ubuntu-latest
    needs: [backend, frontend]
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Install Playwright
        working-directory: e2e
        run: |
          npm ci
          npx playwright install --with-deps chromium
      - name: Run smoke tests
        working-directory: e2e
        run: npx playwright test
        env:
          STAGING_URL: ${{ secrets.STAGING_URL }}
          DEMO_CITIZEN_PASSWORD: ${{ secrets.DEMO_CITIZEN_PASSWORD }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: e2e/playwright-report/
```

#### 4.5.7 Pre-Commit Hooks (Local Safety Net)

To catch lint errors **before** they hit CI (faster feedback):

**File: `.pre-commit-config.yaml`**

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.10.0
    hooks:
      - id: mypy
        additional_dependencies: [pydantic, fastapi]

  - repo: local
    hooks:
      - id: eslint
        name: ESLint (frontend)
        entry: bash -c 'cd frontend && npm run lint'
        language: system
        files: ^frontend/.*\.(ts|tsx|js|jsx)$
```

Install on every dev machine:

```bash
pip install pre-commit
pre-commit install
```

#### 4.5.8 CD — Continuous Deployment (Post-Merge to `main`)

Manual SSH deployment (as in §4.3) is OK for MVD, but we add **one automation** to remove drift: a GitHub Actions job that SSHes into the VPS and runs the deploy script.

```yaml
# .github/workflows/deploy.yml
name: Deploy to production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: github.repository == 'vitachain/vitachain-mvd'
    steps:
      - name: SSH and deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/vitachain
            git pull origin main
            docker-compose pull
            docker-compose up -d --build
            docker system prune -f
            ./healthcheck.sh
```

> **🔒 Required GitHub Secrets**
> - `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` — deploy creds
> - `STAGING_URL`, `DEMO_CITIZEN_PASSWORD`, `DEMO_FARMER_PASSWORD` — E2E creds
> - Store via Settings → Secrets and variables → Actions. **Never commit these.**

#### 4.5.9 Quality Gates — Definition of "Mergeable"

A PR cannot merge to `main` unless **all** these are green:

- [ ] All CI jobs pass (lint, type-check, unit tests, build)
- [ ] Code coverage ≥ 60% on backend services (lenient for MVD)
- [ ] At least 1 reviewer approval (from a different dev than the author)
- [ ] No `TODO`/`FIXME` introduced in the diff without a linked issue
- [ ] No `console.log`/`print` debug statements in the diff
- [ ] PR description includes: *what changed*, *why*, *how to test*

Configure via **GitHub branch protection rules** on `main`. Set up once, enforced forever.

#### 4.5.10 Observability as Test (Bonus)

Tests catch known bugs. **Observability catches unknown bugs in production.** Add these free-tier tools from Week 1:

| Tool | Purpose | Plan | Setup time |
|---|---|---|---|
| **Sentry** | Backend + frontend error tracking, stack traces | Free (5K events/month) | 30 min |
| **Uptime Kuma** | Self-hosted endpoint monitoring, Telegram/Discord alerts | Free (self-host on VPS) | 1 hour |
| **PostHog** *(optional)* | Product analytics, funnel tracking | Free (1M events/month) | 1 hour |

```python
# backend-katara/main.py
import sentry_sdk
sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    environment=os.getenv("ENVIRONMENT", "production"),
    traces_sample_rate=0.1,  # 10% of requests profiled
)
```

```tsx
// frontend/instrumentation.ts
import * as Sentry from "@sentry/nextjs";
Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN });
```

#### 4.5.11 Estimated Effort & ROI

| Activity | Effort | Estimated Time Saved |
|---|---|---|
| Initial CI setup (workflows, secrets) | 4 hours | — |
| Pre-commit hooks | 1 hour | — |
| First 20 backend unit tests (BR-K1..BR-S4) | 1 day | ~10 hours of debugging weekly |
| 3 Playwright E2E smoke tests | 1 day | Catches **all** demo-day disasters |
| Sentry + Uptime Kuma | 2 hours | ~20 hours of "why isn't it working" |
| **Total upfront** | **~3 days** | **~50+ hours of saved debugging over 8 weeks** |

> **Bottom line:** spending 3 days on testing infrastructure at the start of Phase Build (week 1, in parallel with VPS setup) is the single highest-ROI investment for the project. **Do it before writing any business logic.**

### 4.6 Backup & Disaster Recovery

> **⚠ Reality check**
> Supabase Free Tier does **NOT** include automated database backups. If a developer runs `DELETE FROM m2_farmarket_ads;` without a `WHERE` clause, or if Supabase has a regional incident, **your data is gone forever**. A backup strategy is not optional — it's existential.

This section defines what to back up, how often, where it lands, and — most importantly — **how to actually restore it** when things go wrong.

#### 4.6.1 What Must Be Backed Up

**Table 27 — Backup Inventory by Criticality**

| Asset | Criticality | RPO (Recovery Point Objective) | RTO (Recovery Time Objective) | Strategy |
|---|---|---|---|---|
| **PostgreSQL DB** (all `m*_*` tables + `auth`, `profiles`) | 🔴 Critical | ≤ 24 h | ≤ 2 h | Nightly `pg_dump` → offsite bucket |
| **Supabase Storage** (FarMarket photos, ad assets) | 🟠 High | ≤ 7 days | ≤ 4 h | Weekly `rclone` sync → offsite |
| **VPS Docker volumes** (NGINX logs, Redis cache) | 🟡 Medium | ≤ 7 days | ≤ 1 day | Weekly VPS snapshot |
| **`.env` files & secrets** | 🔴 Critical | One-time | < 30 min | Encrypted vault (Bitwarden / 1Password) |
| **Git repo** | 🟢 Low (GitHub is the source of truth) | — | — | GitHub + 1 mirror (GitLab) |
| **ESP32 firmware** (compiled `.bin`) | 🟡 Medium | Per release | < 1 h | Tagged GitHub release |
| **Demo "Smoke & Mirrors" data** (JSON fallback) | 🔴 Critical (demo day) | One-time | Immediate | Versioned in Git repo |

> **RPO = how much data you can afford to lose. RTO = how fast you must be back online.**
> For an MVD demo, the **demo day RTO is < 15 minutes**. Plan accordingly.

#### 4.6.2 Backup Destinations — The "3-2-1" Rule

The industry-standard rule: **3** copies of your data, on **2** different media, with **1** offsite. For VitaChain:

| Copy | Location | Type | Cost |
|---|---|---|---|
| #1 — Primary | Supabase (live database) | Production | $0 (Free Tier) |
| #2 — Local snapshot | VPS local disk (`/opt/backups/`) | Same VPS — fast restore | $0 |
| #3 — Offsite | **DigitalOcean Spaces** or **Backblaze B2** | Different provider, different region | ~$5/month |

> **Why a different provider?** If DigitalOcean has an outage that takes down your VPS, you can still pull backups from Backblaze. Putting backups on the same VPS as the DB is **not** a backup — it's a recipe for shared failure.

**Recommended choice for VitaChain:** **Backblaze B2** (`$0.006/GB/month`, 10 GB free) or **Cloudflare R2** (10 GB free, zero egress fees). Both work with the S3-compatible CLI.

#### 4.6.3 Nightly PostgreSQL Backup Script

```bash
#!/bin/bash
# /opt/vitachain/scripts/backup_db.sh
# Runs nightly at 02:00 via cron

set -euo pipefail  # Exit on error, undefined var, or pipe failure

# Config
BACKUP_DIR="/opt/backups/postgres"
REMOTE_BUCKET="b2:vitachain-backups/postgres"
RETENTION_DAYS=30
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/vitachain_db_${TIMESTAMP}.sql.gz"
LOG_FILE="/var/log/vitachain_backup.log"

mkdir -p "$BACKUP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "===== Backup started ====="

# Step 1: pg_dump (Supabase exposes a Postgres connection string)
log "Dumping database..."
if pg_dump "$SUPABASE_DB_URL" \
    --no-owner \
    --no-acl \
    --format=plain \
    --exclude-schema='auth' \
    --exclude-schema='storage' \
    | gzip > "$BACKUP_FILE"; then
    log "Dump OK: $(du -h $BACKUP_FILE | cut -f1)"
else
    log "❌ pg_dump FAILED"
    curl -s "$ALERT_WEBHOOK_URL" -d "VitaChain backup FAILED at $TIMESTAMP"
    exit 1
fi

# Step 2: Checksum (integrity)
sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"
log "Checksum written"

# Step 3: Push to Backblaze B2 (or any S3-compatible service)
log "Uploading to offsite..."
if rclone copy "$BACKUP_FILE" "$REMOTE_BUCKET/" --quiet \
   && rclone copy "${BACKUP_FILE}.sha256" "$REMOTE_BUCKET/"; then
    log "Upload OK"
else
    log "⚠ Upload FAILED — local copy still kept"
    curl -s "$ALERT_WEBHOOK_URL" -d "VitaChain offsite upload FAILED at $TIMESTAMP"
fi

# Step 4: Local retention (keep last 7 nights)
find "$BACKUP_DIR" -name "vitachain_db_*.sql.gz" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.sha256" -mtime +7 -delete

# Step 5: Remote retention (Backblaze, last 30 nights)
rclone delete "$REMOTE_BUCKET" --min-age "${RETENTION_DAYS}d" --quiet

log "===== Backup completed ====="
```

**Cron registration:**

```bash
# crontab -e (on the VPS, as root)
0 2 * * * /opt/vitachain/scripts/backup_db.sh
```

**Prerequisites:**

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Configure Backblaze B2 (one-time)
rclone config  # follow prompts, name the remote "b2"
```

#### 4.6.4 Supabase Storage Backup (Weekly)

For FarMarket ad photos and SecondServe meal photos:

```bash
#!/bin/bash
# /opt/vitachain/scripts/backup_storage.sh — weekly, Sunday 03:00

set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d")
BUCKETS=("farmarket-photos" "secondserve-photos")
REMOTE="b2:vitachain-backups/storage/${TIMESTAMP}"

for bucket in "${BUCKETS[@]}"; do
    echo "Syncing bucket: $bucket"
    # Supabase Storage exposes an S3-compatible API
    rclone sync \
        "supabase-s3:$bucket" \
        "$REMOTE/$bucket" \
        --transfers=4 \
        --checkers=8
done

echo "Storage backup completed: $TIMESTAMP"
```

```cron
# Weekly storage backup, Sunday 03:00
0 3 * * 0 /opt/vitachain/scripts/backup_storage.sh
```

#### 4.6.5 The Restore Drill — **CRITICAL**

> **🔥 An untested backup is not a backup. It's a hope.**
>
> Run a full restore drill **at least once before Phase Architect** (week 6). If you skip this and try to restore on demo day, you will fail.

**Restore procedure (documented, must be runnable by any team member):**

```bash
#!/bin/bash
# /opt/vitachain/scripts/restore_db.sh
# Usage: ./restore_db.sh <backup_filename> <target_db_url>
# Example: ./restore_db.sh vitachain_db_20260513_020000.sql.gz "$STAGING_DB_URL"

set -euo pipefail

BACKUP_FILE="${1:?Backup filename required}"
TARGET_DB="${2:?Target DB URL required}"
LOCAL_PATH="/tmp/restore_$$.sql.gz"

echo "===== Restore drill started ====="
echo "Source: $BACKUP_FILE"
echo "Target: ${TARGET_DB%@*}@***"

# Step 1: Download from offsite
echo "Fetching from offsite..."
rclone copy "b2:vitachain-backups/postgres/$BACKUP_FILE" /tmp/ --quiet

# Step 2: Verify checksum
echo "Verifying integrity..."
cd /tmp && sha256sum -c "${BACKUP_FILE}.sha256" || { echo "❌ Checksum mismatch"; exit 1; }

# Step 3: Restore to target DB (typically a staging Supabase project)
echo "Restoring (this may take several minutes)..."
gunzip -c "$BACKUP_FILE" | psql "$TARGET_DB"

# Step 4: Smoke test — count rows in critical tables
echo "Smoke test..."
psql "$TARGET_DB" -c "SELECT 'profiles', COUNT(*) FROM public.profiles
                      UNION ALL SELECT 'parcelles', COUNT(*) FROM m1_katara_parcelles
                      UNION ALL SELECT 'meals', COUNT(*) FROM m4_secondserve_meals;"

echo "===== Restore drill completed ====="
```

**Restore drill checklist (run before Phase Architect):**

- [ ] Create a second free Supabase project as "staging"
- [ ] Run `restore_db.sh` against staging — measure elapsed time
- [ ] Verify all `m*_*` tables exist with expected row counts
- [ ] Verify RLS policies were restored (`\dp` in psql)
- [ ] Verify Supabase Storage objects are accessible
- [ ] Document the **actual RTO** observed (likely 30–90 minutes for 500 MB)

#### 4.6.6 Disaster Scenarios — Runbook

**Scenario A — Accidental data deletion** (most common)

1. Stop the worker containers: `docker compose stop worker-cron katara`
2. Identify the timestamp of the bad action from audit logs
3. Restore last good backup to a staging Supabase project
4. Use SQL `INSERT ... ON CONFLICT DO NOTHING` to merge missing rows back to production
5. Re-enable workers
6. **RTO target: < 2 hours**

**Scenario B — Full Supabase project loss** (rare but catastrophic)

1. Create a new Supabase project (free tier, takes 3 minutes)
2. Update `SUPABASE_URL` and keys in `.env` on the VPS
3. Run `restore_db.sh latest_backup.sql.gz $NEW_SUPABASE_URL`
4. Run storage restore script
5. `docker compose restart` to pick up new env vars
6. Verify with smoke test endpoints
7. **RTO target: < 4 hours**

**Scenario C — VPS dies completely** (R1 risk in the matrix)

1. Activate the **standby VPS** (provisioned with `setup_vps.sh`, kept warm)
2. Point DNS records to the new IP (TTL set to 300s in advance — see §2.3)
3. `cd /opt/vitachain && git pull && docker compose up -d --build`
4. Database is still on Supabase (unaffected), no DB restore needed
5. Re-issue Let's Encrypt certs: `certbot --nginx`
6. **RTO target: < 30 minutes** (if DNS TTL was prepared)

**Scenario D — Demo day VPS outage** (worst case)

1. Switch presentation to **pre-recorded backup video** (prepared D-1, see §7.4)
2. Continue narration as if live
3. Promise the jury a follow-up live demo session post-pitch
4. **RTO target: instant** (video plays from local laptop)

#### 4.6.7 Backup Monitoring

A silent backup failure is the worst kind. Every backup script must:

1. **Log** to `/var/log/vitachain_backup.log` with timestamp and result
2. **Alert** on failure via a webhook (Discord / Telegram / Slack — free options below)
3. **Heartbeat** to a monitoring service so you know if cron itself died

**Recommended free monitoring: [Healthchecks.io](https://healthchecks.io)** (free tier: 20 checks, unlimited pings)

```bash
# Add to the END of backup_db.sh, AFTER the success log
curl -fsS -m 10 --retry 3 "https://hc-ping.com/YOUR_UUID_HERE" > /dev/null
```

If the backup doesn't ping Healthchecks.io within 25 hours of the last successful run, you receive an automatic email/Discord alert. Setup time: **5 minutes**.

#### 4.6.8 Secrets Backup — Don't Forget

`.env` files are not committed to Git (correctly), which means **if the VPS dies and no one has them, restoration is impossible**. Strategy:

1. Store the master `.env` in a **shared password manager** (Bitwarden Family is $40/year for 6 users, well worth it)
2. Document **where each secret comes from** (which dashboard, which account email) in a private wiki
3. Rotate any secret that has been in a chat message, screenshot, or unencrypted file
4. Maintain a `.env.example` in Git with **all keys** but no values (so a new dev knows what's needed)

#### 4.6.9 Estimated Effort & Cost

| Activity | Effort | Cost |
|---|---|---|
| Write `backup_db.sh` + cron | 2 hours | — |
| Write `backup_storage.sh` + cron | 1 hour | — |
| Backblaze B2 account + rclone setup | 30 min | ~$0–5/month |
| Healthchecks.io account + integration | 15 min | $0 |
| Write `restore_db.sh` + dry-run drill | 3 hours | — |
| Document disaster runbook | 1 hour | — |
| **Total upfront** | **~1 day** | **~$5/month OPEX** |

> **The single most important sentence in this entire document:**
> **A backup you have not restored is not a backup. Run the drill. Once before Phase Architect, once before demo day. No exceptions.**

---

## 5. Financial Analysis & Resources

The following cost model details operational (OPEX) and capital (CAPEX) expenses for the VitaChain MVD phase. The approach is deliberately **lean**: zero waste of technical or financial resources.

### 5.1 Main Hosting Infrastructure

**Table 18 — MVD Infrastructure Costs**

| Resource | Spec | Monthly Cost (OPEX) |
|---|---|---|
| VPS DigitalOcean | 4 vCPU / 8 GB RAM / 80 GB SSD | ~80 MAD (8 USD) |
| Domain | .ma or .com (1 year) | ~12 MAD/month (amortized) |
| SSL (Let's Encrypt) | Free auto-renewed certs | 0 MAD |
| Cloudflare | Free plan (CDN + basic DDoS) | 0 MAD |
| Vercel | Hobby Plan (Next.js) | 0 MAD |

### 5.2 Database & Authentication

**Table 19 — MVD Supabase Costs**

| Resource | Plan | Quota | Cost |
|---|---|---|---|
| Supabase PostgreSQL | Free Tier | 500 MB storage, 2 GB bandwidth | 0 MAD |
| Supabase Auth | Free Tier | 50,000 monthly active users | 0 MAD |
| Supabase Storage | Free Tier | 1 GB (ad photos) | 0 MAD |
| Supabase Realtime | Free Tier | 200 concurrent connections | 0 MAD |

### 5.3 Third-Party Services & API Integrations

**Table 20 — MVD Third-Party API Costs**

| Service | Plan / Usage | Monthly Cost |
|---|---|---|
| Brevo (Email/SMS) | Free — 300 emails/day | 0 MAD |
| OpenWeatherMap | Free — 60 calls/min | 0 MAD |
| **Google Gemini API** | **Free — 1,500 requests/day** | **0 MAD** ✅ |
| Sentinel Hub | Free Tier (academic/demo use) | 0 MAD |

> **💡 Saving from Claude → Gemini migration: ~30 MAD/month** (and zero risk of credit exhaustion during the demo)

### 5.4 IoT Hardware Equipment (CAPEX)

**Table 21 — IoT Hardware Budget (Demo)**

| Component | Qty | Est. Unit Price | Total |
|---|---|---|---|
| ESP32 DevKit v1 | 3 | ~40 MAD | ~120 MAD |
| Capacitive soil moisture sensor | 3 | ~35 MAD | ~105 MAD |
| DS18B20 waterproof soil-temp probe | 3 | ~20 MAD | ~60 MAD |
| Soil pH probe (analog) | 3 | ~120 MAD | ~360 MAD |
| Soil EC / conductivity probe | 3 | ~150 MAD | ~450 MAD |
| Breadboard + Wires + Resistors | 1 kit | ~50 MAD | ~50 MAD |
| Waterproof case (3D printed) | 3 | ~30 MAD | ~90 MAD |
| **TOTAL IoT CAPEX** | | | **~440 MAD** |

### 5.5 MVD Financial Summary

**Table 22 — Total Cost of Ownership (TCO) — MVD Phase**

| Type | Amount | Details |
|---|---|---|
| CAPEX (one-time) | ~440 MAD | IoT hardware (3 demo sensors) |
| Monthly OPEX (Infrastructure) | ~92 MAD | VPS + Domain |
| Monthly OPEX (AI API) | **0 MAD** ✅ | **Gemini Free Tier** |
| **Total Monthly OPEX** | **~92 MAD** | **~9 USD/month** (vs. 12 USD with Claude) |
| OPEX over 8 weeks (MVD) | ~184 MAD | Development period |
| **Total MVD Budget** | **~624 MAD** | CAPEX + 2 months OPEX |

> **Note on Supabase Free Plan**
> Free Tier quotas (500 MB, 50K users) fully cover MVD needs. If the project exceeds 500 MB (intensive IoT telemetry), Pro plan ($25/month) will be needed. However, hourly aggregation (BR-K4) keeps volume low during MVD.

---

## 6. Constraints & Risk Management

A Distributed Monolith on a tight 8-week deadline exposes the project to specific vulnerabilities. The matrix below identifies critical risks and documents mitigation protocols.

### 6.1 Risk Matrix

**Table 23 — VitaChain Risk Matrix — MVD**

| Risk | Probability | Impact | Technical Mitigation | Fallback Plan |
|---|---|---|---|---|
| **R1 — Single Point of Failure** — One VPS hosts everything. Hardware failure = total outage. | Low–Medium | Critical | `restart: unless-stopped` on all containers. Automated VPS snapshots. | Cloudflare upstream absorbs requests. If VPS down >1h, emergency redeploy on a 2nd VPS from snapshot. |
| **R2 — Shared DB Contention** — Async IoT telemetry + sync e-commerce transactions = bottleneck. | Medium | High | Strict logical isolation (prefixes + schemas). Locked RLS. Supavisor pooler only. | If contention detected, enable Redis cache for frequent reads (meal list, catalog). |
| **R3 — Scope Creep (Deadline Overrun)** — Delivering 4 modules + complex 3rd-party APIs in 8 weeks = demo failure risk. | Very High | Critical | Smoke & Mirrors at D-15: if AI/IoT unstable, hardcode demo answers. **CI/CD with automated tests (§4.5) catches regressions early, preventing last-week rewrites.** | Happy Path beats algorithmic perfection. AI/weather alerts can be simulated in frontend for demo. |
| **R4 — Complex Network Config** — NGINX + Docker networks + internal DNS = steep learning curve. | Medium | High | Time-boxing 14 days for routing PoC. Detailed NGINX docs. | If failed at D+14: immediate fallback to Docker Compose dropped in favor of monolith on Vercel + serverless functions. |
| **R5 — API Quotas Exhausted** — Gemini API or OpenWeather hit limits during demo. | Low–Medium | Medium | Aggressive caching (3h weather, 24h NDVI). Quota monitoring via provider dashboards. **Gemini Free Tier: 1,500/day is comfortable.** | "Offline Demo" mode: pre-generated AI replies stored in local JSON. "Eternal Cache" mode: last valid reply returned indefinitely. |
| **R6 — Brute Force / JWT Attack** — Public endpoints = impersonation risk. | Low | High | NGINX rate limiting (`limit_req_zone`). JWTs signed with strong secret (256 bits). Short refresh tokens (1h). | On JWT compromise: immediate Supabase key rotation + force-logout all users. |
| **R7 — ESP32 / Mobile Network Reliability** — Unstable field WiFi = data loss. | High | Medium | ESP32 circular buffer (`CircularBuffer` of 100 messages). Retry with exponential backoff. | If WiFi absent >24h: "Device Offline" alert by CRON worker. ESP32 stores data in SPIFFS until reconnected. |
| **R8 — Payment Regulation & Collection Risk** — Collecting consumer payments in-app would require Bank Al-Maghrib licensing; restaurants may not pay the 15% commission. | Medium | High | **Cash-on-pickup model (§3.4.4)** — VitaChain stays out of payment scope during MVD. B2B monthly invoice via CMI link post-MVD. | If restaurants ghost the invoice: stop publishing their meals until paid (`is_premium = false`). Threshold for legal action documented in T&Cs. |

### 6.2 "Smoke & Mirrors" Protocol (D-15)

At D-15 of the MVD presentation, a strict checkpoint is set. If backend AI/IoT processes aren't stable by then, they are bypassed per this protocol:

1. **Simulated IoT data** — A Python script generates realistic telemetry (cyclical moisture/temperature variations) and injects into Supabase every 15 min. Physical ESP32 no longer required for demo.
2. **Pre-generated AI replies** — 10 agronomic diagnostics generated ahead of time and stored in `m1_katara_diagnostics`. During demo, frontend shows one of these based on selected crop type.
3. **Frozen weather** — OpenWeatherMap replaced by local JSON file with a realistic forecast for the demo region.
4. **Absolute goal** — Validate the user journey ("Happy Path"): farmer logs in → sees parcels → views chart → reads AI advice. Backend algorithmic perfection is secondary.

> **🏆 MVD Golden Rule**
> The MVD's goal is **NOT** to prove the AI gives the world's best agronomic advice. The goal is to prove the **technical architecture can support the end-to-end flow** (IoT → DB → API → Frontend → Happy User). If the flow works, replacing simulated data with real data is just a config change post-demo.

---

## 7. BMAD Execution Roadmap

The BMAD methodology (Build More Architect Dreams) organizes development into 4 sequential phases, each producing a testable deliverable and a stable base for the next. This avoids the "big bang" effect where everything is coded in parallel and nothing works.

### 7.1 Phase Build — Infra & Auth Setup

> **PHASE BUILD — Weeks 1 to 2**
> Technical foundations. Without this, nothing stands.

#### Deliverables

- Ubuntu 24.04 VPS provisioned and SSH-reachable.
- Functional Docker Compose with NGINX + empty containers (healthcheck returning 200).
- Supabase project created with `auth.users`, `profiles` tables, and base RLS policies.
- Next.js scaffolded with Supabase auth (login/register working).
- Git repo with protected branches and documented manual CI/CD.

#### Detailed Tasks

**Table 24 — Phase Build Tasks**

| Week | Task | Owner | Acceptance Criterion |
|---|---|---|---|
| W1-D1 to W1-D3 | VPS + Docker + NGINX provisioning | DevOps | `curl http://vitachain.ma` returns 200 |
| W1-D4 to W1-D5 | Supabase setup + `profiles` + RLS | Backend | Register/Login working via Supabase Auth |
| W2-D1 to W2-D3 | Next.js scaffold + login/dashboard pages | Frontend | Full auth journey (register → login → dashboard) |
| W2-D4 to W2-D5 | Final Docker Compose + internal network tested | DevOps | Inter-container comms verified (service-to-service ping) |

> **End-of-Phase Validation**
> **Mandatory checkpoint**: a user can register, log in, and reach an empty dashboard without errors. NGINX routing works for at least 2 routes (`/` → frontend, `/api/v1/health` → backend).

### 7.2 Phase More — Core Feature Development

> **PHASE MORE — Weeks 3 to 5**
> Building business modules. Each module is a 1-week sprint.

#### Week 3 — Katara (IoT + Parcels)

- `/ingest` and `/ping` endpoints working with Pydantic validation.
- Tables `m1_katara_devices`, `m1_katara_telemetry`, `m1_katara_parcelles` created.
- Farmer dashboard with historical chart (simulated data OK).
- OpenWeatherMap integration with 3h cache.

#### Week 4 — FarMarket (B2B) + SecondServe (B2C)

- **FarMarket**: Ad CRUD, Supabase Storage upload, catalog filtering, contact endpoint (Brevo email).
- **SecondServe**: Meal publishing, reservation with secret code, restaurateur validation, 15-min expiry worker.
- **BotaBa9a**: Static showcase pages, lead form, Supabase webhook → Brevo.

#### Week 5 — AI (Gemini + Sentinel)

- Contextual prompt compiled (weather + NDVI + ESP32 history).
- **Async Gemini API** call with polling system.
- CRON worker scanning anomalies and offline devices.
- Brevo notifications for alerts and diagnostics.

**Table 25 — Phase More Tasks**

| Week | Module | Key Deliverable | Acceptance Test |
|---|---|---|---|
| W3 | Katara | IoT ingestion + Dashboard | ESP32 data visible <1 min on dashboard |
| W4 | FarMarket + SecondServe + BotaBa9a | B2B/B2C marketplaces + Showcase | Full journey: publish → reserve → validate code |
| W5 | AI + Alerts | Diagnostic + Notifications | Threshold alert fires and email received <5 min |

### 7.3 Phase Architect — Security, Load Testing & Optimization

> **PHASE ARCHITECT — Weeks 6 to 7**
> Make the system robust and presentable. No new features.

#### Week 6 — Security & Tests

- Full RLS audit: verify every sensitive table has active policies.
- Load tests with `locust` or `k6`: 100 req/s on `/ingest` and `/api/v1/secondserve/meals`.
- Business rules validation: BR-K1 to BR-K4, BR-F1 to BR-F4, BR-S1 to BR-S4.
- Light pentest: SQL injection attempts (must fail via Supabase RLS), JWT forgery attempts.

#### Week 7 — Optimization & Stabilization

- PostgreSQL query optimization (`EXPLAIN ANALYZE` on slow queries).
- Redis cache setup (optional but recommended if latency > 200 ms).
- Let's Encrypt SSL + HTTP → HTTPS redirect.
- Basic monitoring: containers `restart: unless-stopped`, Docker log rotation.

> **End-of-Phase Validation**
> The system must support 50 concurrent users with no errors. Median response time on critical endpoints <200 ms (except AI, which is async).

### 7.4 Phase Dreams — UI/UX Polish & Launch

> **PHASE DREAMS — Week 8**
> MVD presentation and delivery. Goal: positive emotion from jury/investor.

#### Week 8 — Show & Demo

- **D-7 to D-3** — UI polish (mobile responsive, light animations, loading states).
- **D-3 to D-1** — Demo scenario preparation (minute-by-minute script).
- **D-1** — Full rehearsal. Field test of ESP32. Verify Brevo emails.
- **D-Day** — Live demo with prepared fallbacks (simulated data, backup videos).

#### Recommended Demo Scenarios

1. **Scenario A — Connected Farmer**: Login FARMER → Katara Dashboard → View history → Request AI diagnostic → Receive advice email.
2. **Scenario B — Economical Restaurateur**: Login RESTAURANT → SecondServe → Publish surprise box → Citizen reserves → Restaurateur validates `VITA-XXX` code.
3. **Scenario C — B2B Commerce**: Farmer publishes tomato ad → Restaurateur browses catalog → Brevo email contact → Lead recorded.

#### D-Day Checklist

- [ ] ESP32 charged 100% and on demo WiFi
- [ ] VPS rebooted in the morning, containers verified (`docker-compose ps`)
- [ ] API quotas verified (Gemini, Brevo, OpenWeather)
- [ ] Backup data exported in JSON ("Smoke & Mirrors" pre-loaded)
- [ ] Backup video ready (screen recording of each scenario)
- [ ] Technical support (1 dev) on standby during the pitch

---

## 8. Technical Annexes

### Annex A — Complete Environment Variables (.env)

```bash
# VitaChain — MVD Environment Configuration
# ===========================================

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# External APIs
GEMINI_API_KEY=AIza...                    # ⬅ Replaces CLAUDE_API_KEY
GEMINI_MODEL=gemini-2.0-flash             # Free, fast
OPENWEATHER_API_KEY=...
SENTINEL_HUB_CLIENT_ID=...
SENTINEL_HUB_CLIENT_SECRET=...
BREVO_API_KEY=xkeysib-...

# Frontend
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
NEXT_PUBLIC_MAP_CENTER_LAT=31.7917
NEXT_PUBLIC_MAP_CENTER_LNG=-7.0926

# Backend
KATARA_API_PORT=8000
SECONDSERVE_API_PORT=8001
FARMARKET_API_PORT=8002
WEBHOOKS_PORT=8003

# ESP32
ESP32_API_KEY_HEADER=X-Device-API-Key
ESP32_MAX_PAYLOAD_SIZE=2048

# Security
JWT_SECRET=256-bit-random-string-here
ACCESS_TOKEN_EXPIRY=3600
REFRESH_TOKEN_EXPIRY=604800

# Workers
ALERT_SCAN_INTERVAL_MINUTES=15
OFFLINE_SCAN_INTERVAL_MINUTES=60
EXPIRY_CHECK_INTERVAL_MINUTES=15
ARCHIVE_OLD_ADS_DAYS=7

# Demo / Fallback
DEMO_MODE=false
DEMO_AI_RESPONSES_PATH=./demo_data/ai_responses.json
DEMO_WEATHER_PATH=./demo_data/weather_fixed.json

# Internationalization (i18n) — §2.6
DEFAULT_LOCALE=fr
SUPPORTED_LOCALES=fr,ar,en
FALLBACK_LOCALE=fr

# Brevo Email Templates (multi-language) — §2.6.6
BREVO_TPL_PICKUP_FR=12
BREVO_TPL_PICKUP_AR=13
BREVO_TPL_PICKUP_EN=14
BREVO_TPL_DIAG_FR=15
BREVO_TPL_DIAG_AR=16
BREVO_TPL_DIAG_EN=17
BREVO_TPL_ALERT_FR=18
BREVO_TPL_ALERT_AR=19
BREVO_TPL_ALERT_EN=20
BREVO_TPL_LEAD_FR=21
BREVO_TPL_LEAD_AR=22
BREVO_TPL_LEAD_EN=23

# Payment Processing (Post-MVD — §3.4.4)
# Not used during MVD (cash-on-pickup model), reserved for future
PAYMENT_PROVIDER=none           # 'cmi' | 'stripe' | 'none'
CMI_MERCHANT_ID=
CMI_STORE_KEY=
CMI_GATEWAY_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Observability (§4.5.10)
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
ENVIRONMENT=production          # 'development' | 'staging' | 'production'
SENTRY_TRACES_SAMPLE_RATE=0.1
```

### Annex B — Relational Data Model (Synthesis)

**Table 26 — Tables Synthesis per Module**

| Module | Tables | Est. MVD Volume | Growth |
|---|---|---|---|
| M1 Katara | 6 (devices, telemetry, parcelles, diagnostics, alerts, thresholds) | ~50K rows (telemetry) | Linear (1 row / 15 min / device) |
| M2 FarMarket | 3 (ads, leads, email_log) | ~500 rows | Quadratic (offers × leads) |
| M3 BotaBa9a | 3 (leads, products, assignments) | ~200 rows | Low (manual leads) |
| M4 SecondServe | 3 (meals, reservations, commissions) | ~1K rows | Exponential (transactions) |
| Common Layer | 4 (profiles, pro_verifications, subscriptions, audit_log) | ~200 rows | Linear (users) |

### Annex C — SQL Migration Management

All schema changes must go through versioned migration files. Use `supabase db push` or manual scripts named `YYYY_MM_DD_description.sql`.

```sql
-- Example: 2026_04_30_add_katara_thresholds.sql
CREATE TABLE m1_katara_thresholds (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    parcelle_id UUID NOT NULL REFERENCES m1_katara_parcelles(id) ON DELETE CASCADE,
    metric VARCHAR(50) NOT NULL CHECK (metric IN ('soil_moisture','soil_temperature','soil_ph','soil_conductivity','battery_level')),
    min_value FLOAT,
    max_value FLOAT,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(parcelle_id, metric)
);

CREATE INDEX idx_thresholds_parcelle ON m1_katara_thresholds(parcelle_id);
COMMENT ON TABLE m1_katara_thresholds IS 'Per-parcel alert thresholds';
```

### Annex D — Healthcheck & Monitoring

```bash
#!/bin/bash
# healthcheck.sh — Basic monitoring script

ENDPOINTS=(
  "http://localhost/api/v1/katara/health"
  "http://localhost/api/v1/secondserve/health"
  "http://localhost/api/v1/farmarket/health"
)

for url in "${ENDPOINTS[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" $url)
    if [ "$status" != "200" ]; then
        echo "[ALERT] $url returned $status at $(date)" >> /var/log/vitachain_alerts.log
        # Optional: send Telegram/Discord notification
    fi
done
```

### Annex E — Gemini API Quick Reference

```python
# Minimum installation
pip install google-genai

# Minimum code (sync)
from google import genai

client = genai.Client(api_key="YOUR_KEY")
response = client.models.generate_content(
    model="gemini-2.0-flash",
    contents="Hello, in one sentence."
)
print(response.text)
```

**Get a free API key**: https://aistudio.google.com/apikey (Google account only, no credit card)

**Free tier limits** (gemini-2.0-flash):
- 15 RPM (requests per minute)
- 1M TPM (tokens per minute)
- 1,500 RPD (requests per day)

**Pricing if you upgrade** (gemini-2.0-flash paid tier):
- Input: $0.10 / 1M tokens
- Output: $0.40 / 1M tokens
- ~40× cheaper than Claude Sonnet

---

## Document Sign-off

This technical document is issued under the BMAD methodology and constitutes the **single reference** for VitaChain MVD implementation. Any post-validation change must go through a documented, steering-committee-approved Change Request.
