# AUTH-07 — RLS audit + business rule test suite (the merge gate before demo)

> **Epic:** E1 — Authentication, Authorization & Roles (Cross-cutting)
> **Phase:** P3 — Architect (Week 6 — Security, Tests & Optimization)
> **Priority:** Must *(PRD §7.1 AUTH-04, §8.3, §12 Phase 3 W6 — every single domain story (KAT-01..14, FAR-01..09, SEC-01..10, BOT-01..07, ADM-*) added a new table, a new policy, a new business rule. Each story tested its own rule in isolation; none of them proved that the **system as a whole** still upholds them when the 22 role × table × verb combinations are exercised back-to-back, or that two business rules do not silently contradict each other (e.g. BR-S2's atomic stock decrement and BR-S3's 15-minute auto-expiry racing at the boundary). AUTH-07 is the merge gate that says: "before demo day, every BR-K1..BR-S4 is asserted by a test that runs on every PR, and every (role, table, verb) tuple in the matrix has a known-correct outcome". Without AUTH-07, regressions slip in silently between week 5 and week 8 polish, and the demo blows up in front of the steering committee on a code path nobody manually clicked in two weeks.)*
> **Status:** TODO
> **Depends on:** [AUTH-04](AUTH-04-enable-rls-on-sensitive-tables.md) (`IN_REVIEW` — ships the `public.has_role()` helper, the `user_scoped_client()` factory, the `request.jwt.claims` + `set local role authenticated` pgTAP pattern that AUTH-07 generalizes across every (role, table, verb) cell; ships the `make -C db test-auth04` skeleton AUTH-07 extends to `test-auth07`), [AUTH-05](AUTH-05-service-key-isolated-to-fastapi.md) (`IN_REVIEW` — guarantees that the service-role JWT cannot reach a logged-in user's browser, which is the *premise* of every assertion in the matrix; without AUTH-05 the entire suite is theatre because a leaked service-role key short-circuits every "denied" row), [AUTH-06](#) (KYC verification — the `verification_status = 'VERIFIED'` gate is encoded as an RLS `with check` clause on `farmarket.ads.INSERT` and `secondserve.meals.INSERT`; AUTH-07 is the test that proves the gate fires, so AUTH-06 must merge first), [KAT-01..05 / FAR-01..06 / SEC-01..08 / BOT-03..05](#) (each owner story landed its table, its policies, and its single business rule test; AUTH-07 cross-checks all of them at once against the role matrix — AUTH-07 cannot run before the tables exist), [INF-05](INF-05-ci-pipeline-github-actions-pre-commit.md) (`DONE` — the CI `db` and `backend` jobs are where AUTH-07's pgTAP + pytest assertions land; the path-filtered pre-commit hook gates schema-touching PRs).
> **Unblocks:** Demo Day (PRD §12 Phase 4) — the steering-committee sign-off depends on a green AUTH-07 run on the demo commit; UAT (informal restaurateur + farmer field testing in week 8); any post-MVD architectural change (the AUTH-07 matrix becomes the regression suite the Year-1 hardening phase iterates against — Stripe / CMI integration, Darija / Tamazight locales, multi-tenant SaaS — none of them are mergeable without AUTH-07 staying green).
> **Acceptance (per [docs/spring-status.yml](../spring-status.yml) lines 706–711):** *"All BR-K1..BR-S4 pass; no cross-role leaks."* Extended DoD: (a) `db/tests/auth07_role_matrix.sql` — exhaustive pgTAP file covering the 22 role × table × verb cells listed in §4 and asserting the documented outcome for each, wrapped in `begin … rollback`; (b) `db/tests/auth07_business_rules.sql` — pgTAP file covering the 11 BR rules that are enforceable at the database layer (BR-K1, BR-K2, BR-K4, BR-F1, BR-F2, BR-F3, BR-S1, BR-S2, BR-S3, BR-S4, plus BR-B1 phone CHECK constraint); (c) `backend/tests/test_auth07_business_rules.py` — pytest covering the 5 BR rules that are application-layer (BR-K3 OWM cache TTL, BR-F4 Brevo key isolation, BR-B2 Supabase Database Webhook delivery, BR-S1 server-side code generation entropy + format, BR-S2 409 conflict surfacing through FastAPI on race); (d) `backend/tests/test_auth07_role_matrix_e2e.py` — live end-to-end smoke that signs in as each of the 4 roles + anon (5 identities) and exercises the 22-cell matrix against the staging Supabase project, skipping cleanly when `SUPABASE_URL` is unset; (e) `scripts/verify-rls-matrix.sh` — Bash wrapper that runs `make -C db test-auth07` and the two backend pytest files in sequence; non-zero exit on any failure; (f) `.github/workflows/ci.yml` runs the suite in the `db` and `backend` jobs and the merge to `main` is gated on it; (g) `docs/runbook.md §AUTH-07` documents the matrix as a 5×N table, the BR coverage matrix as a 16-row table, the triage flow ("a cell that should DENY started returning data" / "a BR test went from green to red"), and the demo-day pre-flight checklist; (h) `docs/spring-status.yml` is updated and a hand-off line under `project.last_updated` records the matrix dimensions, the BR coverage count (16/16), and the staging drill timestamp; (i) the staging drill itself is recorded in the runbook drill log with a screenshot of the green CI run.

---

## 1. Purpose

By the time AUTH-07 starts (week 6), the codebase has accumulated:

- **10 tables** in 4 schemas (`public.profiles`, `katara.parcels` + `katara.devices` + `katara.telemetry` + `katara.thresholds`, `farmarket.ads` + `farmarket.leads`, `secondserve.meals` + `secondserve.reservations`, `botabaqa.leads`).
- **Roughly 32 RLS policies** (each table has 2–4 — typically `select`, `insert`, `update`, `delete` per role-shape).
- **16 business rules** (BR-K1..K4, BR-F1..F4, BR-B1..B2, BR-S1..S4) that span the schema constraints, RLS clauses, scheduled workers, and FastAPI handlers.
- **5 identities** that authenticate against the system (FARMER, RESTAURANT, CITIZEN, ADMIN, anon).

The product of those numbers is the **role × table × verb matrix**: 5 identities × 10 tables × 4 verbs = 200 cells in the worst case. The matrix is sparse — most cells are either "irrelevant" (an anon visitor never `INSERT`s into `katara.devices`) or "structurally denied" (no policy admits the operation, so the database returns zero rows or `42501`). The cells that *matter* for AUTH-07 are the ~22 documented in §4: every cell where a *positive* outcome is expected (each role's own data should be visible / mutable), every cell where the boundary between roles must be enforced (FARMER reading another FARMER's parcel, RESTAURANT reading a CITIZEN's reservation), and every cell where the public catalog is intentionally readable (FAR-02 ad list, SEC-02 meals map).

For an MVD whose value proposition is "we connect the food chain *securely* across three personas", a single broken cell in that matrix is a demo-day failure mode that is impossible to recover from on the spot:

| Failure mode | Without AUTH-07 | With AUTH-07 |
|---|---|---|
| **A KAT-05 PR weakens the `katara.thresholds` UPDATE policy** (e.g. `using (auth.uid() = owner_id)` → `using (true)` because a developer's local test failed and the "fix" was over-permissive) | RLS appears to work — the owner can update their own thresholds — but another FARMER on staging can edit them too. Discovered by Ahmed during the field test on day 6, after eight hours of bad data. No commit is reverted in time. Demo cancelled. | `auth07_role_matrix.sql` asserts FARMER-A's UPDATE on FARMER-B's threshold row affects zero rows. CI red on the PR. The over-permissive fix never merges. |
| **A FAR-06 CRON refactor stops marking ads as EXPIRED** (e.g. the worker's date arithmetic regresses to `> interval '7 days'` from `>= '7 days'`, so 7-day-and-N-hour-old ads sit ACTIVE forever) | BR-F3 is silently violated. Demo scenario C ("3-day-old ad still browseable") works fine because the demo runs on fresh data. Three weeks after demo, the catalog is polluted with stale ads. Restaurant frustration. | `auth07_business_rules.sql` BR-F3 asserts that ads at `created_at = now() - interval '7 days 1 second'` are EXPIRED after one tick of the worker. CI red. |
| **SEC-04 reservation race** — two CITIZENs reserve the last unit of a meal at the same millisecond, both get a pickup code, BR-S2 is violated | One restaurateur sees two `VITA-XXX` codes for one box. They give the meal to whoever arrives first. The second citizen leaves a 1-star review on their lunch break. | `test_auth07_business_rules.py::test_br_s2_atomic_reservation` spawns 20 concurrent reservations against a `quantity = 1` meal and asserts exactly 1 succeeds, the other 19 receive 409. CI red on any regression. |
| **A handler accidentally uses `service_client()` for a CITIZEN-facing read** (the temptation increases as the team gets tired in week 7 — RLS debugging is harder than just bypassing it) | The CITIZEN sees every reservation, including others'. Pickup codes leak across users. Privacy disaster. | `test_auth07_role_matrix_e2e.py::test_citizen_reservation_isolation` is a black-box assertion: it logs in as CITIZEN-A, queries `/api/v1/secondserve/reservations`, asserts the response contains only CITIZEN-A's reservations. The handler choice (service vs user-scoped) is irrelevant to the assertion — the *behaviour* is what is asserted. |

AUTH-07 is therefore three artefacts, in order of increasing scope:

1. **The structural matrix** — pgTAP at the database level. Tests the policies in isolation, in a `begin … rollback` transaction, against synthetic seed rows. Fast, deterministic, no network. Runs on every PR.
2. **The business-rule pgTAP suite** — pgTAP at the database level for rules that are *schema-resident* (CHECK constraints, RLS clauses, triggers, the FAR-06 CRON's SQL). Same harness as the matrix; one file, 11 assertions.
3. **The behavioural matrix** — pytest at the FastAPI level. Tests the *system* through the same surface a real client uses (REST endpoints, real Supabase staging project, real JWTs). Slower, only runs on commits to `main` (CI matrix lane), but it is the only test that catches a handler-level mistake (a wrong dependency injection, a missing `Depends(get_db_for_user)`, a `service_client()` smuggled into a CITIZEN read).

> **What this story is not:** writing *new* policies for existing tables (every owner story already attached its own — AUTH-07 only *tests* them; if a missing policy is uncovered, the fix lands in the owner story's branch, not AUTH-07's); writing *new* business rules (the 16 BRs are PRD-frozen — AUTH-07 only proves they hold); load testing or chaos testing (PRD §12 W6 also lists load testing — that is the partner story AUTH-08 + INF-08; AUTH-07 is the *correctness* leg, AUTH-08 is the *capacity* leg); performance regression — the cross-role assertions use small seeded fixtures, not realistic data volumes; UI testing — the SecondServe map view, the FarMarket filter UX, the Katara chart rendering are tested in their owner stories' frontend test files; security against external attackers (SQLi, XSS, CSRF) — those are not the AUTH-07 threat model, which is *internal authorization correctness* (a logged-in user reaching data they should not, or breaking a business invariant).

---

## 2. Scope

### In scope

- **`db/tests/auth07_role_matrix.sql`** — new pgTAP file. ~80 assertions across the 22 documented cells in §4. Pattern: seed one user per role via the service-role within the transaction (the `0003_profile_on_signup.sql` trigger fills `public.profiles`), seed one or two domain rows per module (one ACTIVE ad, one ACTIVE meal, one set of devices/parcels/telemetry), then for each (role, table, verb) cell: `select set_config('request.jwt.claims', <that user's claims>, true); set local role authenticated;` run the query, assert the expected outcome (`is(rowcount, expected_n)`). All wrapped in `begin … rollback`. The seed block at the top is reused across both new pgTAP files — extracted into `db/tests/_auth07_seed.psql` and `\i`-included from each. Idempotent against re-run.

- **`db/tests/auth07_business_rules.sql`** — new pgTAP file. 11 assertions:
  - **BR-K1** (one ESP32 ↔ one parcel) — insert a device row, then attempt a second insert for the same `device_api_key_hash` linked to a different parcel; assert the second fails with `23505` (unique violation) or the migration's chosen error code.
  - **BR-K2** (alert anti-spam, ≤ 1 email per device+metric per 24h) — insert a row in the `katara.alert_sent_log` table representing a sent email five minutes ago for `(device_id, metric)`; call the `katara.should_send_alert(device_id, metric)` function (KAT-06 ships it); assert it returns `false`. Repeat with the log row 25 hours ago; assert `true`.
  - **BR-K4** (history API ≤ 500 points) — insert 1000 telemetry rows for a single device over 7 days; call the `katara.history(parcel_id, granularity)` view/function (KAT-04); assert the returned row count ≤ 500 regardless of granularity choice.
  - **BR-F1** (only FARMER can create ads) — switch identity to RESTAURANT, attempt `insert into farmarket.ads`, assert `42501` permission denied; switch to CITIZEN, attempt the same insert, assert `42501`; switch to a *non-verified* FARMER, attempt the same insert, assert `42501` (AUTH-06 verification gate fires); switch to a verified FARMER, attempt the insert, assert success.
  - **BR-F2** (≤ 5 photos, ≤ 2 MB) — attempt `insert into farmarket.ads (photos) values (array_fill('http://x.test/p.jpg', array[6]))`; assert the table's CHECK constraint rejects with `23514`. (The 2 MB rule is enforced at the Supabase Storage layer / the upload API — covered by the FAR-07 storage RLS test; AUTH-07 only asserts the count check.)
  - **BR-F3** (ads > 7 days → EXPIRED) — insert an ad with `created_at = now() - interval '7 days 1 hour'`, status `'ACTIVE'`; call the CRON's SQL function `farmarket.expire_stale_ads()` (FAR-06 ships it); reselect the row; assert `status = 'EXPIRED'`. Insert a second ad at `now() - interval '6 days 23 hours'`; call the same function; assert that row stays `'ACTIVE'` (boundary correctness — off-by-one defends against a refactor that changes `>=` to `>`).
  - **BR-S1** (pickup code generated server-side) — insert a reservation with the service-role client without supplying `pickup_code`; assert the trigger / DEFAULT generates a non-null code; assert the code matches `^VITA-[A-Z0-9]{3}$`; assert two consecutive reservations get different codes; assert that an attempt by an *authenticated* user (CITIZEN role) to `update reservations set pickup_code = 'VITA-HCK'` returns zero rows (RLS or column-level grant denies it).
  - **BR-S2** (atomic reservation; 0 stock → 409) — insert a meal with `quantity_remaining = 1`; in a single transaction call `secondserve.reserve_meal(meal_id, citizen_id)` once (success), call it a second time (failure); assert the second call raises `'P0001'` with message containing `'sold out'` (the function uses `raise exception … using errcode = 'P0001'`); reselect `quantity_remaining`, assert it is 0; assert no partial side-effects (no orphaned reservation row).
  - **BR-S3** (auto-expiry every 15 min) — insert a meal with `deadline = now() - interval '1 minute'`, status `'ACTIVE'`; call `secondserve.expire_stale_meals()` (SEC-07 ships it); assert `status = 'EXPIRED'`. Insert a meal with `deadline = now() + interval '1 minute'`; call the same function; assert it stays `'ACTIVE'`. (The *scheduling* of the worker every 15 minutes is an INF-07 concern; AUTH-07 asserts the worker's SQL is correct.)
  - **BR-S4** (monthly commission = SUM(price × qty) × 0.15) — insert 5 COLLECTED reservations across one calendar month for one restaurateur, with prices and quantities producing a known SUM; call `secondserve.commission_for_month(restaurateur_id, '2026-04')`; assert the returned `numeric` equals `expected_sum * 0.15` exactly (not approximately — DECIMAL(10,2) is exact). Insert one CANCELLED reservation in the same month; re-run; assert the result is unchanged (cancelled reservations excluded).
  - **BR-B1** (Moroccan phone format) — attempt `insert into botabaqa.leads (phone) values ('+212600000000')`, assert `23514` (CHECK violation); attempt `'0612345678'`, assert success. Repeat with `'0712345678'` (Maroc Telecom 07x range) success; `'0412345678'` failure.

- **`backend/tests/test_auth07_business_rules.py`** — new pytest. 5 assertions:
  - **BR-K3** (OWM cache TTL ≥ 3h) — patch the OWM client to record every outbound HTTP call; invoke the `katara.weather_for(lat, lng)` cache helper twice in quick succession; assert exactly one outbound HTTP call was made; freeze time forward by 2h59m, call again, assert still one; freeze forward by 3h1m, call again, assert two.
  - **BR-F4** (Brevo key only on backend) — meta-test that imports `frontend/.next/static` (if the bundle exists in the test env, e.g. on CI after the frontend build); greps for the `BREVO_API_KEY` env-var *name* and for the canonical Brevo key prefix (`xkeysib-`); asserts neither is present. Skipped cleanly when no build artefact is present (local dev). Note: AUTH-05's `scripts/check-frontend-bundle.sh` already covers this at the build level — the pytest is the *Python-side* assertion that no test fixture or sample env file accidentally bundles the key. Belt-and-suspenders.
  - **BR-B2** (Database Webhook → Brevo, no Python) — query `select * from supabase_functions.hooks where hook_table_id = 'botabaqa.leads'::regclass`; assert exactly one webhook row exists; assert its `hook_name` matches `auth07_brev_lead_notification` (or whatever BOT-04 named it); assert no Python module under `backend/app/` imports the Brevo client *for the BotaBa9a lead path* (AST walk: any file under `backend/app/routers/botabaqa/` referencing `BrevoClient` or `from app.notifications.brevo import` fails the test). This is a *structural* assertion that the BR-B2 architecture decision has not regressed into a Python handler.
  - **BR-S1** (server-side code generation entropy) — call the FastAPI endpoint `POST /api/v1/secondserve/reservations` 1000 times with a fresh `meal_id` and `Idempotency-Key` each call; collect the 1000 returned codes; assert all 1000 are unique (no collisions — the `VITA-XXX` format has 36^3 = 46,656 codes; collision probability per pair ≈ 2×10⁻⁵, expected ~10 collisions in 1000 draws via birthday paradox is *acceptable*, but if the test sees > 50 collisions the entropy source has regressed). Hard assertion: zero codes start with `VITA-AAA` (the sentinel value reserved for tests). Assert every code matches `^VITA-[A-Z0-9]{3}$`. Assert the SecondServe route never accepts a client-supplied `pickup_code` field — if the request body contains one, FastAPI's Pydantic model should `422` it (the model uses `model_config = ConfigDict(extra="forbid")`).
  - **BR-S2** (concurrent reservation surfacing 409) — using `httpx.AsyncClient` and `asyncio.gather`, fire 20 concurrent `POST /reservations` against a single meal with `quantity_remaining = 1`; assert exactly one response is `201 Created`, the other 19 are `409 Conflict`, every `409` body has `code = "OUT_OF_STOCK"` and a `meal_id` field, none of the `409`s have a `pickup_code` (no information leak through the failure path).

- **`backend/tests/test_auth07_role_matrix_e2e.py`** — new pytest. Five identities, one black-box matrix sweep. Uses the staging Supabase project. The 22 cells (§4) are encoded as parametrize cases — `@pytest.mark.parametrize("identity,table,verb,expected", AUTH07_MATRIX)`. Each case: mint a synthetic JWT for `identity` via the AUTH-03 `_make_token` helper, hit the appropriate FastAPI route (or the PostgREST URL directly for table-level reads, mirroring what the frontend does), assert the response status and shape match `expected`. Skipped cleanly when `SUPABASE_URL` is unset. Marked `@pytest.mark.e2e` so the CI fast-lane skips it on PRs; the `main`-branch lane runs it.

- **`db/tests/_auth07_seed.psql`** — new helper file, `\i`-included from both pgTAP files. Creates the synthetic users, parcels, devices, ads, meals, leads needed for both files. Idempotent against the transaction wrapper (always begins from a clean state because of `begin … rollback`). Tagged with `auth07-` prefix on every email / device key so a leaked seed never collides with real staging data.

- **`scripts/verify-rls-matrix.sh`** — new Bash wrapper. Three sequential calls: `make -C db test-auth07`, `pytest backend/tests/test_auth07_business_rules.py -v`, and (only if `SUPABASE_URL` is set) `pytest backend/tests/test_auth07_role_matrix_e2e.py -v -m e2e`. Exits non-zero on the first failure. Designed for local pre-flight before requesting a `main` merge, and as the demo-day pre-flight (§6 step 7).

- **`db/Makefile`** — add `test-auth07` target:
  ```make
  test-auth07: ## AUTH-07 — role × table × verb matrix + BR-K1..BR-S4
      @test -n "$$DB_URL" || (echo "DB_URL is required (db/.env)" && exit 1)
      psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth07_role_matrix.sql
      psql "$$DB_URL" -v ON_ERROR_STOP=on -f tests/auth07_business_rules.sql

  verify: test-auth01 test-auth02 test-auth04 test-auth07
  ```

- **`.github/workflows/ci.yml`** — two narrow edits:
  1. The `db` job already runs `make -C db verify`. The Makefile edit above folds `test-auth07` into `verify`; no separate CI step is needed. The job's `SUPABASE_DB_URL` secret is already wired (AUTH-04).
  2. The `backend` job: add a step `AUTH-07 — business rule pytest` running `pytest backend/tests/test_auth07_business_rules.py -v`. The e2e file is gated behind a workflow-level conditional `if: github.ref == 'refs/heads/main'` so PR runs skip the network leg (keeps PR CI under 5 minutes); merge-queue runs exercise it.

- **`.pre-commit-config.yaml`** — no new hook. AUTH-07's pgTAP needs a live DB connection (slow, network-dependent); the backend BR tests need pytest config; both belong in CI, not in the per-commit local hook chain.

- **`docs/runbook.md`** — append a *"AUTH-07 — Authorization & business-rule regression matrix"* section. Three subsections: (1) the 22-cell role × table × verb matrix as a Markdown table (rendered version of `AUTH07_MATRIX` from the test); (2) the 16-row BR coverage matrix mapping each BR to its enforcing layer (DB schema / DB function / RLS clause / FastAPI handler / scheduled worker) and its test file & line; (3) the triage flow ("a green cell turned red" → policy regression / verification status drift / new role enum value not handled; "a BR test turned red" → schema migration regression / handler refactor that bypassed the gate / clock drift in CI); (4) the demo-day pre-flight checklist (run `scripts/verify-rls-matrix.sh` against staging, screenshot the green CI run, paste link to the merge commit it ran on).

- **`docs/spring-status.yml`** — flip `AUTH-07.status: TODO → IN_REVIEW` after local DoD; `DONE` after the staging drill (§6 step 6) is recorded in the runbook. Update `summary.todo` / `summary.in_review` / `summary.done`. Append a hand-off line under `project.last_updated` (template in §5.10).

### Out of scope (later stories / explicit deferrals)

- **Load testing under the matrix** — AUTH-08 / INF-08 own k6 + `wrk` scripting against `/ingest` and `/reservations`. AUTH-07 asserts *correctness*; the partner stories assert *throughput*. A green AUTH-07 plus a red AUTH-08 is a valid intermediate state (the system is correct but slow); the inverse is a demo-blocker.
- **Performance regression of the policies themselves** — `EXPLAIN ANALYZE` on every policy is an INF-08 observability concern (Sentry + pg_stat_statements). AUTH-07 does not measure query plans.
- **Frontend role gates** — the Next.js middleware that redirects a CITIZEN trying to open `/dashboard/farmer` is an INF-03 / per-module frontend concern. AUTH-07 asserts the *backend* refuses the cross-role read; the frontend's UX-level redirect is a different layer.
- **External attacker threat model** — SQL injection, XSS in ad descriptions, CSRF on the contact form, brute-force on `/auth/v1/token` — those are AUTH-08 (rate limiting) + INF-06 (HTTPS) + the ad/meal form input sanitisation in each owner story. AUTH-07's threat model is *authenticated insider misuse* and *regression detection*.
- **Storage RLS coverage** — `farmarket-photos` (FAR-07) and `kyc-documents` (AUTH-06) bucket policies live in `storage.objects`. AUTH-07's pgTAP focuses on `public.*` and module schemas; storage RLS is tested by the owner stories with their own bucket-specific harness. A future AUTH-09 may unify them.
- **Audit logging** — `pg_audit` or row-level history. Post-MVD. The MVD threat model relies on the matrix + CI as the *detection* mechanism, not on retrospective audit.
- **The BR-S2 race assertion under DB-level isolation flavours other than `read committed`** — `secondserve.reserve_meal()` uses `select … for update` which is correct under read-committed; testing repeatable-read / serializable behaviour is academic for the MVD.
- **Idempotency-Key contract** for the reservation endpoint (PRD §6.4.3) — the *header* is accepted (architectural safeguard noted in PRD), but the full idempotency-store implementation is post-MVD. AUTH-07 asserts the route refuses to crash when the header is present; it does not assert deduplication semantics.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [AUTH-04](AUTH-04-enable-rls-on-sensitive-tables.md) merged & verified on staging | `public.has_role()`, `user_scoped_client()`, the `request.jwt.claims` pgTAP pattern, and the `make -C db test-auth04` skeleton are all preconditions for AUTH-07. The `db/tests/auth04_cross_role_isolation.sql` is the *prototype* AUTH-07 generalises. |
| [AUTH-05](AUTH-05-service-key-isolated-to-fastapi.md) merged | The matrix' assumption is that the service-role JWT cannot reach a logged-in browser. AUTH-05 makes that structural; without it, the matrix is theatre. |
| [AUTH-06](#) merged | The verification gate (`verification_status = 'VERIFIED'` clause on `farmarket.ads.INSERT` and `secondserve.meals.INSERT`) is asserted as one of AUTH-07's BR-F1 sub-cases. AUTH-07 cannot run if AUTH-06's policy is not yet in place. |
| All E2 (Katara), E3 (FarMarket), E4 (BotaBa9a), E5 (SecondServe) table-creating stories merged | The matrix needs the 10 tables to exist. AUTH-07's PR fails locally if any of `katara.parcels`, `katara.devices`, `katara.telemetry`, `katara.thresholds`, `farmarket.ads`, `farmarket.leads`, `secondserve.meals`, `secondserve.reservations`, `botabaqa.leads` is missing. The `verify-rls-matrix.sh` script names the missing table in its error message. |
| Staging Supabase project seeded with `auth07-*` fixtures | One-off run of `db/seeds/auth07_test_users.sql` against the linked project. Idempotent. The 5 synthetic users (`auth07-farmer-A@test.local`, `auth07-farmer-B@test.local`, `auth07-restaurant@test.local`, `auth07-citizen@test.local`, `auth07-admin@test.local`) are required for the e2e leg. |
| `SUPABASE_JWT_SECRET` reachable from the backend test env | The `_make_token` helper from AUTH-03 (`backend/tests/test_security.py`) is the canonical synthetic-JWT factory. AUTH-07 imports it. |
| pgTAP ≥ 1.2 in the linked project | Confirmed during INF-02; same version `test-auth04` uses. |
| `httpx`, `freezegun`, `pytest-asyncio`, `pytest-xdist` in `backend/requirements-dev.txt` | `httpx` for the e2e leg's async concurrent reservations; `freezegun` for the BR-K3 OWM-cache time-freeze; `pytest-asyncio` for the BR-S2 concurrent harness; `pytest-xdist` is *not* used (the matrix is serial because of shared seed state — parallelism here is a footgun). |

---

## 4. The role × table × verb matrix (22 cells)

The cells below are the ones AUTH-07 asserts. Every other (role, table, verb) tuple is either irrelevant (anon visitor on a private table — no plausible request shape) or is the "DENY" symmetric image of a documented cell (FARMER-B on FARMER-A's parcel is the symmetric image of FARMER-A on FARMER-B's parcel — covered by one of the two).

Legend: ✅ = expected to return data / succeed; ⊘ = expected to be denied (RLS filter → empty result for read, `42501` or `204 no rows` for write); ⛔ = anon path is not even authenticated, response is `401` at the API layer before RLS runs.

| # | Identity | Table | Verb | Expected | Rationale |
|---|---|---|---|---|---|
| 1  | FARMER-A      | `public.profiles`           | SELECT  | ✅ (1 row, own) | AUTH-04 owner-only policy |
| 2  | FARMER-A      | `public.profiles` (other)   | SELECT  | ⊘ (0 rows)      | AUTH-04 — cross-row read denied |
| 3  | FARMER-A      | `public.profiles` (other)   | UPDATE  | ⊘ (0 rows)      | AUTH-04 — `204` with empty body |
| 4  | FARMER-A      | `katara.parcels`            | INSERT  | ✅              | Owner-only with `auth.uid() = owner_id` |
| 5  | FARMER-A      | `katara.parcels` (other)    | SELECT  | ⊘ (0 rows)      | KAT-01 owner-only policy |
| 6  | FARMER-A      | `katara.telemetry`          | INSERT  | ⊘ (`42501`)     | Telemetry is device-key-authed, not user-JWT — KAT-03 |
| 7  | FARMER-A      | `farmarket.ads` (own)       | UPDATE  | ✅              | FAR-05 owner-only |
| 8  | FARMER-A      | `farmarket.ads` (other)     | UPDATE  | ⊘ (0 rows)      | FAR-05 owner-only |
| 9  | FARMER-A (unverified) | `farmarket.ads`     | INSERT  | ⊘ (`42501`)     | AUTH-06 verification gate |
| 10 | FARMER-A (verified)   | `farmarket.ads`     | INSERT  | ✅              | AUTH-06 verification gate (positive path) |
| 11 | FARMER-A      | `farmarket.leads` (for own ad) | SELECT | ✅           | FAR-04 seller can see own leads |
| 12 | RESTAURANT    | `farmarket.ads`             | SELECT  | ✅ (all ACTIVE) | FAR-02 catalog public-read |
| 13 | RESTAURANT    | `farmarket.ads`             | INSERT  | ⊘ (`42501`)     | BR-F1 role gate |
| 14 | RESTAURANT (verified) | `secondserve.meals` | INSERT  | ✅              | SEC-01 owner + verified |
| 15 | RESTAURANT    | `secondserve.reservations` (for own meal) | SELECT | ✅ | SEC-06 restaurateur can see incoming |
| 16 | RESTAURANT    | `secondserve.reservations` (for other restaurateur's meal) | SELECT | ⊘ (0 rows) | Boundary |
| 17 | CITIZEN       | `secondserve.meals`         | SELECT  | ✅ (all ACTIVE) | SEC-02 public catalog |
| 18 | CITIZEN       | `secondserve.meals`         | INSERT  | ⊘ (`42501`)     | Role gate — only RESTAURANT publishes |
| 19 | CITIZEN-A     | `secondserve.reservations` (own)   | SELECT | ✅ (own)  | SEC-09 history |
| 20 | CITIZEN-A     | `secondserve.reservations` (other) | SELECT | ⊘ (0 rows) | Pickup-code privacy |
| 21 | ADMIN         | `farmarket.leads`           | SELECT  | ✅ (all)        | ADM-* admin-read |
| 22 | anon          | `secondserve.meals`         | SELECT  | ⛔ via PostgREST anon role — `select` allowed only if `for select using (true)` policy exists; if catalog is intentionally public, expected ✅. If gated, expected `401` at FastAPI. SEC-02 explicitly opens public-read in PRD § anon meaning of "browse meals on a map" applies. Documented expected: ✅. |

> **Implementation note:** the `AUTH07_MATRIX` constant in `test_auth07_role_matrix_e2e.py` is the single source of truth — the runbook's table in §5.9 is generated from it (`pytest --collect-only -q` + a tiny Python formatter). If the matrix grows (new module, new role), update the constant and re-export the table; do not maintain two copies.

---

## 5. Step-by-step implementation

### 5.1 `db/tests/_auth07_seed.psql` — shared seed block

Create [db/tests/_auth07_seed.psql](../../db/tests/_auth07_seed.psql):

```sql
-- AUTH-07 — synthetic fixtures reused by auth07_role_matrix.sql and
-- auth07_business_rules.sql. \i-included from each. Runs as the migration
-- runner (service-role) inside the file's outer `begin … rollback`.

do $$
declare
    farmer_a_id     uuid := gen_random_uuid();
    farmer_b_id     uuid := gen_random_uuid();
    restaurant_id   uuid := gen_random_uuid();
    citizen_a_id    uuid := gen_random_uuid();
    citizen_b_id    uuid := gen_random_uuid();
    admin_id        uuid := gen_random_uuid();

    parcel_a_id     uuid := gen_random_uuid();
    parcel_b_id     uuid := gen_random_uuid();

    ad_a_id         uuid := gen_random_uuid();

    meal_id         uuid := gen_random_uuid();
begin
    -- Six identities cover all five role variants + the cross-role-FARMER probe.
    insert into auth.users (id, email, raw_user_meta_data) values
        (farmer_a_id,   'auth07-farmer-A@test.local',   jsonb_build_object('role','FARMER')),
        (farmer_b_id,   'auth07-farmer-B@test.local',   jsonb_build_object('role','FARMER')),
        (restaurant_id, 'auth07-restaurant@test.local', jsonb_build_object('role','RESTAURANT')),
        (citizen_a_id,  'auth07-citizen-A@test.local',  jsonb_build_object('role','CITIZEN')),
        (citizen_b_id,  'auth07-citizen-B@test.local',  jsonb_build_object('role','CITIZEN')),
        (admin_id,      'auth07-admin@test.local',      jsonb_build_object('role','ADMIN'));
    -- 0003 trigger populates public.profiles. Bump the professionals to VERIFIED.
    update public.profiles
       set verification_status = 'VERIFIED'
     where id in (farmer_a_id, restaurant_id);
    -- farmer_b stays PENDING so cell #9 (unverified FARMER cannot insert ad) is exercisable.

    insert into katara.parcels (id, owner_id, crop, surface_m2, geom)
    values
        (parcel_a_id, farmer_a_id, 'tomato', 5000, st_geomfromgeojson('{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}')),
        (parcel_b_id, farmer_b_id, 'pepper', 4000, st_geomfromgeojson('{"type":"Polygon","coordinates":[[[2,2],[2,3],[3,3],[3,2],[2,2]]]}'));

    insert into farmarket.ads (id, owner_id, title, status, price_mad, quantity_kg, region, photos, created_at)
    values
        (ad_a_id, farmer_a_id, 'Tomato 5kg', 'ACTIVE', 80.00, 5, 'Souss-Massa', array['http://x.test/p1.jpg'], now());

    insert into secondserve.meals (id, owner_id, title, status, price_mad, quantity_remaining, deadline)
    values
        (meal_id, restaurant_id, 'Couscous box', 'ACTIVE', 35.00, 2, now() + interval '2 hours');

    -- Stash identity ids in GUCs so the consumer files can read them with current_setting('auth07.x').
    perform set_config('auth07.farmer_a_id',   farmer_a_id::text,   true);
    perform set_config('auth07.farmer_b_id',   farmer_b_id::text,   true);
    perform set_config('auth07.restaurant_id', restaurant_id::text, true);
    perform set_config('auth07.citizen_a_id',  citizen_a_id::text,  true);
    perform set_config('auth07.citizen_b_id',  citizen_b_id::text,  true);
    perform set_config('auth07.admin_id',      admin_id::text,      true);
    perform set_config('auth07.parcel_a_id',   parcel_a_id::text,   true);
    perform set_config('auth07.parcel_b_id',   parcel_b_id::text,   true);
    perform set_config('auth07.ad_a_id',       ad_a_id::text,       true);
    perform set_config('auth07.meal_id',       meal_id::text,       true);
end $$;
```

**Why GUCs and not session variables?** `set_config(…, true)` is transaction-local — the values are gone the moment the outer `rollback` runs. This keeps the test hermetic: no cleanup between runs, no risk of a half-aborted run leaving GUCs polluting the connection state.

**Why the FARMER-B `PENDING` carve-out?** Cell #9 in §4 — "unverified FARMER cannot insert ad" — is one of the highest-value assertions in the suite because it proves AUTH-06's verification gate is wired. Without FARMER-B left unverified, cell #9 cannot be exercised from inside the same `begin … rollback` block.

### 5.2 `db/tests/auth07_role_matrix.sql` — the 22-cell pgTAP

Create [db/tests/auth07_role_matrix.sql](../../db/tests/auth07_role_matrix.sql). Structure:

```sql
-- AUTH-07 — role × table × verb matrix. 22 cells, ~80 assertions.
\set ON_ERROR_STOP on
begin;

\i tests/_auth07_seed.psql

select plan(80);

-- Helper: switch identity. Reused across every cell.
create or replace function pg_temp.as_user(p_user_id uuid, p_role text)
returns void language plpgsql as $$
begin
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',       p_user_id,
            'user_role', p_role,
            'role',      'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';
end $$;

-- ============================================================================
-- Cell #1 — FARMER-A sees exactly own profile.
-- ============================================================================
select pg_temp.as_user(current_setting('auth07.farmer_a_id')::uuid, 'FARMER');
select is(
    (select count(*)::int from public.profiles),
    1,
    'cell-01: FARMER-A SELECT public.profiles -> exactly 1 row (own)'
);
select is(
    (select id::text from public.profiles limit 1),
    current_setting('auth07.farmer_a_id'),
    'cell-01b: the visible row is FARMER-A own profile'
);

-- ============================================================================
-- Cell #2 — FARMER-A cannot read FARMER-B's profile row.
-- ============================================================================
select is(
    (select count(*)::int from public.profiles
      where id = current_setting('auth07.farmer_b_id')::uuid),
    0,
    'cell-02: FARMER-A SELECT FARMER-B profile -> 0 rows'
);

-- ============================================================================
-- Cell #3 — FARMER-A cannot update FARMER-B's profile.
-- ============================================================================
with attempt as (
    update public.profiles
       set full_name = 'hacked'
     where id = current_setting('auth07.farmer_b_id')::uuid
    returning 1
)
select is(
    (select count(*)::int from attempt),
    0,
    'cell-03: FARMER-A UPDATE FARMER-B profile -> 0 rows affected (RLS filter)'
);

-- ============================================================================
-- Cell #4 — FARMER-A can INSERT own parcel.
-- ============================================================================
select lives_ok($$
    insert into katara.parcels (id, owner_id, crop, surface_m2, geom)
    values (gen_random_uuid(),
            current_setting('auth07.farmer_a_id')::uuid,
            'cucumber', 1000,
            st_geomfromgeojson('{"type":"Polygon","coordinates":[[[5,5],[5,6],[6,6],[6,5],[5,5]]]}'))
$$, 'cell-04: FARMER-A INSERT own katara.parcel succeeds');

-- ============================================================================
-- Cell #5 — FARMER-A cannot SELECT FARMER-B's parcel.
-- ============================================================================
select is(
    (select count(*)::int from katara.parcels
      where id = current_setting('auth07.parcel_b_id')::uuid),
    0,
    'cell-05: FARMER-A SELECT FARMER-B parcel -> 0 rows'
);

-- ============================================================================
-- Cell #6 — Direct INSERT into katara.telemetry under a user JWT must fail.
-- (Telemetry only accepts the device-key path; an authenticated user is
-- not allowed to forge readings for their own device through PostgREST.)
-- ============================================================================
select throws_ok($$
    insert into katara.telemetry (device_id, recorded_at, soil_moisture)
    values ('00000000-0000-0000-0000-000000000000'::uuid, now(), 50)
$$,
'42501',
'permission denied for table telemetry',
'cell-06: FARMER-A INSERT katara.telemetry via PostgREST is denied');

-- ============================================================================
-- Cell #7 — FARMER-A UPDATE own ad succeeds.
-- ============================================================================
select lives_ok($$
    update farmarket.ads
       set title = 'Tomato 5kg — updated'
     where id = current_setting('auth07.ad_a_id')::uuid
$$, 'cell-07: FARMER-A UPDATE own farmarket.ad succeeds');

-- ============================================================================
-- Cell #9 — Unverified FARMER-B INSERT ad is denied by AUTH-06 gate.
-- ============================================================================
select pg_temp.as_user(current_setting('auth07.farmer_b_id')::uuid, 'FARMER');
select throws_ok($$
    insert into farmarket.ads (owner_id, title, status, price_mad, quantity_kg, region)
    values (current_setting('auth07.farmer_b_id')::uuid,
            'Should fail', 'ACTIVE', 50, 3, 'Souss-Massa')
$$,
'42501',
NULL,
'cell-09: unverified FARMER-B INSERT farmarket.ad -> 42501 (AUTH-06 gate fires)');

-- ============================================================================
-- Cell #12, #13 — RESTAURANT can SELECT catalog, cannot INSERT ad.
-- ============================================================================
select pg_temp.as_user(current_setting('auth07.restaurant_id')::uuid, 'RESTAURANT');
select cmp_ok(
    (select count(*)::int from farmarket.ads where status = 'ACTIVE'),
    '>=',
    1,
    'cell-12: RESTAURANT SELECT farmarket.ads (ACTIVE) returns >= 1 row'
);
select throws_ok($$
    insert into farmarket.ads (owner_id, title, status, price_mad, quantity_kg, region)
    values (current_setting('auth07.restaurant_id')::uuid,
            'should-not-allow', 'ACTIVE', 60, 5, 'Casa')
$$,
'42501',
NULL,
'cell-13: RESTAURANT INSERT farmarket.ads -> 42501 (BR-F1)');

-- ============================================================================
-- Cell #17, #18 — CITIZEN can browse meals, cannot publish.
-- ============================================================================
select pg_temp.as_user(current_setting('auth07.citizen_a_id')::uuid, 'CITIZEN');
select cmp_ok(
    (select count(*)::int from secondserve.meals where status = 'ACTIVE'),
    '>=',
    1,
    'cell-17: CITIZEN SELECT secondserve.meals (ACTIVE) returns >= 1 row'
);
select throws_ok($$
    insert into secondserve.meals (owner_id, title, status, price_mad, quantity_remaining, deadline)
    values (current_setting('auth07.citizen_a_id')::uuid,
            'no', 'ACTIVE', 10, 1, now() + interval '1 hour')
$$,
'42501',
NULL,
'cell-18: CITIZEN INSERT secondserve.meals -> 42501');

-- (cells 19, 20, 21, 22 — same pattern; elided for brevity. The full file
-- carries all 22 cells. ~80 plan() assertions total.)

select * from finish();
rollback;
```

**Pattern notes.**
- Every cell ends in a `select is(...)` or `select throws_ok(...)`. `is_empty()` is *not* used because it does not give a row count on failure; `is(count(*), 0)` does, which is far more useful in CI logs.
- `pg_temp.as_user()` is created inside the transaction. It vanishes at rollback. Re-creating it every run is intentional — a stale function in `pg_temp` from an aborted prior run is impossible.
- Cells that *expect* an error use `throws_ok($$ … $$, '42501')`. Cells that expect *silent denial* (e.g. UPDATE with RLS filter — no error, just zero rows affected) use the `with attempt as (… returning 1) select count(*) = 0` idiom.

### 5.3 `db/tests/auth07_business_rules.sql` — the BR pgTAP

Create [db/tests/auth07_business_rules.sql](../../db/tests/auth07_business_rules.sql). 11 BRs; one named subsection each. The interesting structural patterns:

```sql
-- BR-K2 — alert anti-spam: ≤ 1 email per (device, metric) per 24h.
insert into katara.alert_sent_log (device_id, metric, sent_at)
values (current_setting('auth07.device_id')::uuid, 'soil_moisture', now() - interval '5 minutes');

select is(
    (select katara.should_send_alert(
              current_setting('auth07.device_id')::uuid,
              'soil_moisture')),
    false,
    'BR-K2: sent 5 minutes ago -> should_send_alert returns false'
);

update katara.alert_sent_log
   set sent_at = now() - interval '25 hours'
 where device_id = current_setting('auth07.device_id')::uuid;

select is(
    (select katara.should_send_alert(
              current_setting('auth07.device_id')::uuid,
              'soil_moisture')),
    true,
    'BR-K2: sent 25 hours ago -> should_send_alert returns true'
);

-- BR-F3 boundary correctness — the `>=` vs `>` regression killer.
insert into farmarket.ads (id, owner_id, title, status, price_mad, quantity_kg, region, created_at)
values (gen_random_uuid(), current_setting('auth07.farmer_a_id')::uuid,
        'stale-1h', 'ACTIVE', 50, 5, 'Souss-Massa', now() - interval '7 days 1 hour'),
       (gen_random_uuid(), current_setting('auth07.farmer_a_id')::uuid,
        'fresh-1h', 'ACTIVE', 50, 5, 'Souss-Massa', now() - interval '6 days 23 hours');

perform farmarket.expire_stale_ads();

select is(
    (select status::text from farmarket.ads where title = 'stale-1h'),
    'EXPIRED',
    'BR-F3: ad at 7d+1h -> EXPIRED after worker run'
);
select is(
    (select status::text from farmarket.ads where title = 'fresh-1h'),
    'ACTIVE',
    'BR-F3: ad at 6d+23h -> still ACTIVE (boundary defended)'
);

-- BR-S2 atomic stock — the test that defends the demo from race conditions.
-- A pgTAP test cannot easily simulate two concurrent connections (the test
-- runs in one). The DB-level assertion is *sequential*: stock=1, reserve(),
-- reserve() again, second raises. The truly concurrent assertion is in the
-- Python test (5.5 below) which spawns 20 parallel HTTP calls.
update secondserve.meals
   set quantity_remaining = 1
 where id = current_setting('auth07.meal_id')::uuid;

select lives_ok($$
    perform secondserve.reserve_meal(
        current_setting('auth07.meal_id')::uuid,
        current_setting('auth07.citizen_a_id')::uuid
    )
$$, 'BR-S2: first reserve_meal succeeds');

select throws_ok($$
    perform secondserve.reserve_meal(
        current_setting('auth07.meal_id')::uuid,
        current_setting('auth07.citizen_b_id')::uuid
    )
$$,
'P0001',
NULL,
'BR-S2: second reserve_meal raises P0001 (sold out)');

select is(
    (select quantity_remaining from secondserve.meals
      where id = current_setting('auth07.meal_id')::uuid),
    0,
    'BR-S2: quantity_remaining=0 after the successful reservation; no double-decrement'
);
```

The full file repeats the pattern for BR-K1, BR-K4, BR-F1 (split into 4 sub-cases: RESTAURANT, CITIZEN, unverified FARMER, verified FARMER), BR-F2, BR-S1, BR-S3, BR-S4, BR-B1. All wrapped in one `begin … rollback`.

**Why not split BR-K3 / BR-F4 / BR-B2 into pgTAP?** Those three are *application-layer* concerns — OWM HTTP cache TTL, frontend-bundle absence of Brevo key, webhook routing. They have no SQL surface to assert. They land in `test_auth07_business_rules.py` (§5.5).

### 5.4 `backend/tests/test_auth07_business_rules.py` — application-layer BRs

Create [backend/tests/test_auth07_business_rules.py](../../backend/tests/test_auth07_business_rules.py):

```python
"""AUTH-07 — application-layer business rule assertions.

Covers BR-K3 (OWM cache TTL), BR-F4 (Brevo key isolation),
BR-B2 (Database Webhook delivery shape), BR-S1 (server-side code generation
entropy + format), BR-S2 (concurrent reservation surfacing 409).

The DB-layer BRs are in db/tests/auth07_business_rules.sql.
"""

import ast
import asyncio
import os
import re
import time
import uuid
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from freezegun import freeze_time

REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# BR-K3 — OWM data cached >= 3 hours.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_br_k3_owm_cache_ttl_three_hours(monkeypatch):
    """The OWM client must not issue a second outbound request inside a 3h window."""
    from app.integrations.openweathermap import weather_for, _CACHE

    _CACHE.clear()
    calls = {"n": 0}

    async def fake_fetch(lat: float, lng: float):
        calls["n"] += 1
        return {"temp": 22.5, "humidity": 60, "lat": lat, "lng": lng}

    monkeypatch.setattr("app.integrations.openweathermap._fetch", fake_fetch)

    with freeze_time("2026-05-20 10:00:00") as frozen:
        await weather_for(30.0, -8.0)
        await weather_for(30.0, -8.0)
        assert calls["n"] == 1, "second call within seconds must hit cache"

        frozen.tick(delta=60 * 60 * 2 + 60 * 59)  # 2h 59m
        await weather_for(30.0, -8.0)
        assert calls["n"] == 1, "second call at 2h59m must still hit cache"

        frozen.tick(delta=60 * 2)  # +2m -> 3h01m total
        await weather_for(30.0, -8.0)
        assert calls["n"] == 2, "call after 3h must refresh"


# ---------------------------------------------------------------------------
# BR-F4 — Brevo key never in the frontend bundle.
# ---------------------------------------------------------------------------

def test_br_f4_brevo_key_absent_from_frontend_bundle():
    """If a built .next/ exists, neither the env-var name nor the key prefix appears."""
    bundle_root = REPO_ROOT / "frontend" / ".next"
    if not bundle_root.exists():
        pytest.skip("frontend/.next not built — covered by CI frontend job")

    forbidden_patterns = [
        re.compile(rb"BREVO_API_KEY"),
        re.compile(rb"xkeysib-[A-Za-z0-9_-]{40,}"),
    ]
    offenders: list[tuple[Path, str]] = []
    for path in bundle_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in {".js", ".mjs", ".json", ".html", ".txt"}:
            continue
        blob = path.read_bytes()
        for rx in forbidden_patterns:
            if rx.search(blob):
                offenders.append((path.relative_to(REPO_ROOT), rx.pattern.decode()))

    assert not offenders, (
        "BR-F4 violation — Brevo material in frontend bundle:\n"
        + "\n".join(f"  - {p}: {pat}" for p, pat in offenders)
    )


# ---------------------------------------------------------------------------
# BR-B2 — BotaBa9a lead notifications run as a Supabase Database Webhook,
# not as Python code.
# ---------------------------------------------------------------------------

def test_br_b2_botabaqa_python_does_not_import_brevo():
    """No file under backend/app/routers/botabaqa/ may import the Brevo client.
    The lead-notification path is owned by the Supabase Webhook (BOT-04)."""
    target_dir = REPO_ROOT / "backend" / "app" / "routers" / "botabaqa"
    if not target_dir.exists():
        pytest.skip("BOT-04 router not yet merged")

    offenders: list[tuple[Path, int, str]] = []
    for py_file in target_dir.rglob("*.py"):
        tree = ast.parse(py_file.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                if "brevo" in node.module.lower():
                    offenders.append((py_file.relative_to(REPO_ROOT),
                                      node.lineno, node.module))
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if "brevo" in alias.name.lower():
                        offenders.append((py_file.relative_to(REPO_ROOT),
                                          node.lineno, alias.name))

    assert not offenders, (
        "BR-B2 violation — Brevo imported from the BotaBa9a Python router. "
        "Lead notifications must go through the Supabase Database Webhook:\n"
        + "\n".join(f"  - {p}:{line} imports {mod}" for p, line, mod in offenders)
    )


# ---------------------------------------------------------------------------
# BR-S1 — pickup code generated server-side, format VITA-XXX, high entropy.
# ---------------------------------------------------------------------------

CODE_RX = re.compile(r"^VITA-[A-Z0-9]{3}$")


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("SUPABASE_URL"),
    reason="BR-S1 entropy assertion is a live e2e check",
)
async def test_br_s1_pickup_code_generation_entropy(staging_meal_factory,
                                                    staging_citizen_jwt,
                                                    api_base_url):
    codes: list[str] = []
    async with httpx.AsyncClient(base_url=api_base_url, timeout=10) as client:
        for _ in range(1000):
            meal_id = await staging_meal_factory(quantity_remaining=1)
            r = await client.post(
                "/api/v1/secondserve/reservations",
                json={"meal_id": meal_id},
                headers={
                    "Authorization": f"Bearer {staging_citizen_jwt}",
                    "Idempotency-Key": str(uuid.uuid4()),
                },
            )
            assert r.status_code == 201, r.text
            codes.append(r.json()["pickup_code"])

    assert all(CODE_RX.match(c) for c in codes), "code format VITA-XXX broken"
    assert "VITA-AAA" not in codes, "sentinel test-only code leaked"
    duplicates = len(codes) - len(set(codes))
    assert duplicates < 50, (
        f"BR-S1: {duplicates} duplicates in 1000 draws — entropy regression "
        f"(birthday paradox upper bound ~30 in clean PRNG)"
    )


@pytest.mark.asyncio
async def test_br_s1_pickup_code_not_accepted_from_client(staging_citizen_jwt,
                                                          api_base_url):
    async with httpx.AsyncClient(base_url=api_base_url, timeout=10) as client:
        r = await client.post(
            "/api/v1/secondserve/reservations",
            json={"meal_id": str(uuid.uuid4()), "pickup_code": "VITA-HCK"},
            headers={"Authorization": f"Bearer {staging_citizen_jwt}"},
        )
    assert r.status_code == 422, (
        "BR-S1: client-supplied pickup_code must be rejected by Pydantic "
        "extra='forbid'"
    )


# ---------------------------------------------------------------------------
# BR-S2 — concurrent reservations against quantity_remaining=1 produce
# exactly one 201 and N-1 surfaced 409s, never two 201s.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("SUPABASE_URL"),
    reason="BR-S2 race assertion is live e2e",
)
async def test_br_s2_concurrent_reservations(staging_meal_factory,
                                              staging_citizen_jwts,  # list of 20
                                              api_base_url):
    meal_id = await staging_meal_factory(quantity_remaining=1)

    async def attempt(jwt: str) -> httpx.Response:
        async with httpx.AsyncClient(base_url=api_base_url, timeout=10) as c:
            return await c.post(
                "/api/v1/secondserve/reservations",
                json={"meal_id": meal_id},
                headers={
                    "Authorization": f"Bearer {jwt}",
                    "Idempotency-Key": str(uuid.uuid4()),
                },
            )

    responses = await asyncio.gather(*(attempt(j) for j in staging_citizen_jwts))
    statuses = [r.status_code for r in responses]
    assert statuses.count(201) == 1, f"BR-S2: expected exactly 1 success, got {statuses}"
    assert statuses.count(409) == len(staging_citizen_jwts) - 1, (
        f"BR-S2: every other attempt must surface 409, got {statuses}"
    )

    for r in responses:
        if r.status_code == 409:
            body = r.json()
            assert body.get("code") == "OUT_OF_STOCK", body
            assert "pickup_code" not in body, "BR-S2: 409 path leaked a pickup_code"
            assert body.get("meal_id") == meal_id
```

**Fixture notes.** `staging_meal_factory`, `staging_citizen_jwt`, `staging_citizen_jwts`, `api_base_url` live in [backend/tests/conftest.py](../../backend/tests/conftest.py). The factory creates a fresh meal via `service_client()` and returns its id; the JWT fixtures mint synthetic tokens with `_make_token` (AUTH-03's helper). `staging_citizen_jwts` returns a list of 20 — one per `auth07-citizen-NN@test.local` seeded user, or a single user reused 20 times if the deployment serialises by `Idempotency-Key`. The fixture comment names which behaviour is documented.

### 5.5 `backend/tests/test_auth07_role_matrix_e2e.py` — black-box matrix

Create [backend/tests/test_auth07_role_matrix_e2e.py](../../backend/tests/test_auth07_role_matrix_e2e.py):

```python
"""AUTH-07 — end-to-end matrix sweep against the staging Supabase project."""

from dataclasses import dataclass
from typing import Literal

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("SUPABASE_URL"),
    reason="AUTH-07 e2e matrix requires staging",
)

Verb = Literal["GET", "POST", "PATCH", "DELETE"]


@dataclass(frozen=True)
class Cell:
    cell_id: int
    identity: str          # "farmer_a", "farmer_b_unverified", "restaurant", "citizen_a", "admin", "anon"
    method: Verb
    path: str
    body: dict | None
    expect_status: int
    expect_rows: int | None = None       # if response is a list, exact length expected
    expect_code: str | None = None       # if response is an error body, expected `code`


# The single source of truth — 22 cells (only a few shown for brevity).
AUTH07_MATRIX: list[Cell] = [
    Cell(1,  "farmer_a", "GET", "/rest/v1/profiles?select=id", None,
         200, expect_rows=1),
    Cell(2,  "farmer_a", "GET",
         "/rest/v1/profiles?select=id&id=eq.${FARMER_B_ID}", None,
         200, expect_rows=0),
    Cell(3,  "farmer_a", "PATCH",
         "/rest/v1/profiles?id=eq.${FARMER_B_ID}",
         {"full_name": "hacked"}, 204, expect_rows=0),
    Cell(9,  "farmer_b_unverified", "POST",
         "/api/v1/farmarket/ads",
         {"title": "x", "price_mad": 50, "quantity_kg": 5, "region": "S"},
         403, expect_code="VERIFICATION_REQUIRED"),
    Cell(13, "restaurant", "POST",
         "/api/v1/farmarket/ads",
         {"title": "x", "price_mad": 50, "quantity_kg": 5, "region": "C"},
         403, expect_code="ROLE_NOT_ALLOWED"),
    Cell(18, "citizen_a", "POST",
         "/api/v1/secondserve/meals",
         {"title": "x", "price_mad": 10, "quantity_remaining": 1,
          "deadline": "2026-06-01T20:00:00Z"},
         403, expect_code="ROLE_NOT_ALLOWED"),
    Cell(22, "anon", "GET", "/api/v1/secondserve/meals?status=ACTIVE", None,
         200),
    # … (full 22 cells)
]


@pytest.mark.parametrize("cell", AUTH07_MATRIX, ids=lambda c: f"cell-{c.cell_id:02d}-{c.identity}")
@pytest.mark.asyncio
async def test_matrix_cell(cell, identities, api_base_url):
    headers = {}
    if cell.identity != "anon":
        headers["Authorization"] = f"Bearer {identities[cell.identity]['jwt']}"
        headers["apikey"] = os.environ["SUPABASE_ANON_KEY"]

    path = cell.path.replace("${FARMER_B_ID}", identities["farmer_b_unverified"]["id"])

    async with httpx.AsyncClient(base_url=api_base_url, timeout=15) as client:
        r = await client.request(cell.method, path, json=cell.body, headers=headers)

    assert r.status_code == cell.expect_status, (
        f"cell-{cell.cell_id}: expected {cell.expect_status}, got "
        f"{r.status_code}: {r.text[:200]}"
    )

    if cell.expect_rows is not None:
        if cell.expect_status == 204:
            assert r.text in ("", "[]")
        else:
            data = r.json()
            assert isinstance(data, list), f"cell-{cell.cell_id}: expected list, got {type(data)}"
            assert len(data) == cell.expect_rows, (
                f"cell-{cell.cell_id}: expected {cell.expect_rows} rows, got {len(data)}"
            )

    if cell.expect_code is not None:
        body = r.json()
        assert body.get("code") == cell.expect_code, body
```

**Why parametrize with a frozen dataclass?** Each cell shows up in `pytest -v` as its own line (`cell-01-farmer_a PASSED`, `cell-09-farmer_b_unverified PASSED`, …). A regression on one cell does not hide behind a single failing test name; CI logs name the precise cell. The `ids=` lambda makes the matrix self-documenting in CI output.

### 5.6 `scripts/verify-rls-matrix.sh` — local pre-flight

Create [scripts/verify-rls-matrix.sh](../../scripts/verify-rls-matrix.sh):

```bash
#!/usr/bin/env bash
# AUTH-07 — run the full matrix + BR suite locally before requesting a main merge.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "AUTH-07 [1/3] — pgTAP role × table × verb matrix + BR DB tests"
make -C db test-auth07

echo "AUTH-07 [2/3] — application-layer BR pytest"
( cd backend && pytest tests/test_auth07_business_rules.py -v )

if [ -n "${SUPABASE_URL:-}" ]; then
    echo "AUTH-07 [3/3] — staging e2e matrix sweep"
    ( cd backend && pytest tests/test_auth07_role_matrix_e2e.py -v -m e2e )
else
    echo "AUTH-07 [3/3] — SKIPPED (no SUPABASE_URL)"
fi

echo "AUTH-07 — all green. Safe to merge to main."
```

Wire into the top-level Makefile:

```make
auth07: ## AUTH-07 — full matrix + BR + (optional) staging e2e
    @bash scripts/verify-rls-matrix.sh
```

### 5.7 CI changes — minimal and additive

Edit [.github/workflows/ci.yml](../../.github/workflows/ci.yml). The `db` job already calls `make -C db verify`; the §5.2 Makefile change folds `test-auth07` into `verify` automatically. **No new CI step needed for the pgTAP side.**

In the `backend` job, add one step after the existing pytest run:

```yaml
- name: AUTH-07 — business-rule pytest
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
    SUPABASE_JWT_SECRET: ${{ secrets.SUPABASE_JWT_SECRET }}
  run: |
    cd backend
    pytest tests/test_auth07_business_rules.py -v

- name: AUTH-07 — e2e matrix (main only)
  if: github.ref == 'refs/heads/main'
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
    SUPABASE_JWT_SECRET: ${{ secrets.SUPABASE_JWT_SECRET }}
    API_BASE_URL: ${{ secrets.STAGING_API_BASE_URL }}
  run: |
    cd backend
    pytest tests/test_auth07_role_matrix_e2e.py -v -m e2e
```

**Why `main`-only for the e2e leg?** Two reasons: (1) staging is shared — running 22 cells × every PR multiplies fixture churn; (2) the BR-S1 entropy assertion makes 1000 reservations, which is too expensive for every PR. The pgTAP + BR pytest legs cover regression on PR; the e2e leg is the final gate before deploy.

### 5.8 Runbook section

Append to [docs/runbook.md](../runbook.md):

````markdown
## AUTH-07 — Authorization & business-rule regression matrix

### Role × table × verb matrix (22 cells)

| # | Identity | Table / Endpoint | Verb | Outcome |
|---|---|---|---|---|
| 1 | FARMER-A | `public.profiles` | SELECT | ✅ 1 row (own) |
| 2 | FARMER-A | `public.profiles` (other) | SELECT | ⊘ 0 rows |
| 3 | FARMER-A | `public.profiles` (other) | UPDATE | ⊘ 204 empty |
| 4 | FARMER-A | `katara.parcels` (own) | INSERT | ✅ |
| 5 | FARMER-A | `katara.parcels` (other) | SELECT | ⊘ 0 rows |
| 6 | FARMER-A | `katara.telemetry` | INSERT via PostgREST | ⊘ 42501 |
| 7 | FARMER-A | `farmarket.ads` (own) | UPDATE | ✅ |
| 8 | FARMER-A | `farmarket.ads` (other) | UPDATE | ⊘ 0 rows |
| 9 | FARMER-B unverified | `farmarket.ads` | INSERT | ⊘ 42501 (AUTH-06) |
| 10 | FARMER-A verified | `farmarket.ads` | INSERT | ✅ |
| 11 | FARMER-A | `farmarket.leads` (own ad) | SELECT | ✅ |
| 12 | RESTAURANT | `farmarket.ads` ACTIVE | SELECT | ✅ |
| 13 | RESTAURANT | `farmarket.ads` | INSERT | ⊘ 42501 (BR-F1) |
| 14 | RESTAURANT verified | `secondserve.meals` | INSERT | ✅ |
| 15 | RESTAURANT | `secondserve.reservations` (own meal) | SELECT | ✅ |
| 16 | RESTAURANT | `secondserve.reservations` (other) | SELECT | ⊘ 0 rows |
| 17 | CITIZEN | `secondserve.meals` ACTIVE | SELECT | ✅ |
| 18 | CITIZEN | `secondserve.meals` | INSERT | ⊘ 42501 |
| 19 | CITIZEN-A | `secondserve.reservations` (own) | SELECT | ✅ |
| 20 | CITIZEN-A | `secondserve.reservations` (other) | SELECT | ⊘ 0 rows |
| 21 | ADMIN | `farmarket.leads` | SELECT | ✅ (all) |
| 22 | anon | `secondserve.meals` ACTIVE | SELECT | ✅ (public catalog) |

### Business-rule coverage matrix (16 rules)

| BR | Description | Enforcing layer | Test file | Notes |
|---|---|---|---|---|
| BR-K1 | One ESP32 ↔ one parcel | UNIQUE constraint on `katara.devices.device_api_key_hash` | `db/tests/auth07_business_rules.sql` | |
| BR-K2 | Alert anti-spam ≤ 1/24h | `katara.should_send_alert()` SQL function | `auth07_business_rules.sql` | |
| BR-K3 | OWM cache ≥ 3h | `app.integrations.openweathermap._CACHE` | `test_auth07_business_rules.py` | uses `freezegun` |
| BR-K4 | History API ≤ 500 points | `katara.history()` view aggregation | `auth07_business_rules.sql` | |
| BR-F1 | Only FARMER can create ads | RLS `with check (user_role='FARMER')` | `auth07_role_matrix.sql` cells 9, 10, 13 | |
| BR-F2 | ≤ 5 photos / ad | `farmarket.ads.photos` CHECK | `auth07_business_rules.sql` | 2 MB rule is a Storage RLS concern (FAR-07) |
| BR-F3 | Ad > 7d → EXPIRED | `farmarket.expire_stale_ads()` worker SQL | `auth07_business_rules.sql` | boundary test 7d+1h / 6d+23h |
| BR-F4 | Brevo key only on backend | AUTH-05 source/build/runtime guards | `test_auth07_business_rules.py` | belt-and-suspenders to AUTH-05 |
| BR-B1 | Phone format `^0[5-7]\d{8}$` | `botabaqa.leads.phone` CHECK | `auth07_business_rules.sql` | |
| BR-B2 | Webhook → Brevo (no Python) | Supabase Database Webhook | `test_auth07_business_rules.py` | AST scan + webhook presence |
| BR-S1 | Code generated server-side | Pydantic `extra='forbid'` + DB default | `test_auth07_business_rules.py` | format + entropy |
| BR-S2 | Atomic reservation, 409 on stock-0 | `secondserve.reserve_meal()` SQL function | `auth07_business_rules.sql` + `test_auth07_business_rules.py` | concurrent test in Python |
| BR-S3 | Auto-expiry every 15 min | `secondserve.expire_stale_meals()` worker SQL | `auth07_business_rules.sql` | |
| BR-S4 | Commission = SUM × 0.15 | `secondserve.commission_for_month()` | `auth07_business_rules.sql` | exact DECIMAL equality |

### Triage flow

| Symptom | Likely cause | Action |
|---|---|---|
| pgTAP cell-NN turned red | A migration added/changed a policy without updating the matrix | `git log -p -- db/migrations/` since last green run; diff the policy on the relevant table. Update the matrix or fix the policy. |
| pgTAP BR-K1..S4 turned red | A schema CHECK or trigger was dropped/loosened | `\d+ <schema>.<table>` on staging; compare to migration history. Restore the constraint. |
| e2e cell-NN turned red but pgTAP green | A handler regression — wrong `Depends()`, missing `require_role`, accidental `service_client()` | Grep the offending route module for `service_client(` and `Depends(get_db_for_user)`. Read the route's call site; the policy is fine, the handler is wrong. |
| BR-S1 entropy test fails | `secrets.token_hex` was replaced by `random.choices` somewhere, *or* the alphabet was truncated | `git log --grep="VITA-" -p`; restore `secrets.choice(string.ascii_uppercase + string.digits)`. |
| BR-S2 sees 2× 201 | `select … for update` removed from `reserve_meal()`, *or* transaction isolation downgraded | Read the function definition; `select … for update of <row>` must be present. Run `select * from pg_locks where granted = false` during the next failed run to confirm. |
| BR-F3 boundary test red on 6d+23h ad | The `>=` in the expire predicate became `>` | `\sf farmarket.expire_stale_ads`; restore `created_at <= now() - interval '7 days'`. |

### Demo-day pre-flight

1. Run `scripts/verify-rls-matrix.sh` locally against staging — green.
2. Trigger a `main` CI run on the demo commit — record the run URL.
3. Screenshot the CI green badge and paste under this section's *Demo runs* table.
4. Re-run `make -C db test-auth07` on the linked project ten minutes before the demo (the auto-expiry worker may have moved data around).
5. If any cell or BR is red within 30 minutes of the demo, fall back to "Smoke & Mirrors" (PRD §13 R3, R5): demo on the pre-generated JSON fixture and the recorded video. Do not attempt a hot fix.
````

### 5.9 `docs/spring-status.yml` — hand-off line

Append to `project.last_updated`:

```
# 2026-MM-DD — AUTH-07 LOCAL DONE: 22-cell role × table × verb matrix
# (db/tests/auth07_role_matrix.sql, ~80 pgTAP assertions, identities FARMER-A/
# FARMER-B-unverified/RESTAURANT/CITIZEN-A/CITIZEN-B/ADMIN + anon) and 11 DB-layer
# BR assertions (db/tests/auth07_business_rules.sql — BR-K1/K2/K4, BR-F1/F2/F3,
# BR-S1/S2/S3/S4, BR-B1) green via `make -C db test-auth07`. Application-layer
# BR assertions (BR-K3 OWM-cache via freezegun, BR-F4 frontend-bundle Brevo
# absence, BR-B2 AST scan + webhook presence, BR-S1 entropy + extra-forbid,
# BR-S2 concurrent reservation race) in backend/tests/test_auth07_business_rules.py
# green via pytest. Live e2e matrix sweep in backend/tests/test_auth07_role_matrix_e2e.py
# parametrizes the 22 AUTH07_MATRIX cells, gated `main`-only in CI; locally green
# against staging qyyxgdfetzjqfpygikbz. scripts/verify-rls-matrix.sh wraps all
# three legs for local pre-flight; top-level `make auth07` target wired. CI: db
# job picks up test-auth07 via the new `verify` chain in db/Makefile (no extra
# step); backend job gains the pytest step; e2e step runs only on refs/heads/main.
# Runbook docs/runbook.md §AUTH-07 ships the 22-row matrix table, the 16-row BR
# coverage matrix, the triage flow, and the demo-day pre-flight checklist.
# Unblocks: Demo Day pre-flight; the AUTH-07 matrix becomes the regression suite
# every future schema-touching PR is gated against. DoD flips to DONE on:
# (a) `scripts/verify-rls-matrix.sh` green against staging with SUPABASE_URL set;
# (b) the main-branch CI run that includes the e2e leg is green and its URL is
# recorded in runbook §AUTH-07 Demo-runs table; (c) the 16-row BR coverage matrix
# in the runbook is sanity-checked against PRD §6 by a second reviewer.
```

Flip `AUTH-07.status: TODO → IN_REVIEW`. Update the `summary` counters (`todo` -1, `in_review` +1).

---

## 6. Verification

Run in order on a clean working tree:

```bash
# 1. Schema is current — every domain table must exist.
make -C db push
make -C db list
# Expect: 0001..0010 + every owner-story migration applied (KAT/FAR/SEC/BOT).

# 2. pgTAP matrix + BR.
make -C db test-auth07
# Expect: 80 + 11 `ok` lines + two ROLLBACK lines.

# 3. Application-layer BR pytest.
cd backend && pytest tests/test_auth07_business_rules.py -v
# Expect: 5 passed (BR-K3 / F4 / B2 always run; BR-S1 entropy + BR-S2 race
# skip without SUPABASE_URL).

# 4. e2e matrix against staging.
SUPABASE_URL=https://qyyxgdfetzjqfpygikbz.supabase.co \
SUPABASE_ANON_KEY=$ANON \
SUPABASE_JWT_SECRET=$SECRET \
API_BASE_URL=https://staging-api.vitachain.ma \
pytest tests/test_auth07_role_matrix_e2e.py -v -m e2e
# Expect: 22 passed, each line names `cell-NN-<identity>`.

# 5. Single-script wrapper.
bash scripts/verify-rls-matrix.sh
# Expect: three "AUTH-07 [X/3]" sections, final "all green" line.

# 6. CI green on a no-op PR.
git checkout -b chore/auth-07-noop
git commit --allow-empty -m "AUTH-07 — verify CI flow"
git push -u origin chore/auth-07-noop
# Expect: db job green (test-auth07 runs); backend job green (BR pytest runs);
# e2e step skipped per `if: github.ref == 'refs/heads/main'`.

# 7. Demo-day pre-flight rehearsal.
SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_JWT_SECRET=… \
  bash scripts/verify-rls-matrix.sh
# Expect: green within < 90 seconds (DB matrix ~10s, BR pytest ~5s, e2e ~70s for
# 22 cells + 1000-call entropy + 20-call race). Record timestamp and run URL.
```

**Manual staging drill** (gates DoD):
1. From the staging frontend, sign in as `auth07-farmer-A@test.local` — confirm the dashboard loads and shows exactly one parcel.
2. In the same browser session, open DevTools and run:
   ```js
   fetch('/rest/v1/profiles?select=*', {
     headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY }
   }).then(r => r.json()).then(console.log)
   ```
   Expect a one-element array — the FARMER-A profile.
3. Sign out, sign in as `auth07-restaurant@test.local`. Same fetch — expect a one-element array, the RESTAURANT profile.
4. Attempt to publish an ad via the UI as `auth07-farmer-B@test.local` (unverified). Expect a 403 toast referencing `VERIFICATION_REQUIRED`.
5. Record outcomes in the runbook AUTH-07 *Demo runs* table along with the CI run URL.

---

## 7. Risks & failure modes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **A new module story (post-AUTH-07) lands a table without updating the matrix** | High over weeks 7–8 | High — silent gap in coverage | The 22-cell matrix is the single source of truth in `AUTH07_MATRIX`. PR template adds a checkbox: "If this PR adds a table, was AUTH07_MATRIX extended?" Code review enforces it. The pgTAP RLS-contract test from AUTH-04 fails CI if any new public table has no policy at all — so a *complete* miss is impossible; a partial miss (one role × one verb under-asserted) is the residual risk. |
| **Staging Supabase project clock drift breaks BR-F3 / BR-S3 boundary tests** | Low | Medium | Boundary tests use `now() - interval` arithmetic relative to the DB clock; drift inside the *same* transaction is impossible. Cross-session drift is irrelevant because the worker SQL is asserted in-transaction. |
| **`freezegun` patch leaks into a parallel test, breaking unrelated time-sensitive code** | Low | Medium | The BR-K3 test uses `with freeze_time(...)` (context manager), not the decorator. The patch is scoped to the block. `pytest-xdist` is explicitly *not* used. |
| **BR-S1 entropy test fails on a clean PRNG by birthday-paradox bad luck** | Very low (≤ 1%) | Low — flake | The threshold is `< 50` duplicates in 1000 draws against a 46k-code space (expected ~30 by birthday paradox). The 50 ceiling is ~2σ above expected. If it fails flakily, the cause is real entropy regression, not luck. |
| **CI flake on the 20-call concurrent reservation test** (network jitter between the 20 `httpx.AsyncClient` requests serialises them, masking the race) | Medium | Medium — false green, not false red | The test is *only* meaningful if the 20 requests overlap. Mitigation: the FastAPI handler must honour the `Idempotency-Key` header to deduplicate, *not* serialise — if the handler queues sequentially the test trivially passes 1×201 + 19×409 even without a race. The runbook §AUTH-07 triage flow names this and suggests `EXPLAIN ANALYZE` on `reserve_meal()` to confirm `for update` is firing. |
| **Adding a 5th role (e.g. `INSPECTOR` post-MVD) requires recomputing every cell** | Very low for MVD | High in post-MVD | The matrix is hand-curated, not generated. A new role is a focused, multi-PR effort: enum migration, add the identity to `_auth07_seed.psql`, extend `AUTH07_MATRIX` with the new role's row across every table. Documented as a known-extensibility task; not a defect. |
| **A handler regression where `service_client()` is used for a CITIZEN read** *and* the resulting handler happens to filter by `auth.uid()` from the JWT (because the developer was tired but at least checked the user) | Medium | High — RLS bypassed, only the in-handler filter remains; if a bug in the filter (e.g. missing `where`), every row leaks | AUTH-05's `test_service_client_callsite_allowlist.py` constrains where `service_client()` can live (admin / workers / auth_hooks). The e2e matrix is the behavioural backstop: cell-19 / cell-20 (CITIZEN reservation isolation) catches the leak even if the in-handler filter is wrong. |
| **A reviewer accepts a PR that adds a *test exemption* rather than a *fix*** | Medium under deadline pressure | Critical — silent erosion | The `AUTH07_MATRIX` const has no `xfail` and no skip mechanism by design. Removing a cell is a code change that must be justified in the PR description. Code review enforces. |
| **The e2e leg's 1000-call entropy test exhausts the staging rate-limit** | Low — staging has no rate limit during MVD | Low | If post-MVD AUTH-08 adds NGINX rate limits to `/reservations`, this test must be excluded from the rate-limited path or the limit raised for the `auth07-citizen-*` users. Tracked in §8 hand-off. |

---

## 8. Definition of Done

- [ ] `db/tests/_auth07_seed.psql` — shared seed block, idempotent against the outer rollback.
- [ ] `db/tests/auth07_role_matrix.sql` — 22 cells, ~80 pgTAP assertions, green via `make -C db test-auth07`.
- [ ] `db/tests/auth07_business_rules.sql` — 11 DB-layer BR assertions, green via the same target.
- [ ] `db/Makefile` — `test-auth07` target added; `verify` chain includes it.
- [ ] `backend/tests/test_auth07_business_rules.py` — 5 assertions (BR-K3, BR-F4, BR-B2, BR-S1, BR-S2) pass; BR-S1 entropy + BR-S2 race skip cleanly without staging credentials.
- [ ] `backend/tests/test_auth07_role_matrix_e2e.py` — `AUTH07_MATRIX` exports the 22 cells as a frozen dataclass list; `pytest -v` shows each `cell-NN-<identity>` as a separate line.
- [ ] `backend/tests/conftest.py` — fixtures `identities`, `staging_meal_factory`, `staging_citizen_jwts` (list of 20), `api_base_url` added; reuse `_make_token` from `test_security.py`.
- [ ] `scripts/verify-rls-matrix.sh` — runs all three legs; exits non-zero on the first failure; the no-network leg works in pure-local mode.
- [ ] Top-level `Makefile` — `auth07` target wired.
- [ ] `.github/workflows/ci.yml` — `backend` job runs `test_auth07_business_rules.py` on every PR; runs `test_auth07_role_matrix_e2e.py -m e2e` only on `refs/heads/main`.
- [ ] `docs/runbook.md §AUTH-07` — matrix table (22 rows), BR coverage table (16 rows), triage flow, demo-day pre-flight checklist, *Demo runs* table (empty, populated as the team performs drills).
- [ ] Staging drill (§6 manual steps 1–5) recorded in the *Demo runs* table with timestamp and run URL.
- [ ] `docs/spring-status.yml` — `AUTH-07.status: TODO → IN_REVIEW`; `summary` counters updated; hand-off line appended under `project.last_updated`.
- [ ] `ruff check backend/tests/test_auth07_*.py` and `mypy backend/tests/` pass cleanly.
- [ ] `make -C db verify` green end-to-end (AUTH-01 + AUTH-02 + AUTH-04 + AUTH-07 in series) on staging.

---

## 9. Hand-off notes

- **For Demo Day (PRD §12 Phase 4):** The `scripts/verify-rls-matrix.sh` script run ≤ 30 min before the demo is the last gate. If it goes red, do not attempt a hot fix — switch to "Smoke & Mirrors" per PRD §13 R3 / R5. The `docs/runbook.md §AUTH-07` triage table is the *only* document anyone should reference during the demo window; do not improvise.

- **For AUTH-08 (NGINX rate limiting):** When rate limits land on `/api/v1/secondserve/reservations`, the BR-S1 entropy test (1000 calls) and BR-S2 concurrency test (20 calls) will be the first tests to feel the pinch. Either (a) carve a rate-limit exemption for the `auth07-citizen-*` user agents in NGINX `map`, or (b) parametrise the entropy test down to a sample size of ~300 (still > 1σ above birthday-paradox expected for false-positive control) and add a `time.sleep(0.05)` between calls. AUTH-08 owns that decision; AUTH-07 stays silent.

- **For Year-1 hardening (multi-tenant, CMI integration, Darija):** The `AUTH07_MATRIX` constant is the regression suite. A 5th locale or a 2nd tenant adds rows, not concepts. The pattern in `pg_temp.as_user()` (set `request.jwt.claims` + `set local role authenticated`) is the canonical RLS-test idiom for the entire codebase post-MVD; document it in the platform handbook.

- **For any future module (M5..M8 in the post-MVD roadmap):** A new module adds a schema, tables, policies, and business rules. The mechanical checklist is: (1) extend `_auth07_seed.psql` with one fixture row per new table; (2) append cells to `auth07_role_matrix.sql` for every (role, table, verb) where the outcome is *intentional* (positive read, denied write, etc.); (3) append assertions to `auth07_business_rules.sql` for every new BR; (4) extend the runbook tables. The cost of skipping any one of these in week 1 of a new module compounds; this story is the precedent that says "don't skip."

- **For the verification gate (AUTH-06):** Cell #9 (unverified FARMER-B `INSERT farmarket.ads` → 42501) and cell #10 (verified FARMER-A `INSERT farmarket.ads` → success) are the two cells that prove AUTH-06's verification clause fires. If AUTH-06's policy is ever rewritten (e.g. swapped from inline `with check` to a SECURITY DEFINER guard), those two cells are the regression sentinels. AUTH-06's own DoD references this story by name.

- **For the IoT path (KAT-03):** Cell #6 — direct `INSERT katara.telemetry` via a user JWT is denied — is the assertion that telemetry can *only* arrive through the device-key path (`POST /api/v1/katara/ingest`). If that route ever stops doing constant-time key comparison, the matrix does not catch it (that is INF-08 / AUTH-08 territory) — but if the *RLS* on `katara.telemetry` is weakened to admit user-JWT writes, cell #6 will scream.

---

*AUTH-07 implementation guide — generated under BMAD methodology — references PRD §6 (BR-K1..BR-S4), §7.1 AUTH-04, §8.3, §12 Phase 3 W6, and `docs/spring-status.yml` lines 706–711.*
