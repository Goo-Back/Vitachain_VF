import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Routes that require an authenticated session. Domain stories extend this
// prefix list (e.g. "/admin" once ADM-01 lands).
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding/verification", "/admin"];

// AUTH-06 — pro-only publishing routes. An unverified FARMER / RESTAURANT
// who hits one of these gets redirected to /onboarding/verification.
// Citizens and admins pass through. This is UX, not security — the
// FastAPI dependency `require_verified()` is the actual gate.
const VERIFIED_PRO_PREFIXES = ["/farmarket/new", "/secondserve/new"];

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

export async function middleware(request: NextRequest) {
  // The pattern below — mutating both `request.cookies` and a re-built `response`
  // on every `setAll` — is the canonical @supabase/ssr Next 15 recipe. Removing
  // any line silently breaks token refresh.
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthPage = AUTH_PAGES.has(pathname);

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // AUTH-06 — gate publishing routes on the verification_status JWT claim.
  // The claim is the fast path (no DB round-trip); the API guard
  // `require_verified()` is the security boundary.
  const isPublishRoute = VERIFIED_PRO_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isPublishRoute && user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      const claims = decodeJwtClaims(session.access_token);
      const role = claims.user_role as string | undefined;
      const vStatus = claims.verification_status as string | undefined;
      const isPro = role === "FARMER" || role === "RESTAURANT";
      if (isPro && vStatus !== "VERIFIED") {
        const url = request.nextUrl.clone();
        url.pathname = "/onboarding/verification";
        url.search = "";
        return NextResponse.redirect(url);
      }
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
  // The auth-cookie refresh must run on every other dynamic request, not only
  // protected ones, so the matcher stays broad.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/healthz|api/readyz|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)",
  ],
};
