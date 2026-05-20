# AUTH-02 — Role assignment at registration (FARMER / RESTAURANT / CITIZEN / ADMIN)

> **Epic:** E1 — Authentication, Authorization & Roles (Cross-cutting)
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must *(per [docs/spring-status.yml:472-477](../spring-status.yml#L472-L477) — paired with AUTH-01 to close the PRD §12 Phase-1 gate: *"any user can register **with a role**, log in, and reach a dashboard."* AUTH-01 owns the *register* half; AUTH-02 owns the *with a role* half — every downstream RLS policy keys on this column.)*
> **Status:** TODO
> **Depends on:** [AUTH-01](AUTH-01-email-password-registration.md) (`IN_REVIEW` — `auth.users` + `public.profiles` rows exist and `raw_user_meta_data.role` is plumbed through `handle_new_user()`; AUTH-02 hardens the role *contract* on top of that working signup)
> **Soft-depends on:** [INF-02](INF-02-supabase-project-base-schema.md) (`DONE` — the `public.user_role` enum at [db/migrations/0001_extensions_and_enums.sql:17](../../db/migrations/0001_extensions_and_enums.sql#L17) is the canonical role set; AUTH-02 never widens it), [INF-05](INF-05-ci-pipeline-github-actions-pre-commit.md) (`IN_PROGRESS` — the test files this story adds need the CI matrix to run them)
> **Unblocks:** [AUTH-04](#) (RLS enable — meaningful only once `profiles.role` is reliable), [AUTH-06](#) (KYC — verification queue filters by `role in ('FARMER','RESTAURANT')`), [AUTH-07](#) (RLS audit suite — the role-by-role test matrix), [ADM-01](#) (admin shell — gates on `role = 'ADMIN'`), every module story that reads `auth.jwt()->>'user_role'` (KAT-*, FAR-*, SEC-*, BOT-05, ADM-*)
> **Acceptance (per [docs/spring-status.yml:474-477](../spring-status.yml#L474-L477)):** *"Role persisted on profile; visible in JWT claims."* The §8 Definition of Done extends that into: (a) the role enum has exactly one source of truth in TS, mirrored 1:1 from the Postgres enum, with a CI guard against drift; (b) the self-signup role set is `{FARMER, RESTAURANT, CITIZEN}` enforced **server-side** and DB-side — `ADMIN` is unreachable from the registration form by any path (zod, server action, trigger, RLS); (c) every JWT issued by Supabase Auth carries `user_role` as a top-level claim, populated by an `auth.hook` SQL function reading `public.profiles.role`; (d) RLS policies on downstream tables can gate on `auth.jwt()->>'user_role'` without a per-request `profiles` lookup; (e) the role UI is a three-button radio group with copy that explains each role's privileges; (f) tests cover the four positive role paths, the ADMIN-rejection path (zod + DB), and the JWT-claim presence on a freshly-issued session.

---

## 1. Purpose

PRD §7.1 lists **AUTH-02** as *"Each user is assigned a role: `FARMER`, `RESTAURANT`, `CITIZEN`, or `ADMIN` at registration."* The four-word phrase hides two distinct contracts the MVD depends on every minute it is running:

1. **The persistence contract** — the role assigned at signup must survive into a row on `public.profiles` that every later RLS policy can join to. AUTH-01 already wires the metadata path (`raw_user_meta_data.role` → `handle_new_user()` → `profiles.role`), and INF-02's migration 0003 already validates the enum value. That part works. What AUTH-02 *adds* is the guarantee that nothing in the system can write an `ADMIN` row through the signup pipe — admin promotion is a service-role write, not a client-supplied string.
2. **The runtime-readability contract** — every authenticated request needs to know "what role is this caller?" without a database round-trip. Today, [db/migrations/0005_profiles_rls_recursion_fix.sql:29-42](../../db/migrations/0005_profiles_rls_recursion_fix.sql#L29-L42) ships `public.is_admin()` as a `SECURITY DEFINER` SQL helper — it works, but it costs one extra row read per RLS evaluation, and downstream policies for KAT/FAR/SEC will check `role = 'FARMER'` / `'RESTAURANT'` / `'CITIZEN'` orders of magnitude more often than `role = 'ADMIN'`. The clean MVD answer is a **custom access token hook** that lifts `profiles.role` into the JWT as a top-level `user_role` claim, exposed via `auth.jwt()->>'user_role'`. Policies become `auth.jwt()->>'user_role' = 'FARMER'` — a string comparison on already-decoded claims, no SQL re-entrancy, no recursion class of bug (see the INF-02/INF-03 42P17 incident that produced migration 0005).

Beyond those two contracts, AUTH-02 also fixes three UX/DX gaps that AUTH-01 deliberately left for this story:

- **Role enum drift risk.** AUTH-01 inlined `z.enum(["FARMER", "RESTAURANT", "CITIZEN"])` in [frontend/src/app/register/schema.ts:25](../../frontend/src/app/register/schema.ts#L25). The DB enum is at [db/migrations/0001_extensions_and_enums.sql:17](../../db/migrations/0001_extensions_and_enums.sql#L17). The trigger validator is at [db/migrations/0003_profile_on_signup.sql:22](../../db/migrations/0003_profile_on_signup.sql#L22). Three copies of the same set, with no compile-time link. AUTH-02 collapses them to one TS constant + one DB enum, with a CI test that asserts equality.
- **`<select>` UX is wrong for a three-way role decision.** A native dropdown hides the *consequence* of the choice — a citizen picking "FARMER" by accident hits a `verification_status = 'PENDING'` wall later, with no explanation at signup time. A three-radio group with one sentence of role copy each makes the trade-off legible.
- **No server-side recheck of `ADMIN`.** The zod enum already excludes `ADMIN`, so a well-formed POST never reaches the trigger with that value. But a hand-crafted POST to `/register` that bypasses zod (e.g. `curl -d 'role=ADMIN'` against the server action) **does** reach the trigger today. The trigger catches it (`22023`), which maps to `unknown` in `mapAuthError`, which the user sees as the generic *"erreur inattendue"* banner. That's correct behaviour but slow to diagnose — AUTH-02 short-circuits with a deterministic `invalid_input` mapping and a Sentry tag.

> **What this story is not:** introducing a per-user multi-role model, building the KYC document-upload flow (AUTH-06), opening an ADMIN signup path (admins are seeded by hand via the service role — see §9), or changing the citizen-vs-pro split for SecondServe vs FarMarket (PRD §6.4 already fixes that). The verification queue, document upload, and admin approval flow are all AUTH-06. The end-to-end RLS test matrix is AUTH-07.

---

## 2. Scope

### In scope

- **`frontend/src/lib/auth/roles.ts`** — new module. Single source of truth for the **self-signup** role set:

  ```ts
  export const SELF_SIGNUP_ROLES = ["FARMER", "RESTAURANT", "CITIZEN"] as const;
  export const ALL_ROLES = ["FARMER", "RESTAURANT", "CITIZEN", "ADMIN"] as const;
  export type SelfSignupRole = (typeof SELF_SIGNUP_ROLES)[number];
  export type UserRole = (typeof ALL_ROLES)[number];
  export const ROLE_DESCRIPTIONS_FR: Record<SelfSignupRole, { label: string; blurb: string }> = { … };
  ```

  Used by `schema.ts`, the new role-picker component, the middleware (for redirect-after-login routing in a later story), and the tests. `ALL_ROLES` exists so AUTH-06 / ADM-01 can import the same constant for admin-side code.
- **`frontend/src/app/register/schema.ts`** — replace the inlined `z.enum([...])` with `z.enum(SELF_SIGNUP_ROLES)` imported from `roles.ts`. The schema's *negative* contract — *"`role = 'ADMIN'` returns `safeParse.success === false`"* — is preserved verbatim and pinned by a regression test added in §5.7.
- **`frontend/src/app/register/role-picker.tsx`** — new client component. Renders a `<fieldset>` with three `<input type="radio">` cards (FARMER, RESTAURANT, CITIZEN), each showing a label + one-sentence blurb from `ROLE_DESCRIPTIONS_FR`. The default-checked radio is `CITIZEN` (preserves the existing default from [frontend/src/app/register/page.tsx:93](../../frontend/src/app/register/page.tsx#L93)). The component is purely cosmetic markup — the server still receives `role=…` in the same `FormData` key, so `actions.ts` stays unchanged.
- **`frontend/src/app/register/page.tsx`** — swap the `<select id="role">` block ([line 87-100](../../frontend/src/app/register/page.tsx#L87-L100)) for `<RolePicker />`. No other change to this file.
- **`frontend/src/app/register/actions.ts`** — add a **defensive server-side recheck** after the zod parse: if `parsed.data.role === "ADMIN"` (impossible per the schema, but guards against future schema drift), redirect with `error=invalid_input` and emit a Sentry event tagged `story=AUTH-02, attack=admin_escalation`. The check is **inside** the success branch so the developer reading the code sees the post-zod sanity net next to the optimistic path.
- **`db/migrations/0006_auth02_jwt_role_hook.sql`** — new migration. Three additions:
  1. A `SECURITY DEFINER` function `public.custom_access_token_hook(event jsonb)` that takes the Supabase Auth hook payload (`{ user_id, claims, … }`), reads `public.profiles.role` for `user_id`, and returns the same payload with `claims.user_role` populated. Search-path locked to `public, pg_temp`. Idempotent.
  2. A regression-guard view `public.v_auth02_role_drift` that returns one row per `(profiles.role, distinct values)` so a Supabase Studio query can spot orphans.
  3. A grant of `EXECUTE` to the `supabase_auth_admin` role on the hook function (Supabase Auth runs hooks under this role — it's a documented Supabase convention, not something we invent).
- **`supabase/config.toml`** — wire the hook under a new `[auth.hook.custom_access_token]` block:

  ```toml
  [auth.hook.custom_access_token]
  enabled = true
  uri = "pg-functions://postgres/public/custom_access_token_hook"
  ```

  Mirrored in the Dashboard under **Authentication → Hooks → Custom Access Token** (manual step — Supabase does not yet auto-sync the hook URI from `config.toml` to the project's Auth service; runbook §9 documents this).
- **`db/tests/auth02_jwt_role.sql`** — new psql-driven smoke. For each role in `('FARMER','RESTAURANT','CITIZEN','ADMIN')`: (a) admin-create a user with that role's metadata; (b) call `public.custom_access_token_hook` directly with a synthetic event; (c) assert the returned JSONB has `claims.user_role` equal to the expected enum value; (d) negative case — create a user, then `update profiles set role = 'ADMIN'` via service role, re-run the hook, assert the claim flips. Wrapped in a `begin … rollback` so live data is untouched. Wired into `make -C db test-auth02` and the existing `verify` chain.
- **`db/tests/auth02_no_admin_signup.sql`** — separate psql smoke specifically pinning that `handle_new_user()` rejects `role = 'ADMIN'` from a **client-shaped** metadata payload. Today migration 0003 *allows* ADMIN through the trigger (line 22 lists ADMIN as valid) because admin seeding goes through the trigger too. AUTH-02 changes the contract: ADMIN is only valid when the JWT role is `service_role`. The migration adds a `current_setting('request.jwt.claims', true)::json->>'role'` check identical to the immutability guard in [migration 0005](../../db/migrations/0005_profiles_rls_recursion_fix.sql#L60-L72).
- **`db/migrations/0007_auth02_block_admin_self_signup.sql`** — small migration that patches `public.handle_new_user()` to reject `role = 'ADMIN'` unless the calling JWT role is `service_role`. Lives in its own migration (not folded into 0003) because 0003 is `DONE` and signed off — re-editing a green migration violates the *append-only* convention documented in [docs/runbook.md](../runbook.md).
- **`frontend/__tests__/auth/roles.test.ts`** — new Vitest file:
  - `SELF_SIGNUP_ROLES` contains exactly `["FARMER","RESTAURANT","CITIZEN"]` (regression — a future PR cannot silently add ADMIN by importing the wrong constant).
  - `ALL_ROLES` is `SELF_SIGNUP_ROLES + ["ADMIN"]` (composition holds).
  - `RegisterSchema.safeParse({ role: "ADMIN", … }).success === false` (the AUTH-02 hardened contract).
  - `ROLE_DESCRIPTIONS_FR` has an entry for every `SELF_SIGNUP_ROLES` value (compile-time + runtime check).
- **`db/tests/auth02_enum_parity.sql`** — five-line check that the Postgres `public.user_role` enum has exactly the four values `{FARMER, RESTAURANT, CITIZEN, ADMIN}`. Catches a future migration that silently widens the enum (e.g. adds `MODERATOR`) without updating `ALL_ROLES` on the TS side. A CI Bash script (`scripts/check-role-enum-parity.sh`) greps both files and diff'es the sorted sets — wired into `.github/workflows/ci.yml` under the existing `db` job.
- **`docs/runbook.md`** — new *"AUTH-02 — role assignment operational notes"* section: how to seed an ADMIN user (one-off, via Supabase Dashboard → SQL editor + service role), how to verify the JWT hook is active (decode a fresh access token at jwt.io, assert `user_role` is present), how to revoke / re-grant a role in an incident, and the *"a user reports they cannot create a FarMarket ad"* triage flow that almost always lands on *"their JWT was issued before AUTH-02 — force-refresh"*.
- **`docs/spring-status.yml`** — flip `AUTH-02.status: TODO → IN_REVIEW` once local DoD is green; flip to `DONE` after staging verification per §6.7. Update `summary.in_progress / in_review / todo / done`. Append a hand-off line under `project.last_updated` matching the AUTH-01 entry's shape.

### Out of scope (later stories / explicit deferrals)

- **KYC document upload + admin approval flow** → [AUTH-06](#). AUTH-02 leaves every new pro account at `verification_status = 'PENDING'`; AUTH-06 owns the queue, the document storage bucket, and the `PENDING → VERIFIED` write.
- **`verification_status` as a JWT claim** → [AUTH-06](#) ships the hook extension that adds `verification_status` next to `user_role`. AUTH-02 deliberately stops at one claim — every JWT claim costs token-size bytes on every request, and AUTH-06's policies will be the first ones that actually need it.
- **Role-based redirect after login** → [INF-03 §future](INF-03-nextjs-scaffold-login-dashboard.md) or a small AUTH story late in Phase 2. AUTH-02 does **not** change the post-login `/dashboard` redirect; the dashboard shell stays generic until per-role pages exist.
- **Multi-role users (a farmer who also runs a restaurant)** — explicitly out of MVD scope per PRD §5.2. The data model is single-role; a future Phase-5 story would migrate to a `user_roles(user_id, role)` join table.
- **ADMIN signup path / admin-invitation flow** — admins are seeded by hand for MVD (`vitachain-prod` ships with two ADMIN rows for the two team members on-call). A proper invitation flow with a tokenized URL is post-MVD.
- **`SECURITY DEFINER` audit of the new hook** → [AUTH-07](#). The hook is conservative (one indexed SELECT, no writes, no dynamic SQL), so a per-call audit is overkill at MVD scale; AUTH-07 will fold it into the broader RLS suite.
- **`pgaudit` extension wiring for role-flip logs** — post-MVD compliance story; `auth.audit_log_entries` (Supabase-managed) is the MVD source of truth.
- **CAPTCHA on the role picker** — same logic as AUTH-01 §2: NGINX rate-limit (AUTH-08) is the MVD answer to enumeration / brute force; CAPTCHA is Phase-5.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [AUTH-01](AUTH-01-email-password-registration.md) merged | The role plumbing — `RegisterSchema.role`, `raw_user_meta_data.role`, the `handle_new_user()` validator — is the foundation. AUTH-02 patches it, not rebuilds it. |
| [INF-02](INF-02-supabase-project-base-schema.md) `DONE` | The `public.user_role` enum and `public.profiles.role` column exist with the four-value contract intact. |
| Supabase project ≥ project plan that supports Auth Hooks | The `custom_access_token` hook is a free-tier feature on Supabase since 2024-09. Confirm in **Authentication → Hooks** that the *Custom Access Token* slot is visible — if it isn't, the project was created before the rollout and needs a Supabase support ticket. `qyyxgdfetzjqfpygikbz` (the `vitachain-prod` project) was created post-rollout, so this is a one-line dashboard check, not a procurement task. |
| Bitwarden access | The `service_role` JWT is needed for the `db/tests/auth02_no_admin_signup.sql` smoke (it exercises the `current_setting('request.jwt.claims')` branch that only fires under a service-role connection). |
| Local Supabase CLI ≥ 1.200 | `supabase db push` needs to recognize the `[auth.hook.custom_access_token]` TOML block. |
| INF-08 Sentry DSN in `frontend/.env.local` | The post-zod recheck Sentry event in `actions.ts` is a no-op without it locally — fine for dev, but the DoD §8 drill needs the staging DSN active. |

---

## 4. Target configuration

| Setting | Value | Source / rationale |
|---|---|---|
| Self-signup role set | `{FARMER, RESTAURANT, CITIZEN}` | PRD §7.1 — admin role is seeded out-of-band, not chosen on a public form. |
| DB enum `public.user_role` | `{FARMER, RESTAURANT, CITIZEN, ADMIN}` | Unchanged from INF-02 0001. Includes ADMIN because the column must accept it for ADMIN rows seeded via service role. |
| Trigger acceptance of `ADMIN` | Allowed **only** when JWT role is `service_role` | Hardens migration 0003's permissive validator without breaking the seed path. |
| JWT claim shape | `claims.user_role = profiles.role` | Set by `public.custom_access_token_hook`. Single string, top-level, never null for a row that has a profile. |
| Hook runner role | `supabase_auth_admin` | Supabase convention — Auth service calls hooks under this role; `GRANT EXECUTE` is therefore required. |
| Default role on form | `CITIZEN` | Lowest-privilege default — preserves AUTH-01's default; promotions to pro role still happen through KYC (AUTH-06). |
| Role-immutability after signup | Enforced by `enforce_profile_immutability` trigger from migration 0005 | Unchanged; AUTH-02 builds **on** that guard, doesn't relax it. |

---

## 5. Step-by-step implementation

### 5.1 Single source of truth for the role enum

Create [frontend/src/lib/auth/roles.ts](../../frontend/src/lib/auth/roles.ts):

```ts
/**
 * AUTH-02 — Single TS mirror of the public.user_role Postgres enum
 * (db/migrations/0001_extensions_and_enums.sql).
 *
 * SELF_SIGNUP_ROLES is the closed set the public /register form may emit.
 * ALL_ROLES adds ADMIN — used by admin-side code (ADM-01, AUTH-06) that
 * needs to render the full enum (e.g. a verification queue filter).
 *
 * Drift between this file and the Postgres enum is caught by
 * scripts/check-role-enum-parity.sh in CI.
 */
export const SELF_SIGNUP_ROLES = ["FARMER", "RESTAURANT", "CITIZEN"] as const;
export const ALL_ROLES = [
  "FARMER",
  "RESTAURANT",
  "CITIZEN",
  "ADMIN",
] as const;

export type SelfSignupRole = (typeof SELF_SIGNUP_ROLES)[number];
export type UserRole = (typeof ALL_ROLES)[number];

// TODO(i18n) — moved to register.json in I18N-02.
export const ROLE_DESCRIPTIONS_FR: Record<
  SelfSignupRole,
  { label: string; blurb: string }
> = {
  FARMER: {
    label: "Agriculteur",
    blurb:
      "Je cultive et souhaite vendre directement aux restaurateurs. Vérification requise.",
  },
  RESTAURANT: {
    label: "Restaurateur",
    blurb:
      "Je gère un restaurant et souhaite acheter des produits frais ou publier des invendus. Vérification requise.",
  },
  CITIZEN: {
    label: "Citoyen",
    blurb:
      "Je cherche des paniers à prix réduits près de chez moi. Aucune vérification nécessaire.",
  },
};
```

### 5.2 Wire the schema to the single source

Edit [frontend/src/app/register/schema.ts](../../frontend/src/app/register/schema.ts) — replace the inlined enum with the constant:

```ts
import { z } from "zod";
import { SELF_SIGNUP_ROLES } from "@/lib/auth/roles";

export const RegisterSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(10, "weak_password")
    .max(72, "weak_password")
    .regex(/[a-z]/, "weak_password")
    .regex(/[A-Z]/, "weak_password")
    .regex(/\d/, "weak_password"),
  role: z.enum(SELF_SIGNUP_ROLES),
  locale: z.enum(["fr", "ar", "en"]).default("fr"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
```

### 5.3 Role-picker UI

Create [frontend/src/app/register/role-picker.tsx](../../frontend/src/app/register/role-picker.tsx):

```tsx
"use client";
import { useState } from "react";
import {
  SELF_SIGNUP_ROLES,
  ROLE_DESCRIPTIONS_FR,
  type SelfSignupRole,
} from "@/lib/auth/roles";

export default function RolePicker({
  name = "role",
  defaultRole = "CITIZEN" as SelfSignupRole,
}: {
  name?: string;
  defaultRole?: SelfSignupRole;
}) {
  const [selected, setSelected] = useState<SelfSignupRole>(defaultRole);

  return (
    <fieldset className="mt-1 flex flex-col gap-2">
      <legend className="sr-only">Rôle</legend>
      {SELF_SIGNUP_ROLES.map((r) => {
        const meta = ROLE_DESCRIPTIONS_FR[r];
        const isSelected = selected === r;
        return (
          <label
            key={r}
            className={
              "flex cursor-pointer items-start gap-3 rounded border p-3 text-sm " +
              (isSelected
                ? "border-emerald-600 bg-emerald-50"
                : "border-neutral-300 hover:border-neutral-400")
            }
          >
            <input
              type="radio"
              name={name}
              value={r}
              checked={isSelected}
              onChange={() => setSelected(r)}
              className="mt-1"
              required
            />
            <span>
              <span className="block font-medium text-neutral-900">
                {meta.label}
              </span>
              <span className="block text-xs text-neutral-600">
                {meta.blurb}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
```

### 5.4 Swap the `<select>` for the picker

Edit [frontend/src/app/register/page.tsx](../../frontend/src/app/register/page.tsx) — replace lines 87–100 with:

```tsx
import RolePicker from "./role-picker";

// …in the form body, where the <select id="role"> currently lives:
<div className="text-xs text-neutral-600">
  Rôle
  <RolePicker name="role" defaultRole="CITIZEN" />
</div>
```

The `<select>` block is deleted. No other changes to `page.tsx`.

### 5.5 Defensive server-side recheck

Edit [frontend/src/app/register/actions.ts](../../frontend/src/app/register/actions.ts) — add the post-zod recheck immediately after the `safeParse` block:

```ts
import * as Sentry from "@sentry/nextjs";

// …after parsed.data is destructured:
if ((parsed.data.role as string) === "ADMIN") {
  // Unreachable via the schema; this catches a hand-crafted POST
  // that bypasses the form.
  Sentry.captureMessage("AUTH-02: ADMIN role submitted to /register", {
    level: "warning",
    tags: { story: "AUTH-02", attack: "admin_escalation" },
  });
  redirect("/register?error=invalid_input");
}
```

### 5.6 The JWT-claim hook

Create [db/migrations/0006_auth02_jwt_role_hook.sql](../../db/migrations/0006_auth02_jwt_role_hook.sql):

```sql
-- =============================================================================
-- 0006 — AUTH-02 — Custom access-token hook: lifts profiles.role into the JWT.
-- Story:  AUTH-02 (docs/stories/AUTH-02-role-assignment-registration.md)
-- Why:    every downstream RLS policy needs a fast, recursion-free way to
--         read the caller's role. A SQL helper (is_admin() — migration 0005)
--         costs one indexed SELECT per evaluation; a JWT claim costs zero.
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
    uid           uuid;
    resolved_role text;
    new_claims    jsonb;
begin
    uid := (event->>'user_id')::uuid;

    -- Defensive: a hook fired for a user_id with no profile (shouldn't happen
    -- given migration 0003's trigger, but defence in depth) returns the event
    -- unchanged so the Auth service doesn't 500. A missing claim is a softer
    -- failure than a refused token.
    select role::text into resolved_role
      from public.profiles
     where id = uid;

    if resolved_role is null then
        return event;
    end if;

    new_claims := coalesce(event->'claims', '{}'::jsonb)
                  || jsonb_build_object('user_role', resolved_role);

    return jsonb_set(event, '{claims}', new_claims);
end;
$$;

-- Supabase Auth runs hooks under the supabase_auth_admin role.
grant execute on function public.custom_access_token_hook(jsonb)
    to supabase_auth_admin;

-- Belt and braces — revoke from every other role.
revoke execute on function public.custom_access_token_hook(jsonb)
    from public, anon, authenticated;
```

### 5.7 Block `ADMIN` self-signup

Create [db/migrations/0007_auth02_block_admin_self_signup.sql](../../db/migrations/0007_auth02_block_admin_self_signup.sql):

```sql
-- =============================================================================
-- 0007 — AUTH-02 — Reject role=ADMIN from non-service-role signups.
-- Story:  AUTH-02
-- Why:    migration 0003 accepts ADMIN in raw_user_meta_data because the
--         service-role seed path goes through the same trigger. AUTH-02
--         tightens that: ADMIN is only acceptable when the JWT role of
--         the caller is service_role.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    requested_role   text := coalesce(new.raw_user_meta_data->>'role',   'CITIZEN');
    requested_locale text := coalesce(new.raw_user_meta_data->>'locale', 'fr');
    jwt_role         text;
begin
    if requested_role not in ('FARMER','RESTAURANT','CITIZEN','ADMIN') then
        raise exception 'invalid role on signup: %', requested_role
            using errcode = '22023';
    end if;

    if requested_locale not in ('fr','ar','en') then
        raise exception 'invalid locale on signup: %', requested_locale
            using errcode = '22023';
    end if;

    if requested_role = 'ADMIN' then
        begin
            jwt_role := current_setting('request.jwt.claims', true)::json->>'role';
        exception when others then
            jwt_role := null;
        end;
        if jwt_role is distinct from 'service_role' then
            raise exception 'ADMIN role may only be assigned via the service role'
                using errcode = '42501';   -- insufficient_privilege
        end if;
    end if;

    insert into public.profiles (id, email, full_name, role, locale)
    values (
        new.id,
        new.email,
        new.raw_user_meta_data->>'full_name',
        requested_role::public.user_role,
        requested_locale::public.locale_code
    );

    return new;
end;
$$;
```

### 5.8 Codify the hook in `supabase/config.toml`

Edit [supabase/config.toml](../../supabase/config.toml) — append:

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

Push:

```bash
supabase db push --linked
```

### 5.9 DB-side tests

Create [db/tests/auth02_jwt_role.sql](../../db/tests/auth02_jwt_role.sql):

```sql
-- AUTH-02 — JWT claim hook coverage.
-- Verifies public.custom_access_token_hook lifts profiles.role into claims.user_role.

begin;

do $$
declare
    role_v public.user_role;
    uid    uuid;
    event  jsonb;
    out_   jsonb;
begin
    foreach role_v in array array['FARMER','RESTAURANT','CITIZEN','ADMIN']::public.user_role[] loop
        uid := gen_random_uuid();
        insert into auth.users (id, email, raw_user_meta_data, encrypted_password, email_confirmed_at)
        values (uid,
                format('auth02-%s@test.local', uid),
                jsonb_build_object('role', role_v::text),
                crypt('Abcdefg123', gen_salt('bf')),
                now());

        event := jsonb_build_object(
            'user_id', uid::text,
            'claims', jsonb_build_object('sub', uid::text)
        );
        out_ := public.custom_access_token_hook(event);

        if out_->'claims'->>'user_role' is distinct from role_v::text then
            raise exception 'claim mismatch for role=%: got %', role_v,
                out_->'claims'->>'user_role';
        end if;

        delete from auth.users where id = uid;
        raise notice 'OK hook claim for %', role_v;
    end loop;
end$$;

-- Missing-profile path returns the event unchanged.
do $$
declare
    event jsonb := jsonb_build_object(
        'user_id', gen_random_uuid()::text,
        'claims', jsonb_build_object('sub','dummy')
    );
    out_  jsonb;
begin
    out_ := public.custom_access_token_hook(event);
    if out_->'claims' ? 'user_role' then
        raise exception 'expected no user_role claim for missing profile';
    end if;
    raise notice 'OK missing-profile path';
end$$;

rollback;
```

Create [db/tests/auth02_no_admin_signup.sql](../../db/tests/auth02_no_admin_signup.sql):

```sql
-- AUTH-02 — ADMIN self-signup is rejected (42501); service-role seed is allowed.

begin;

-- Negative — anon-context ADMIN signup must fail.
do $$
declare
    uid uuid := gen_random_uuid();
begin
    perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    begin
        insert into auth.users (id, email, raw_user_meta_data, encrypted_password)
        values (uid, format('no-admin-%s@test.local', uid),
                jsonb_build_object('role','ADMIN'),
                crypt('Abcdefg123', gen_salt('bf')));
        raise exception 'expected 42501, got success';
    exception when insufficient_privilege then
        raise notice 'OK anon ADMIN signup rejected';
    end;
end$$;

-- Positive — service-role ADMIN seed must succeed.
do $$
declare
    uid uuid := gen_random_uuid();
begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    insert into auth.users (id, email, raw_user_meta_data, encrypted_password, email_confirmed_at)
    values (uid, format('admin-seed-%s@test.local', uid),
            jsonb_build_object('role','ADMIN'),
            crypt('Abcdefg123', gen_salt('bf')), now());

    if not exists (select 1 from public.profiles where id = uid and role = 'ADMIN') then
        raise exception 'service-role ADMIN seed did not produce profile row';
    end if;
    raise notice 'OK service-role ADMIN seed';
end$$;

rollback;
```

Create [db/tests/auth02_enum_parity.sql](../../db/tests/auth02_enum_parity.sql):

```sql
-- AUTH-02 — DB enum is exactly {FARMER, RESTAURANT, CITIZEN, ADMIN}.
do $$
declare
    expected text[] := array['ADMIN','CITIZEN','FARMER','RESTAURANT'];
    actual   text[];
begin
    select array_agg(enumlabel order by enumlabel)
      into actual
      from pg_enum
     where enumtypid = 'public.user_role'::regtype;
    if actual is distinct from expected then
        raise exception 'user_role enum drift: expected %, got %', expected, actual;
    end if;
    raise notice 'OK user_role parity';
end$$;
```

Append to [db/Makefile](../../db/Makefile):

```make
.PHONY: test-auth02
test-auth02:
	psql "$$SUPABASE_DB_URL" -v ON_ERROR_STOP=on -f tests/auth02_enum_parity.sql
	psql "$$SUPABASE_DB_URL" -v ON_ERROR_STOP=on -f tests/auth02_jwt_role.sql
	psql "$$SUPABASE_DB_URL" -v ON_ERROR_STOP=on -f tests/auth02_no_admin_signup.sql

verify:: test-auth02
```

### 5.10 Frontend tests

Create [frontend/__tests__/auth/roles.test.ts](../../frontend/__tests__/auth/roles.test.ts):

```ts
import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  ROLE_DESCRIPTIONS_FR,
  SELF_SIGNUP_ROLES,
} from "@/lib/auth/roles";
import { RegisterSchema } from "@/app/register/schema";

describe("role constants", () => {
  it("SELF_SIGNUP_ROLES excludes ADMIN", () => {
    expect(SELF_SIGNUP_ROLES).toEqual(["FARMER", "RESTAURANT", "CITIZEN"]);
    expect(SELF_SIGNUP_ROLES).not.toContain("ADMIN");
  });

  it("ALL_ROLES composes SELF_SIGNUP_ROLES + ADMIN", () => {
    expect([...ALL_ROLES].sort()).toEqual(
      ["ADMIN", ...SELF_SIGNUP_ROLES].sort(),
    );
  });

  it("ROLE_DESCRIPTIONS_FR covers every self-signup role", () => {
    for (const r of SELF_SIGNUP_ROLES) {
      expect(ROLE_DESCRIPTIONS_FR[r].label).toBeTruthy();
      expect(ROLE_DESCRIPTIONS_FR[r].blurb).toBeTruthy();
    }
  });
});

describe("RegisterSchema role hardening", () => {
  const base = {
    full_name: "Test User",
    email: "test@example.com",
    password: "Abcdefghi1",
    locale: "fr" as const,
  };

  it.each(SELF_SIGNUP_ROLES)("accepts role=%s", (role) => {
    expect(RegisterSchema.safeParse({ ...base, role }).success).toBe(true);
  });

  it("rejects role=ADMIN", () => {
    const r = RegisterSchema.safeParse({ ...base, role: "ADMIN" });
    expect(r.success).toBe(false);
  });

  it("rejects role=PRESIDENT (unknown enum value)", () => {
    const r = RegisterSchema.safeParse({ ...base, role: "PRESIDENT" });
    expect(r.success).toBe(false);
  });
});
```

### 5.11 CI parity guard

Create [scripts/check-role-enum-parity.sh](../../scripts/check-role-enum-parity.sh):

```bash
#!/usr/bin/env bash
# AUTH-02 — fail CI if frontend ALL_ROLES drifts from the DB enum literal.
set -euo pipefail

ts_roles=$(grep -oE '"(FARMER|RESTAURANT|CITIZEN|ADMIN)"' \
    frontend/src/lib/auth/roles.ts \
  | tr -d '"' | sort -u | paste -sd, -)

sql_roles=$(grep -oE "'(FARMER|RESTAURANT|CITIZEN|ADMIN)'" \
    db/migrations/0001_extensions_and_enums.sql \
  | tr -d "'" | sort -u | paste -sd, -)

if [ "$ts_roles" != "$sql_roles" ]; then
    echo "AUTH-02 parity FAILED:" >&2
    echo "  TS roles:  $ts_roles" >&2
    echo "  SQL roles: $sql_roles" >&2
    exit 1
fi
echo "AUTH-02 parity OK ($ts_roles)"
```

Wire into [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — add to the `db` job's steps, after the existing `make -C db verify` step:

```yaml
- name: AUTH-02 — role enum parity
  run: bash scripts/check-role-enum-parity.sh
```

And to [.pre-commit-config.yaml](../../.pre-commit-config.yaml) as a `local` hook so the check runs on every commit that touches either file:

```yaml
- id: auth02-role-parity
  name: AUTH-02 role enum parity
  entry: scripts/check-role-enum-parity.sh
  language: script
  files: '^(frontend/src/lib/auth/roles\.ts|db/migrations/0001_extensions_and_enums\.sql)$'
  pass_filenames: false
```

---

## 6. Verification

Run, in order, on a clean working tree:

```bash
# 1. Migrations apply cleanly
supabase db push --linked --dry-run            # MUST report only 0006 + 0007 + config delta

# 2. Frontend tests (roles + register schema)
cd frontend && npm run test -- roles register   # MUST pass — 12+ assertions

# 3. Typecheck + lint
npm run typecheck && npm run lint

# 4. DB smokes (uses Bitwarden SUPABASE_DB_URL DIRECT :5432)
make -C db test-auth02                         # 3 files; MUST emit OK lines, end in ROLLBACK

# 5. CI parity guard locally
bash scripts/check-role-enum-parity.sh         # prints "AUTH-02 parity OK (…)"

# 6. Hook activation in Dashboard
#    (a) Authentication → Hooks → Custom Access Token → confirm enabled,
#        URI = pg-functions://postgres/public/custom_access_token_hook.
#    (b) The Dashboard UI is the canonical activator; config.toml mirrors it
#        for replay but does not auto-flip the runtime hook.

# 7. Manual end-to-end against staging
#    (a) Register a FARMER from /register with the new radio picker. Confirm
#        the radio cards render and the FARMER blurb appears.
#    (b) Log in, open the network tab, copy the access_token cookie value,
#        paste at jwt.io. Confirm payload contains "user_role": "FARMER".
#    (c) Hand-crafted POST attack — from a separate terminal:
#          curl -X POST https://staging.vitachain.ma/register \
#               -F full_name=Bad -F email=bad@x.co -F password=Abcdefghi1 \
#               -F role=ADMIN -F locale=fr -L
#        Expect a 302 to /register?error=invalid_input. Confirm a Sentry
#        Issue lands tagged story=AUTH-02, attack=admin_escalation.
#    (d) Service-role ADMIN seed — from psql with SUPABASE_DB_URL DIRECT:
#          set local request.jwt.claims = '{"role":"service_role"}';
#          insert into auth.users (id, email, raw_user_meta_data,
#                                  encrypted_password, email_confirmed_at)
#          values (gen_random_uuid(), 'admin@vitachain.ma',
#                  '{"role":"ADMIN","locale":"fr","full_name":"Admin"}',
#                  crypt('Abcdefghi1', gen_salt('bf')), now());
#        Confirm public.profiles has the row with role=ADMIN. Reset the
#        password from the Dashboard for production handoff.

# 8. JWT freshness for existing users
#    Any user signed up before AUTH-02's hook activation carries a JWT
#    without user_role. Force-refresh by signing them out (or wait < 1h
#    for natural expiry). The runbook §9 has the operator-side script.
```

---

## 7. Risks & failure modes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Hook function errors → Auth service refuses to mint tokens** | Low — the function is small and `stable`, but a future edit could regress. | Critical — *no one can log in*. | The hook is wrapped so the missing-profile path returns the event unchanged; `EXCEPTION` blocks in any future extension must do the same. The §6.7 manual JWT decode is a fast canary. |
| **Stale JWTs after rollout (users see "missing user_role")** | High — every existing session predates the hook. | Medium — downstream policies fail closed; users get redirected to login or see empty dashboards. | One-line `supabase.auth.signOut({ scope: 'global' })` via service role at deploy time; documented in runbook §9. |
| **Role enum drift between TS and SQL** | Medium — easy to add a value in one place and forget the other. | Medium — schema-rejected role at signup, or runtime cast errors. | `scripts/check-role-enum-parity.sh` runs in pre-commit + CI `db` job. The `auth02_enum_parity.sql` smoke is the DB-side complement. |
| **Hook latency on every token issuance** | Low — one indexed PK SELECT on `profiles`. | Low — adds ~1–2 ms per signin/refresh. | `profiles.id` is the table's PK; the SELECT is a primary-key lookup. Re-measured if the table grows past 10k rows (not in MVD). |
| **Admin seed accidentally goes through the trigger as anon** | Low — the seed procedure runs as service role by design. | High — `42501` raised, seed fails. | Runbook §9 explicitly states the `set local request.jwt.claims` step. The `auth02_no_admin_signup.sql` smoke covers both branches. |
| **JWT-claim size pressure** | Very low — one extra short string. | Negligible. | If AUTH-06 adds `verification_status` later (also a short enum), the total claim overhead stays well under Supabase's defaults. |
| **Browser-side state retains the old `<select>` after a partial deploy** | Low — Next 15 SSR + client refresh resolves fast. | Low — visual glitch only. | Standard CDN cache-bust on `/register`; the runbook deploy step purges it. |

---

## 8. Definition of Done

- [ ] [frontend/src/lib/auth/roles.ts](../../frontend/src/lib/auth/roles.ts) exists with `SELF_SIGNUP_ROLES`, `ALL_ROLES`, `ROLE_DESCRIPTIONS_FR`, and the type exports.
- [ ] [frontend/src/app/register/schema.ts](../../frontend/src/app/register/schema.ts) imports `SELF_SIGNUP_ROLES` (no inline literal).
- [ ] [frontend/src/app/register/role-picker.tsx](../../frontend/src/app/register/role-picker.tsx) renders three radio cards with copy from `ROLE_DESCRIPTIONS_FR`; `CITIZEN` is default-checked.
- [ ] [frontend/src/app/register/page.tsx](../../frontend/src/app/register/page.tsx) uses `<RolePicker />` (no `<select id="role">` remaining).
- [ ] [frontend/src/app/register/actions.ts](../../frontend/src/app/register/actions.ts) has the post-zod `role === "ADMIN"` recheck with Sentry tagging.
- [ ] [db/migrations/0006_auth02_jwt_role_hook.sql](../../db/migrations/0006_auth02_jwt_role_hook.sql) applied; `public.custom_access_token_hook` exists and grants `EXECUTE` to `supabase_auth_admin`.
- [ ] [db/migrations/0007_auth02_block_admin_self_signup.sql](../../db/migrations/0007_auth02_block_admin_self_signup.sql) applied; `handle_new_user()` rejects ADMIN under non-service JWT role.
- [ ] [supabase/config.toml](../../supabase/config.toml) contains the `[auth.hook.custom_access_token]` block; the Dashboard hook slot is **enabled** with the matching URI.
- [ ] `make -C db test-auth02` green against `qyyxgdfetzjqfpygikbz` (enum parity + JWT hook + no-admin-signup, all three).
- [ ] `npm run test` green; the role/schema test file passes 12+ assertions.
- [ ] `bash scripts/check-role-enum-parity.sh` exits 0 locally; the CI `db` job has the same step and reports green on the first PR that touches AUTH-02.
- [ ] Manual staging verification §6.7: (a) radio picker renders, (b) JWT decoded at jwt.io shows `user_role`, (c) hand-crafted ADMIN POST returns `error=invalid_input` and produces a Sentry Issue, (d) service-role seed succeeds.
- [ ] [docs/runbook.md](../runbook.md) has the *"AUTH-02 — role assignment operational notes"* section with: admin seed recipe, JWT-freshness force-refresh procedure, hook health check, role-revoke playbook.
- [ ] [docs/spring-status.yml](../spring-status.yml) flipped `AUTH-02.status: TODO → IN_REVIEW` after local DoD; flipped to `DONE` after §6.7 staging verification. `summary` counters updated. Hand-off log line under `project.last_updated`.

---

## 9. Operational notes (runbook excerpt)

These go into [docs/runbook.md](../runbook.md) under *"AUTH-02 — role assignment operational notes"*. Summarized here so the implementer has the operator's view in one place while building.

### Seed an ADMIN user (one-off)

1. Sign in to the Supabase Dashboard → **SQL Editor** with the team Google account.
2. Run, replacing the email and a strong random password (paste from Bitwarden's *VitaChain — ADMIN seed* secure note):

   ```sql
   set local request.jwt.claims = '{"role":"service_role"}';
   insert into auth.users (id, email, raw_user_meta_data,
                           encrypted_password, email_confirmed_at)
   values (gen_random_uuid(),
           'ops-admin@vitachain.ma',
           '{"role":"ADMIN","locale":"fr","full_name":"Ops Admin"}',
           crypt('REDACTED-FROM-BITWARDEN', gen_salt('bf')),
           now());
   ```
3. Confirm `public.profiles` has the matching row with `role = 'ADMIN'`.
4. Hand the credentials to the operator over Bitwarden (never Slack / email).

### Verify the JWT hook is active

1. Log in any user from staging.
2. In the browser devtools → Application → Cookies, copy `sb-<ref>-auth-token`'s access-token portion.
3. Paste into jwt.io. The payload must contain `"user_role": "<their role>"`.
4. If `user_role` is missing: (a) the Dashboard hook slot is off — flip it ON; (b) the function exists but the GRANT is missing — re-run migration 0006; (c) the user's JWT predates rollout — force a re-login.

### Force-refresh all sessions after a role change

```bash
# In a psql connection with the service role:
delete from auth.refresh_tokens
 where user_id = (select id from auth.users where email = 'user@x.co');
```

Next access-token refresh will fail; the client logs out, signs back in, and the new JWT carries the updated `user_role`.

### Triage: *"I cannot publish an ad / reserve a meal"*

1. Decode the user's JWT at jwt.io (the user can paste it from the URL bar after Supabase appends `#access_token=…` in some flows; otherwise pull from Supabase Studio → Auth → Users).
2. If `user_role` is absent → JWT predates AUTH-02 → force re-login (above).
3. If `user_role` is wrong → check `public.profiles.role` in Studio; if mismatched, an admin or service-role write is the only fix (the immutability trigger from migration 0005 blocks self-edit).
4. If `user_role` is correct and the action still fails → not AUTH-02; route to AUTH-06 (verification_status) or AUTH-04 (RLS audit).

---

## 10. Hand-off notes

- **For AUTH-04 (RLS enable on all sensitive tables):** every new policy you write may now key on `(auth.jwt() ->> 'user_role') = '<ROLE>'` instead of joining to `public.profiles`. This is the recursion-safe pattern that migration 0005 baked in for `profiles_select_admin` via `is_admin()`; AUTH-02 generalizes it to all roles. Keep `is_admin()` as the helper for ADMIN-specific policies on `profiles` itself (the recursion-avoidance dance), but use the JWT claim everywhere else.
- **For AUTH-06 (KYC):** the second JWT claim — `verification_status` — is yours to ship. Extend `public.custom_access_token_hook` with one more `SELECT` and one more `jsonb_build_object` key; rename the migration accordingly. The DoD's "force-refresh after a flip" pattern is the same as AUTH-02's runbook §9, except triggered on every admin approve action.
- **For AUTH-07 (RLS audit suite):** the per-role test matrix anchors on the four `user_role` values. The `auth02_jwt_role.sql` smoke is the prototype for the AUTH-07 "for each role, run the policy probe set" pattern — copy its DO-LOOP shape.
- **For ADM-01 (admin shell):** route protection is one middleware check on `(auth.jwt() ->> 'user_role') === 'ADMIN'`. No DB round-trip. The `roles.ts` `ALL_ROLES` constant is your import.
- **For I18N-02 (French catalog):** `ROLE_DESCRIPTIONS_FR` and the `// TODO(i18n)` markers in `roles.ts` are the migration targets. The constant's key set (`SELF_SIGNUP_ROLES`) is the catalog's key set for this slice.

---

*AUTH-02 implementation guide — generated under BMAD methodology — references PRD §7.1 (AUTH-02) and `docs/spring-status.yml` lines 472–477.*
