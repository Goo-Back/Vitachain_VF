# AUTH-01 — Email/password registration via Supabase Auth

> **Epic:** E1 — Authentication, Authorization & Roles (Cross-cutting)
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must *(per [docs/spring-status.yml:436](../spring-status.yml#L436) — half of the PRD §12 Phase-1 gate: *"any user can register with a role, log in, and reach a dashboard."* AUTH-01 owns the **registration** half; the login + dashboard halves are owned by AUTH-03 and INF-03 respectively.)*
> **Status:** TODO
> **Depends on:** [INF-02](INF-02-supabase-project-base-schema.md) (`DONE` — `auth.users` exists; the `on_auth_user_created` trigger consumes `raw_user_meta_data.{full_name,role,locale}` and inserts into `public.profiles` — this story produces the metadata that trigger expects), [INF-03](INF-03-nextjs-scaffold-login-dashboard.md) (`DONE` — `/register` route, server-action plumbing, `@supabase/ssr` cookies, middleware — AUTH-01 takes that scaffold from *"works on a happy path"* to *"PRD §7.1 contract met"*)
> **Soft-depends on:** [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) (`DONE` — the FastAPI surface AUTH-01 does **not** touch; AUTH-01 is a frontend + Supabase-Dashboard story by design — the backend joins at AUTH-06 for KYC and at AUTH-05 for the service-key boundary)
> **Unblocks:** [AUTH-02](#) (role assignment — needs an existing signup row to flip role on; AUTH-02 also re-tightens the role-selector UI that this story leaves in place from INF-03), [AUTH-03](#) (JWT lifetime tuning — meaningful only once at least one user can authenticate), [AUTH-06](#) (KYC — verification flips a column on the `profiles` row this story creates), every domain story that gates by `auth.uid()` (KAT-*, FAR-*, SEC-*, ADM-*)
> **Acceptance (per [docs/spring-status.yml:438](../spring-status.yml#L438) + PRD §7.1):** *"User can register with email + password."* The §8 Definition of Done extends that single line into: (a) the `/register` form persists `auth.users` + `public.profiles` atomically; (b) the password policy declared in §4 is enforced **server-side** (Supabase Auth setting, not just zod); (c) every Supabase error surface is mapped to a stable, i18n-friendly error key — never echoed verbatim to the URL; (d) abuse paths (duplicate email, leaked-password, rate-limit) each produce a deterministic, tested outcome; (e) the `INF-08` Sentry pipeline captures a signup failure as a structured event with `request_id` + `email_hash` (never the raw email).

---

## 1. Purpose

PRD §7.1 lists **AUTH-01** as *"Users register with email + password via Supabase Auth."* That one-line requirement is the entry door to every other story in the project — every RLS policy keys off `auth.uid()`, every `profiles.role` check expects a row to exist, every email Brevo sends needs a recipient address that Supabase Auth has confirmed belongs to a real human.

INF-03 already shipped a working `/register` server action because the Phase-1 scaffold needed *something* to click. That action is roughly 30 lines of zod + `supabase.auth.signUp()` and it covers the **happy path**. What it does **not** cover, and what AUTH-01 owns, is everything that turns a 30-line happy path into a production-shaped auth surface:

- **Password policy in Supabase Auth itself** — today the only floor is `z.string().min(8)` on the client. A direct REST POST to `/auth/v1/signup` bypasses zod and Supabase Auth currently accepts a six-character password silently. AUTH-01 lifts the floor to **server-side** Supabase Auth settings (min length, character classes, HIBP breached-password check).
- **Email confirmation policy** — Supabase Auth defaults to *"confirm email on signup"* in production projects. INF-02 deliberately turned it **off** for the MVD demo (`enable_confirmations = false`) so demo-day flows don't depend on inbox-reachability. AUTH-01 **ratifies** that decision in writing, documents the post-MVD path back to ON, and ensures the current code is correct for both modes (today, the `/register` action redirects to `/dashboard` on success, which is right when confirmation is OFF and wrong when it is ON).
- **Deterministic error UX** — INF-03's `redirect(?error=${error.message})` leaks Supabase's English error strings into a URL bar that the i18n catalogs (I18N-02..04) cannot translate. AUTH-01 introduces a small `mapAuthError()` switch that converts every realistic Supabase Auth failure code into a stable error **key** (`email_taken`, `weak_password`, `rate_limited`, `network`, `unknown`) that the i18n layer can localize and that QA can assert against.
- **Abuse path coverage** — duplicate email, leaked password, IP-level rate limit, server-side timeout. Each must produce a known outcome that the user can recover from without a developer in the loop.
- **Observability** — the INF-08 Sentry SDK should see signup failures as **events** (not just 500s) with `email_hash = sha256(email.lower())` as a fingerprint and the mapped error key as a tag. Never the raw email — INF-08's `before_send` scrubs it anyway, but defence-in-depth means we never pass it in.
- **Tests** — a frontend unit test on the zod schema, a frontend integration test that mocks `supabase.auth.signUp` and asserts each error mapping, a DB-side smoke that exercises the `handle_new_user()` trigger via the admin REST path (same shape as INF-02 §6.4 already established), and a manual signup E2E that lives in `docs/runbook.md`.

> **What this story is not:** a redesign of the register UI, an introduction of social logins, or a JWT tuning exercise. The role-selector dropdown stays exactly where INF-03 put it (AUTH-02 will harden it). The cookie store, middleware, and `/dashboard` shell are untouched. JWT lifetimes are AUTH-03. KYC gating is AUTH-06. Service-role boundary enforcement is AUTH-05.

---

## 2. Scope

### In scope

- **Supabase Auth configuration (Dashboard + `supabase/config.toml`)** — lock in the production-shaped policy:
  - `password_min_length = 10` (Supabase default is 6; PRD §8.3 demands *short-lived JWT + strong secret*, so a brute-force-resistant password is the complementary lever).
  - `password_required_characters` = `lower,upper,digit` (skip *special* — Moroccan keyboards on mobile vary; cost/benefit poor at MVD scale).
  - `password_hibp_enabled = true` (Have-I-Been-Pwned check via the SHA-1 prefix API — Supabase ships it as a single toggle; cost: one extra ~50 ms RTT per signup, acceptable).
  - `enable_signup = true` (explicit — Supabase has a kill-switch we don't want flipped accidentally).
  - `enable_confirmations = false` for **MVD** (demo-day reality; documented switch-back path in §9).
  - `rate_limit.email_sent = 4` per hour per IP (Supabase Auth's built-in; sits below AUTH-08 NGINX rate-limiting but applies at the auth tier so a misconfigured NGINX doesn't undermine it).
  - `mailer_otp_exp = 3600` (1 h — only matters once `enable_confirmations` is flipped; setting it now means the runbook switch-back is a single boolean).
- **`supabase/config.toml`** — commit the above as the source of truth so `supabase db push` and a green CI replay the policy in a fresh project. Today the file is mostly defaults from INF-02; this story adds the explicit `[auth]` + `[auth.email]` blocks.
- **`frontend/src/app/register/actions.ts`** — keep the existing zod schema; **align** the password floor with Supabase Auth (`min(10).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/)`); **route** every Supabase Auth error code through a new `mapAuthError()` helper; **never** redirect with `error=${error.message}` again.
- **`frontend/src/lib/auth/errors.ts`** — new module. Exports `mapAuthError(error: AuthError | null): AuthErrorKey` and an `AuthErrorKey` union (`"email_taken" | "weak_password" | "rate_limited" | "invalid_input" | "network" | "unknown"`). The mapping is keyed on `error.code` (Supabase Auth v2 ships `error.code` strings like `user_already_exists`, `weak_password`, `over_email_send_rate_limit`) with a fall-through `unknown` for anything new — the unknown branch is **logged** (Sentry breadcrumb) so a future Supabase Auth release that adds a code surfaces in the dashboard instead of dying silently.
- **`frontend/src/app/register/page.tsx`** — read the `error` query param, run it through a small `dictionary[errorKey][locale]` lookup, render the localized message inline above the form. Until I18N-02 lands, the dictionary is a hardcoded French map with `// TODO(i18n) — moved to register.json in I18N-02` markers on every string.
- **Password strength hint UI** — a small, unstyled checklist below the password field (*"≥ 10 caractères"*, *"une majuscule"*, *"un chiffre"*) that toggles green as the user types. Client-side only, purely cosmetic — the real gate is the Supabase Auth setting. Implemented as a single client component, no new dependency.
- **Observability wiring** — `actions.ts` imports `Sentry` from `@sentry/nextjs` (already a dependency since INF-08); on the `unknown` branch of `mapAuthError`, calls `Sentry.captureException(error, { tags: { story: "AUTH-01", auth_error_code: error.code ?? "missing" } })` so the Sentry team-room link routes to the right owner. On every signup attempt — success or failure — it also calls `Sentry.addBreadcrumb({ category: "auth", message: "signup_attempt", data: { email_hash: sha256(email), result } })`. Two PII rules: (a) breadcrumb stores **`email_hash`**, never the email; (b) breadcrumb stores the **mapped error key**, never the raw Supabase message.
- **`frontend/src/lib/auth/email-hash.ts`** — thin wrapper over `crypto.subtle.digest("SHA-256", ...)`. Server-action context only (Node, not Edge), so `node:crypto` would work too — kept as Web Crypto for portability if a future Server Action moves to Edge.
- **`frontend/__tests__/auth/register.test.ts`** — Vitest unit tests:
  - `RegisterSchema` rejects passwords below 10 chars, missing classes, > 72 chars (Supabase Auth's bcrypt ceiling).
  - `RegisterSchema` trims + lowercases the email.
  - `RegisterSchema` rejects role = `"ADMIN"` (the deliberate omission documented in INF-03 §5.5).
  - `mapAuthError({ code: "user_already_exists" })` returns `"email_taken"`.
  - `mapAuthError({ code: "weak_password" })` returns `"weak_password"`.
  - `mapAuthError({ code: "over_email_send_rate_limit" })` returns `"rate_limited"`.
  - `mapAuthError({ code: "made_up_code_from_future" })` returns `"unknown"` and emits a Sentry breadcrumb (asserted via a spy).
- **`db/tests/auth01_trigger.sql`** — a `psql`-driven smoke test that, using the service-role connection (the only way to call `auth.admin.create_user`), inserts a user with each role/locale enum value and confirms `public.profiles` lands with the matching row. Replays the INF-02 §6.4 admin-create path but parameterized over all 9 (role × locale) combinations + 2 negative cases (`role = 'PRESIDENT'` → 22023; `locale = 'tr'` → 22023). Wired into `make -C db verify` as a new target.
- **`docs/runbook.md`** — new "AUTH-01 — signup operational notes" section: the Dashboard switches that mirror `supabase/config.toml`, the procedure to flip `enable_confirmations` ON post-MVD (template setup, Brevo SMTP relay, mailer test), the procedure to force-resend confirmation to a stuck user (`supabase.auth.admin.generateLink`), and the *"a user reports they cannot register"* triage flow.
- **`docs/spring-status.yml`** — flip `AUTH-01.status: TODO → DONE` and append a hand-off line under `project.last_updated` matching the INF-08 entry's shape.

### Out of scope (later stories / explicit deferrals)

- **Role selection UX + business rules** → [AUTH-02](#). The role dropdown is on `/register` today because INF-03 left it there; AUTH-01 does not touch it, AUTH-02 owns it.
- **JWT lifetime + refresh rotation** → [AUTH-03](#). INF-02 set the lifetimes already; AUTH-03 audits + tests them.
- **RLS audit** → [AUTH-04](#) (initial enable, already done in INF-02 §6) + [AUTH-07](#) (full audit suite).
- **Service-key isolation** → [AUTH-05](#). AUTH-01 uses the **anon** key only — the boundary script in INF-05 will fail the build if a service-role key ever appears in `frontend/`.
- **KYC document upload + admin verification** → [AUTH-06](#). `profiles.verification_status` defaults to `'PENDING'` on the row this story creates; AUTH-06 owns the path from `PENDING → VERIFIED`.
- **Magic-link / OAuth (Google, Apple, etc.)** — out of MVD scope; the `/auth/callback` route from INF-03 §5.5 is a placeholder. PRD §5.2 lists *"in-app payments"* and *"native mobile apps"* as deferred — social login follows the same logic: cost of integration > demo-day value.
- **Two-factor authentication / WebAuthn / passkeys** — Supabase Auth supports TOTP MFA; out of MVD scope (PRD §11.1 — 8-week deadline, 3 devs). Phase-5 story.
- **Account lockout after N failed attempts** — Supabase Auth does **not** ship account-level lockout (only per-IP rate limits). AUTH-08 (NGINX `limit_req_zone`) is the MVD answer; a real account-lockout state machine is a post-MVD story.
- **CAPTCHA / Turnstile on the signup form** — PRD §13 R6 *"JWT / brute-force attack"* lists NGINX rate-limiting (AUTH-08) as the mitigation, not CAPTCHA. CAPTCHA is a Phase-5 lever if the rate-limit alone proves insufficient.
- **Signup audit log table** — a `public.auth_events(user_id, event, ip, ua, ts)` write-only table is appealing but redundant: `auth.audit_log_entries` is the Supabase-managed source of truth, and INF-08 Sentry captures the application-side failures. Adding a third sink fragments the on-call story.
- **Account deletion / GDPR delete-my-data** — out of MVD scope; post-MVD legal-compliance story.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-02](INF-02-supabase-project-base-schema.md) `DONE` | The `on_auth_user_created` trigger ([db/migrations/0003_profile_on_signup.sql](../../db/migrations/0003_profile_on_signup.sql)) is the consumer of the metadata this story writes. Without it, `auth.users` rows appear but `public.profiles` stays empty — and every RLS policy keyed on `auth.uid() = profiles.id` blows up. |
| [INF-03](INF-03-nextjs-scaffold-login-dashboard.md) `DONE` | The `/register` route, the `createSupabaseServerClient` helper, the cookies middleware, and the existing zod schema all live here. AUTH-01 patches them — it does not rebuild them. |
| Supabase project access | The `vitachain-prod` project (`qyyxgdfetzjqfpygikbz`, eu-central-1). The §5.1 Dashboard settings are owned by whoever is rotating the project's Bitwarden entry — coordinate before flipping. |
| Bitwarden access | Need the `service_role` key for `db/tests/auth01_trigger.sql` (admin-create path) and the Sentry DSNs (already shipped under INF-08). |
| Local Supabase CLI ≥ 1.200 | Needed to `supabase db push` the `config.toml` changes. The version constraint is the floor at which `[auth.email]` blocks are recognized by the linter. |
| Node 20 LTS + frontend lockfile in sync | New Vitest tests need the existing `vitest` + `@testing-library/react` already pinned by INF-03 §5.1. |
| INF-08 Sentry DSN in `frontend/.env.local` | Without it, the `unknown`-branch capture is a no-op locally — fine for development, but the DoD §8 demands the planted-error drill against staging, which needs the staging DSN. |

---

## 4. Target configuration

| Setting | Value | Source / rationale |
|---|---|---|
| Identity provider | Email + password only | PRD §7.1 AUTH-01. Social / magic-link deferred. |
| Password — min length | **10** characters | Supabase default 6 is below NIST SP 800-63B *"line of credible defence"*; lifting to 10 doubles search space without hurting Moroccan-keyboard UX. |
| Password — required classes | lower, upper, digit | Special chars skipped — see §2. |
| Password — max length | 72 characters | bcrypt truncates at 72; rejecting > 72 client-side prevents the *"my long password silently became my short password"* footgun. |
| Password — HIBP check | ON | Single Supabase Auth toggle; k-anonymity prefix-based, no plaintext password ever leaves the user agent. |
| Email confirmation | **OFF** for MVD | Demo-day robustness; documented switch-back in §9. |
| Signup rate limit | 4 / hour / IP (Supabase) + AUTH-08 NGINX layer when DONE | Defence in depth. |
| Default role on signup | `CITIZEN` (zod schema default; trigger fallback as belt-and-braces) | Lowest-privilege default — promotions go through AUTH-02 + AUTH-06. |
| Default locale on signup | `fr` (PRD §7.2 P0) | Fallback chain owned by I18N-05. |
| Error surface to UI | Mapped error keys (5 + `unknown`) | Stable contract for I18N + QA. |
| Audit trail | `auth.audit_log_entries` (Supabase-managed) + Sentry breadcrumbs (INF-08) | No new audit table. |

---

## 5. Step-by-step implementation

### 5.1 Supabase Dashboard policy

Authenticate to [supabase.com/dashboard](https://supabase.com/dashboard) with the team Google account (`yasseralgoside@gmail.com`). Project = `vitachain-prod` (ref `qyyxgdfetzjqfpygikbz`).

Navigate to **Authentication → Providers → Email**:

| Toggle | Value |
|---|---|
| Enable Email provider | ON |
| Confirm email | **OFF** (MVD — see §9 for post-MVD ON path) |
| Secure email change | ON |
| Secure password change | ON |

Navigate to **Authentication → Policies → Password**:

| Setting | Value |
|---|---|
| Minimum password length | **10** |
| Password requirements | *Lowercase letters, uppercase letters, digits* (uncheck *special characters*) |
| HaveIBeenPwned check | ON |

Navigate to **Authentication → Rate Limits**:

| Setting | Value |
|---|---|
| Sign-ups per hour per IP | **4** |
| Token refreshes per 5 min per IP | 150 (default) |
| OTPs per hour per IP | 30 (default — only meaningful once `enable_confirmations` is ON) |

Save. Verify with the read-only inspector at the bottom of each page.

### 5.2 Codify the policy in `supabase/config.toml`

The Dashboard is the canonical place to apply the settings, but `supabase/config.toml` is the canonical place to **prove** they are applied — CI replays it against a throwaway project to detect drift.

Edit [supabase/config.toml](../../supabase/config.toml):

```toml
[auth]
enable_signup = true
enable_anonymous_sign_ins = false
jwt_expiry = 3600
# Refresh token rotation is owned by AUTH-03; do not touch here.

[auth.email]
enable_signup = true
enable_confirmations = false   # AUTH-01 — flipped ON post-MVD; see docs/runbook.md
double_confirm_changes = true
secure_password_change = true
mailer_otp_exp = 3600

[auth.email.password]
min_length = 10
require_lowercase = true
require_uppercase = true
require_numbers = true
require_special_chars = false
hibp_check = true

[auth.rate_limit]
sign_ups_per_hour = 4
token_refreshes_per_5min = 150
email_sent_per_hour = 30
```

Run:

```bash
supabase db push --linked
```

Confirm there is no diff. The Dashboard and the file now mirror each other.

### 5.3 Frontend — align the zod schema to the server-side policy

Edit [frontend/src/app/register/actions.ts](../../frontend/src/app/register/actions.ts):

```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/auth/errors";
import { hashEmail } from "@/lib/auth/email-hash";
import * as Sentry from "@sentry/nextjs";

const RegisterSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(10, "weak_password")
    .max(72, "weak_password")
    .regex(/[a-z]/, "weak_password")
    .regex(/[A-Z]/, "weak_password")
    .regex(/\d/, "weak_password"),
  // AUTH-02 will harden the role selector; AUTH-01 leaves it as-is from INF-03.
  role: z.enum(["FARMER", "RESTAURANT", "CITIZEN"]),
  locale: z.enum(["fr", "ar", "en"]).default("fr"),
});

export async function registerAction(formData: FormData) {
  const parsed = RegisterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? "invalid_input";
    redirect(`/register?error=${key}`);
  }

  const { full_name, email, password, role, locale } = parsed.data;
  const supabase = await createSupabaseServerClient();

  Sentry.addBreadcrumb({
    category: "auth",
    message: "signup_attempt",
    data: { email_hash: await hashEmail(email) },
    level: "info",
  });

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, role, locale } },
  });

  if (error) {
    const key = mapAuthError(error);
    if (key === "unknown") {
      Sentry.captureException(error, {
        tags: { story: "AUTH-01", auth_error_code: error.code ?? "missing" },
      });
    }
    redirect(`/register?error=${key}`);
  }

  // enable_confirmations = false in MVD → signUp returns a session immediately.
  // The runbook switch-back path (§9) flips this redirect to `/register/check-email`.
  redirect("/dashboard");
}
```

### 5.4 The error-mapping module

Create [frontend/src/lib/auth/errors.ts](../../frontend/src/lib/auth/errors.ts):

```ts
import type { AuthError } from "@supabase/supabase-js";

export type AuthErrorKey =
  | "email_taken"
  | "weak_password"
  | "rate_limited"
  | "invalid_input"
  | "network"
  | "unknown";

/**
 * Maps a Supabase AuthError to a stable, i18n-friendly key.
 * I18N-02 owns the translation; QA asserts on the key, not the message.
 *
 * Keep the switch exhaustive on documented Supabase codes; the `default` branch
 * is the canary — anything unrecognized fires a Sentry event upstream.
 */
export function mapAuthError(error: AuthError | null): AuthErrorKey {
  if (!error) return "unknown";

  switch (error.code) {
    case "user_already_exists":
    case "email_exists":
      return "email_taken";
    case "weak_password":
    case "validation_failed":
      return "weak_password";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "rate_limited";
    case "validation_failed_email":
    case "anonymous_provider_disabled":
      return "invalid_input";
    default:
      // Network-shaped failures don't carry a `code` — Supabase wraps them
      // as AuthRetryableFetchError with `status === 0` or no status at all.
      if (error.status === 0 || error.status === undefined) return "network";
      return "unknown";
  }
}
```

### 5.5 The `email_hash` helper

Create [frontend/src/lib/auth/email-hash.ts](../../frontend/src/lib/auth/email-hash.ts):

```ts
/**
 * SHA-256 of a normalized email — used as a Sentry breadcrumb fingerprint.
 * NEVER store, log, or transmit the raw email alongside the hash.
 */
export async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

### 5.6 Localized error banner on `/register`

Edit [frontend/src/app/register/page.tsx](../../frontend/src/app/register/page.tsx). Add an `error` reader at the top of the component body:

```tsx
import { registerAction } from "./actions";
import type { AuthErrorKey } from "@/lib/auth/errors";

// TODO(i18n) — moved to register.json in I18N-02
const FR: Record<AuthErrorKey, string> = {
  email_taken: "Un compte existe déjà avec cet email.",
  weak_password:
    "Mot de passe trop faible — au moins 10 caractères, avec majuscule, minuscule et chiffre.",
  rate_limited:
    "Trop de tentatives. Veuillez réessayer dans une heure.",
  invalid_input: "Données invalides — vérifiez les champs.",
  network: "Connexion impossible. Vérifiez votre réseau et réessayez.",
  unknown:
    "Une erreur inattendue est survenue. Notre équipe a été notifiée.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: AuthErrorKey }>;
}) {
  const sp = await searchParams;
  const errorMessage = sp.error ? FR[sp.error] ?? FR.unknown : null;

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-6 text-2xl font-semibold">Créer un compte</h1>

      {errorMessage && (
        <div
          role="alert"
          className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {errorMessage}
        </div>
      )}

      <form action={registerAction} className="flex flex-col gap-3">
        {/* …existing inputs unchanged… */}
      </form>
    </main>
  );
}
```

### 5.7 Password-strength hint (client component)

Create [frontend/src/app/register/password-hint.tsx](../../frontend/src/app/register/password-hint.tsx):

```tsx
"use client";
import { useState } from "react";

export default function PasswordHint({ name = "password" }: { name?: string }) {
  const [v, setV] = useState("");
  const rules = [
    { ok: v.length >= 10, label: "≥ 10 caractères" },
    { ok: /[a-z]/.test(v), label: "une minuscule" },
    { ok: /[A-Z]/.test(v), label: "une majuscule" },
    { ok: /\d/.test(v), label: "un chiffre" },
  ];
  return (
    <div className="flex flex-col gap-1">
      <input
        name={name}
        type="password"
        placeholder="Mot de passe"
        className="rounded border p-2"
        minLength={10}
        maxLength={72}
        required
        onChange={(e) => setV(e.target.value)}
      />
      <ul className="text-xs">
        {rules.map((r) => (
          <li
            key={r.label}
            className={r.ok ? "text-emerald-700" : "text-neutral-500"}
          >
            {r.ok ? "✓" : "·"} {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Replace the existing password `<input>` in `register/page.tsx` with `<PasswordHint />`.

### 5.8 Tests

Create [frontend/__tests__/auth/register.test.ts](../../frontend/__tests__/auth/register.test.ts):

```ts
import { describe, expect, it, vi } from "vitest";
import { mapAuthError } from "@/lib/auth/errors";

describe("RegisterSchema", () => {
  // Re-export the schema from actions.ts as `export const RegisterSchema` for testability.
  // (Pure data — Server-Action wrapper around it is what carries the "use server".)
  const { RegisterSchema } = require("@/app/register/actions");

  it("rejects passwords below 10 chars", () => {
    const r = RegisterSchema.safeParse({
      full_name: "Ahmed Tazi",
      email: "a@b.co",
      password: "Abcd123!",
      role: "FARMER",
      locale: "fr",
    });
    expect(r.success).toBe(false);
  });

  it("rejects ADMIN role on self-signup", () => {
    const r = RegisterSchema.safeParse({
      full_name: "Bad Actor",
      email: "a@b.co",
      password: "Abcdefg123",
      role: "ADMIN",
      locale: "fr",
    });
    expect(r.success).toBe(false);
  });

  it("trims and lowercases email", () => {
    const r = RegisterSchema.parse({
      full_name: "Y",
      email: "  YAS@example.COM ",
      password: "Abcdefghi1",
      role: "CITIZEN",
      locale: "fr",
    });
    expect(r.email).toBe("yas@example.com");
  });
});

describe("mapAuthError", () => {
  it("recognizes user_already_exists", () => {
    expect(mapAuthError({ code: "user_already_exists" } as any)).toBe(
      "email_taken",
    );
  });
  it("recognizes weak_password", () => {
    expect(mapAuthError({ code: "weak_password" } as any)).toBe(
      "weak_password",
    );
  });
  it("recognizes rate_limit codes", () => {
    expect(
      mapAuthError({ code: "over_email_send_rate_limit" } as any),
    ).toBe("rate_limited");
  });
  it("falls back to network on status=0", () => {
    expect(mapAuthError({ status: 0 } as any)).toBe("network");
  });
  it("falls back to unknown for unrecognized code", () => {
    expect(
      mapAuthError({ code: "made_up_future_code", status: 500 } as any),
    ).toBe("unknown");
  });
});
```

### 5.9 DB-side trigger smoke

Create [db/tests/auth01_trigger.sql](../../db/tests/auth01_trigger.sql):

```sql
-- AUTH-01 — exhaustive trigger coverage for handle_new_user().
-- Runs under the service-role connection (psql with SUPABASE_DB_URL DIRECT :5432).
-- Each block creates a user via auth.admin internals, asserts profile shape,
-- cleans up. A NOTICE is emitted per block; failure raises and aborts the txn.

begin;

do $$
declare
    role_v   public.user_role;
    locale_v public.locale_code;
    uid      uuid;
    p        record;
begin
    foreach role_v in array array['FARMER','RESTAURANT','CITIZEN','ADMIN']::public.user_role[] loop
        foreach locale_v in array array['fr','ar','en']::public.locale_code[] loop
            uid := gen_random_uuid();
            insert into auth.users (id, email, raw_user_meta_data, encrypted_password, email_confirmed_at)
            values (uid,
                    format('auth01-%s@test.local', uid),
                    jsonb_build_object('full_name','T', 'role', role_v::text, 'locale', locale_v::text),
                    crypt('Abcdefg123', gen_salt('bf')),
                    now());

            select * into p from public.profiles where id = uid;
            if p is null then
                raise exception 'profile missing for role=% locale=%', role_v, locale_v;
            end if;
            if p.role <> role_v or p.locale <> locale_v then
                raise exception 'profile mismatch role=% locale=%', role_v, locale_v;
            end if;

            delete from auth.users where id = uid;
            raise notice 'OK role=% locale=%', role_v, locale_v;
        end loop;
    end loop;
end$$;

-- Negative — bad role rejected with 22023.
do $$
begin
    begin
        insert into auth.users (id, email, raw_user_meta_data, encrypted_password)
        values (gen_random_uuid(), 'bad-role@test.local',
                jsonb_build_object('role','PRESIDENT'), crypt('Abcdefg123', gen_salt('bf')));
        raise exception 'expected 22023, got success';
    exception when invalid_parameter_value then
        raise notice 'OK negative role';
    end;
end$$;

-- Negative — bad locale rejected with 22023.
do $$
begin
    begin
        insert into auth.users (id, email, raw_user_meta_data, encrypted_password)
        values (gen_random_uuid(), 'bad-locale@test.local',
                jsonb_build_object('role','CITIZEN', 'locale','tr'),
                crypt('Abcdefg123', gen_salt('bf')));
        raise exception 'expected 22023, got success';
    exception when invalid_parameter_value then
        raise notice 'OK negative locale';
    end;
end$$;

rollback;
```

Wire into [db/Makefile](../../db/Makefile):

```make
.PHONY: test-auth01
test-auth01:
	psql "$$SUPABASE_DB_URL" -v ON_ERROR_STOP=on -f tests/auth01_trigger.sql

verify:: test-auth01   # appends to the existing verify target chain
```

---

## 6. Verification

Run, in order, on a clean working tree:

```bash
# 1. Config drift check
supabase db push --linked --dry-run            # MUST report "no changes to apply"

# 2. Frontend tests
cd frontend && npm run test -- register.test  # MUST pass 7/7

# 3. Frontend typecheck + lint
npm run typecheck && npm run lint

# 4. DB trigger smoke (uses Bitwarden SUPABASE_DB_URL DIRECT :5432, NOT pooler)
make -C db test-auth01                         # MUST emit OK lines + "ROLLBACK"

# 5. Manual happy path against staging
#    (a) Open https://staging.vitachain.ma/register
#    (b) Submit: full_name=Test, email=auth01-$(date +%s)@vitachain.ma,
#        password=Aaaaaaaaa1, role=CITIZEN
#    (c) Expect 302 → /dashboard with the welcome shell rendering
#    (d) In Supabase Dashboard → Auth → Users, confirm the row exists
#        AND public.profiles has a matching row with role=CITIZEN, locale=fr,
#        verification_status=PENDING

# 6. Manual abuse paths
#    (a) Re-submit the same email → /register?error=email_taken; banner reads
#        "Un compte existe déjà avec cet email."
#    (b) Submit password "abc12345" → /register?error=weak_password
#    (c) Submit 5 fresh emails from the same IP within 60 min → 5th attempt
#        returns /register?error=rate_limited

# 7. Sentry plumbing
#    (a) Confirm the staging Sentry project shows one breadcrumb per signup
#        attempt with category=auth, message=signup_attempt, email_hash=<sha256>.
#    (b) Submit with a made-up password that triggers a 500 from Supabase
#        (e.g. force-disable email provider in Dashboard for 30s, retry) and
#        confirm one Sentry Issue lands tagged story=AUTH-01.
```

---

## 7. Risks & failure modes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Dashboard ↔ `config.toml` drift** | Medium — easy for an operator to flip a Dashboard toggle and forget to commit. | Medium — silent policy weakening (e.g. min-length back to 6). | The `supabase db push --dry-run` step in §6 is the canary. INF-05 CI replays it on every push. |
| **HIBP check latency spike** | Low — Cloudflare-fronted, but a region-local outage has happened. | Low — signup latency goes from ~300 ms to several seconds. | Supabase's HIBP integration is fail-open by design (returns "not breached" on timeout). Document in runbook so an operator doesn't chase a non-existent latency bug. |
| **Email-already-exists enumeration** | Medium — `email_taken` discloses presence. | Low — for an MVD anti-waste platform, account enumeration is not a critical threat vector; the trade-off is UX clarity. | Accept. Documented. Post-MVD: switch to *"if this address is registered, we sent an email"* once `enable_confirmations` is ON. |
| **Trigger 22023 surfaced as `unknown`** | Low — would only fire if a future migration touches the trigger. | Medium — a real user sees the *"unexpected error"* banner. | The `auth01_trigger.sql` exhaustive test catches this on every push to `db/`. |
| **Local dev breaks because Sentry DSN missing** | High during onboarding. | Low — `Sentry.captureException` is a no-op when init was skipped (INF-08 §3 guard). | The INF-08 init code already early-returns on `environment in ("dev","ci")`; reaffirm in the AUTH-01 PR description. |
| **Race: two POSTs to `/register` with the same email** | Low — humans don't double-tap that fast, but bots do. | Low — `auth.users.email` is UNIQUE; second insert returns `23505` → `user_already_exists` → `email_taken`. | Already handled by Postgres + the mapping table. |

---

## 8. Definition of Done

- [ ] [supabase/config.toml](../../supabase/config.toml) contains the `[auth]` + `[auth.email]` + `[auth.email.password]` + `[auth.rate_limit]` blocks per §5.2 and `supabase db push --dry-run` reports no diff.
- [ ] [frontend/src/app/register/actions.ts](../../frontend/src/app/register/actions.ts) routes every Supabase Auth error through `mapAuthError` and never redirects with `error=${error.message}`.
- [ ] [frontend/src/lib/auth/errors.ts](../../frontend/src/lib/auth/errors.ts) and [frontend/src/lib/auth/email-hash.ts](../../frontend/src/lib/auth/email-hash.ts) exist and are imported only from the auth path.
- [ ] [frontend/__tests__/auth/register.test.ts](../../frontend/__tests__/auth/register.test.ts) is green on `npm run test` — 7 assertions minimum, covering each `AuthErrorKey` branch and the schema's negative cases.
- [ ] [db/tests/auth01_trigger.sql](../../db/tests/auth01_trigger.sql) is green on `make -C db test-auth01` against the live `qyyxgdfetzjqfpygikbz` project (service-role connection).
- [ ] Manual signup against staging produces the expected `auth.users` + `public.profiles` rows.
- [ ] Each of the three abuse paths (duplicate email, weak password, rate limit) renders the right localized banner.
- [ ] INF-08 Sentry project shows one `category=auth` breadcrumb per signup attempt and one Issue for any `unknown`-branch error, tagged `story=AUTH-01`.
- [ ] [docs/runbook.md](../runbook.md) has the *"AUTH-01 — signup operational notes"* section with the switch-back-to-`enable_confirmations` walkthrough.
- [ ] [docs/spring-status.yml](../spring-status.yml) flipped `AUTH-01.status: TODO → DONE`, `summary.done` incremented, `summary.todo` decremented, hand-off line under `project.last_updated`.

---

## 9. Post-MVD switch-back: `enable_confirmations = true`

When the demo is over and the platform takes real users, flip confirmations ON. The procedure (also in [docs/runbook.md](../runbook.md)):

1. In Supabase Dashboard → **Authentication → Providers → Email** → toggle *"Confirm email"* ON.
2. Mirror in [supabase/config.toml](../../supabase/config.toml): `enable_confirmations = true`. Commit + push.
3. Switch [frontend/src/app/register/actions.ts](../../frontend/src/app/register/actions.ts) success-redirect from `/dashboard` to a new `/register/check-email` page (one new server-rendered page with localized copy *"Vérifiez votre boîte mail."*).
4. Configure the SMTP relay — **Project Settings → Auth → SMTP Settings** — point to Brevo (`smtp-relay.brevo.com:587`, the team Brevo SMTP user from Bitwarden). Until then, Supabase uses its low-throughput shared mail server and signups will silently fail past ~3/hour.
5. Customize the **Authentication → Email Templates → Confirm signup** template — paste the FR/AR/EN variants from the (then-existing) I18N-02 catalogs. The redirect URL is `https://vitachain.ma/auth/callback?next=/dashboard` — the route from INF-03 §5.5 already exchanges the code for a session.
6. Test from staging: register a fresh email, expect a real email in Brevo's logs, click the link, expect `/dashboard`.
7. Update [docs/spring-status.yml](../spring-status.yml) hand-off log.

---

## 10. Hand-off notes

- **For AUTH-02 (role assignment):** the `RegisterSchema.role` field is the contract. AUTH-02 will: (a) move the role enum to `frontend/src/lib/auth/roles.ts` as a single source of truth, (b) re-style the `<select>` as a three-button group with role descriptions, (c) add a server-side recheck of role allowability now that `auth.users` ↔ `profiles` exists, (d) audit the path for ADMIN escalation — the mapping `role: z.enum(["FARMER","RESTAURANT","CITIZEN"])` deliberately excludes `ADMIN`; AUTH-02 must keep that exclusion and add a test that `role=ADMIN` is rejected with `invalid_input`.
- **For AUTH-06 (KYC-lite):** every row this story writes has `verification_status = 'PENDING'`. The KYC queue is *"all profiles where role in ('FARMER','RESTAURANT') and verification_status = 'PENDING'"*. The `CITIZEN` role is exempt (PRD §6.4 — citizens reserve, they don't sell).
- **For I18N-02 (French catalog):** the hardcoded FR dictionary in `register/page.tsx` and the `// TODO(i18n)` markers in `password-hint.tsx` are the migration targets. The `AuthErrorKey` type is the catalog's key set.
- **For QG-04 / QG-05 (load test):** the §5.1 rate limit of 4 signups/hour/IP is the floor on what a single-source load test can exercise. The load test should source from at least 13 IPs to drive 50 signups/hour without tripping the limit, or temporarily relax to 100/hour during the run and restore after. The relax-and-restore script lives in `infra/scripts/load-test-relax.sh` (Phase-3 story).

---

*AUTH-01 implementation guide — generated under BMAD methodology — references PRD §7.1 and `docs/spring-status.yml` lines 434–439.*
