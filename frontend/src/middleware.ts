import { createServerClient, type CookieOptions } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const LOCALE_PREFIX_RE = /^\/(fr|en|ar)(?=\/|$)/;

const handleI18nRouting = createIntlMiddleware(routing);

// Routes that require an authenticated session. The admin console lives under
// /dashboard/admin, so it is already covered by the "/dashboard" prefix.
// NOTE: these are locale-stripped pathnames (see `bare` below) — next-intl's
// middleware runs first and always resolves the URL to a `/fr|en|ar/...`
// shape before this auth logic ever sees the request.
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding/verification"];

// AUTH-06 — pro-only publishing routes. An unverified FARMER / RESTAURANT
// who hits one of these gets redirected to /onboarding/verification.
// Citizens and admins pass through. This is UX, not security — the
// FastAPI dependency `require_verified()` is the actual gate.
// NOTE: SecondServe publishing is NOT here — it lives in the separate
// SecondServe app (other origin) and is gated by SecondServe's own RLS.
const VERIFIED_PRO_PREFIXES = ["/farmarket/new"];

// Auth pages that redirect AWAY when the user is already signed in.
const AUTH_PAGES = new Set(["/login", "/register"]);

function decodeJwtClaims(token: string): Record<string, unknown> {
  // Edge runtime has no Buffer; manual base64url decode of the payload segment.
  try {
    const payload = token.split(".")[1] ?? "";
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const decoded = atob(b64 + pad);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isLocale(value: unknown): value is (typeof routing.locales)[number] {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value);
}

export async function middleware(request: NextRequest) {
  // next-intl resolves/normalises the locale first. With localePrefix:
  // "always" this only ever produces a redirect when the URL is missing or
  // has an invalid locale segment (e.g. "/" → "/fr", "/dashboard" →
  // "/fr/dashboard") — in that case there is nothing else to do: return
  // immediately without spending a Supabase round-trip on a URL that's about
  // to be replaced.
  const intlResponse = handleI18nRouting(request);
  if (intlResponse.headers.get("location")) {
    return intlResponse;
  }

  // The pattern below — mutating both `request.cookies` and a re-built `response`
  // on every `setAll` — is the canonical @supabase/ssr Next 15 recipe. Removing
  // any line silently breaks token refresh. `response` starts as next-intl's
  // response (not a bare NextResponse.next()) so its cookies/headers (locale
  // detection) survive into whatever we end up returning.
  let response = intlResponse;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: CookieToSet[]) => {
          for (const { name, value } of toSet) {
            request.cookies.set(name, value);
          }
          const next = NextResponse.next({ request });
          response.headers.forEach((value, key) => next.headers.set(key, value));
          for (const cookie of response.cookies.getAll()) {
            next.cookies.set(cookie);
          }
          response = next;
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: calling getUser() here is what triggers cookie refresh. Do not
  // replace with getSession() — the latter trusts the cookie without revalidating.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const localeMatch = LOCALE_PREFIX_RE.exec(pathname);
  const locale = localeMatch?.[1] ?? routing.defaultLocale;
  const bare = pathname.replace(LOCALE_PREFIX_RE, "") || "/";

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => bare === p || bare.startsWith(`${p}/`),
  );
  const isAuthPage = AUTH_PAGES.has(bare);

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.searchParams.set("next", `/${locale}${bare}`);
    return NextResponse.redirect(url);
  }

  // Decode the JWT claims once, lazily — every branch below that needs them
  // (locale preference, AUTH-06 verification gate) shares this single call.
  // Both claims are lifted from profiles in the SAME custom_access_token_hook
  // SELECT (migrations 0014 + 0054), so this is a claims decode, not a DB hit.
  let claims: Record<string, unknown> | undefined;
  const getClaims = async () => {
    if (claims) return claims;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    claims = session?.access_token ? decodeJwtClaims(session.access_token) : {};
    return claims;
  };

  if (isAuthPage && user) {
    const localeClaim = (await getClaims()).locale;
    const preferred = isLocale(localeClaim) ? localeClaim : locale;
    const url = request.nextUrl.clone();
    url.pathname = `/${preferred}/dashboard`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // First protected-route hit of the session, no explicit NEXT_LOCALE choice
  // yet: steer the user to the locale they picked at signup (profiles.locale,
  // lifted into the locale JWT claim by migration 0054 — no extra DB round
  // trip). Once NEXT_LOCALE is set (by this redirect, or a manual switch),
  // that cookie wins on every subsequent request.
  if (isProtected && user && !request.cookies.get("NEXT_LOCALE")) {
    const preferredLocale = (await getClaims()).locale;
    if (isLocale(preferredLocale) && preferredLocale !== locale) {
      const url = request.nextUrl.clone();
      url.pathname = `/${preferredLocale}${bare}`;
      return NextResponse.redirect(url);
    }
  }

  // AUTH-06 — gate publishing routes on the verification_status JWT claim.
  // The claim is the fast path (no DB round-trip); the API guard
  // `require_verified()` is the security boundary.
  const isPublishRoute = VERIFIED_PRO_PREFIXES.some(
    (p) => bare === p || bare.startsWith(`${p}/`),
  );
  if (isPublishRoute && user) {
    const { user_role: role, verification_status: vStatus } = await getClaims();
    const isPro = role === "FARMER" || role === "RESTAURANT";
    if (isPro && vStatus !== "VERIFIED") {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/onboarding/verification`;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Everything except:
  //   - Next internals + common static assets
  //   - /api/healthz, /api/readyz — health endpoints must answer even when
  //     Supabase is unreachable; otherwise Uptime Kuma (INF-08) would alert
  //     on Supabase outages as a "frontend down" event.
  //   - /auth/* — Supabase OAuth callback & sign-out route handlers, hit
  //     directly by redirect URLs configured outside this app; they render
  //     no HTML and carry no locale segment.
  // The auth-cookie refresh must run on every other dynamic request, not only
  // protected ones, so the matcher stays broad.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/healthz|api/readyz|auth/callback|auth/signout|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)",
  ],
};
