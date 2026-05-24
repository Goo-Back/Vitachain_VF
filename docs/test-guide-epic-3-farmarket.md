# Test Guide — Epic E3 (M2 FarMarket) — LOCAL

> **Epic:** E3 — M2 FarMarket — B2B Agri-Marketplace (PRD §6.2)
> **Phase:** P2 (Weeks 3–5)
> **Stories covered:** [FAR-01](./stories/FAR-01-farmer-creates-ad.md) … [FAR-09](./stories/FAR-09-featured-ads-at-top-of-catalog.md)
> **Audience:** developer running pre-merge validation **entirely on the laptop**
> **Companion docs:** [runbook.md](./runbook.md), [spring-status.yml](./spring-status.yml) §E3

This guide is the *local-only* version of the test plan. Nothing here needs the
VPS or the staging stack. The remote Supabase project is still used (it is the
DB + Storage backend the laptop talks to over the network), but everything
*runs* on your machine: backend via `uvicorn`, frontend via `next dev`,
workers via `python -m`, DB tests via `psql`.

The guide is split in **three layers**, matching how Epic 3 is implemented:

1. **DB layer** — pgTAP cells in [db/tests/auth07_business_rules.sql](../db/tests/auth07_business_rules.sql) (F-01…F-09 blocks).
2. **Backend layer** — pytest under [backend/tests/test_far*.py](../backend/tests/).
3. **App layer (local e2e)** — `uvicorn` + `next dev` + the two workers, driven by curl, the browser, and SQL inspection.

Run them in that order: DB cells are the fastest to fail and the cheapest to
re-run while iterating.

---

## 1. Story map

| Story  | Title                                              | Status (2026-05-23) | Key BR        |
|--------|----------------------------------------------------|---------------------|---------------|
| FAR-01 | Verified farmer creates ad                         | DONE                | BR-F1, BR-F2  |
| FAR-02 | Restaurateur browses ads (region/type/price)       | IN_REVIEW           | —             |
| FAR-03 | Restaurateur contacts seller (message + phone)     | IN_REVIEW           | Moroccan tel  |
| FAR-04 | Brevo email to seller w/ buyer contact             | IN_REVIEW           | BR-F4         |
| FAR-05 | Farmer edits / removes own ads                     | IN_REVIEW           | owner-RLS     |
| FAR-06 | Nightly CRON expires ads older than 7 days         | IN_REVIEW           | BR-F3         |
| FAR-07 | Photos stored in Supabase Storage (not DB)         | IN_REVIEW           | BR-F2 storage |
| FAR-08 | Admin views all ads & leads                        | IN_REVIEW           | admin-RLS     |
| FAR-09 | Featured ads at top of catalog                     | IN_REVIEW           | sort order    |

**Business-rule reminders** (PRD §7.4):

- **BR-F1** — Only `VERIFIED FARMER` may INSERT into `public.m2_farmarket_ads`.
- **BR-F2** — `photos ≤ 5`, each `≤ 2 MB`; enforced at API boundary + DB CHECK.
- **BR-F3** — Ads expire 7 days after `created_at` unless renewed; CRON sets `status = 'EXPIRED'`.
- **BR-F4** — Brevo API key is **never** present in the frontend bundle.

---

## 2. Local environment setup

### 2.1 Tooling checklist

| Tool / file                                       | Why                                                          |
|---------------------------------------------------|--------------------------------------------------------------|
| `python 3.12` + `make`                            | Backend pytest, uvicorn dev server, workers.                 |
| `node 20.x` + `npm`                               | Frontend `next dev`.                                         |
| `psql` 17 client                                  | pgTAP suites use `psql -v ON_ERROR_STOP=on`.                 |
| `curl`, `jq`                                      | API smokes and JWT inspection.                               |
| Docker (optional)                                 | Only needed for the worker drill if you don't run workers natively. The instructions below show **both** routes. |

### 2.2 Required `.env` files

Three files must exist locally — none is committed.

#### [db/.env](../db/.env)
```env
# DIRECT Postgres URL (port 5432). The pooler (6543) breaks pgTAP transactions.
DB_URL=postgresql://postgres:<PASS>@db.<ref>.supabase.co:5432/postgres
```

#### [backend/.env](../backend/.env)
```env
ENVIRONMENT=dev
LOG_LEVEL=DEBUG
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...service-role JWT...
SUPABASE_JWT_SECRET=...HS256 signing secret (≥ 64 hex chars)...
CORS_ALLOW_ORIGINS=http://localhost:3000
WEB_CONCURRENCY=1
# Used by workers
SUPABASE_DB_URL=postgresql://postgres:<PASS>@db.<ref>.supabase.co:5432/postgres
BREVO_API_KEY=...transactional...
BREVO_SENDER_NAME=VitaChain
BREVO_SENDER_EMAIL=no-reply@vitachain.ma
BREVO_TEMPLATE_FAR_LEAD_FR=<id>
# FAR-06 — short interval so a sweep fires in seconds during testing.
EXPIRY_SCAN_PERIOD_S=30
```

#### [frontend/.env.local](../frontend/.env.local)
```env
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...anon key...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Talk to the local FastAPI instead of the prod gateway.
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

> **Never** put `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, or
> `BREVO_API_KEY` in `frontend/.env.local`. The bundle scan in §5 verifies
> they stay backend-only (BR-F4).

### 2.3 Apply migrations + seed identities

```powershell
# Apply 0032–0035 (FAR-* migrations) and confirm bookkeeping.
make -C db push
make -C db list
```

The `AUTH-07` test harness builds the six identities re-used across the FAR
cells (one VERIFIED FARMER, one PENDING farmer, one RESTAURANT, two CITIZENs,
one ADMIN). It is idempotent — running it twice is safe.

| Handle       | Role        | Status   | Used in        |
|--------------|-------------|----------|----------------|
| FARMER-A     | FARMER      | VERIFIED | F-01, F-05, F-07 owner path |
| FARMER-B     | FARMER      | PENDING  | F-01 negative + F-05 cross-owner block |
| RESTAURANT   | RESTAURANT  | VERIFIED | F-02 browse, F-03 contact |
| CITIZEN-A/B  | CITIZEN     | n/a      | role-gating negatives |
| ADMIN        | ADMIN       | n/a      | F-08, F-09 toggle |

### 2.4 Mint test JWTs (used by curl recipes)

Backend tests sign JWTs with `SUPABASE_JWT_SECRET`. For curl one-liners, mint
one per identity from a Python shell:

```python
# python from backend/ (after `make -C backend install`)
import os, time, jwt
secret = os.environ["SUPABASE_JWT_SECRET"]
def mk(sub, role, vstatus="VERIFIED"):
    return jwt.encode({
        "sub": sub,
        "role": "authenticated",
        "app_metadata": {"vitachain_role": role, "verification_status": vstatus},
        "exp": int(time.time()) + 3600,
    }, secret, algorithm="HS256")
print("FARMER-A", mk("<farmer-a-uuid>", "FARMER", "VERIFIED"))
print("FARMER-B", mk("<farmer-b-uuid>", "FARMER", "PENDING"))
print("RESTAURANT", mk("<restaurant-uuid>", "RESTAURANT"))
print("ADMIN", mk("<admin-uuid>", "ADMIN"))
```

Get the UUIDs from `select id, raw_app_meta_data from auth.users where email like 'auth07-%';`.

---

## 3. Running the three layers

### 3.1 Layer 1 — DB pgTAP

The fastest signal. Run on every change to a `0032…0035*.sql` migration.

```powershell
# Full AUTH-07 suite (role matrix + business rules — includes F-01…F-09 cells).
make -C db test-auth07
```

Expect **every F-* cell green** and **zero `SKIP`** notices for `m2_farmarket_*`
once Epic 3 is fully merged. Pin to FarMarket only while iterating:

```powershell
psql "$env:DB_URL" -v ON_ERROR_STOP=on -f db/tests/auth07_business_rules.sql 2>&1 |
  Select-String -Pattern '^(ok|not ok|# .*F-0[1-9])'
```

### 3.2 Layer 2 — Backend pytest

```powershell
# Whole epic
.\backend\.venv\Scripts\pytest backend/tests -k far -q

# One story
.\backend\.venv\Scripts\pytest backend/tests/test_far01_ad_create.py -q

# One marker inside a story
.\backend\.venv\Scripts\pytest "backend/tests/test_far01_ad_create.py::TestAdCreateSchema" -q
```

These cover:

- Pydantic validators in [schemas.py](../backend/app/modules/farmarket/schemas.py).
- Auth contract on `POST/GET/PATCH/DELETE /api/v1/farmarket/ads` (401 / 403 / 404 / 409 / 422 matrix).
- The expiry sweeper (12 cells: zero-row sweep, 5-row sweep, SQL pin, DB-error propagation, healthcheck ping shape, network exception suppression, SIGTERM exit).
- The lead-email worker mailer (Brevo 5xx retry, 4xx dead-letter, idempotency anchor).

DB writes and Storage writes are **not** exercised here — those live in §3.3.

### 3.3 Layer 3 — Local app stack

Open four terminals (or use `tmux` / Windows Terminal tabs):

**Terminal 1 — backend API**
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000 --host 127.0.0.1
# Smoke:  curl http://127.0.0.1:8000/api/v1/healthz
```

**Terminal 2 — frontend**
```powershell
cd frontend
npm run dev
# Browser: http://localhost:3000
```

**Terminal 3 — FAR-04 lead-email worker** (LISTENs on `farmarket_lead_created`)
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m app.workers.farmarket_lead_email
```

**Terminal 4 — FAR-06 expiry worker** (loops every `EXPIRY_SCAN_PERIOD_S` s)
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
$env:EXPIRY_SCAN_PERIOD_S = "30"   # see a sweep every 30s for testing
python -m app.workers.farmarket_expiry
```

> Don't have a Brevo key on the laptop? Set `BREVO_API_KEY=fake-key` and watch
> the worker log a structured 401 from Brevo — the *NOTIFY → claim → mailer*
> path is still exercised, only the SMTP hand-off fails. That is enough to
> validate FAR-04 plumbing; switch in a real key for the end-to-end email
> assertion.

---

## 4. Per-story checklists

For every story: (a) DB cell, (b) backend test marker, (c) local API/UI walk,
(d) inspection SQL, (e) success criteria.

The curl recipes below assume the JWTs from §2.4 are in PowerShell vars
`$JWT_FARMER_A`, `$JWT_FARMER_B`, `$JWT_RESTAURANT`, `$JWT_CITIZEN`,
`$JWT_ADMIN`.

---

### FAR-01 — Farmer creates ad

**Files:** [0032_far01_farmarket_ads.sql](../db/migrations/0032_far01_farmarket_ads.sql), [0033_far01_farmarket_photos_storage.sql](../db/migrations/0033_far01_farmarket_photos_storage.sql), [router.py](../backend/app/modules/farmarket/router.py), [test_far01_ad_create.py](../backend/tests/test_far01_ad_create.py).

| # | Check                                                                       | How |
|---|------------------------------------------------------------------------------|-----|
| 1 | F-01a–d pgTAP cells green                                                    | `make -C db test-auth07` |
| 2 | `AdCreate` rejects bad price / qty / region / title length / description length | `pytest backend/tests/test_far01_ad_create.py::TestAdCreateSchema -q` |
| 3 | Unauthenticated POST → 401; CITIZEN → 403; PENDING farmer → 403; VERIFIED FARMER → 201 | curl matrix (below) |
| 4 | Multipart upload with 1–5 valid images succeeds; 6 photos → 422 `too_many_photos`; one >2 MB → 422 `photo_too_large`; .pdf → 422 `invalid_photo_type` | curl |
| 5 | Verified farmer creates an ad via UI at [/dashboard/farmer/ads/new](../frontend/src/app/dashboard/farmer/ads/new/page.tsx) with 1–5 photos | browser walk |
| 6 | Row appears in `public.m2_farmarket_ads`; photo objects under `farmarket-photos/<farmer_id>/<ad_id>/` in Storage; `expires_at = created_at + 7 days` | Supabase Studio + SQL below |
| 7 | `GET /api/v1/farmarket/ads` as FARMER-B returns **only** FARMER-B's rows (RLS) | curl |
| 8 | Best-effort orphan cleanup: kill uvicorn after Storage upload but before DB insert (drop the DB by editing service-role key); confirm the next sweep run shows no orphan path | manual |

**Curl matrix (PowerShell-friendly):**
```powershell
# unauth → 401
curl.exe -i -X POST http://127.0.0.1:8000/api/v1/farmarket/ads `
  -F "title=Test" -F "description=10+ chars here" -F "product_type=Tomate" `
  -F "price_mad=12.50" -F "quantity_kg=20" -F "region=Casablanca-Settat"

# CITIZEN → 403
curl.exe -i -H "Authorization: Bearer $JWT_CITIZEN" -X POST `
  http://127.0.0.1:8000/api/v1/farmarket/ads `
  -F "title=Test" -F "description=ten+ chars here" -F "product_type=Tomate" `
  -F "price_mad=12.50" -F "quantity_kg=20" -F "region=Casablanca-Settat"

# PENDING farmer → 403
curl.exe -i -H "Authorization: Bearer $JWT_FARMER_B" ... (same body) ...

# VERIFIED farmer + 2 photos → 201
curl.exe -i -H "Authorization: Bearer $JWT_FARMER_A" -X POST `
  http://127.0.0.1:8000/api/v1/farmarket/ads `
  -F "title=Tomates bio" -F "description=Lot frais récolte du jour" `
  -F "product_type=Tomate" -F "price_mad=8.50" -F "quantity_kg=120" `
  -F "region=Casablanca-Settat" `
  -F "photos=@C:\path\to\photo1.jpg" -F "photos=@C:\path\to\photo2.jpg"
```

**Inspection SQL:**
```sql
select id, status, expires_at, array_length(photo_paths,1) as n_photos,
       created_at
from public.m2_farmarket_ads
where farmer_id = '<farmer-a-uuid>'
order by created_at desc limit 5;
```

**Pass criterion:** all eight rows green.

---

### FAR-02 — Restaurateur browses ads

**Files:** `browse_catalog` in [router.py](../backend/app/modules/farmarket/router.py), [test_far02_catalog_browse.py](../backend/tests/test_far02_catalog_browse.py), [marketplace/page.tsx](../frontend/src/app/dashboard/restaurant/marketplace/page.tsx).

| # | Check                                                                              | How |
|---|------------------------------------------------------------------------------------|-----|
| 1 | F-02 cells green (catalog visibility + role gate)                                  | `make -C db test-auth07` |
| 2 | `GET /api/v1/farmarket/catalog` honours `region`, `product_type` (ilike), `price_min`, `price_max`, `page`, `page_size` | pytest + curl |
| 3 | EXPIRED ads invisible (seed one manually, refresh)                                 | SQL seed + GET |
| 4 | DELETED ads invisible                                                              | soft-delete from FAR-05, GET |
| 5 | UI filters at `/dashboard/restaurant/marketplace` round-trip into the query string | browser walk |
| 6 | Page size cap: `page_size=51` → 422                                                | curl |
| 7 | Unknown region → 422 (Pydantic validator)                                          | curl |
| 8 | Unauthenticated GET → 401 (still requires a session)                               | curl |

**Seed an EXPIRED ad to validate row 3:**
```sql
-- Service-role psql session
update public.m2_farmarket_ads
set status = 'EXPIRED', expires_at = now() - interval '1 day'
where id = '<some-active-ad-id>';
```

**Curl recipes:**
```powershell
# All ACTIVE ads visible to FARMER-A (read is role-agnostic — uses RLS select_active).
curl.exe -s -H "Authorization: Bearer $JWT_FARMER_A" `
  "http://127.0.0.1:8000/api/v1/farmarket/catalog?region=Casablanca-Settat&product_type=Tom" | jq

# Price filter + pagination
curl.exe -s -H "Authorization: Bearer $JWT_RESTAURANT" `
  "http://127.0.0.1:8000/api/v1/farmarket/catalog?price_min=5&price_max=20&page=1&page_size=10" | jq '.items[].title, .total, .has_next'
```

---

### FAR-03 — Restaurateur contacts seller

**Files:** [test_far03_contact_seller.py](../backend/tests/test_far03_contact_seller.py), [0034_far03_farmarket_leads.sql](../db/migrations/0034_far03_farmarket_leads.sql), [ContactModal.tsx](../frontend/src/app/dashboard/restaurant/marketplace/ContactModal.tsx).

| # | Check                                                                            | How |
|---|----------------------------------------------------------------------------------|-----|
| 1 | F-03 pgTAP cells green                                                           | `make -C db test-auth07` |
| 2 | Moroccan phone regex `^0[5-7][0-9]{8}$` accepts `0612345678`, `0512345678`, `0712345678`; rejects `+212612345678`, `0412345678`, `06 12 34 56 78` | pytest |
| 3 | Lead row lands in `public.m2_farmarket_leads` with `ad_id`, `buyer_id`, `message`, `buyer_phone`, `status='PENDING'` | curl + SQL |
| 4 | FARMER-A cannot SELECT leads attached to FARMER-B's ads — RLS isolation          | psql `SET role`, `SELECT` |
| 5 | Lead against EXPIRED ad → 409 `ad_not_active`                                     | curl |
| 6 | Lead against non-existent UUID → 404 `ad_not_found`                              | curl |
| 7 | FARMER/CITIZEN posting a lead → 403 (`require_role("RESTAURANT")`)               | curl |
| 8 | UI ContactModal at `/dashboard/restaurant/marketplace` validates phone before submit and clears form on 201 | browser walk |

**Curl recipe (RESTAURANT contacts FARMER-A's ad):**
```powershell
curl.exe -i -H "Authorization: Bearer $JWT_RESTAURANT" `
  -H "Content-Type: application/json" -X POST `
  http://127.0.0.1:8000/api/v1/farmarket/ads/<ad_id>/leads `
  -d '{"message":"Bonjour, intéressé par 50 kg dès demain","buyer_phone":"0612345678"}'
```

**RLS isolation check:**
```sql
-- As FARMER-A — should be empty for FARMER-B's ad ids
select set_config('request.jwt.claim.sub', '<farmer-a-uuid>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select * from public.m2_farmarket_leads where ad_id = '<farmer-b-ad-id>';
```

---

### FAR-04 — Brevo email to seller

**Files:** [farmarket_lead_email/](../backend/app/workers/farmarket_lead_email/), [test_far04_brevo_email_to_seller.py](../backend/tests/test_far04_brevo_email_to_seller.py), [0035_far04_farmarket_lead_notify.sql](../db/migrations/0035_far04_farmarket_lead_notify.sql).

| # | Check                                                                                      | How |
|---|--------------------------------------------------------------------------------------------|-----|
| 1 | `NOTIFY farmarket_lead_created` fires on lead insert                                       | `LISTEN` in psql, insert a row |
| 2 | Worker logs `claimed lead_id=…` JSON line within ~1s of insert                              | terminal 3 logs |
| 3 | Brevo transactional email contains: ad title, buyer phone, buyer message, farmer's locale  | inbox (real Brevo) **or** `BREVO_API_KEY=fake-key` + observed 401 |
| 4 | `notified_at` stamped on the lead AFTER Brevo 2xx; survives worker restart (idempotent)    | SQL: `select notified_at from m2_farmarket_leads where id=…` |
| 5 | Brevo 5xx → retry with backoff; permanent 4xx → dead-letter (no infinite loop)             | pytest sender unit cells |
| 6 | **BR-F4** — `BREVO_API_KEY` is absent from the frontend bundle                              | §5 cross-cutting check |
| 7 | 30-minute backstop reclaims any lead with `notified_at IS NULL` after a restart            | start worker, insert lead, kill worker before Brevo, restart, see retry |

**LISTEN drill:**
```powershell
psql "$env:DB_URL"
# in psql:
LISTEN farmarket_lead_created;
-- in another terminal: do FAR-03 step (3) curl insert.
-- psql prints:  Asynchronous notification "farmarket_lead_created" with payload "{...}" received
```

**Target latency:** lead persisted → email queued in **< 2 min** (PRD acceptance).

---

### FAR-05 — Farmer edits / removes own ads

**Files:** [test_far05_farmer_edits_removes_ad.py](../backend/tests/test_far05_farmer_edits_removes_ad.py), [edit-ad-form.tsx](../frontend/src/app/dashboard/farmer/ads/[id]/edit/edit-ad-form.tsx).

| # | Check                                                                       | How |
|---|------------------------------------------------------------------------------|-----|
| 1 | F-05a/b/c pgTAP cells green                                                  | `make -C db test-auth07` |
| 2 | FARMER-A `PATCH` own ad → 200; FARMER-B `PATCH` FARMER-A's ad → 403 `not_ad_owner` | curl |
| 3 | `PATCH` with no fields and no photos → 422 `no_fields_to_update`             | curl |
| 4 | `PATCH` on an EXPIRED ad → 409 `ad_not_editable`                             | seed EXPIRED + curl |
| 5 | Sending new photos replaces ALL existing photos (storage objects removed)    | SQL + Storage UI |
| 6 | Soft-delete: `DELETE` → 204, row now `status='DELETED'`, **not** physically removed | SQL `select status from m2_farmarket_ads where id=…` |
| 7 | DELETE is idempotent (second call → 204, no error)                           | curl twice |
| 8 | DELETED ad disappears from `/api/v1/farmarket/catalog` on next request       | curl |
| 9 | UI `/dashboard/farmer/ads/[id]/edit` round-trips a title change              | browser walk |
| 10 | UI confirm-modal at `/dashboard/farmer/ads` prevents accidental delete       | browser walk |

```powershell
# PATCH title only
curl.exe -i -H "Authorization: Bearer $JWT_FARMER_A" -X PATCH `
  http://127.0.0.1:8000/api/v1/farmarket/ads/<ad_id> -F "title=Tomates bio — prix baissé"

# Soft-delete
curl.exe -i -H "Authorization: Bearer $JWT_FARMER_A" -X DELETE `
  http://127.0.0.1:8000/api/v1/farmarket/ads/<ad_id>
```

---

### FAR-06 — Nightly CRON expires ads older than 7 days

**Files:** [farmarket_expiry/sweeper.py](../backend/app/workers/farmarket_expiry/sweeper.py), [test_far06_nightly_expiry.py](../backend/tests/test_far06_nightly_expiry.py).

| # | Check                                                                                                 | How |
|---|-------------------------------------------------------------------------------------------------------|-----|
| 1 | F-06a/b/c pgTAP cells green                                                                           | `make -C db test-auth07` |
| 2 | 12 sweeper unit cells green                                                                           | `pytest backend/tests/test_far06_nightly_expiry.py -q` |
| 3 | Worker boots, logs `farmarket_expiry sweeper starting period=30`                                      | terminal 4 logs |
| 4 | Seed an ad with `expires_at = now() - interval '1 minute'`; within 30s the sweeper flips it to `EXPIRED` | SQL seed + log |
| 5 | The sweep is idempotent: already-EXPIRED rows are not re-touched (UPDATE count stays 0)              | log `expired=0` |
| 6 | Healthcheck ping fires only on success (set `HEALTHCHECKS_FAR_EXPIRY_PING_URL=https://webhook.site/<uuid>` and watch hits) | webhook.site |
| 7 | DB-error path: revoke role privileges temporarily, observe error log + no ping                       | psql `REVOKE` |
| 8 | SIGTERM exits cleanly within 1s (no asyncio stack trace)                                              | `Ctrl+C` |
| 9 | EXPIRED ad disappears from FAR-02 catalog browse                                                      | repeat FAR-02 step 3 |

**Seed an expirable ad:**
```sql
insert into public.m2_farmarket_ads
  (id, farmer_id, title, description, product_type, price_mad, quantity_kg, region, photo_paths, status, expires_at)
values
  (gen_random_uuid(), '<farmer-a-uuid>', 'Olives expirable', 'Description >= 10 chars', 'Olives',
   10, 50, 'Fès-Meknès', '{}', 'ACTIVE', now() - interval '1 minute');
```

Watch terminal 4 for: `sweep complete expired=1 elapsed_ms=…`. Then:
```sql
select status from public.m2_farmarket_ads where title = 'Olives expirable';  -- → EXPIRED
```

---

### FAR-07 — Photos stored in Supabase Storage

**Files:** [0033_far01_farmarket_photos_storage.sql](../db/migrations/0033_far01_farmarket_photos_storage.sql), [test_far07_photo_storage.py](../backend/tests/test_far07_photo_storage.py).

| # | Check                                                                                                  | How |
|---|--------------------------------------------------------------------------------------------------------|-----|
| 1 | F-07a/b/c/d pgTAP cells green (storage RLS policies on `farmarket-photos` bucket)                       | `make -C db test-auth07` |
| 2 | DB column stores **paths only** (`<farmer_id>/<ad_id>/<filename>`), never bytea                         | `\d+ public.m2_farmarket_ads` in psql |
| 3 | Public photo URL responds 200 without auth header                                                       | `curl -I <url from AdOut.photo_urls[0]>` |
| 4 | FARMER-B uploading into FARMER-A's prefix → 403 (storage RLS INSERT policy)                            | supabase-py with FARMER-B JWT |
| 5 | FAR-05 PATCH that replaces photos also removes the prior storage objects                                | Storage UI before/after |
| 6 | FAR-05 DELETE (soft) also removes storage objects                                                       | Storage UI before/after |
| 7 | Object size cap (2 MB) enforced at the API; the bucket policy also rejects > 2 MB as a backstop         | curl with a 3 MB png → 422 |

**Forge a cross-prefix upload (should be 403):**
```python
from supabase import create_client
sb = create_client(SUPABASE_URL, FARMER_B_JWT)  # user-scoped client
sb.storage.from_("farmarket-photos").upload(
    path=f"<farmer-A-uuid>/forged/evil.jpg", file=b"...", file_options={"content-type":"image/jpeg"}
)  # → expects storage.upload to raise 403
```

---

### FAR-08 — Admin views all ads & leads

**Files:** [admin/farmarket.py](../backend/app/routers/admin/farmarket.py), [admin/farmarket/FarMarketAdminView.tsx](../frontend/src/app/dashboard/admin/farmarket/FarMarketAdminView.tsx).

| # | Check                                                                          | How |
|---|--------------------------------------------------------------------------------|-----|
| 1 | F-08a pgTAP cell green (`farmarket_ads_admin_select` policy)                  | `make -C db test-auth07` |
| 2 | `GET /api/v1/admin/farmarket/ads` returns every ad regardless of status        | curl as ADMIN |
| 3 | `GET /api/v1/admin/farmarket/leads` returns every lead across all buyers      | curl as ADMIN |
| 4 | Same endpoints as FARMER → 403; as RESTAURANT → 403; as CITIZEN → 403          | curl matrix |
| 5 | Filter `?status=EXPIRED` returns only expired ads                              | curl |
| 6 | Filter `?region=Souss-Massa&product_type=Tom` returns intersection             | curl |
| 7 | Pagination: `?page=2&page_size=5` returns items 6–10, `has_next` reflects `total` | curl |
| 8 | UI `/dashboard/admin/farmarket` lists ads + leads with filters; filter chips update URL | browser walk |

```powershell
# all ads
curl.exe -s -H "Authorization: Bearer $JWT_ADMIN" `
  http://127.0.0.1:8000/api/v1/admin/farmarket/ads | jq '.items[] | {title,status,region}'

# only expired
curl.exe -s -H "Authorization: Bearer $JWT_ADMIN" `
  "http://127.0.0.1:8000/api/v1/admin/farmarket/ads?status=EXPIRED" | jq '.total'

# all leads
curl.exe -s -H "Authorization: Bearer $JWT_ADMIN" `
  http://127.0.0.1:8000/api/v1/admin/farmarket/leads | jq '.items[].status'
```

---

### FAR-09 — Featured ads at top of catalog

**Files:** [admin/farmarket.py](../backend/app/routers/admin/farmarket.py) (`admin_toggle_ad_featured`), [test_far09_featured_ads.py](../backend/tests/test_far09_featured_ads.py).

| # | Check                                                                       | How |
|---|------------------------------------------------------------------------------|-----|
| 1 | F-09a / F-09b pgTAP cells green                                              | `make -C db test-auth07` |
| 2 | `PATCH /api/v1/admin/farmarket/ads/{id}/feature` toggles `is_featured`       | curl |
| 3 | Calling the PATCH twice restores the original state (idempotency)            | curl × 2 |
| 4 | `PATCH … /feature` with unknown UUID → 404 `ad_not_found`                    | curl |
| 5 | FARMER/RESTAURANT hitting the PATCH → 403                                    | curl matrix |
| 6 | After featuring, `GET /api/v1/farmarket/catalog` puts the featured row first (`items[0].is_featured == true`) regardless of `created_at` | curl + jq |
| 7 | Frontend marketplace card shows the ★ badge on featured ads                  | browser walk |
| 8 | Admin "Épingler / Désépingler" toggle round-trips and refreshes the list     | browser walk |

```powershell
# Toggle
curl.exe -i -H "Authorization: Bearer $JWT_ADMIN" -X PATCH `
  http://127.0.0.1:8000/api/v1/admin/farmarket/ads/<ad_id>/feature

# Catalog sort check
curl.exe -s -H "Authorization: Bearer $JWT_RESTAURANT" `
  http://127.0.0.1:8000/api/v1/farmarket/catalog | jq '.items[0] | {title, is_featured}'
```

---

## 5. Cross-cutting checks (run once per session)

These catch regressions that the per-story cells miss.

| # | Check                                                                          | Command |
|---|--------------------------------------------------------------------------------|---------|
| 1 | AUTH-07 RLS matrix still green for every `m2_farmarket_*` row                  | `make -C db test-auth07` — no `SKIP` notices on FAR-* cells |
| 2 | AUTH-05 boundary: `service_client()` callers in farmarket are allowlisted (`routers/admin/farmarket.py` and worker code only) | `bash infra/scripts/check-secrets-boundary.sh` (Git Bash on Windows) |
| 3 | Frontend bundle scan — no `BREVO_API_KEY`, no `SUPABASE_SERVICE_ROLE_KEY`, no `SUPABASE_JWT_SECRET` in `frontend/.next/` | `bash infra/scripts/check-frontend-bundle.sh` after `npm run build` |
| 4 | Worker process inventory: while running, `Get-Process python` shows exactly the two `farmarket_*` workers you started; no stragglers from a prior session | PowerShell `Get-Process` |
| 5 | Backend log lines contain `request_id` and `lead_id` correlation when a lead is created | grep terminal 1 + terminal 3 |

```powershell
# Build & scan the frontend bundle locally
cd frontend; npm run build
bash ../infra/scripts/check-frontend-bundle.sh  # exits non-zero if BR-F4 violated
```

---

## 6. Local demo-day pre-flight (compressed walkthrough)

Run this in **one sitting** the morning of the demo (≈ 15 minutes):

1. `make -C db test-auth07` → expect all F-* cells green.
2. `pytest backend/tests -k far -q` → expect all green.
3. Start all four terminals from §3.3.
4. Log in as **FARMER-A** at http://localhost:3000 → create an ad with 3 photos → confirm visible at `/dashboard/farmer/ads`.
5. Log in as **RESTAURANT** (new browser profile) → filter by FARMER-A's region → see the ad → open it → submit a contact form.
6. Watch terminal 3 → `claimed lead_id=…` within seconds → Brevo email arrives in the test inbox **< 2 min** with buyer phone + message + ad title.
7. Log in as **ADMIN** → see the new ad and lead at `/dashboard/admin/farmarket` → click "Épingler".
8. Reload restaurant marketplace → pinned ad appears first with ★ badge.
9. In psql, manually `UPDATE` an existing ad's `expires_at = now() - interval '1 minute'`. With `EXPIRY_SCAN_PERIOD_S=30`, terminal 4 logs `expired=1` within 30s → confirm `EXPIRED` and absence from the catalog.
10. Log in as **FARMER-A** → edit the original ad's price → reload as RESTAURANT → updated price visible.
11. Log in as **FARMER-A** → soft-delete → vanishes from catalog within one render.

If all eleven pass, the epic is demo-ready.

---

## 7. Failure triage

| Symptom                                            | First place to look                                            |
|----------------------------------------------------|----------------------------------------------------------------|
| pgTAP F-* cell red                                 | `db/migrations/0032…0035*.sql` policy bodies; recheck AUTH-07 seed |
| Backend test red but pgTAP green                   | Pydantic schema drift vs DB CHECK — see [schemas.py](../backend/app/modules/farmarket/schemas.py) |
| 401 with valid JWT                                 | JWT signed with a different `SUPABASE_JWT_SECRET` than the backend has; or `exp` past |
| 403 where 200 expected                             | `app_metadata.vitachain_role` / `verification_status` claim missing in the JWT — see AUTH-06 hook |
| 422 `region must be one of the 12 …`               | Region string mismatch (accents matter): `Casablanca-Settat` vs `Casablanca - Settat` |
| Brevo email never arrives                          | Terminal 3 logs; check `BREVO_API_KEY` valid; check Brevo dashboard delivery log |
| `notified_at` stays NULL forever                   | Worker not running, or Brevo returning 5xx — check terminal 3 |
| EXPIRED ad still in catalog                        | FAR-02 query missing `status='ACTIVE'`; or FAR-06 worker not running; or `expires_at` in the future |
| Photo 401/403 when fetching public URL             | Bucket `public` flag in Supabase Storage; policy from migration 0033 |
| Photo upload returns 500                           | Storage path collision (use `upsert: false` on POST, `true` on PATCH); check uvicorn log for the supabase-py exception |
| Frontend ad form rejects valid photo               | BR-F2 mismatch — check `MAX_PHOTOS` / `MAX_PHOTO_BYTES` in [schemas.py](../backend/app/modules/farmarket/schemas.py) |
| `NOTIFY` never received by worker                  | `DATABASE_URL` is the pooler (:6543) instead of direct (:5432). LISTEN cannot survive transaction-pooler boundaries |
| CORS error in browser                              | `CORS_ALLOW_ORIGINS` missing `http://localhost:3000` |

For deeper failures, AUTH-07's `docs/runbook.md` §AUTH-07 triage flow applies —
most FAR-* failures land either in the RLS column or the BR column.

---

## 8. Sign-off

Epic 3 is **release-ready** when:

- [ ] All FAR-* stories in [spring-status.yml](./spring-status.yml) are `DONE`.
- [ ] `make -C db test-auth07` green with **zero** `SKIP` notices on FAR-* cells.
- [ ] `pytest backend/tests -k far -q` green on a clean clone.
- [ ] The §6 local demo-day walkthrough passes end-to-end.
- [ ] §5 cross-cutting checks all green (bundle scan, boundary scan).
- [ ] Brevo email round-trip recorded in the runbook with a timestamp.

Record the local-run summary (date, host, commit SHA) under a new
"E3 local-validation runs" table in [runbook.md](./runbook.md).
