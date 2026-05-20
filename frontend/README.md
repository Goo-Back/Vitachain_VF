# VitaChain — Frontend (INF-03)

Next.js 15 App Router app that serves every VitaChain web surface. Scope for
the INF-03 scaffold is **auth journey + empty dashboard shell** only; domain
modules (Katara, FarMarket, BotaBa9a, SecondServe) graft onto this skeleton
in later stories.

> See [docs/stories/INF-03-nextjs-scaffold-login-dashboard.md](../docs/stories/INF-03-nextjs-scaffold-login-dashboard.md)
> for the contract this implementation satisfies.

---

## Stack

- **Next.js** 15 — App Router, Server Actions, `output: "standalone"`
- **React** 19
- **TypeScript** 5.7, `strict` + `noUncheckedIndexedAccess`
- **Tailwind CSS** v4 (config-in-CSS, no `tailwind.config.ts`)
- **Supabase** auth via `@supabase/ssr` (HTTP-only cookie session)
- **Zod** for server-action input validation

---

## Local development

```bash
# 1. Copy the public env values from Bitwarden.
cp .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.

# 2. Install + run.
npm install
npm run dev
# → http://localhost:3000

# 3. Sanity.
npm run typecheck
npm run lint
npm run build
```

The full reachable surface in this story:

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Landing placeholder with links to `/login` and `/register`. |
| `/register` | GET / POST (server action) | Email + password + role + locale. |
| `/login` | GET / POST (server action) | Email + password. |
| `/dashboard` | GET | Protected; reads `public.profiles` via owner-RLS. |
| `/auth/callback` | GET | OAuth / magic-link code exchange — wired for future stories. |
| `/auth/signout` | POST | Revokes session, redirects to `/login`. |
| `/api/healthz` | GET | `{ ok: true, service: "frontend" }`. |

---

## Auth flow

```
register (server action)
  └─→ supabase.auth.signUp({ email, password, options: { data: {full_name, role, locale} } })
        └─→ Supabase inserts auth.users row
              └─→ trigger handle_new_user() (migration 0003 — INF-02)
                    └─→ insert into public.profiles (id, email, full_name, role, locale)
                          └─→ session cookies set
                                └─→ redirect /dashboard

dashboard
  └─→ middleware refreshes cookie → getUser()
        └─→ select * from profiles where id = auth.uid()  (owner-RLS, AUTH-04)

signout
  └─→ POST /auth/signout
        └─→ supabase.auth.signOut() (clears cookies)
              └─→ 303 → /login
```

---

## Where things live

```
frontend/
├── Dockerfile                       # multi-stage, standalone runtime
├── next.config.ts                   # output: "standalone", server-action allow-list
├── postcss.config.mjs               # Tailwind v4
├── eslint.config.mjs                # flat-config wrap of eslint-config-next
├── public/
└── src/
    ├── middleware.ts                # session refresh + dashboard gate
    ├── app/
    │   ├── layout.tsx               # <html lang="fr">
    │   ├── page.tsx                 # /
    │   ├── globals.css              # @import "tailwindcss"
    │   ├── register/{page,actions}.ts(x)
    │   ├── login/{page,actions}.ts(x)
    │   ├── dashboard/page.tsx
    │   ├── auth/callback/route.ts
    │   ├── auth/signout/route.ts
    │   └── api/healthz/route.ts
    └── lib/
        └── supabase/
            ├── server.ts            # createSupabaseServerClient()
            ├── browser.ts           # createSupabaseBrowserClient()
            └── types.ts             # hand-typed profile row, until gen-types
```

---

## Production (VPS) build

The container is built and run by the root [infra/docker-compose.yml](../infra/docker-compose.yml)
on the VPS. The compose file passes `NEXT_PUBLIC_*` values as build args
so the Next bundle has them inlined.

```bash
# From repo root, on the VPS:
docker compose -f infra/docker-compose.yml up -d --build frontend

# Smoke:
curl -fsS http://vitachain.ma/ | head -5
curl -fsS http://vitachain.ma/api/healthz
# → {"ok":true,"service":"frontend"}
```

---

## Boundaries (AUTH-05)

- Only variables prefixed `NEXT_PUBLIC_` may appear in `.env.example`.
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_DB_PASSWORD`,
  `DB_URL` are **forbidden** anywhere under `frontend/` and CI (INF-05) will
  fail the build if grep finds them.

Verify locally:

```bash
grep -RIn 'SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_JWT_SECRET\|SUPABASE_DB_PASSWORD\|^DB_URL=' . \
  --exclude-dir=node_modules --exclude-dir=.next
# Must return nothing (except .env.example references in this README itself,
# which are documentation, not env loads).
```
