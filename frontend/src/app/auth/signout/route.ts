import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Signout endpoint. POST-only — CSRF-safe because Server Actions and HTML forms
 * both ride on Next's same-origin POST handler.
 *
 * The dashboard renders `<form action="/auth/signout" method="post">`, so a
 * GET handler is intentionally NOT exposed (clicking a malicious GET link from
 * another tab would otherwise revoke the user's session).
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  // 303 forces the browser to follow with GET, regardless of original verb.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
