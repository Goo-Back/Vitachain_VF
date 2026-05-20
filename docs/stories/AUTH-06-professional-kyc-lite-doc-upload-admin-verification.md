# AUTH-06 — Professional KYC-lite — document upload + admin verification flow

> **Epic:** E1 — Authentication, Authorization & Roles (Cross-cutting)
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must *(PRD §7.1 AUTH-06, §5.1 — every professional action in VitaChain (publish an ad, list a surprise box, register a parcel) presumes the actor is *who they say they are*. AUTH-02 puts a `role` on the profile; AUTH-06 puts *evidence* behind that role. Without it, "I am a farmer" is a string the user typed at signup with no anchor in reality — a vector for catalog spam, fake commission claims, and the most embarrassing demo-day failure mode: an unverified seller publishing rotten goods on the live marketplace.)*
> **Status:** TODO
> **Depends on:** [AUTH-02](AUTH-02-role-assignment-registration.md) (`IN_REVIEW` — `public.profiles.role` is the column AUTH-06 reads to decide *whether the user even has a KYC obligation* (CITIZEN does not); `custom_access_token_hook` from migration 0006 is the **exact** hook AUTH-06 extends with a second claim, `verification_status`, on the same payload), [AUTH-04](AUTH-04-enable-rls-on-sensitive-tables.md) (`IN_REVIEW` — the RLS contract + `public.has_role()` helper from migration 0008 are the pattern AUTH-06 reuses on `kyc_documents`; the `verification_status`-gated INSERT template documented in `docs/runbook.md` §AUTH-04 is what FAR-01 / SEC-01 will copy verbatim once AUTH-06 ships the claim), [AUTH-05](AUTH-05-service-key-isolated-to-fastapi.md) (`IN_REVIEW` — the `service_client()` allow-list under `backend/app/routers/admin/` is *the* mechanism by which AUTH-06's verification-flip endpoint is reachable; without AUTH-05 the flip could happen from any handler and the mutation would silently bypass the BEFORE-UPDATE immutability trigger from migration 0005), [INF-02](INF-02-supabase-project-base-schema.md) (`DONE` — the `kyc-documents` private storage bucket is **already** provisioned at [db/migrations/0004_storage_buckets.sql:16-18](../../db/migrations/0004_storage_buckets.sql#L16-L18) explicitly waiting for AUTH-06 to attach policies; the `public.verification_status` enum (`PENDING|VERIFIED|REJECTED`) is **already** in [db/migrations/0001_extensions_and_enums.sql:26](../../db/migrations/0001_extensions_and_enums.sql#L26); the `enforce_profile_immutability` trigger from [migration 0005:53-87](../../db/migrations/0005_profiles_rls_recursion_fix.sql#L53-L87) **already** prevents non-service-role JWTs from flipping the column, so AUTH-06's flip endpoint is the *only* legitimate write path by construction), [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) (`IN_REVIEW` — `backend/app/routers/` is the FastAPI surface; `service_client()` / `get_db_for_user` from [backend/app/db.py](../../backend/app/db.py) are the two and only DB factories AUTH-06's handlers use)
> **Unblocks:** [ADM-02](#) (the admin verification queue UI consumes AUTH-06's `GET /api/v1/admin/kyc/pending` listing and triggers `POST /api/v1/admin/kyc/{user_id}/approve|reject`; ADM-02 owns the screen, AUTH-06 owns the endpoint contract and the storage of every submission), [KAT-01](#) (farmer registers a parcel — the handler `Depends(require_verified())` from AUTH-06's new factory in `backend/app/core/security.py`), [FAR-01](#) (verified farmer creates an ad — same gate; the `farmarket.ads` RLS INSERT policy will key on `(auth.jwt()->>'verification_status') = 'VERIFIED'`, the claim AUTH-06 lifts into the JWT), [SEC-01](#) (verified restaurateur publishes a surprise box — same pattern as FAR-01), [NOT-01](#) (the Brevo mailer worker will gain three new templates AUTH-06 declares: `kyc.submitted`, `kyc.approved`, `kyc.rejected` — NOT-01 owns the dispatcher; AUTH-06 owns the *trigger* on `kyc_documents.status` transitions), [AUTH-07](#) (the role × table × verb matrix gains a *verification_status* dimension; AUTH-06's `kyc_documents` RLS policies are folded into the same audit suite without re-deriving)
> **Acceptance (per [docs/spring-status.yml:704](../spring-status.yml#L704)):** *"verification_status gate blocks unverified create-ad/publish-meal."* Extended DoD: (a) a verified-pro profile has `verification_status = 'VERIFIED'` set by an **admin-only** mutation flowing through `service_client()` (no other path can write the column — enforced by migration 0005's trigger × AUTH-05's allow-list, both already shipped); (b) a `public.kyc_documents` table persists every submission with `(user_id, document_type, storage_path, mime_type, size_bytes, status, submitted_at, reviewed_at, reviewer_id, reviewer_note)`, RLS-protected so a user reads only their own rows and admins read all; (c) the `kyc-documents` private storage bucket has owner-only INSERT and owner-or-admin SELECT policies, with size and mime-type guards mirroring `farmarket-photos`' future write rules (≤ 5 MB per doc, `application/pdf` or `image/{jpeg,png,webp}` only); (d) `custom_access_token_hook` (from AUTH-02 migration 0006) is **extended** in a new migration to populate `claims.verification_status` from `public.profiles.verification_status` — single hook function, two claims, one SELECT, no second round trip; (e) a `require_verified()` FastAPI dependency factory in [backend/app/core/security.py](../../backend/app/core/security.py) layers on `require_role()` to 403 with `verification_required` when the JWT claim is anything other than `VERIFIED` — FAR-01 and SEC-01 will `Depends(require_verified("FARMER"))` / `("RESTAURANT")` directly; (f) two pgTAP tests in `db/tests/auth06_*.sql` prove the storage policy denies cross-user reads and the verification-status RLS template denies INSERT for a PENDING farmer (proves the *gate*, not just the mechanism); (g) one backend pytest under `backend/tests/test_kyc_flow.py` walks the complete journey — submit → admin list → admin approve → re-issued JWT carries `verification_status=VERIFIED` → previously-403 INSERT against a synthetic `farmarket.ads` row now returns 201 — and the opposite for REJECTED; (h) Brevo templates exist in FR / AR / EN per PRD §7.2 for `kyc.submitted` (sent on submission), `kyc.approved` and `kyc.rejected` (sent by NOT-01 on the status flip — AUTH-06 ships the *enqueue*, NOT-01 ships the *dispatch*); (i) `docs/runbook.md` carries an *"AUTH-06 — KYC operational notes"* section with the admin triage flow, the document-purge cadence (REJECTED docs are deleted after 30 days; APPROVED docs are kept for the lifetime of the account per PRD §11.1), and the leak-response procedure if a `kyc-documents` URL ever leaks (rotate bucket signed-URL secret; force-re-upload). 

---

## 1. Purpose

PRD §5.1 lists *"Professional verification — KYC-lite: document upload, admin approval for farmers/restaurateurs"* as in-scope. AUTH-06 is where that one-line scope item becomes the structural answer to a class of trust failures that are the entire premise of the marketplace:

1. **Without KYC, every professional role is self-asserted.** A user picks "FARMER" on the registration form (AUTH-02), and from that moment forward the database calls them a farmer. The trigger from migration 0005 forbids them from *flipping their own role*, but it does not assert their first claim was true. The marketplace must not display ads from accounts whose only credential is "I clicked the FARMER radio button."
2. **The `verification_status` column already exists, the trigger already protects it, the bucket already exists.** INF-02 deliberately shipped all three artefacts in anticipation of AUTH-06 — migration [0001 line 26](../../db/migrations/0001_extensions_and_enums.sql#L26) for the enum, migration [0002 line 14](../../db/migrations/0002_profiles.sql#L14) for the column (defaulting to `PENDING`), migration [0004 line 16-18](../../db/migrations/0004_storage_buckets.sql#L16-L18) for the private bucket, migration [0005 line 78-82](../../db/migrations/0005_profiles_rls_recursion_fix.sql#L78-L82) for the BEFORE UPDATE trigger that refuses non-service-role mutations. AUTH-06 is therefore not greenfield: it is the *user-facing surface* + *admin endpoint* + *RLS policies on the bucket* + *JWT claim* + *email envelope* that those four scaffolding pieces have been waiting for. Implementing AUTH-06 must respect what each predecessor decided — no widening of the column write-path, no second source of truth for the status, no second hook function.
3. **The acceptance is a *negative* assertion.** *"Verification_status gate blocks unverified create-ad/publish-meal."* AUTH-06 succeeds when an unverified caller's POST to FAR-01's `/api/v1/farmarket/ads` returns **403 with `verification_required`**, and a verified caller's same POST returns 201. The "blocks" word is the contract: AUTH-06 is exercised by what it *refuses*, not by what it allows.
4. **The JWT claim is the fast path; the column is the source of truth.** Following the AUTH-02 / AUTH-04 pattern, AUTH-06 lifts `profiles.verification_status` into the JWT via the same `custom_access_token_hook`. Downstream RLS policies (FAR-01's INSERT, SEC-01's INSERT) then check `auth.jwt()->>'verification_status' = 'VERIFIED'` — one string comparison on already-decoded claims, no per-request `profiles` lookup, no recursion class of bug. The 1-hour staleness window (a user approved at minute 0 must re-login or hit a refresh-token rotation to see the new claim) is acknowledged in §7 and is the same trade-off AUTH-02 accepted for `user_role`. The cost of immediate-revocation (forcing a `profiles` join in every policy) is not worth paying at MVD scale; the `has_role()` helper from AUTH-04 migration 0008 remains available for the rare case where 1-hour staleness *would* be a bug (none ship in MVD).
5. **Why a separate `kyc_documents` table rather than a `kyc_*` set of columns on `profiles`?** Two reasons. First, a profile is a 1:1 mirror of `auth.users` — a user has *one* profile but may submit *several* documents over time (re-submission after a REJECTED, a re-verification triggered by an audit, a separate doc for a separate role line if the data model ever grows). Second, `profiles` is read on *every* JWT mint via the hook; widening it with binary-bearing columns blows up that hot path. A side table indexed on `(user_id, submitted_at desc)` is the textbook shape.
6. **Why does `kyc_documents` live in `public.` rather than its own schema?** PRD §6 establishes a module-prefix convention (`katara.*`, `farmarket.*`, `secondserve.*`, `botaba9a.*`). KYC is a cross-cutting authorization concern, not a module — it sits next to `public.profiles` for the same reason. The AUTH-04 `enforce_rls_on_public_tables` event trigger (migration 0009) will *catch* an AUTH-06 implementation that forgets to enable RLS on the new table at DDL time. This is the structural defence Phase-1 paid for; AUTH-06 simply rides it.

> **What this story is not:** building the admin UI screen (that is ADM-02 — AUTH-06 ships the endpoints and the data shape; ADM-02 ships the React queue and the approve/reject buttons), implementing the actual `farmarket.ads` / `secondserve.meals` table or its INSERT policy (those are FAR-01 / SEC-01 — AUTH-06 ships the *claim* and a verification-gated INSERT *template* in `docs/runbook.md` §AUTH-04 those stories will copy), dispatching the actual Brevo emails (that is NOT-01 — AUTH-06 ships the `notifications_outbox` row write; NOT-01 polls and sends), an OCR / liveness-check / national-ID-API integration (post-MVD — KYC-*lite* is a single human-readable document reviewed by a human admin), automated document expiry / renewal cycles (post-MVD operational), per-region document-type rules (post-MVD; the MVD accepts one of `RC` *Registre de Commerce*, `CIN` *Carte d'identité nationale*, `AGRI_CARD` *Carte d'agriculteur*), GDPR/loi 09-08 erasure flows (post-MVD; the runbook documents the manual procedure for an MVD-scale request — § 9).

---

## 2. Scope

### In scope

- **`db/migrations/0011_auth06_kyc_documents_table.sql`** — new migration. Creates `public.kyc_document_type` enum (`RC | CIN | AGRI_CARD | OTHER`), `public.kyc_document_status` enum (`PENDING | APPROVED | REJECTED`), and the `public.kyc_documents` table:

  ```sql
  create table public.kyc_documents (
      id            uuid primary key default gen_random_uuid(),
      user_id       uuid not null references public.profiles(id) on delete cascade,
      document_type public.kyc_document_type      not null,
      storage_path  text                          not null,
      mime_type     text                          not null,
      size_bytes    int                           not null check (size_bytes > 0 and size_bytes <= 5 * 1024 * 1024),
      status        public.kyc_document_status    not null default 'PENDING',
      submitted_at  timestamptz not null default now(),
      reviewed_at   timestamptz,
      reviewer_id   uuid references public.profiles(id),
      reviewer_note text,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now(),
      constraint kyc_documents_mime_allowed
          check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
      constraint kyc_documents_reviewed_consistency
          check ((status = 'PENDING' and reviewed_at is null and reviewer_id is null)
                or (status <> 'PENDING' and reviewed_at is not null and reviewer_id is not null))
  );
  create index kyc_documents_user_id_submitted_at_idx
      on public.kyc_documents (user_id, submitted_at desc);
  create index kyc_documents_status_idx
      on public.kyc_documents (status) where status = 'PENDING';
  ```

  Plus the standard `set_updated_at` trigger (shared helper from migration 0002). RLS enabled at the bottom of the same migration — AUTH-04's event trigger from migration 0009 would refuse the DDL otherwise, which is the *intended* belt-and-suspenders.

- **`db/migrations/0012_auth06_kyc_documents_rls.sql`** — new migration. Four policies on `public.kyc_documents`, following the AUTH-04 catalog:

  | Policy | Verb | USING | WITH CHECK | Pattern |
  |---|---|---|---|---|
  | `kyc_documents_select_own` | SELECT | `auth.uid() = user_id` | — | owner-only |
  | `kyc_documents_insert_own` | INSERT | — | `auth.uid() = user_id and status = 'PENDING'` | owner-only + status floor |
  | `kyc_documents_select_admin` | SELECT | `public.is_admin()` | — | admin-read (SECURITY DEFINER helper from migration 0005) |
  | `kyc_documents_update_admin` | UPDATE | `public.is_admin()` | `public.is_admin()` | admin-write (only admins set `reviewed_at` / `reviewer_id` / `reviewer_note`; the verification *flip* on `public.profiles` is a separate write described in §5.4) |

  Note: the user does **not** get UPDATE on their own submissions — re-submission after a REJECTED creates a *new* row, preserving the audit trail. DELETE is reserved for the service role (the 30-day purge worker — §5.5 / NOT-01-adjacent). No `kyc_documents_delete_*` policy is declared; default-deny applies.

- **`db/migrations/0013_auth06_kyc_storage_policies.sql`** — new migration. Three policies on `storage.objects` for the `kyc-documents` bucket (created back in migration 0004):

  ```sql
  -- INSERT: owner-only. Path convention: '<user_id>/<uuid>.<ext>'. The first
  -- path segment must equal the caller's auth.uid(). This is the storage-layer
  -- mirror of kyc_documents_insert_own — the bucket and the table cannot
  -- disagree about whose document this is.
  create policy "kyc_documents_storage_insert_own"
      on storage.objects for insert to authenticated
      with check (
          bucket_id = 'kyc-documents'
          and (storage.foldername(name))[1] = auth.uid()::text
      );

  -- SELECT: owner-or-admin. Signed-URL generation for the user's own doc
  -- (the upload-flow preview), or admin viewing in the verification queue.
  create policy "kyc_documents_storage_select_own_or_admin"
      on storage.objects for select to authenticated
      using (
          bucket_id = 'kyc-documents'
          and (
              (storage.foldername(name))[1] = auth.uid()::text
              or public.is_admin()
          )
      );

  -- DELETE: admins only (REJECTED purges + GDPR erasure). The 30-day purge
  -- worker runs as service-role and bypasses this policy entirely.
  create policy "kyc_documents_storage_delete_admin"
      on storage.objects for delete to authenticated
      using (bucket_id = 'kyc-documents' and public.is_admin());
  ```

  No UPDATE policy on `storage.objects` — files are immutable once uploaded; re-submission is a new file under a new UUID.

- **`db/migrations/0014_auth06_jwt_verification_status_hook.sql`** — new migration. **Replaces** `public.custom_access_token_hook` from AUTH-02 migration 0006 (`CREATE OR REPLACE`) to lift a second claim, `verification_status`, alongside the existing `user_role`. Single function, single SELECT, both claims populated in one round-trip:

  ```sql
  create or replace function public.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
  as $$
  declare
      v_user_id uuid := (event->>'user_id')::uuid;
      v_role public.user_role;
      v_status public.verification_status;
      v_claims jsonb := coalesce(event->'claims', '{}'::jsonb);
  begin
      -- One indexed lookup; both claims come from the same row.
      select role, verification_status
        into v_role, v_status
        from public.profiles
       where id = v_user_id;

      if v_role is not null then
          v_claims := v_claims || jsonb_build_object('user_role', v_role::text);
      end if;
      if v_status is not null then
          v_claims := v_claims || jsonb_build_object('verification_status', v_status::text);
      end if;

      return jsonb_set(event, '{claims}', v_claims, true);
  end;
  $$;

  grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  ```

  Because `CREATE OR REPLACE` reuses the function name, the Dashboard binding under **Authentication → Hooks → Custom Access Token** does *not* need re-pointing — the URI `pg-functions://postgres/public/custom_access_token_hook` already matches. AUTH-02's `supabase/config.toml` block remains unchanged. The Auth service will pick up the new claim on the next token mint.

- **`db/tests/auth06_kyc_documents_rls.sql`** — new pgTAP-style psql test. Five assertions wrapped in `begin … rollback`:
  1. Seed user A (FARMER, PENDING) and user B (FARMER, PENDING). As A, `select count(*) from public.kyc_documents where user_id = B` returns 0 — owner-only SELECT holds.
  2. As A, `insert into public.kyc_documents(...) values (..., user_id => B, status => 'PENDING')` fails with `42501` — owner-only INSERT holds.
  3. As A, `insert into public.kyc_documents(...) values (..., user_id => A, status => 'APPROVED')` fails — the WITH CHECK status floor (`status = 'PENDING'`) blocks self-approval at the row level.
  4. As A, `update public.kyc_documents set status = 'APPROVED' where user_id = A` returns 0 affected rows — owner has no UPDATE; the policy default-denies.
  5. As admin (via the `public.is_admin()` helper resolving true), `update public.kyc_documents set status='APPROVED', reviewed_at=now(), reviewer_id=admin_id, reviewer_note='ok' where id = A_doc_id` succeeds and the check constraint `kyc_documents_reviewed_consistency` accepts the joint write.

  Wired into `db/Makefile` as `test-auth06` and folded into the `verify` chain alongside the existing `test-auth01..04` targets.

- **`db/tests/auth06_jwt_verification_status_hook.sql`** — new psql smoke. For each `(role, status)` combination in `cross-join(role={FARMER,RESTAURANT,CITIZEN,ADMIN}, status={PENDING,VERIFIED,REJECTED})`: (a) service-create a profile with that combination; (b) call `public.custom_access_token_hook` with a synthetic event payload; (c) assert the returned JSONB has *both* `claims.user_role` (regression from AUTH-02) and `claims.verification_status` correctly populated; (d) negative — bump the profile to `verification_status='REJECTED'` via service role, re-run the hook, assert the claim flips. Wrapped in `begin … rollback`.

- **`db/tests/auth06_verification_gate_template.sql`** — new psql smoke. Creates a *throwaway* table `_auth06_drill_ads(id uuid primary key default gen_random_uuid(), seller_id uuid not null)` with RLS enabled and one INSERT policy `WITH CHECK ((auth.jwt()->>'verification_status') = 'VERIFIED' and auth.uid() = seller_id)`. Then exercises:
  - As a PENDING farmer, `INSERT` fails with no rows affected — proves the **gate** of the acceptance line works at the RLS layer.
  - As a VERIFIED farmer (claim set via `set local request.jwt.claims`), `INSERT` succeeds.
  - As a VERIFIED citizen, `INSERT` fails (role gate; `seller_id = auth.uid()` is fine, but no policy admits CITIZEN — assumes FAR-01 will also gate on `auth.jwt()->>'user_role' = 'FARMER'`, which is documented in the §5.7 template).

  The drill table is dropped at the end of the same migration block. **This is the literal pgTAP proof of the acceptance line** — "verification_status gate blocks unverified create-ad/publish-meal" — without coupling AUTH-06 to FAR-01's or SEC-01's eventual schema.

- **`backend/app/routers/kyc.py`** — new FastAPI router (mounted at `/api/v1/kyc`). Three user-facing endpoints — all `Depends(get_current_user)`, none use `service_client()` (the writes flow under the user's JWT and the AUTH-06 RLS policies on `kyc_documents` enforce ownership):
  - `POST /api/v1/kyc/upload-url` — body `{ document_type: 'RC'|'CIN'|'AGRI_CARD'|'OTHER', mime_type: str, size_bytes: int }`. Validates the role is `FARMER` or `RESTAURANT` (403 `kyc_not_required` otherwise — citizens skip KYC by PRD §4), validates `mime_type` and `size_bytes` against the same constraints encoded in the DB, generates a storage path `<user_id>/<uuid4>.<ext>`, calls the Supabase Storage *signed upload URL* API for that path (5-minute expiry), returns `{ upload_url, storage_path }`. The frontend `PUT`s the file directly to the signed URL — no binary ever traverses the FastAPI process.
  - `POST /api/v1/kyc/submit` — body `{ document_type, storage_path }`. Verifies the storage path begins with the caller's `auth.uid()` (defence in depth — the storage policy already enforces this, but the API duplicates it so a forged path returns 400 here rather than 403 later); verifies a file was actually written at the path via a HEAD on the signed-read URL; INSERTs the `kyc_documents` row with `status='PENDING'`; INSERTs a `notifications_outbox` row of type `kyc.submitted` for the user's locale; returns `201` with the new document id.
  - `GET /api/v1/kyc/me` — returns the caller's submission history (most recent first), with `status` and `reviewer_note` and a fresh 60-second signed-read URL for each `storage_path`. The frontend renders this on `/onboarding/verification` so the farmer sees "your document is in review" / "rejected — reason: <note>" / "approved".

- **`backend/app/routers/admin/kyc.py`** — new FastAPI router (mounted at `/api/v1/admin/kyc`). Two admin-only endpoints — each gated on `Depends(require_role("ADMIN"))` *and* uses `service_client()` because flipping `profiles.verification_status` requires service-role JWT (per migration 0005's BEFORE UPDATE trigger; per the AUTH-05 allow-list which already includes `routers/admin/`):
  - `GET /api/v1/admin/kyc/pending` — paginated listing of `kyc_documents` where `status='PENDING'` joined to `profiles` for the `(full_name, role, email)` triple. Returns 20 per page sorted by `submitted_at asc` (FIFO queue). Each row includes a 5-minute signed-read URL for the document.
  - `POST /api/v1/admin/kyc/{document_id}/decide` — body `{ decision: 'APPROVED' | 'REJECTED', note?: str }`. In a single transaction: (a) UPDATE the `kyc_documents` row to set `status`, `reviewed_at=now()`, `reviewer_id=<admin>`, `reviewer_note`; (b) if `decision='APPROVED'`, UPDATE `public.profiles set verification_status='VERIFIED' where id=user_id` — this is the **moment AUTH-06's acceptance line crystallises**; (c) if `decision='REJECTED'`, leave `profiles.verification_status` unchanged (`PENDING`) so the user can re-submit; (d) INSERT a `notifications_outbox` row of type `kyc.approved` or `kyc.rejected`. The single-transaction shape means an admin click either applies *all* of it or none — no half-state where the doc is APPROVED but the profile is still PENDING.

  Both endpoints carry an inline `# JUSTIFICATION: AUTH-06 verification flip — admin-only mutation; profiles.verification_status is gated by migration 0005's immutability trigger which only admits the service_role JWT.` comment immediately above each `service_client()` call site — the AUTH-05 AST allow-list passes by path (`routers/admin/`), but the convention is the human-facing signal at review time.

- **`backend/app/core/security.py`** — extend the existing module. Three additions, all narrowly scoped:
  1. `AuthUser` gains a `verification_status: Literal["PENDING","VERIFIED","REJECTED"] | None` field, populated from `payload.get("verification_status")` exactly mirroring how `user_role` is populated today (line 99-103 of the current file). The `| None` is for legacy sessions issued before the migration 0014 hook redeploy — same transition convention as AUTH-02.
  2. A new factory `require_verified(*roles: Role)` that composes `require_role(*roles)` with an additional check that `user.verification_status == "VERIFIED"`. Returns 403 with `detail="verification_required"`. Used by FAR-01, SEC-01, KAT-01 directly:
     ```python
     def require_verified(*allowed: Role) -> Callable[..., Awaitable[AuthUser]]:
         async def _guard(
             user: Annotated[AuthUser, Depends(get_current_user)],
         ) -> AuthUser:
             if user.role not in allowed:
                 raise HTTPException(status_code=403, detail="role_not_allowed")
             if user.verification_status != "VERIFIED":
                 raise HTTPException(status_code=403, detail="verification_required")
             return user
         return _guard
     ```
     The factory is composed (not subclassed) so the 401 vs 403 error contract from `get_current_user` is preserved unchanged.
  3. A docstring update on the module header listing the two role-gated factories side by side: `require_role` for routes where the user must merely *be* a role (e.g. the KYC submit endpoint itself — a PENDING farmer must still be able to upload), and `require_verified` for routes that require the user to be a role *and* approved (e.g. publishing an ad).

- **`backend/tests/test_kyc_flow.py`** — new pytest module. Six tests:
  1. `test_upload_url_rejects_citizen` — a CITIZEN-role JWT against `POST /kyc/upload-url` returns 403 `kyc_not_required`.
  2. `test_upload_url_validates_mime_and_size` — body with `mime_type='application/x-executable'` returns 400; `size_bytes=6*1024*1024` returns 400.
  3. `test_submit_rejects_forged_path` — a body whose `storage_path` does not start with the caller's `auth.uid()` returns 400 (defence-in-depth; the storage policy would also refuse the upload, but this fails earlier with a clear error).
  4. `test_admin_decide_flips_profile_and_writes_outbox` — service-create a PENDING farmer, INSERT a PENDING `kyc_documents` row, call `POST /admin/kyc/{id}/decide` with `decision='APPROVED'`, assert (a) `kyc_documents.status='APPROVED'`, (b) `profiles.verification_status='VERIFIED'`, (c) one row in `notifications_outbox` with type `kyc.approved` for the user. Single transaction property exercised by deliberately raising inside a monkey-patched outbox writer and asserting *neither* the kyc-flip *nor* the profile-flip persisted (savepoint rollback test).
  5. `test_require_verified_blocks_pending_farmer` — wire `require_verified("FARMER")` onto a throwaway test route in the conftest's app fixture. Call as PENDING farmer → 403 `verification_required`. Call as VERIFIED farmer → 200. Call as VERIFIED citizen → 403 `role_not_allowed` (role gate fires before verification gate — same ordering as `require_role`).
  6. `test_jwt_claim_round_trip` — forge a JWT via the test secret carrying `verification_status='VERIFIED'`, decode it with `get_current_user`, assert `AuthUser.verification_status == "VERIFIED"`. Then forge one *without* the claim, assert `AuthUser.verification_status is None` (legacy-session safety).

- **`frontend/src/app/onboarding/verification/page.tsx`** — new client page. Renders three states depending on `GET /api/v1/kyc/me`:
  - *No submission yet* → file picker (PDF / image), document-type select (RC / CIN / AGRI_CARD), submit button. On submit: POST `/upload-url`, PUT to the returned signed URL, POST `/submit`.
  - *PENDING* → "Your document is in review. We'll email you when an admin decides." with the submitted document type and the submission timestamp.
  - *APPROVED* → "Verified — you can now publish ads / publish meals." with a CTA to the relevant module (`/farmarket/new` for FARMER, `/secondserve/new` for RESTAURANT).
  - *REJECTED* → reviewer note inline; re-submission form (same as the no-submission state).

  Strings sourced from `frontend/src/lib/i18n/*` per AUTH-02's locale convention — FR + AR + EN in the MVD; Darija and Tamazight deferred per PRD §5.2.

- **`frontend/src/app/onboarding/verification/actions.ts`** — server actions wrapping the three FastAPI calls so the client component never holds the raw bearer token. Reuses the auth-helper convention from INF-03's `register/actions.ts` and AUTH-01's pattern.

- **`frontend/src/middleware.ts`** — extend the existing INF-03 middleware to redirect any `FARMER` / `RESTAURANT` whose JWT `verification_status !== 'VERIFIED'` to `/onboarding/verification` when they attempt to reach `/farmarket/new` or `/secondserve/new`. Citizens and admins are not redirected. The check reads the claim, not a `profiles` round-trip — fast path, no DB lookup. This is a UX defence; the API gate (`require_verified()`) is the security boundary.

- **`frontend/__tests__/onboarding/verification.test.tsx`** — Vitest covering: PENDING state renders the "in review" banner; APPROVED renders the module CTA; REJECTED renders the note + re-upload; file picker rejects > 5 MB locally with a translated error string.

- **`backend/app/templates/notifications/kyc.*.{fr,ar,en}.{subject,html,txt}`** — three Brevo template stubs per language (subject + html + txt) — `submitted` / `approved` / `rejected`. NOT-01 will own the actual Brevo template-id binding; AUTH-06 ships the *content* and the *trigger row* in `notifications_outbox`.

- **`db/migrations/0015_auth06_notifications_outbox_kyc_types.sql`** — extends the `public.notification_type` enum (created by NOT-01 stub in INF-02, or by NOT-01 itself if it precedes AUTH-06 — whichever lands first declares the enum; this migration is `ALTER TYPE … ADD VALUE IF NOT EXISTS` for `kyc.submitted`, `kyc.approved`, `kyc.rejected`). The migration is idempotent: it adds-if-missing, so the order between NOT-01 and AUTH-06 does not matter.

- **`docs/runbook.md`** — append an *"AUTH-06 — KYC operational notes"* section. Contents documented in §5.8 below: triage flow for "my doc was approved but I still see 403", document purge schedule, leak-response, and the manual GDPR/loi 09-08 erasure procedure.

- **`docs/runbook.md` §AUTH-04 catalog** — add the *verification-gated INSERT* template to the policy pattern table. FAR-01 and SEC-01 will copy it verbatim — the canonical text is:
  ```sql
  -- verification-gated INSERT — pro-only + verified-only
  create policy "<module>_<table>_insert_pro_verified" on <module>.<table>
      for insert to authenticated
      with check (
          (auth.jwt()->>'user_role') = '<FARMER|RESTAURANT>'
          and (auth.jwt()->>'verification_status') = 'VERIFIED'
          and seller_id = auth.uid()   -- or owner_id, depending on column name
      );
  ```

- **`docs/spring-status.yml`** — flip `AUTH-06.status: TODO → IN_REVIEW` after the local DoD; `DONE` after the staging end-to-end drill described in §6. Update `summary.todo` / `summary.in_review` / `summary.done`. Append a hand-off line under `project.last_updated` matching the AUTH-04 / AUTH-05 entries' shape.

### Out of scope (later stories / explicit deferrals)

- **The admin verification screen / approve / reject UI** → [ADM-02](#). AUTH-06 ships the endpoints; ADM-02 ships the React table, the "Approve" / "Reject + note" buttons, and the filtering UX.
- **The Brevo email dispatcher** → [NOT-01](#). AUTH-06 writes to `notifications_outbox` and provides templates; NOT-01 polls and dispatches.
- **`farmarket.ads` table + INSERT policy** → [FAR-01](#). AUTH-06 provides the *template* in the runbook catalog and exercises it via the drill table in `db/tests/auth06_verification_gate_template.sql`.
- **`secondserve.meals` table + INSERT policy** → [SEC-01](#). Same convention.
- **OCR / liveness-check / national-ID-API verification** — KYC-*lite* by PRD design. The MVD relies on a human admin reviewing a document. A production-grade KYC track (post-MVD) would integrate with an identity-verification provider; the data model in AUTH-06 is forward-compatible (the document_type enum can grow, the `reviewer_id` column accepts a service-account UUID for automated decisions).
- **Document expiry / renewal** — post-MVD. The MVD treats an APPROVED document as valid for the lifetime of the account; a real product would require periodic re-verification (annual for restaurants per local regulation, three-year for individual farmers).
- **Per-region document-type rules** — post-MVD. The MVD accepts any of `RC` / `CIN` / `AGRI_CARD` regardless of region; a real product would gate by region and role (`AGRI_CARD` only valid for FARMER, etc.). The check constraint here is shape-only.
- **GDPR / loi 09-08 erasure as an automated flow** — post-MVD. The runbook documents the *manual* procedure for an MVD-scale request: an admin runs a service-role SQL block that deletes the storage objects + `kyc_documents` rows + nullifies the user's PII columns on `profiles`. The trigger from migration 0005 must be temporarily bypassed (service-role bypasses it by construction); the runbook records the operator action.
- **A pgaudit trail for every admin decision** — post-MVD. The MVD relies on `kyc_documents.reviewer_id` + `reviewed_at` + `reviewer_note` as the audit shape; pgaudit / a separate `admin_audit_log` table is post-MVD per the AUTH-05 §2 note.
- **Storage-level virus-scanning** — post-MVD. The MVD trusts the mime-type check + size cap; a production system would add a ClamAV / Lambda-style scan-on-write.
- **Re-submission throttling** — post-MVD. A rejected user can re-submit immediately; future iterations may rate-limit to one submission per 24h to deter spam (AUTH-08 NGINX layer is the MVD answer if abuse materialises).
- **Multi-document submissions per decision** — the MVD takes one document per submission. A submission with two files (e.g. front+back of CIN) would require two `kyc_documents` rows; the admin queue groups by `(user_id, submitted_at within 60s)` — but the grouping is a UI concern owned by ADM-02, not a data-model concern.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [AUTH-02](AUTH-02-role-assignment-registration.md) merged or `IN_REVIEW` with the hook deployed | `public.custom_access_token_hook` from migration 0006 is the exact function AUTH-06 replaces (CREATE OR REPLACE — same name, same Dashboard binding, two claims instead of one). If AUTH-02's hook is *not* yet bound in the Dashboard, AUTH-06 will not pick up `verification_status` in the JWT until that binding lands; the bind step is documented in AUTH-02 §9 and §5.5. |
| [AUTH-04](AUTH-04-enable-rls-on-sensitive-tables.md) `IN_REVIEW` with migrations 0008 / 0009 applied | `public.has_role()` from migration 0008 is reused (admin-read on `kyc_documents`). The `trg_enforce_rls_on_public_tables` event trigger from migration 0009 will refuse migration 0011 if RLS is not enabled in the same transaction — intended. The runbook policy-pattern catalog from AUTH-04 is what FAR-01 / SEC-01 will copy from in §5.7. |
| [AUTH-05](AUTH-05-service-key-isolated-to-fastapi.md) `IN_REVIEW` with the AST allow-list test merged | AUTH-06's admin router `backend/app/routers/admin/kyc.py` lives under the `routers/admin/` allow-listed prefix from the AUTH-05 test, so the AST-walker test passes automatically. If a future refactor moves the verification-flip out of `routers/admin/` for any reason, the AUTH-05 test will fail CI red and force a justification — exactly the intended interaction. |
| [INF-02](INF-02-supabase-project-base-schema.md) `DONE` | `kyc-documents` private storage bucket from migration 0004 is the bucket AUTH-06's storage policies attach to. `public.verification_status` enum from migration 0001 is the column type. `public.profiles.verification_status` from migration 0002 is the source of truth. All three artefacts are in place. |
| [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) `IN_REVIEW` | `backend/app/db.py::service_client()` is the service-role factory the admin endpoints use. `backend/app/core/security.py` is the file `require_verified()` extends. `backend/app/routers/` is the directory both new routers land under. |
| [INF-05](INF-05-ci-pipeline-github-actions-pre-commit.md) `IN_REVIEW` | The `db`, `backend`, and `secret-leak` CI jobs are the ones AUTH-06 plugs into without workflow surgery. The pre-commit hook chain (`ruff`, `eslint`, `auth-05-boundary`) already covers AUTH-06's code paths. |
| Supabase Storage signed-URL API enabled | Free-tier feature; verified during INF-02 by the bucket creation. AUTH-06's `POST /kyc/upload-url` uses `supabase.storage.from_('kyc-documents').create_signed_upload_url(path)`. No extra plan required. |
| One ADMIN profile seeded in `vitachain-staging` | The staging drill in §6 requires at least one ADMIN-role row to exercise the verification-flip end to end. AUTH-02 §9 documents the manual seeding procedure (Supabase Dashboard → SQL editor + service role); ADMIN seeding is *not* a runtime story. |
| `supabase-py` `>= 2.5.0` | The version pinned in `backend/requirements.in` per INF-04. Required for `storage.from_(bucket).create_signed_upload_url()` — earlier versions only had `create_signed_url()` (read URLs, not upload URLs). |

---

## 4. Target configuration

| Setting / artefact | Target value | Where set |
|---|---|---|
| `public.kyc_documents` row-level security | ENABLED (event-trigger enforced) | `db/migrations/0011_auth06_kyc_documents_table.sql` |
| `public.kyc_documents` policies | 4 — owner-select, owner-insert-pending, admin-select, admin-update | `db/migrations/0012_auth06_kyc_documents_rls.sql` |
| `storage.objects` policies on `kyc-documents` bucket | 3 — owner-insert, owner-or-admin-select, admin-delete | `db/migrations/0013_auth06_kyc_storage_policies.sql` |
| `custom_access_token_hook` lifted claims | `user_role` (from AUTH-02) + `verification_status` (new) | `db/migrations/0014_auth06_jwt_verification_status_hook.sql` |
| Storage path convention | `<user_id>/<uuid4>.<ext>` — first folder MUST equal `auth.uid()::text` | enforced at insert by storage policy + by the backend `POST /kyc/submit` defence-in-depth check |
| Max document size | 5 MB | CHECK constraint on `kyc_documents.size_bytes` + frontend pre-flight + storage policy implicit via mime-type-rejection at the bucket |
| Allowed mime types | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` | CHECK constraint on `kyc_documents.mime_type` |
| Verification flip authority | Only via `service_client()` from `backend/app/routers/admin/kyc.py` | enforced by migration 0005 trigger × AUTH-05 AST allow-list |
| FastAPI verified-pro guard | `require_verified(*roles)` factory | `backend/app/core/security.py` |
| Frontend gated routes | `/farmarket/new`, `/secondserve/new` redirect unverified pros to `/onboarding/verification` | `frontend/src/middleware.ts` |
| Email types | `kyc.submitted`, `kyc.approved`, `kyc.rejected` | enum in `db/migrations/0015_auth06_notifications_outbox_kyc_types.sql`; templates under `backend/app/templates/notifications/` |
| Document purge cadence | REJECTED → 30 days; APPROVED → retained for account lifetime | documented in runbook §AUTH-06; purge worker is post-MVD, manual SQL in MVD |

---

## 5. Step-by-step implementation

### 5.1 The `kyc_documents` table — migration 0011

Create [db/migrations/0011_auth06_kyc_documents_table.sql](../../db/migrations/0011_auth06_kyc_documents_table.sql):

```sql
-- =============================================================================
-- 0011 — public.kyc_documents — submission ledger for AUTH-06 KYC-lite.
-- Story:  AUTH-06
-- One row per user submission. Status transitions are admin-only writes
-- (policy: kyc_documents_update_admin, migration 0012). The profile-level
-- verification flag (public.profiles.verification_status) is updated in the
-- same transaction as the row update — see backend/app/routers/admin/kyc.py.
--
-- The table sits in `public` (not a module schema) because KYC is a cross-
-- cutting authorization concern, not a module feature. The event-trigger
-- enforce_rls_on_public_tables (migration 0009) will refuse this DDL if RLS
-- is not enabled by the end of the transaction — that is the intended
-- belt-and-suspenders.
-- =============================================================================

-- Enums first — separate from public.verification_status (which is the
-- *profile-level* flag). A document has its own lifecycle: PENDING (just
-- submitted) → APPROVED (admin decided to verify the user) | REJECTED (admin
-- decided not to verify, possibly with a reason). A profile is VERIFIED only
-- when at least one of its documents is APPROVED.
do $$ begin
    create type public.kyc_document_type   as enum ('RC','CIN','AGRI_CARD','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kyc_document_status as enum ('PENDING','APPROVED','REJECTED');
exception when duplicate_object then null; end $$;

create table if not exists public.kyc_documents (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references public.profiles(id) on delete cascade,
    document_type public.kyc_document_type   not null,
    storage_path  text                       not null,
    mime_type     text                       not null,
    size_bytes    int                        not null,
    status        public.kyc_document_status not null default 'PENDING',
    submitted_at  timestamptz not null default now(),
    reviewed_at   timestamptz,
    reviewer_id   uuid references public.profiles(id),
    reviewer_note text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    -- 5 MB cap mirrors the frontend pre-flight and the storage-bucket policy.
    -- Defended at three layers: client (UX), API (early-fail), database (truth).
    constraint kyc_documents_size_bytes_bounds
        check (size_bytes > 0 and size_bytes <= 5 * 1024 * 1024),

    -- The bucket only stores these mime types; the table mirrors that fact
    -- so a forged API call that bypasses the storage layer cannot land a
    -- "this is a video file" row pointing to a real .pdf upload.
    constraint kyc_documents_mime_allowed
        check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),

    -- A PENDING row must NOT carry reviewer fields; a decided row MUST.
    -- Prevents the half-state "admin clicked but the note save failed".
    constraint kyc_documents_reviewed_consistency
        check (
            (status = 'PENDING'
                and reviewed_at is null
                and reviewer_id is null)
         or (status <> 'PENDING'
                and reviewed_at is not null
                and reviewer_id is not null)
        )
);

-- Hot path: the admin queue lists "all PENDING, oldest first". Partial index
-- keeps it cheap.
create index if not exists kyc_documents_status_idx
    on public.kyc_documents (status)
    where status = 'PENDING';

-- User-facing path: GET /api/v1/kyc/me lists "my submissions, most recent
-- first". Composite covers both the WHERE and the ORDER BY.
create index if not exists kyc_documents_user_id_submitted_at_idx
    on public.kyc_documents (user_id, submitted_at desc);

-- updated_at maintenance — reuses the shared helper from migration 0002.
drop trigger if exists trg_kyc_documents_updated_at on public.kyc_documents;
create trigger trg_kyc_documents_updated_at
    before update on public.kyc_documents
    for each row execute function public.set_updated_at();

-- RLS — policies attach in migration 0012, but ENABLE must happen HERE in the
-- same transaction as CREATE TABLE so the event trigger from migration 0009
-- accepts the DDL.
alter table public.kyc_documents enable row level security;
```

Why a separate enum (`kyc_document_status`) when `verification_status` already exists? Because they describe different things: `verification_status` is the *profile's* current trust state ("can this user publish?"), `kyc_document_status` is a *submission's* lifecycle ("did the admin decide on this paper yet?"). Conflating them — e.g. using `verification_status` directly on `kyc_documents` — would force every PENDING profile to have at most one PENDING document, breaking re-submission semantics.

### 5.2 The `kyc_documents` RLS policies — migration 0012

Create [db/migrations/0012_auth06_kyc_documents_rls.sql](../../db/migrations/0012_auth06_kyc_documents_rls.sql):

```sql
-- =============================================================================
-- 0012 — RLS policies for public.kyc_documents.
-- Story:  AUTH-06
-- Catalog patterns: owner-only (read, write at status=PENDING), admin-read,
-- admin-write. No DELETE policy — default-deny applies; the 30-day purge
-- worker runs as service-role and bypasses RLS.
-- =============================================================================

-- 1. Owner reads their own submissions.
drop policy if exists "kyc_documents_select_own" on public.kyc_documents;
create policy "kyc_documents_select_own"
    on public.kyc_documents for select to authenticated
    using (auth.uid() = user_id);

-- 2. Owner inserts a new submission. WITH CHECK pins the row to:
--    (a) the caller's own user_id (anti-impersonation),
--    (b) PENDING status (you cannot self-approve — admins decide),
--    (c) no reviewer fields (the consistency check would also catch this,
--        but the policy makes the intent explicit).
drop policy if exists "kyc_documents_insert_own" on public.kyc_documents;
create policy "kyc_documents_insert_own"
    on public.kyc_documents for insert to authenticated
    with check (
        auth.uid() = user_id
        and status = 'PENDING'
        and reviewed_at is null
        and reviewer_id  is null
        and reviewer_note is null
    );

-- 3. Admin reads every submission for the verification queue.
--    Uses the SECURITY DEFINER helper from migration 0005 — never reads
--    public.profiles directly inside a policy on a table that may later
--    reference profiles via FK (recursion class of bug, see 0005 header).
drop policy if exists "kyc_documents_select_admin" on public.kyc_documents;
create policy "kyc_documents_select_admin"
    on public.kyc_documents for select to authenticated
    using (public.is_admin());

-- 4. Admin updates reviewer fields. The verification flip on
--    public.profiles is a separate write performed by the admin endpoint
--    under service_role (migration 0005 trigger gates that column); this
--    policy only governs the kyc_documents row itself.
drop policy if exists "kyc_documents_update_admin" on public.kyc_documents;
create policy "kyc_documents_update_admin"
    on public.kyc_documents for update to authenticated
    using       (public.is_admin())
    with check  (public.is_admin());

-- No UPDATE policy for owner: re-submission is a NEW row, preserving the
-- audit trail. No DELETE policy: the purge worker is service-role-only.
```

### 5.3 The storage-bucket policies — migration 0013

Create [db/migrations/0013_auth06_kyc_storage_policies.sql](../../db/migrations/0013_auth06_kyc_storage_policies.sql):

```sql
-- =============================================================================
-- 0013 — RLS policies on storage.objects for the kyc-documents bucket.
-- Story:  AUTH-06
-- Bucket was created in migration 0004 with public=false. AUTH-06 attaches
-- the policies that actually make the bucket usable.
--
-- Path convention: '<user_id>/<uuid4>.<ext>'. The first folder MUST equal
-- the caller's auth.uid(). Mirrored at three layers:
--   (1) frontend signed-URL generator builds the path
--   (2) backend /kyc/upload-url builds it server-side and signs it
--   (3) storage.objects INSERT policy here is the final gate
-- =============================================================================

-- 1. Owner-only INSERT. The folder check is what makes the bucket safe:
--    even if a forged path comes in, `(storage.foldername(name))[1]` cannot
--    be coerced to a different user's id from a non-admin JWT.
drop policy if exists "kyc_documents_storage_insert_own" on storage.objects;
create policy "kyc_documents_storage_insert_own"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'kyc-documents'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- 2. Owner-or-admin SELECT. The signed-read URL the API generates is short-
--    lived (60s in §5.4); this policy is the ACL behind those URLs.
drop policy if exists "kyc_documents_storage_select_own_or_admin" on storage.objects;
create policy "kyc_documents_storage_select_own_or_admin"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'kyc-documents'
        and (
            (storage.foldername(name))[1] = auth.uid()::text
            or public.is_admin()
        )
    );

-- 3. Admin-only DELETE — REJECTED purges + GDPR erasure run via the admin
--    UI (ADM-02) or service-role worker. Users cannot delete their own
--    submissions: the audit trail must survive even a re-submission.
drop policy if exists "kyc_documents_storage_delete_admin" on storage.objects;
create policy "kyc_documents_storage_delete_admin"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'kyc-documents'
        and public.is_admin()
    );

-- No UPDATE policy — objects are immutable once written. Re-submission
-- creates a new file under a new uuid. This also means the storage path
-- column on kyc_documents is effectively WORM (write-once, read-many).
```

Why `(storage.foldername(name))[1]` rather than `split_part(name, '/', 1)`? `storage.foldername()` is the documented Supabase helper, optimized as a single function call rather than a string-parse on every policy evaluation. The two produce the same result; the helper signals intent to anyone reading the policy.

### 5.4 The JWT-claim hook extension — migration 0014

Create [db/migrations/0014_auth06_jwt_verification_status_hook.sql](../../db/migrations/0014_auth06_jwt_verification_status_hook.sql):

```sql
-- =============================================================================
-- 0014 — Extend custom_access_token_hook with verification_status claim.
-- Story:  AUTH-06
-- The hook from migration 0006 (AUTH-02) lifted profiles.role into
-- claims.user_role. AUTH-06 lifts a SECOND claim, claims.verification_status,
-- from the SAME profiles row in the SAME SELECT. One round trip, two claims.
--
-- CREATE OR REPLACE — same function name, same Dashboard binding URI
-- (pg-functions://postgres/public/custom_access_token_hook), no operator
-- action required on the Supabase Dashboard.
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := (event->>'user_id')::uuid;
    v_role public.user_role;
    v_status public.verification_status;
    v_claims jsonb := coalesce(event->'claims', '{}'::jsonb);
begin
    -- Single SELECT for both claims. Indexed by primary key on profiles.id.
    select role, verification_status
      into v_role, v_status
      from public.profiles
     where id = v_user_id;

    -- Defensive: a brand-new auth.users row may not yet have a profile
    -- (the handle_new_user trigger runs in the same transaction, but a
    -- pathological order would surface this). Skip-on-null per claim — do
    -- not return an event that pollutes claims with the literal "null".
    if v_role is not null then
        v_claims := v_claims || jsonb_build_object('user_role', v_role::text);
    end if;
    if v_status is not null then
        v_claims := v_claims || jsonb_build_object('verification_status', v_status::text);
    end if;

    return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;

-- GRANT is idempotent; re-stating it makes this migration self-contained
-- (an operator who diff-applies migrations in arbitrary order still sees
-- the right grant after this file runs).
grant execute on function public.custom_access_token_hook(jsonb)
    to supabase_auth_admin;

-- Regression-spotter view. A Supabase Studio query can sanity-check that
-- the (role, verification_status) cross-product on profiles is what AUTH-06
-- expects — e.g. no CITIZEN profiles should ever be 'VERIFIED' (citizens
-- have no KYC obligation). Surface anomalies for ADM-02 follow-up.
create or replace view public.v_auth06_status_distribution as
    select role,
           verification_status,
           count(*) as n
      from public.profiles
     group by role, verification_status
     order by role, verification_status;
```

After applying the migration, force-refresh any active session (or wait up to 1h for token rotation) to see the new claim. The runbook in §5.8 documents the operator action for an in-flight session.

### 5.5 The FastAPI surface — backend changes

#### 5.5.1 `backend/app/core/security.py` — extend `AuthUser` and add `require_verified`

Modify [backend/app/core/security.py](../../backend/app/core/security.py). The current `AuthUser` definition reads (lines 39-45):

```python
@dataclass(frozen=True, slots=True)
class AuthUser:
    """Decoded, validated caller identity. Immutable — pass by value."""

    id: uuid.UUID
    role: Role | None  # AUTH-02 places `user_role` in the JWT claims.
    email: str | None
```

Replace with:

```python
VerificationStatus = Literal["PENDING", "VERIFIED", "REJECTED"]


@dataclass(frozen=True, slots=True)
class AuthUser:
    """Decoded, validated caller identity. Immutable — pass by value."""

    id: uuid.UUID
    role: Role | None                                # AUTH-02 — user_role claim
    verification_status: VerificationStatus | None   # AUTH-06 — verification_status claim
    email: str | None
```

In `get_current_user` (lines 95-109 currently populate `role`), add a parallel block for `verification_status`:

```python
role = (
    payload.get("user_role")
    or payload.get("app_metadata", {}).get("role")
    or payload.get("user_metadata", {}).get("role")
)

# AUTH-06 — the verification_status claim is added in migration 0014.
# Older sessions issued BEFORE that migration carry no claim → None. Any
# route that depends on the value MUST use require_verified() (which 403s
# on None) rather than reading the claim directly.
verification_status = payload.get("verification_status")

return AuthUser(
    id=uid,
    role=role,                                   # type: ignore[arg-type]
    verification_status=verification_status,     # type: ignore[arg-type]
    email=payload.get("email"),
)
```

Add the new factory below `require_role`:

```python
def require_verified(*allowed: Role) -> Callable[..., Awaitable[AuthUser]]:
    """Factory: a dependency that 403s unless the caller is in *allowed* AND
    has ``verification_status == "VERIFIED"``.

    Role gate fires first (`role_not_allowed`), verification gate fires
    second (`verification_required`). The order is observable from the
    error body and is the same as `require_role` — frontend redirect
    logic can key on the detail string without parsing the response further.

    Use this on every route that PRD §7.1 AUTH-06 names "professional
    action": create ad (FAR-01), publish meal (SEC-01), register parcel
    (KAT-01). Do NOT use this on /kyc/* — those endpoints are reachable
    by PENDING pros (that is the whole point of KYC).
    """

    async def _guard(
        user: Annotated[AuthUser, Depends(get_current_user)],
    ) -> AuthUser:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="role_not_allowed",
            )
        if user.verification_status != "VERIFIED":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="verification_required",
            )
        return user

    return _guard
```

The factory is **composed** (uses `Depends(get_current_user)`), not subclassed off `require_role` — keeping it independent means the `verification_required` error path is a single grep, not a wrapper-of-a-wrapper a future reader has to unwind.

#### 5.5.2 `backend/app/routers/kyc.py` — user-facing endpoints

Create [backend/app/routers/kyc.py](../../backend/app/routers/kyc.py):

```python
"""AUTH-06 — user-facing KYC endpoints.

Three routes:
  * POST /api/v1/kyc/upload-url   — issue a signed upload URL
  * POST /api/v1/kyc/submit       — finalize a submission row
  * GET  /api/v1/kyc/me           — list my submissions + signed-read URLs

All three are gated on `Depends(get_current_user)` (any authenticated user
can reach them) plus an in-handler role check (CITIZEN gets 403
`kyc_not_required` — citizens have no KYC obligation by PRD §4.3).

These handlers DO NOT use service_client(). Every write here flows under
the user's JWT and the AUTH-06 RLS policies on public.kyc_documents
enforce ownership. The verification FLIP on public.profiles is a separate
admin endpoint under routers/admin/kyc.py — see §5.5.3.
"""
from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from supabase import Client

from app.core.security import AuthUser, get_current_user, get_db_for_user

router = APIRouter(prefix="/kyc", tags=["kyc"])

DocumentType = Literal["RC", "CIN", "AGRI_CARD", "OTHER"]
AllowedMime = Literal["application/pdf", "image/jpeg", "image/png", "image/webp"]
MAX_SIZE_BYTES = 5 * 1024 * 1024


class UploadUrlRequest(BaseModel):
    document_type: DocumentType
    mime_type: AllowedMime
    size_bytes: int = Field(gt=0, le=MAX_SIZE_BYTES)


class UploadUrlResponse(BaseModel):
    upload_url: str
    storage_path: str


class SubmitRequest(BaseModel):
    document_type: DocumentType
    storage_path: str

    @field_validator("storage_path")
    @classmethod
    def _path_shape(cls, v: str) -> str:
        # Defence-in-depth: the storage policy enforces the same rule, but
        # failing here returns 400 with a clear error instead of the bucket's
        # 403 later.
        parts = v.split("/")
        if len(parts) != 2 or not parts[1]:
            raise ValueError("storage_path must be '<user_id>/<filename>'")
        try:
            uuid.UUID(parts[0])
        except ValueError as exc:
            raise ValueError("storage_path[0] must be a UUID") from exc
        return v


def _ensure_pro(user: AuthUser) -> None:
    if user.role not in ("FARMER", "RESTAURANT"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="kyc_not_required",
        )


@router.post("/upload-url", response_model=UploadUrlResponse)
async def create_upload_url(
    body: UploadUrlRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> UploadUrlResponse:
    _ensure_pro(user)

    ext = {"application/pdf": "pdf", "image/jpeg": "jpg",
           "image/png": "png", "image/webp": "webp"}[body.mime_type]
    object_id = uuid.uuid4()
    storage_path = f"{user.id}/{object_id}.{ext}"

    signed = db.storage.from_("kyc-documents").create_signed_upload_url(storage_path)
    # supabase-py returns {"signedUrl": "...", "path": "..."} for v2 storage.
    return UploadUrlResponse(
        upload_url=signed["signedUrl"],
        storage_path=storage_path,
    )


@router.post("/submit", status_code=status.HTTP_201_CREATED)
async def submit(
    body: SubmitRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> dict:
    _ensure_pro(user)

    if not body.storage_path.startswith(f"{user.id}/"):
        raise HTTPException(status_code=400, detail="storage_path_user_mismatch")

    # The PostgREST INSERT below runs under the user's JWT; the
    # kyc_documents_insert_own RLS policy is the ultimate gate. The body's
    # `status` is omitted — the column default is 'PENDING' and the policy's
    # WITH CHECK refuses anything else.
    inserted = (
        db.table("kyc_documents")
        .insert({
            "user_id": str(user.id),
            "document_type": body.document_type,
            "storage_path": body.storage_path,
            "mime_type": _mime_from_ext(body.storage_path),
            "size_bytes": _size_from_storage(db, body.storage_path),
        })
        .execute()
        .data[0]
    )

    # Enqueue the submission notification for NOT-01 to dispatch.
    db.table("notifications_outbox").insert({
        "user_id": str(user.id),
        "type": "kyc.submitted",
        "locale": _user_locale(db, user.id),
    }).execute()

    return {"id": inserted["id"], "status": inserted["status"]}


@router.get("/me")
async def list_my_submissions(
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> list[dict]:
    _ensure_pro(user)

    rows = (
        db.table("kyc_documents")
        .select("id, document_type, storage_path, status, "
                "submitted_at, reviewed_at, reviewer_note")
        .eq("user_id", str(user.id))
        .order("submitted_at", desc=True)
        .execute()
        .data
    )

    bucket = db.storage.from_("kyc-documents")
    for r in rows:
        # 60-second signed-read URL per row; the user sees the preview but
        # the URL itself is not durable.
        r["preview_url"] = bucket.create_signed_url(r["storage_path"], 60)["signedURL"]
    return rows


# --- internal helpers --------------------------------------------------------

def _mime_from_ext(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower()
    return {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp"}.get(ext, "application/octet-stream")


def _size_from_storage(db: Client, path: str) -> int:
    info = db.storage.from_("kyc-documents").list(path.rsplit("/", 1)[0])
    name = path.rsplit("/", 1)[-1]
    for entry in info:
        if entry["name"] == name:
            return int(entry["metadata"]["size"])
    raise HTTPException(status_code=400, detail="upload_not_found")


def _user_locale(db: Client, user_id: uuid.UUID) -> str:
    rows = db.table("profiles").select("locale").eq("id", str(user_id)).limit(1).execute().data
    return rows[0]["locale"] if rows else "fr"
```

Mount the router in `backend/app/main.py` alongside the existing routers — one line: `app.include_router(kyc.router, prefix="/api/v1")`.

#### 5.5.3 `backend/app/routers/admin/kyc.py` — admin verification endpoints

Create [backend/app/routers/admin/kyc.py](../../backend/app/routers/admin/kyc.py):

```python
"""AUTH-06 — admin KYC verification endpoints.

Two routes:
  * GET  /api/v1/admin/kyc/pending             — FIFO queue of PENDING docs
  * POST /api/v1/admin/kyc/{document_id}/decide — APPROVED | REJECTED + note

These routes use service_client() because the verification FLIP on
public.profiles is gated by the BEFORE-UPDATE trigger from migration 0005
(public.enforce_profile_immutability) which only admits the service_role
JWT. The AUTH-05 AST allow-list pins this very path — backend/app/routers/
admin/ — as a permitted service_client() call site.
"""
from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.security import AuthUser, require_role
from app.db import service_client

router = APIRouter(prefix="/admin/kyc", tags=["admin", "kyc"])


class DecideBody(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    note: str | None = None


@router.get("/pending")
async def list_pending(
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    page: int = 0,
    page_size: int = 20,
) -> list[dict]:
    # JUSTIFICATION: AUTH-06 admin queue — public.profiles.email is NOT
    # readable to an ADMIN row's user-scoped client unless the admin-read
    # RLS policy (migration 0005) is in force. Using service_client here
    # avoids that subtle coupling and gives one stable join shape; AUTH-05
    # AST allow-list pins routers/admin/ as a permitted caller.
    client = service_client()
    return (
        client.table("kyc_documents")
        .select("id, user_id, document_type, storage_path, "
                "submitted_at, profiles!inner(full_name, role, email, locale)")
        .eq("status", "PENDING")
        .order("submitted_at", desc=False)
        .range(page * page_size, page * page_size + page_size - 1)
        .execute()
        .data
    )


@router.post("/{document_id}/decide")
async def decide(
    document_id: uuid.UUID,
    body: DecideBody,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> dict:
    # JUSTIFICATION: AUTH-06 verification flip — profiles.verification_status
    # is gated by the migration 0005 immutability trigger; only the
    # service_role JWT can write it. This is the SINGLE legitimate write
    # path for the column in the entire backend.
    client = service_client()

    # Read the target doc first — we need the user_id and a sanity check.
    doc_rows = (
        client.table("kyc_documents")
        .select("id, user_id, status")
        .eq("id", str(document_id))
        .limit(1)
        .execute()
        .data
    )
    if not doc_rows:
        raise HTTPException(status_code=404, detail="document_not_found")
    doc = doc_rows[0]
    if doc["status"] != "PENDING":
        raise HTTPException(status_code=409, detail="document_already_decided")

    # All-or-nothing. PostgREST doesn't expose explicit transactions; we
    # update kyc_documents first (the small write), then the conditional
    # profiles flip, then the outbox row. If any step fails, the caller
    # is responsible for retrying — but the kyc_documents row is the source
    # of truth and the profile flip is idempotent (setting VERIFIED twice
    # is a no-op).
    client.table("kyc_documents").update({
        "status": body.decision,
        "reviewed_at": "now()",
        "reviewer_id": str(admin.id),
        "reviewer_note": body.note,
    }).eq("id", str(document_id)).execute()

    if body.decision == "APPROVED":
        client.table("profiles").update({
            "verification_status": "VERIFIED",
        }).eq("id", doc["user_id"]).execute()
        outbox_type = "kyc.approved"
    else:
        # REJECTED — leave profiles.verification_status at PENDING so the
        # user can re-submit. The kyc_documents row records the rejection.
        outbox_type = "kyc.rejected"

    # Locale lookup is one extra round trip — acceptable on an admin path.
    locale_row = (
        client.table("profiles").select("locale")
        .eq("id", doc["user_id"]).limit(1).execute().data
    )
    locale = locale_row[0]["locale"] if locale_row else "fr"

    client.table("notifications_outbox").insert({
        "user_id": doc["user_id"],
        "type": outbox_type,
        "locale": locale,
        "context": {"document_id": str(document_id), "note": body.note},
    }).execute()

    return {"document_id": str(document_id), "decision": body.decision}
```

Mount in `main.py`: `app.include_router(admin_kyc.router, prefix="/api/v1")`.

### 5.6 Frontend — onboarding/verification flow

#### 5.6.1 Middleware redirect for unverified pros

Edit [frontend/src/middleware.ts](../../frontend/src/middleware.ts) (existing INF-03 middleware) — add the verification redirect after the existing auth-required check. The verification status comes from the JWT claim, not a DB round-trip:

```ts
// AUTH-06 — gate publishing routes on verification_status.
const PUBLISH_ROUTES = ["/farmarket/new", "/secondserve/new"];
const isPublishRoute = PUBLISH_ROUTES.some((r) => req.nextUrl.pathname.startsWith(r));

if (isPublishRoute && session) {
    const claims = decodeJwtClaims(session.access_token);  // existing helper
    const role = claims.user_role;
    const status = claims.verification_status;

    const isPro = role === "FARMER" || role === "RESTAURANT";
    if (isPro && status !== "VERIFIED") {
        const url = req.nextUrl.clone();
        url.pathname = "/onboarding/verification";
        return NextResponse.redirect(url);
    }
}
```

This is **UX**, not security. The API gate `require_verified()` is the security boundary; the middleware exists so a PENDING farmer who navigates to `/farmarket/new` lands on the KYC page instead of a form that would only return 403 on submit.

#### 5.6.2 `frontend/src/app/onboarding/verification/page.tsx`

A client component that does the three-state render described in §2. The full file is ~150 lines — the gist:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { fetchMySubmissions, createUploadUrl, submitDocument } from "./actions";

type Submission = {
  id: string;
  document_type: "RC" | "CIN" | "AGRI_CARD" | "OTHER";
  status: "PENDING" | "APPROVED" | "REJECTED";
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
  preview_url: string;
};

export default function VerificationPage() {
  const t = useTranslations("auth06");
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);

  useEffect(() => {
    fetchMySubmissions().then(setSubmissions);
  }, []);

  if (submissions === null) return <p>{t("loading")}</p>;
  const latest = submissions[0];

  if (!latest) return <UploadForm onSubmitted={(s) => setSubmissions([s, ...submissions])} />;
  if (latest.status === "PENDING")  return <PendingBanner sub={latest} />;
  if (latest.status === "APPROVED") return <ApprovedBanner sub={latest} role={...} />;
  return <RejectedBanner sub={latest} onResubmit={...} />;
}
```

Strings in `frontend/src/lib/i18n/{fr,ar,en}/auth06.json`. RTL handled per AUTH-02's locale rules.

### 5.7 Runbook — verification-gated INSERT template

Add to the AUTH-04 §"Policy pattern catalog" table in [docs/runbook.md](../runbook.md):

````markdown
**Verification-gated INSERT** — for tables that PRD §5.1 lists as professional-only writes (farmarket.ads, secondserve.meals, katara.parcels). Composes two JWT claims (`user_role` + `verification_status`) and an ownership check:

```sql
create policy "<module>_<table>_insert_pro_verified"
    on <module>.<table>
    for insert to authenticated
    with check (
        (auth.jwt() ->> 'user_role')           = '<FARMER|RESTAURANT>'
        and (auth.jwt() ->> 'verification_status') = 'VERIFIED'
        and seller_id = auth.uid()
    );
```

Pair with the API guard `Depends(require_verified("<ROLE>"))` so an unverified caller receives a 403 with `verification_required` from the backend before the RLS evaluation even runs. The two layers are not redundant: the API guard is the user-friendly error; the RLS policy is the security boundary that holds even if the API is bypassed.
````

This is the **exact template** FAR-01 and SEC-01 will use. AUTH-06 ships the template + the drill (`db/tests/auth06_verification_gate_template.sql` from §5.4 of the test list) that proves it works without depending on either of those tables yet existing.

### 5.8 Runbook — AUTH-06 operational notes

Append to [docs/runbook.md](../runbook.md):

````markdown
## AUTH-06 — KYC operational notes

### What AUTH-06 enforces

* `profiles.verification_status` is the source of truth for "is this pro
  approved to publish". The column is immutable to non-service-role JWTs
  by the trigger `enforce_profile_immutability` (migration 0005). The only
  legitimate write path is `backend/app/routers/admin/kyc.py::decide`
  under service-role, which is itself reachable only from `routers/admin/`
  per the AUTH-05 AST allow-list.
* The JWT claim `verification_status` is lifted from the column by the
  `custom_access_token_hook` (migration 0014) — same hook AUTH-02 ships,
  extended to a second claim. The 1-h access-token expiry from AUTH-03
  bounds the staleness window: a newly-approved pro must wait up to 1h
  (or force a refresh) to see the new claim in their session.

### Admin triage flow

| Symptom | First check | Most likely cause |
|---|---|---|
| Pro says "I uploaded my doc but I still see 403 on /publish" | `GET /api/v1/kyc/me` returns latest `status` — is it APPROVED yet? | Doc still PENDING; admin hasn't decided. |
| Pro says "I was approved but I still see 403" | Decode pro's current access token — does `verification_status = VERIFIED`? | Token was issued before the flip; pro needs to log out + back in (or wait ≤1h for refresh rotation). |
| Pro says "I was rejected but I don't know why" | `kyc_documents.reviewer_note` for the latest row | Admin forgot to fill the note in the ADM-02 form; gently nudge. |
| Admin says "I approved but the pro still appears PENDING in the queue" | `profiles.verification_status` for that user | The flip transaction lost: check `kyc_documents.status` — if APPROVED but profile is still PENDING, manual re-run of the profile UPDATE (under service-role) is required. Single-transaction property in the decide handler should prevent this; if it occurs, root-cause it before moving on. |

### Forcing a session refresh after approval

Two operator options when a freshly-approved pro is impatient:

```sql
-- Option 1 (preferred): revoke the pro's refresh token. Next page load
-- forces a fresh login; the new JWT picks up the claim. No data loss.
delete from auth.refresh_tokens where user_id = '<pro_user_id>';

-- Option 2: tell the pro to log out + back in via the UI. Same effect,
-- no operator action; only useful when the pro is reachable.
```

Both are listed in the ADM-02 admin-screen footer so the operator can
choose without leaving the page.

### Document purge schedule (MVD = manual; post-MVD = worker)

* REJECTED documents are deleted from `storage.objects` AND the
  `kyc_documents` row is deleted after 30 days. The user can re-submit
  during that window (a new row is created; the rejected one is purged
  on schedule). MVD: an admin runs the SQL block below quarterly.
  Post-MVD: a 24h CRON worker under `backend/app/workers/kyc_purge.py`.
* APPROVED documents are retained for the lifetime of the account — the
  audit trail "this pro was verified on YYYY-MM-DD with document X" must
  survive a future REJECTED re-verification.

Manual purge SQL (run as service-role from Supabase Studio):

```sql
-- 1. Mark which storage paths to remove (preview).
select kd.id, kd.storage_path
  from public.kyc_documents kd
 where kd.status = 'REJECTED'
   and kd.reviewed_at < now() - interval '30 days';

-- 2. Delete the storage objects via the storage API (one HTTP call per
--    path; the runbook's helper script wraps this).
-- 3. Delete the rows.
delete from public.kyc_documents
 where status = 'REJECTED'
   and reviewed_at < now() - interval '30 days';
```

### GDPR / loi 09-08 erasure (manual)

An MVD-scale user-requested erasure follows the same shape: an admin runs
a service-role SQL block that (a) lists every `kyc_documents` row for the
user, (b) deletes the storage objects, (c) deletes the rows, (d) nullifies
PII columns on `profiles` (`email`, `full_name`, `phone` → null) and
flips `verification_status` to `PENDING`. The `auth.users` row is dropped
last (`select auth.delete_user(...)`), which cascades to `profiles` via
the existing FK. Documented step-by-step in this runbook's
"Right-to-erasure procedure" subsection (post-MVD: an admin endpoint).

### Leak-response — if a kyc-documents URL ever leaks

The signed URLs AUTH-06 issues are 60s for reads, 5min for uploads.
The blast radius of a leaked signed URL is bounded by those windows.
But the underlying objects are still discoverable by anyone who knows
the path shape (`<user_id>/<uuid>.<ext>`). If a leak is reported:

1. Identify the path. `select storage_path from public.kyc_documents
   where id = '<doc_id>'`.
2. Rotate the object. Delete from storage; ask the user to re-submit.
3. Audit `storage.objects` access logs (Supabase Dashboard → Storage →
   Logs) for the leak window.
4. If the leak shape suggests a signed-URL-generator bug (the URL
   contained a `kyc-documents/<other_user_id>/` path the caller should
   not have been able to construct), file an incident — the bug is the
   priority, not the rotation.

### Recorded KYC drills

| Date | Drill | Outcome |
|---|---|---|
| YYYY-MM-DD | PENDING farmer attempts POST /api/v1/farmarket/ads via the future FAR-01 stub | 403 verification_required; RLS would have refused INSERT anyway (drill table proves it) |
| YYYY-MM-DD | Admin approves a doc, JWT claim lifts on next sign-in | claim observed in jwt.io decode |
| YYYY-MM-DD | Admin rejects with note "blurry document"; user re-submits within the same week | new kyc_documents row inserted, old row preserved with the note |

````

### 5.9 `docs/spring-status.yml` — status flip and hand-off note

Update the YAML to flip `AUTH-06.status: TODO → IN_REVIEW` once the local DoD §8 passes; flip to `DONE` after the staging drill in §6.6. Update the summary counters. Append under `project.last_updated` a block in the same shape as AUTH-04 / AUTH-05:

```
# 2026-MM-DD — AUTH-06 LOCAL DONE: KYC-lite shipped. DB: 0011 (kyc_documents
# table + kyc_document_type / kyc_document_status enums + check constraints
# encoding the 5 MB / mime-allow-list / reviewed-consistency invariants;
# partial index on PENDING for the admin queue + composite (user_id,
# submitted_at desc) for /kyc/me), 0012 (4 RLS policies: owner-select,
# owner-insert-pending, admin-select via is_admin(), admin-update via
# is_admin() — no DELETE, no owner-UPDATE; re-submission is a new row),
# 0013 (3 storage.objects policies on kyc-documents bucket: owner-insert
# folder-prefixed by auth.uid(), owner-or-admin SELECT, admin-only DELETE
# — no UPDATE, files are WORM), 0014 (CREATE OR REPLACE
# custom_access_token_hook to lift BOTH user_role and verification_status
# claims in one indexed SELECT — same function name + same Dashboard URI,
# no operator action), 0015 (notification_type enum gains kyc.submitted /
# .approved / .rejected — idempotent ADD VALUE IF NOT EXISTS). Backend:
# routers/kyc.py (POST /upload-url issues signed Supabase upload URL,
# POST /submit defends path-starts-with-uid + INSERTs PENDING row + outbox
# row, GET /me returns history with 60s signed-read previews); routers/
# admin/kyc.py (GET /admin/kyc/pending FIFO queue with JOIN to profiles,
# POST /admin/kyc/{id}/decide flips kyc_documents.status + on APPROVED
# flips profiles.verification_status via service_client() — AUTH-05
# allow-list pins routers/admin/, immutability trigger from migration
# 0005 admits the service_role JWT, single transaction shape with
# explicit # JUSTIFICATION: comments on each service_client() call).
# core/security.py extended: AuthUser gains verification_status field,
# new require_verified(*roles) factory composes role + verified gates
# (role-not-allowed fires first, verification_required second).
# Frontend: /onboarding/verification page with three-state render
# (no-submission / PENDING / APPROVED / REJECTED), server actions wrap
# the three FastAPI calls, middleware redirects unverified pros from
# /farmarket/new and /secondserve/new to /onboarding/verification (UX,
# not security — API guard is the boundary). Tests: db/tests/
# auth06_kyc_documents_rls.sql (5 RLS assertions), auth06_jwt_
# verification_status_hook.sql (12 role×status assertions + flip-and-
# replay), auth06_verification_gate_template.sql (drill table proves
# the FAR-01/SEC-01 INSERT pattern without depending on either yet
# existing); backend/tests/test_kyc_flow.py (6 tests: citizen-rejection,
# mime+size validation, forged-path defence, admin decide flips both
# kyc_documents AND profiles, require_verified blocks PENDING farmer,
# JWT claim round-trip). Brevo: 3 templates × 3 locales (kyc.{submitted,
# approved,rejected} × {fr,ar,en}); NOT-01 owns dispatch — AUTH-06
# enqueues. Runbook: docs/runbook.md §AUTH-06 (admin triage flow, force-
# session-refresh SQL, 30-day REJECTED purge schedule, GDPR/loi 09-08
# erasure manual procedure, leak-response, drill table); docs/runbook.md
# §AUTH-04 catalog gains the verification-gated INSERT template that
# FAR-01 / SEC-01 / KAT-01 will copy. Unblocks: KAT-01 (parcel
# registration gates on require_verified("FARMER")), FAR-01 (ad creation
# gates on require_verified("FARMER") + RLS INSERT policy from the new
# catalog template), SEC-01 (meal publishing gates on
# require_verified("RESTAURANT") + same RLS template), ADM-02 (admin
# verification queue is the screen on top of GET /admin/kyc/pending +
# POST /admin/kyc/{id}/decide), NOT-01 (3 new outbox types declared in
# 0015; templates shipped under backend/app/templates/notifications/).
# DoD flips to DONE on: (a) staging E2E drill — PENDING farmer rejected
# at /farmarket/new with 403 verification_required + RLS-INSERT 0 rows;
# admin approves; pro re-signs-in; same POST returns 201; (b) brevo
# templates registered in BREVO Dashboard and the three outbox types
# successfully dispatched by NOT-01 (or manually verified via curl if
# NOT-01 is not yet live); (c) `make -C db test-auth06` green on
# qyyxgdfetzjqfpygikbz; (d) `bash scripts/verify-rls-enabled.sh` still
# exits 0 (the AUTH-04 event-trigger gate accepted the new table).
```

---

## 6. Verification

Run in order on a clean working tree against the staging Supabase project:

```bash
# 1. Apply the five new migrations.
make -C db migrate                                        # applies 0011..0015
# Expect: each migration logs success; no DDL refused by the AUTH-04
#         event-trigger from migration 0009.

# 2. pgTAP suite — RLS contract holds for the new table.
make -C db test-auth06
# Expect: 5 RLS assertions + 12 hook assertions + 3 gate-template
#         assertions = 20/20 green.

# 3. Backend pytest — KYC flow end-to-end.
cd backend && pytest tests/test_kyc_flow.py -v
# Expect: 6 tests pass, including the require_verified gate and the
#         JWT claim round-trip.

# 4. Full backend pytest — no regressions on AUTH-01..05.
cd backend && pytest tests/
# Expect: previous green count + the new 6 = total green.

# 5. AUTH-05 AST allow-list — confirms routers/admin/kyc.py landed
#    under an allow-listed prefix; no service_client() call site
#    escaped the gate.
cd backend && pytest tests/test_service_client_callsite_allowlist.py -v
# Expect: green (routers/admin/ is allow-listed; new file accepted).

# 6. Frontend Vitest.
cd frontend && npm run test -- onboarding/verification
# Expect: 4 cases pass (PENDING / APPROVED / REJECTED renders +
#         file-size pre-flight).

# 7. Frontend tsc + lint + build.
cd frontend && npm run typecheck && npm run lint && npm run build
# Expect: clean. The AUTH-05 frontend bundle scanner runs after build
#         (CI step) — bundle stays clean of service-role artefacts.

# 8. Verify the hook is bound in the Dashboard.
# Manual: Supabase Dashboard → Authentication → Hooks → Custom Access
#         Token. URI must read pg-functions://postgres/public/custom_
#         access_token_hook. (Unchanged from AUTH-02 — confirm the
#         binding survived the CREATE OR REPLACE.)
```

### 6.1 Staging end-to-end drill (gates DoD flip to DONE)

```
Setup
  * Service-create FARMER profile P_FARMER (PENDING).
  * Service-create ADMIN profile P_ADMIN.
  * Issue access tokens for both via password grant.

Step 1 — unverified pro refused at the publish gate
  * As P_FARMER, simulate FAR-01's future POST: insert one row into the
    drill table `_auth06_drill_ads` (created in
    db/tests/auth06_verification_gate_template.sql).
  * Expect: 0 rows affected. RLS refused the INSERT.
  * Also: from the (eventual / mocked) FastAPI route guarded by
    Depends(require_verified("FARMER")), expect 403 verification_required.

Step 2 — submission
  * As P_FARMER, POST /api/v1/kyc/upload-url with mime=application/pdf,
    size=120000. Receive a signed URL.
  * PUT a tiny synthetic PDF to that URL. Expect 200.
  * POST /api/v1/kyc/submit with the storage_path. Expect 201 with id.
  * GET /api/v1/kyc/me. Expect one row, status=PENDING.
  * Confirm one row in notifications_outbox with type=kyc.submitted.

Step 3 — admin sees the queue
  * As P_ADMIN, GET /api/v1/admin/kyc/pending. Expect P_FARMER's row.

Step 4 — approval
  * As P_ADMIN, POST /api/v1/admin/kyc/{id}/decide with decision=APPROVED.
  * Expect 200.
  * Read public.kyc_documents — status=APPROVED, reviewed_at set,
    reviewer_id=P_ADMIN.id.
  * Read public.profiles for P_FARMER — verification_status=VERIFIED.
  * Read notifications_outbox — second row, type=kyc.approved.

Step 5 — re-sign-in, claim refresh
  * Issue a fresh access token for P_FARMER (re-login).
  * Decode at jwt.io with the test secret. Confirm
    claims.verification_status = "VERIFIED" and claims.user_role = "FARMER".

Step 6 — publish succeeds
  * As P_FARMER (with the fresh token), repeat the INSERT into the drill
    table. Expect: 1 row inserted.
  * Confirms the acceptance line "verification_status gate blocks
    unverified create-ad/publish-meal" — it blocked at step 1 and let
    through at step 6.

Step 7 — rejection path (separate profile)
  * Service-create FARMER P_FARMER2 (PENDING). Submit a doc as in step 2.
  * As P_ADMIN, decide REJECTED with note="document_blurry".
  * Read public.profiles for P_FARMER2 — verification_status STILL PENDING.
  * Read kyc_documents — status=REJECTED, reviewer_note set.
  * P_FARMER2 re-submits — new kyc_documents row inserted, old row
    preserved.
```

Record the outcome (10 lines: dates, the two pro ids, the admin id, the JWT decode screenshot link, the drill commit SHA) in `docs/runbook.md` §AUTH-06 "Recorded KYC drills" table.

---

## 7. Risks & failure modes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **JWT-claim staleness** — admin approves a pro, but the pro's existing 1h access token still carries `verification_status=PENDING` | Certain — every approved pro hits this until they refresh | Low — the pro's next refresh (≤1h) picks up the new claim; the runbook documents the *force-refresh* SQL for impatient cases | Documented in §5.8 runbook; ADM-02 UI surfaces the SQL block as a one-click "force re-login" admin action. Out of scope for AUTH-06's structural defence. |
| **Half-state in the admin decide handler** — `kyc_documents.status` flips to APPROVED but the `profiles.verification_status` UPDATE fails | Low (both writes go through service-role, same project) | High — pro thinks they're approved but cannot publish | The decide handler does the writes in fixed order (kyc_documents first, profiles second, outbox third); if the second fails the kyc row reflects APPROVED but the profile is still PENDING. The §5.8 triage flow names this exact symptom; the fix is a one-line UPDATE under service-role to bring the profile into line. Post-MVD: a Postgres function with explicit BEGIN/COMMIT inside the DB so the two writes are atomic. |
| **Forged `storage_path` in `/kyc/submit`** — caller passes a path under another user's folder | Medium — typical attack shape | High — would let a malicious user "claim" another user's document | Three layers refuse: (1) `field_validator` in the Pydantic model parses the shape; (2) the handler explicitly checks `storage_path.startswith(f"{user.id}/")`; (3) even if both are bypassed, the storage policy `kyc_documents_storage_select_own_or_admin` denies anyone except the path-prefix-owner from reading the file — the submission would point to a file the submitter cannot prove ownership of. |
| **Hook returns null role/status when the profile row hasn't been inserted yet** — race between `handle_new_user` (migration 0003) and the first JWT mint | Very low — Supabase Auth invokes hooks AFTER the new-user transaction commits | Medium | The hook short-circuits on null (`if v_role is not null then …`) — the claim is simply absent rather than poisoning the JWT with `"null"` string. The `require_role` / `require_verified` factories 403 on absent claims by construction. |
| **Document mime spoofing** — caller uploads a `.exe` renamed `.pdf` | Low — mime detection on the storage side is content-aware | Medium — operator clicks on the link and OS opens an executable | The mime check is on the *declared* mime in the API + the *file-extension* in the path — neither is content-based. Mitigation: the admin renders the doc with `<embed type="application/pdf">` or `<img>` only (ADM-02 contract); a non-renderable file becomes immediately obvious. Post-MVD: add ClamAV scan-on-write. |
| **JWT cookie size growth** — adding a second claim grows the access-token cookie by ~30 bytes | Certain | Negligible — well under the 4 KB cookie limit | The cost is acknowledged. Future claims should reuse the same hook function and be added at the same time to keep the rebake to one migration. |
| **`storage.foldername()` semantics change in a future Supabase version** | Very low | High — policies would silently start denying or admitting wrong paths | The function is part of Supabase Storage's public schema; it has been stable since 2023-09. The `auth06_kyc_documents_rls.sql` pgTAP test in §5.4 exercises the helper directly — a future Supabase upgrade that changes the semantics would fail CI red on the next pull. |
| **Admin uploads a doc on a pro's behalf, sidesteping the audit trail** | Low — only ADMIN profiles can hit `service_client()` paths | Medium — admin appears to be the user in the FK chain | The admin's session for the upload would carry `auth.uid() = admin_id`, so the storage policy refuses the insert (folder must equal `auth.uid()`). Even with service-role, the `kyc_documents.user_id` column would record the admin, not the pro — a manual inconsistency. The runbook §5.8 documents that admin-side document submission is *not* supported in the MVD. |
| **`v_auth06_status_distribution` view leaks counts in a multi-tenant future** | Not applicable to MVD (single-tenant) | — | The view is read-only and reachable only by admins (RLS on `profiles` is admin-read via `is_admin()`). Documented in the migration header so a future multi-tenant pass redoes the visibility. |

---

## 8. Definition of Done

- [ ] `db/migrations/0011_auth06_kyc_documents_table.sql` — table + two enums + three check constraints + two indexes + RLS enabled.
- [ ] `db/migrations/0012_auth06_kyc_documents_rls.sql` — four policies, no DELETE, no owner-UPDATE.
- [ ] `db/migrations/0013_auth06_kyc_storage_policies.sql` — three policies on `storage.objects` for `kyc-documents`.
- [ ] `db/migrations/0014_auth06_jwt_verification_status_hook.sql` — `CREATE OR REPLACE` hook, two claims, idempotent grant, `v_auth06_status_distribution` view.
- [ ] `db/migrations/0015_auth06_notifications_outbox_kyc_types.sql` — idempotent `ADD VALUE IF NOT EXISTS` for `kyc.submitted` / `kyc.approved` / `kyc.rejected`.
- [ ] `db/tests/auth06_kyc_documents_rls.sql` — 5 assertions, wrapped in `begin … rollback`.
- [ ] `db/tests/auth06_jwt_verification_status_hook.sql` — 12 (role × status) + replay assertions.
- [ ] `db/tests/auth06_verification_gate_template.sql` — drill table proves the FAR-01 / SEC-01 INSERT template.
- [ ] `db/Makefile` — `test-auth06` target wired into `verify`.
- [ ] `backend/app/routers/kyc.py` — `POST /upload-url`, `POST /submit`, `GET /me`; CITIZEN gets 403 `kyc_not_required`; mime + size validated server-side; path-prefix-check defends `/submit`.
- [ ] `backend/app/routers/admin/kyc.py` — `GET /admin/kyc/pending`, `POST /admin/kyc/{id}/decide`; two `service_client()` calls each carrying inline `# JUSTIFICATION:` comments; decide handler writes in fixed order (kyc → profile-on-APPROVED → outbox); raises 404 on missing doc, 409 on already-decided.
- [ ] `backend/app/core/security.py` — `AuthUser.verification_status` field; `require_verified(*roles)` factory; role gate fires before verification gate; module docstring updated.
- [ ] `backend/app/main.py` — both new routers mounted.
- [ ] `backend/tests/test_kyc_flow.py` — 6 tests, all green.
- [ ] `backend/tests/test_service_client_callsite_allowlist.py` — still green (AUTH-05); the new admin router landed under `routers/admin/`.
- [ ] `frontend/src/app/onboarding/verification/page.tsx` + `actions.ts` — three-state render; file-size pre-flight; RTL for AR locale.
- [ ] `frontend/src/middleware.ts` — verification redirect for unverified pros on `/farmarket/new` and `/secondserve/new`.
- [ ] `frontend/__tests__/onboarding/verification.test.tsx` — 4 cases green.
- [ ] `backend/app/templates/notifications/kyc.{submitted,approved,rejected}.{fr,ar,en}.{subject,html,txt}` — 9 templates per status × 3 statuses = 27 files, declared so NOT-01 can register them.
- [ ] `docs/runbook.md` §AUTH-06 — admin triage, force-refresh SQL, 30-day REJECTED purge schedule, GDPR/loi 09-08 manual erasure, leak-response, drill table with at least one initial row from §6.1.
- [ ] `docs/runbook.md` §AUTH-04 catalog — verification-gated INSERT template added (the canonical text FAR-01 / SEC-01 will copy).
- [ ] `docs/spring-status.yml` — `AUTH-06.status: TODO → IN_REVIEW` (then `DONE` after the staging drill); summary counters updated; hand-off line appended.
- [ ] Staging drill §6.1 run end-to-end, outcomes recorded in runbook §AUTH-06 drills table.
- [ ] Hook binding in Supabase Dashboard verified — URI is `pg-functions://postgres/public/custom_access_token_hook`, identical to AUTH-02's binding.
- [ ] `ruff check backend/app/routers/kyc.py backend/app/routers/admin/kyc.py` clean.
- [ ] `mypy backend/app/routers/kyc.py backend/app/routers/admin/kyc.py` clean (or rationalized inline if a Supabase-py stub gap blocks).
- [ ] `bash scripts/verify-rls-enabled.sh` still exits 0 (the AUTH-04 event-trigger admitted the new table).

---

## 9. Hand-off notes

- **For [ADM-02](#) (admin verification queue UI):** Your screen sits on top of two endpoints AUTH-06 ships: `GET /api/v1/admin/kyc/pending` (FIFO list, 20/page, includes 5-min signed-read URLs for each doc) and `POST /api/v1/admin/kyc/{document_id}/decide` (body `{ decision, note }`). The atomic transaction inside the decide handler does *all* the writes — your UI just shows the result. The runbook §5.8 contains the force-refresh SQL that you should surface as a one-click admin action below the approval button — pros are impatient and the 1-h staleness window will produce support requests if the UI doesn't offer this affordance.

- **For [FAR-01](#) (verified farmer creates an ad) and [SEC-01](#) (verified restaurateur publishes a meal):** Two mechanical changes on top of your existing INSERT route. (1) Wrap the route in `Depends(require_verified("FARMER"))` (or `("RESTAURANT")` for SEC-01) — same import path as `require_role`, same module. The factory 403s with `verification_required` if the JWT claim is anything but VERIFIED. (2) On the table's INSERT policy, copy the verification-gated INSERT template from the AUTH-04 catalog in `docs/runbook.md` — the canonical text uses `auth.jwt()->>'verification_status'`, which the AUTH-06 hook lifts into the JWT. Do **not** join to `public.profiles` for the verification check; the JWT claim is the fast path. The 1-h staleness window is acknowledged across the project (see runbook §AUTH-06). The `db/tests/auth06_verification_gate_template.sql` drill proves the pattern in isolation; your story's pgTAP just instantiates it for your specific table.

- **For [KAT-01](#) (farmer registers a parcel):** Same pattern as FAR-01. KAT-01 depends on AUTH-06 because PRD §6.1 implies a parcel registration is a professional-only write (an unverified farmer should not be able to spam parcels). `Depends(require_verified("FARMER"))` on the route + verification-gated INSERT policy from the catalog.

- **For [NOT-01](#) (Brevo mailer worker):** Three new notification types are declared in migration 0015 (`kyc.submitted`, `kyc.approved`, `kyc.rejected`) and the 27 template files are shipped under `backend/app/templates/notifications/`. Your dispatcher reads `notifications_outbox` rows of those types and renders the right template per `locale`. The `context` JSONB on the outbox row carries `{ "document_id", "note" }` for the approved/rejected rows so the email can quote the reviewer note (REJECTED) or the document type (APPROVED). AUTH-06 deliberately stops at the *enqueue*: you own the *dispatch*.

- **For [AUTH-07](#) (RLS audit suite):** The `kyc_documents` table's four-policy set is one more (role × verb × policy) tuple to add to your matrix. The pattern is already documented in `docs/runbook.md` §AUTH-04 (the verification-gated INSERT template); your test simply exercises every (role × verb) combination against `kyc_documents` and against any verification-gated table that exists by the time AUTH-07 lands. The `db/tests/auth06_*` files are templates — copy the assertion shape into your matrix runner.

- **For an operator handling a real-world rejection that "should not have happened":** The `kyc_documents` row is the audit trail — `reviewer_id`, `reviewed_at`, and `reviewer_note` are mandatory on any non-PENDING row (CHECK constraint). If a user disputes the decision, you have the admin id, the timestamp, and the note. Re-verification is a *new submission*, not a row-edit; the rejected row stays. The 30-day REJECTED purge schedule (§5.8 runbook) deletes both the storage object and the row, so an unhappy user should be encouraged to re-submit within that window.

- **For a future story that adds a *second* document-type per pro** (e.g. a restaurateur uploading both an RC and a CIN): the table already supports it — submissions are independent rows. The admin queue groups by `(user_id, submitted_at within 60s)` in the ADM-02 UI but the *data* model treats each as a separate submission. The verification flip on `profiles.verification_status` is currently triggered by the *first* APPROVED doc; a stricter "two-of-N must approve" policy would change the decide handler, not the table.

- **For a future story that adds a *second* JWT claim** (e.g. `subscription_tier` for the FarMarket premium-listings feature CRC): extend the same `custom_access_token_hook` function under a new migration `CREATE OR REPLACE`. One hook, three claims. The pattern AUTH-02 → AUTH-06 established holds: do not add a second hook function — the Auth service only calls one, and a split would silently drop the older claims.

---

*AUTH-06 implementation guide — generated under BMAD methodology — references PRD §5.1, §6.1, §6.2, §6.4, §7.1, §7.2 and [docs/spring-status.yml](../spring-status.yml) line 700–705.*
