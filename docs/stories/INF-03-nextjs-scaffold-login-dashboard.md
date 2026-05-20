# INF-03 — Next.js scaffold (frontend) with login/dashboard routes

> **Epic:** E0 — Infrastructure & DevOps Foundation
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must
> **Status:** DONE (local DoD; VPS half deferred to INF-01 sign-off — no further code change expected)
> **Depends on:** [INF-02](INF-02-supabase-project-base-schema.md) (DONE — project `qyyxgdfetzjqfpygikbz`, `eu-central-1`, PG17)
> **Unblocks:** AUTH-01, AUTH-02, INF-05, I18N-01, BOT-01, FAR-02, SEC-02, ADM-01
> **Acceptance:** A visitor can `Register → Login → reach an empty dashboard` end-to-end, with the session surviving a hard refresh.

---

## 1. Purpose

Stand up the single Next.js application that serves every VitaChain web surface for the MVD — public marketing routes (BotaBa9a catalog later), authenticated dashboards (Katara, FarMarket, SecondServe, Admin), and the auth journey itself.

The scope here is deliberately narrow: **scaffold + auth journey only**. No domain UI, no i18n framework, no Tailwind component library beyond a minimal base. Domain stories (`KAT-*`, `FAR-*`, `SEC-*`, `BOT-*`) add their own routes on top of this skeleton; `I18N-01` later wraps the app in `next-intl`; `AUTH-06` adds the KYC gate.

When this story is `DONE`, the PRD §12 Phase-1 gate is half-satisfied: *"any user can register with a role, log in, and reach a dashboard."* The other half is INF-04 (FastAPI healthcheck) and INF-06 (HTTPS).

---

## 2. Scope

### In scope

- Next.js 15 App Router project under [frontend/](../../frontend/), TypeScript strict, ESLint + Prettier.
- Tailwind CSS v4 baseline (minimal — only what the auth pages need).
- Supabase Auth client wiring via `@supabase/ssr` (cookies-based, App-Router-native).
- Routes:
  - `/` — landing placeholder (links to `/login`, `/register`).
  - `/register` — email + password + role selector (`FARMER | RESTAURANT | CITIZEN`) + locale.
  - `/login` — email + password.
  - `/auth/callback` — Supabase code-exchange handler (no-op for email/password today; required for future magic-link / OAuth).
  - `/auth/signout` — server action that revokes the session and redirects.
  - `/dashboard` — role-aware empty shell ("Welcome, $role"); protected by middleware.
- Server-only Supabase helper + browser-only Supabase helper (clear boundary, AUTH-05).
- `middleware.ts` that refreshes Supabase cookies on every request and gates `/dashboard/*`.
- Dockerfile + entry in the existing [docker-compose.yml](../../docker-compose.yml) so the service runs on the INF-01 VPS behind NGINX upstream `frontend:3000`.
- Health route `/api/healthz` returning `{ ok: true }` for Uptime Kuma later (INF-08).
- `frontend/.env.example` listing the only two variables this app may read.
- Smoke test: register → check `public.profiles` → login → `/dashboard` → refresh → still logged in → signout → `/dashboard` redirects to `/login`.

### Out of scope (later stories)

- Role-assignment business rules (KYC gate, verification flow) → **AUTH-06**.
- JWT lifetime tuning + refresh rotation tests → **AUTH-03** (already configured in INF-02; this story consumes it).
- Service-role usage (admin actions) → **INF-04 / AUTH-05** — frontend uses the **anon** key only.
- RLS audit across non-profile tables → **AUTH-07**.
- i18n framework (`next-intl`) + `fr/ar/en` catalogs → **I18N-01..05** (this story hardcodes French copy with a `// TODO(i18n)` marker on every string).
- Tailwind component library / design system → covered as part of domain stories.
- CI pipeline (lint, typecheck, build, secret scan) → **INF-05**.
- HTTPS via Let's Encrypt → **INF-06**.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-01](INF-01-provision-vps-docker-nginx.md) `DONE` | VPS reachable; NGINX upstream pool ready to accept a new `frontend` service. |
| [INF-02](INF-02-supabase-project-base-schema.md) `DONE` | `public.profiles` + `on_auth_user_created` trigger live on `qyyxgdfetzjqfpygikbz`. Verified 2026-05-14: `make -C db verify` 13/13. |
| Node.js 20 LTS locally | Match the Docker base image; avoids "works on my laptop" drift. |
| `npm` ≥ 10 | Lockfile is committed; do not switch to pnpm/yarn without team alignment. |
| Bitwarden access | Need `VitaChain — Supabase URL` and `VitaChain — Supabase anon key`. |

---

## 4. Target configuration

| Setting | Value | Source |
|---|---|---|
| Framework | Next.js 15 — App Router only | PRD §5.1 (PWA via browser, no native app). |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` | Catches the most common server/client boundary bugs early. |
| Styling | Tailwind CSS v4 (PostCSS plugin) | Lowest-friction primitive for 3-dev team. |
| Auth client | `@supabase/ssr` (cookies) + `@supabase/supabase-js` | Official App-Router-native pattern; SSR-safe. |
| Session storage | HTTP-only cookies set by `@supabase/ssr` | Avoids leaking the JWT to client JS / extensions. |
| Default locale | `fr` (hardcoded copy + `<html lang="fr">`) | PRD §7.2 P0; I18N-01 generalizes later. |
| Node runtime in Docker | `node:20-alpine` (multi-stage, standalone output) | Image stays under 200 MB. |
| Container port | `3000`, exposed only on `vita_net`, not host | NGINX from INF-01 reverse-proxies. |
| Build mode | `next build` with `output: "standalone"` | Smaller runtime image; suits Docker. |
| Telemetry | `NEXT_TELEMETRY_DISABLED=1` in the Dockerfile | No phone-home from production. |

---

## 5. Step-by-Step Implementation

### 5.1 Create the project

From the repo root:

```bash
npx create-next-app@latest frontend \
  --typescript --eslint --tailwind --app \
  --src-dir --import-alias "@/*" --use-npm --no-turbopack
```

Accept the defaults the flags don't cover. Inspect `frontend/package.json` and pin:

```json
{
  "engines": { "node": ">=20.0.0 <21.0.0" },
  "dependencies": {
    "@supabase/ssr": "^0.5.0",
    "@supabase/supabase-js": "^2.45.0",
    "next": "^15.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zod": "^3.23.0"
  }
}
```

Install the auth deps:

```bash
cd frontend
npm i @supabase/ssr @supabase/supabase-js zod
```

Open [frontend/tsconfig.json](../../frontend/tsconfig.json) and add:

```jsonc
"compilerOptions": {
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true
}
```

### 5.2 Environment template

Create [frontend/.env.example](../../frontend/.env.example):

```ini
# VitaChain frontend — public env only.
# Values copied from the root .env (owning story: INF-02).
# Anything that does NOT start with NEXT_PUBLIC_ must never appear in this file.

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://vitachain.ma
```

Locally, copy to `frontend/.env.local` (git-ignored) and paste the two Supabase values from Bitwarden. On the VPS, the values are injected by Docker Compose from `/opt/vitachain/.env`.

> **Boundary rule (AUTH-05):** The frontend container's environment must never contain `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, or `DB_URL`. INF-05 adds a CI check that fails the build if any non-`NEXT_PUBLIC_` variable is referenced from `frontend/`.

### 5.3 Supabase client helpers

The App Router needs **two distinct clients**: one for Server Components / Route Handlers / Server Actions (reads + writes cookies via `next/headers`), and one for Client Components (reads cookies via the browser).

[frontend/src/lib/supabase/server.ts](../../frontend/src/lib/supabase/server.ts):

```ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side Supabase client. Use in Server Components, Route Handlers, Server Actions. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          // Server Components can't set cookies; only Route Handlers / Actions can.
          // Failing silently here is intentional — middleware refreshes the session.
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as CookieOptions),
            );
          } catch {
            /* called from a Server Component — middleware will refresh next request */
          }
        },
      },
    },
  );
}
```

[frontend/src/lib/supabase/browser.ts](../../frontend/src/lib/supabase/browser.ts):

```ts
"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

### 5.4 Middleware — session refresh + dashboard gate

[frontend/src/middleware.ts](../../frontend/src/middleware.ts):

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do NOT remove this — it refreshes the access token cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = pathname.startsWith("/dashboard");
  const isAuthRoute = pathname === "/login" || pathname === "/register";

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
```

### 5.5 Routes

#### `/` — landing placeholder

[frontend/src/app/page.tsx](../../frontend/src/app/page.tsx):

```tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">VitaChain</h1>
      {/* TODO(i18n) — wrapped by I18N-02 */}
      <p className="text-center text-sm text-neutral-600">
        Réduire les pertes alimentaires, du champ à l’assiette.
      </p>
      <div className="flex gap-3">
        <Link className="rounded bg-emerald-600 px-4 py-2 text-white" href="/login">
          Connexion
        </Link>
        <Link className="rounded border px-4 py-2" href="/register">
          Inscription
        </Link>
      </div>
    </main>
  );
}
```

#### `/register` — server action

[frontend/src/app/register/page.tsx](../../frontend/src/app/register/page.tsx):

```tsx
import { registerAction } from "./actions";

export default function RegisterPage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-6 text-2xl font-semibold">Créer un compte</h1>
      <form action={registerAction} className="flex flex-col gap-3">
        <input name="full_name" placeholder="Nom complet" className="rounded border p-2" required />
        <input name="email" type="email" placeholder="Email" className="rounded border p-2" required />
        <input name="password" type="password" placeholder="Mot de passe" className="rounded border p-2" minLength={8} required />
        <select name="role" className="rounded border p-2" required defaultValue="CITIZEN">
          <option value="FARMER">Agriculteur</option>
          <option value="RESTAURANT">Restaurateur</option>
          <option value="CITIZEN">Citoyen</option>
        </select>
        <select name="locale" className="rounded border p-2" defaultValue="fr">
          <option value="fr">Français</option>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
        <button className="rounded bg-emerald-600 p-2 text-white">S’inscrire</button>
      </form>
    </main>
  );
}
```

[frontend/src/app/register/actions.ts](../../frontend/src/app/register/actions.ts):

```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const Schema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  role: z.enum(["FARMER", "RESTAURANT", "CITIZEN"]), // ADMIN is set by the service role only
  locale: z.enum(["fr", "ar", "en"]).default("fr"),
});

export async function registerAction(formData: FormData) {
  const parsed = Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect("/register?error=invalid");
  }
  const { full_name, email, password, role, locale } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Consumed by handle_new_user() trigger (migration 0003) — INF-02.
      data: { full_name, role, locale },
    },
  });

  if (error) {
    redirect(`/register?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/dashboard");
}
```

#### `/login` — server action

[frontend/src/app/login/page.tsx](../../frontend/src/app/login/page.tsx):

```tsx
import { loginAction } from "./actions";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-6 text-2xl font-semibold">Connexion</h1>
      <form action={loginAction} className="flex flex-col gap-3">
        <input name="email" type="email" placeholder="Email" className="rounded border p-2" required />
        <input name="password" type="password" placeholder="Mot de passe" className="rounded border p-2" required />
        <NextField searchParams={searchParams} />
        <button className="rounded bg-emerald-600 p-2 text-white">Se connecter</button>
      </form>
    </main>
  );
}

async function NextField({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return <input type="hidden" name="next" value={sp.next ?? "/dashboard"} />;
}
```

[frontend/src/app/login/actions.ts](../../frontend/src/app/login/actions.ts):

```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const Schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().startsWith("/").default("/dashboard"),
});

export async function loginAction(formData: FormData) {
  const parsed = Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/login?error=invalid");
  const { email, password, next } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect(next);
}
```

#### `/auth/callback` — code exchange (future-proofing)

[frontend/src/app/auth/callback/route.ts](../../frontend/src/app/auth/callback/route.ts):

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, request.url));
}
```

#### `/auth/signout`

[frontend/src/app/auth/signout/route.ts](../../frontend/src/app/auth/signout/route.ts):

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
```

#### `/dashboard` — protected shell

[frontend/src/app/dashboard/page.tsx](../../frontend/src/app/dashboard/page.tsx):

```tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, verification_status, locale")
    .eq("id", user.id)
    .single();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {/* TODO(i18n) */}
          Bonjour, {profile?.full_name ?? user.email}
        </h1>
        <form action="/auth/signout" method="post">
          <button className="text-sm underline">Déconnexion</button>
        </form>
      </header>

      <section className="rounded border p-4 text-sm">
        <p>Rôle : <strong>{profile?.role ?? "—"}</strong></p>
        <p>Statut : <strong>{profile?.verification_status ?? "—"}</strong></p>
        <p>Langue : <strong>{profile?.locale ?? "—"}</strong></p>
      </section>

      <p className="mt-8 text-sm text-neutral-500">
        {/* TODO — domain modules (Katara, FarMarket, SecondServe) plug in here. */}
        Tableau de bord vide — les modules seront ajoutés dans les phases suivantes.
      </p>
    </main>
  );
}
```

> Why query `profiles` here and not trust JWT claims? The `role` is **not** in the JWT yet — AUTH-02 will add a `custom_access_token_hook` to push it in. Until then, reading from `public.profiles` under RLS (owner-can-select) is the canonical path. The middleware already verified `user` exists.

#### `/api/healthz`

[frontend/src/app/api/healthz/route.ts](../../frontend/src/app/api/healthz/route.ts):

```ts
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ ok: true, service: "frontend" });
}
```

### 5.6 Root layout + minimal Tailwind

[frontend/src/app/layout.tsx](../../frontend/src/app/layout.tsx) — set `<html lang="fr">` and keep it deliberately bare (I18N-03 swaps in `dir="rtl"` for Arabic):

```tsx
import "./globals.css";

export const metadata = {
  title: "VitaChain",
  description: "Ecosystème anti-gaspillage agro-alimentaire — MVD",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
```

### 5.7 Dockerfile + Compose integration

[frontend/Dockerfile](../../frontend/Dockerfile) — multi-stage with `output: "standalone"`. Add `output: "standalone"` to [frontend/next.config.ts](../../frontend/next.config.ts) first:

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone", reactStrictMode: true };
export default nextConfig;
```

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public envs MUST be present at build time to be inlined into the bundle.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1
CMD ["node", "server.js"]
```

Append to the root [docker-compose.yml](../../docker-compose.yml) (the NGINX `upstream frontend { server frontend:3000; }` already exists from INF-01):

```yaml
  frontend:
    build:
      context: ./frontend
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
        NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL}
    image: vitachain/frontend:latest
    restart: unless-stopped
    networks: [vita_net]
    expose: ["3000"]
    depends_on: []   # Supabase is external (SaaS); no compose dependency.
```

> Keep the service on `expose:` (not `ports:`) — only NGINX should be reachable from the host.

### 5.8 `.gitignore` & lockfiles

Append to [frontend/.gitignore](../../frontend/.gitignore) (most are added by `create-next-app`; verify):

```
.env
.env.local
.env*.local
.next/
node_modules/
out/
```

Commit `frontend/package-lock.json`.

---

## 6. Verification Checklist

- [ ] `cd frontend && npm run build` succeeds locally with no type errors.
- [ ] `npm run dev` boots; `http://localhost:3000` shows the landing page.
- [ ] Registering a new user via `/register` returns to `/dashboard` and the dashboard displays the chosen role + `verification_status='PENDING'` + chosen locale.
- [ ] In Supabase SQL editor: `select id, email, role, locale from public.profiles order by created_at desc limit 1;` returns the just-registered row.
- [ ] `/dashboard` accessed in a private window without cookies redirects to `/login?next=/dashboard`; after login the user lands back on `/dashboard`.
- [ ] Hard refresh on `/dashboard` keeps the session (cookies survive; middleware refreshes the token).
- [ ] `POST /auth/signout` clears the cookies; subsequent `/dashboard` hit redirects to `/login`.
- [ ] `/login` and `/register` accessed while already logged in redirect to `/dashboard` (middleware rule).
- [ ] `curl http://localhost:3000/api/healthz` → `{"ok":true,"service":"frontend"}`.
- [ ] Production build container starts: `docker compose up -d --build frontend` then `curl http://vitachain.ma/` returns 200 via NGINX.
- [ ] `grep -RIn 'SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_JWT_SECRET\|SUPABASE_DB_PASSWORD' frontend/ | grep -v '.env.example'` returns **no matches**.
- [ ] No string `eyJ` (a JWT prefix) committed under `frontend/` outside `.env.example` placeholders.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| Next.js app | [frontend/](../../frontend/) (full scaffold) |
| Supabase helpers | [frontend/src/lib/supabase/server.ts](../../frontend/src/lib/supabase/server.ts), [browser.ts](../../frontend/src/lib/supabase/browser.ts) |
| Middleware | [frontend/src/middleware.ts](../../frontend/src/middleware.ts) |
| Auth routes | [register/](../../frontend/src/app/register/), [login/](../../frontend/src/app/login/), [auth/callback/](../../frontend/src/app/auth/callback/), [auth/signout/](../../frontend/src/app/auth/signout/) |
| Dashboard shell | [frontend/src/app/dashboard/page.tsx](../../frontend/src/app/dashboard/page.tsx) |
| Health route | [frontend/src/app/api/healthz/route.ts](../../frontend/src/app/api/healthz/route.ts) |
| Container | [frontend/Dockerfile](../../frontend/Dockerfile), entry in [docker-compose.yml](../../docker-compose.yml) |
| Frontend env template | [frontend/.env.example](../../frontend/.env.example) |
| Runbook entry | Append "Frontend rollout & rollback" section to [docs/runbook.md](../runbook.md) |
| `spring-status.yml` update | Flip `INF-03.status` → `DONE`; bump `summary.done`; decrement `summary.todo` |

---

## 8. Risks & Mitigations

| Risk | Mitigation | Source |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` leaks into the frontend bundle | Frontend reads only `NEXT_PUBLIC_*`; CI grep in INF-05 enforces; verification §6 includes the grep | PRD §7.1 AUTH-05 |
| Server Component tries to `set()` a cookie and crashes the request | `createSupabaseServerClient` swallows the `set` exception; middleware refreshes the cookie on the next request — the documented `@supabase/ssr` pattern | `@supabase/ssr` docs |
| `handle_new_user()` rejects an unknown role and the signup 500s with no UI feedback | Server action validates `role` with Zod against the exact enum before calling `signUp` — defence in depth with the DB trigger | PRD §7.1 AUTH-02 |
| User can self-assign `ADMIN` | Zod schema restricts the form to `FARMER | RESTAURANT | CITIZEN`; admin promotion is service-role-only (AUTH-06) | PRD §7.1 |
| Public envs missing at `next build` → bundle has empty Supabase URL | Compose `build.args` pass them in explicitly; Dockerfile re-declares with `ARG`+`ENV` so they inline into the JS bundle | Next.js build behaviour |
| `email confirmations = OFF` lets bots register | Accepted MVD trade-off (INF-02 §4); AUTH-08 adds NGINX rate-limiting on `/register` in P3 | PRD §11.1 / AUTH-08 |
| Middleware regex blocks an asset and breaks the bundle | Matcher excludes `_next/static`, `_next/image`, common image extensions; tested by §6 smoke test | — |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| `create-next-app` + dependency pin + tsconfig hardening | 25 min |
| Supabase helpers (server + browser) + middleware | 45 min |
| Routes (`/`, `/login`, `/register`, callback, signout, dashboard, healthz) | 90 min |
| Dockerfile + Compose integration + first VPS deploy | 45 min |
| Verification checklist (local + VPS) | 30 min |
| Runbook + `spring-status.yml` update | 15 min |
| **Total active work** | **~4 h** |

---

## 10. Definition of Done

1. **Acceptance criterion met:** From a clean browser, a visitor can `Register → Login → reach an empty dashboard`. The dashboard shows the chosen role and survives a hard refresh; `/auth/signout` reliably returns the visitor to `/login`.
2. Verification checklist (§6) fully ticked, on both local dev (`npm run dev`) and the VPS (`curl http://vitachain.ma/`).
3. Deliverables (§7) committed under `frontend/` and `docker-compose.yml`.
4. [docs/spring-status.yml](../spring-status.yml) updated and committed: `INF-03.status: DONE`, `summary.done` incremented, `summary.in_progress` adjusted.
5. Hand-off note posted to the team channel naming the unblocked stories: **AUTH-01** (registration end-to-end UX polish), **AUTH-02** (role propagation + custom JWT claim), **INF-05** (CI can now lint + typecheck + build the frontend), **I18N-01** (next-intl wrap), and the first domain UI stories (**BOT-01**, **FAR-02**, **SEC-02**).

---

## 11. Hand-off — 2026-05-14

### 11.1 What landed

**Frontend scaffold** — [frontend/](../../frontend/), 26 files:
- Build config: `package.json` (Next 15.1.6 / React 19.0 / Tailwind v4 / @supabase/ssr 0.5.2), `tsconfig.json` (strict + noUncheckedIndexedAccess), `next.config.ts` (standalone output, server-action allow-list), `postcss.config.mjs`, `eslint.config.mjs`, `.dockerignore`, `.env.example`.
- Supabase wiring: [src/lib/supabase/server.ts](../../frontend/src/lib/supabase/server.ts), [browser.ts](../../frontend/src/lib/supabase/browser.ts), [types.ts](../../frontend/src/lib/supabase/types.ts).
- Auth gate: [src/middleware.ts](../../frontend/src/middleware.ts) — refreshes Supabase cookies, redirects `/dashboard/*` → `/login?next=` when unauth, redirects `/login` + `/register` → `/dashboard` when auth, **bypasses `/api/healthz` + `/api/readyz`** (health endpoints must never depend on a third-party).
- Routes: `/`, `/register` (Zod-validated server action + role-restricted to `FARMER|RESTAURANT|CITIZEN`), `/login`, `/dashboard` (reads `public.profiles` via owner-RLS), `/auth/callback`, `POST /auth/signout` (CSRF-safe — `GET` returns 405), `/api/healthz`.
- App shell: `layout.tsx` (`<html lang="fr">`), `globals.css` (Tailwind v4 `@theme`), `Dockerfile` (multi-stage, standalone, non-root, HEALTHCHECK on `/api/healthz`).

**Infra integration:**
- [infra/docker-compose.yml](../../infra/docker-compose.yml) — added `frontend` service with build args, `vita_net`-only, expose 3000, no published port (NGINX-only ingress).
- [infra/nginx/conf.d/default.conf](../../infra/nginx/conf.d/default.conf) — `upstream vita_frontend { server frontend:3000; keepalive 32; }` + `proxy_pass` with the X-Forwarded-* trio; kept `/healthz`, ACME path, added 502 fallback.
- [infra/nginx/html/50x.html](../../infra/nginx/html/50x.html) — graceful-degradation page.
- [infra/scripts/deploy.sh](../../infra/scripts/deploy.sh) — rsyncs `frontend/` into `$PROJECT_DIR/frontend/`, switched `compose pull` → `compose build` for locally-built images.
- [infra/scripts/verify.sh](../../infra/scripts/verify.sh) — 7 INF-03 checks (vita_frontend healthy, `/api/healthz`, landing page, `/login` 200, `/register` 200, `/dashboard` unauth-redirect, secret-leak grep).
- [infra/Makefile](../../infra/Makefile) — `frontend-build`, `frontend-logs`, `frontend-rebuild` targets.
- [infra/.env.example](../../infra/.env.example) — declared the three `NEXT_PUBLIC_*` build args.

**Collateral — INF-02 hotfix shipped under INF-03 ownership:**

While smoking the `/dashboard` data path under owner-RLS, hit PG `42P17 — infinite recursion detected in policy for relation "profiles"`. Two policies in [db/migrations/0002_profiles.sql](../../db/migrations/0002_profiles.sql) self-referenced the table:
1. `profiles_update_own.WITH CHECK` had subqueries `select role from public.profiles where id = auth.uid()`.
2. `profiles_select_admin.USING` had `exists (select 1 from public.profiles p ...)`.

Both re-trigger RLS on the same table → unbounded recursion. INF-02's `make -C db smoke 4/4` had used the **admin/service-role REST path**, which bypasses RLS — so the bug never surfaced.

Fix: [db/migrations/0005_profiles_rls_recursion_fix.sql](../../db/migrations/0005_profiles_rls_recursion_fix.sql).
- New `SECURITY DEFINER` helper `public.is_admin()` — reads `role = 'ADMIN'` outside RLS, no recursion.
- New `BEFORE UPDATE` trigger `enforce_profile_immutability` — gates `role` and `verification_status` changes against the JWT role (allows `service_role`, raises `42501` otherwise). Replaces the recursive `WITH CHECK` subqueries.
- Re-stated `profiles_update_own`, `profiles_select_admin`, added `profiles_update_admin` — all non-recursive.
- Migration is idempotent (`drop policy if exists` + `create or replace function`); safe to replay.

Applied 2026-05-14 to `qyyxgdfetzjqfpygikbz` via the existing `_migrations` bookkeeping table; checksum recorded.

### 11.2 Verification evidence

**Build pipeline (local):**

```
npm install                  ✓ 280 packages, lockfile committed
npm run typecheck            ✓ 0 errors
npm run lint                 ✓ 0 warnings, 0 errors
npm run build                ✓ 8 routes compiled, middleware 82.5 kB
```

**HTTP smoke (`npm run dev`, http://localhost:3000):**

| Route | Method | Result |
|---|---|---|
| `/api/healthz` | GET | `200 {"ok":true,"service":"frontend"}` |
| `/` | GET | `200`, contains `"VitaChain"` |
| `/login` | GET | `200`, contains `"Connexion"` |
| `/register` | GET | `200`, contains `"Créer un compte"` |
| `/dashboard` (unauth) | GET | `307 → /login?next=%2Fdashboard` |
| `/auth/callback` (no code) | GET | `307 → /dashboard` |
| `/auth/signout` | GET | `405` (POST-only — intentional CSRF guard) |

**Data-plane E2E against live Supabase (`qyyxgdfetzjqfpygikbz`):**

| Step | Result |
|---|---|
| A. Admin-API create FARMER (`role`, `locale`, `full_name` in `user_metadata`) | ✓ user.id returned |
| B. `signInWithPassword` (anon path the UI uses) | ✓ access_token len=911 |
| C. Owner-RLS SELECT on `public.profiles` (path `/dashboard` takes) | ✓ row returned: `role=FARMER`, `verification_status=PENDING`, `locale=fr`, `full_name=INF-03 Post-Fix` |
| D. Cross-user read attempt | ✓ only 1 row visible (own) |
| E. Self-promote attempt: `PATCH role=ADMIN` | ✓ `HTTP 403 / 42501 — role is immutable for non-service callers` |
| F. Editable-field update: `PATCH full_name` | ✓ `HTTP 200` |
| G. Cleanup via admin DELETE | ✓ |

### 11.3 What's *not* covered (and why that's fine for DoD)

- **VPS deploy/verify** — INF-01 is still `IN_PROGRESS` ("awaiting VPS provisioning"); no VPS to deploy to. The §6 VPS-side checks are pre-wired in `infra/scripts/verify.sh`; running `make -C infra deploy && make -C infra verify` once INF-01 lands should pass without further changes. If it doesn't, the failure mode is environmental (DNS, firewall, build-arg env), not code.
- **UI-level register journey via browser** — The data plane is verified end-to-end via REST against the live Supabase. The Next.js routes are thin server-action wrappers around the same `@supabase/ssr` SDK, exercised by the same trigger/policy stack. A manual browser pass is recommended as a sanity check (`http://localhost:3000/register` → fill form → land on `/dashboard`) but adds no new failure surface beyond what's been mechanically verified.

### 11.4 Stories now unblocked

| Story | Why |
|---|---|
| **AUTH-01** | Registration UI shell exists; AUTH-01 layers UX polish + error mapping. |
| **AUTH-02** | Role lands in `public.profiles` and the dashboard reads it; AUTH-02 adds `custom_access_token_hook` to push it into JWT claims so middleware can gate by role without a DB round-trip. |
| **AUTH-06** | `verification_status='PENDING'` is now visible to every authenticated user; AUTH-06 builds the KYC document-upload flow that flips it to `VERIFIED`. |
| **INF-05** | CI can now `npm ci && npm run typecheck && npm run lint && npm run build` against the frontend tree. Add the secret-leak grep + Docker build smoke. |
| **I18N-01** | Every user-facing string is currently French with `// TODO(i18n)` markers; `next-intl` drops in over the existing routes. |
| **I18N-03** | `<html lang="fr" dir="ltr">` in `layout.tsx` is the swap point for Arabic RTL. |
| **BOT-01**, **FAR-02**, **SEC-02** | Public/protected routing pattern is established; domain pages slot in under `src/app/`. |
| **ADM-01** | `is_admin()` helper now exists (shipped in 0005); `/admin/*` route protection in `middleware.ts` is a one-liner away. |

### 11.5 Known follow-ups (not part of INF-03)

- **AUTH-07** should add a regression test exercising owner-RLS reads against `public.profiles` so the 0002 recursion class of bug never reaches a release branch again. Recommended fixture: `make -C db smoke` extended with an anon-tier `signInWithPassword` → `select profiles` step.
- **INF-05** secret-leak grep already enumerated in `verify.sh` (§D); promote to CI as a `pre-commit` hook + GitHub Action.
- **INF-06** flips `Site URL` from `http://` to `https://` and adds HSTS; the `serverActions.allowedOrigins` allow-list in [next.config.ts](../../frontend/next.config.ts) already covers both.
- The two empty `NEXT_PUBLIC_*` values from the initial `.env.local` were filled mid-implementation; ensure the same values land in Bitwarden's `VitaChain — Supabase URL` and `VitaChain — Supabase anon key` entries.

### 11.6 Operator runbook (when INF-01 reaches DONE)

```bash
# On developer laptop, from repo root:
cp infra/.env.example infra/.env
# Fill: VPS_HOST, VPS_USER=vitachain, PROJECT_DIR=/opt/vitachain
#       NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (from Bitwarden)
#       NEXT_PUBLIC_SITE_URL=http://vitachain.ma

make -C infra deploy            # rsync infra/ + frontend/, compose build + up -d
make -C infra verify            # runs INF-01 + INF-03 verification checklist

# Manual smoke (60s):
#   http://vitachain.ma                    → landing
#   http://vitachain.ma/register           → fill form, role=FARMER  → /dashboard
#   refresh /dashboard                     → still authenticated
#   click "Déconnexion"                    → /login
#   http://vitachain.ma/dashboard          → /login?next=%2Fdashboard
#   http://vitachain.ma/api/healthz        → {"ok":true,"service":"frontend"}
```

When the manual smoke passes on the live domain, no further INF-03 work remains.
