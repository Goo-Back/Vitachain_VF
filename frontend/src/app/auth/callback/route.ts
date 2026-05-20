import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link code exchange endpoint.
 *
 * INF-03 only enables email/password (no `?code=` callback is ever produced),
 * but every Supabase Auth setup needs this route declared so future stories
 * (e.g. Google OAuth, magic-link recovery) can drop in without touching auth
 * wiring. Until then, the handler is effectively a redirect to `/dashboard`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? "/dashboard";

  // Open-redirect guard — same shape as login action.
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, request.url));
}
