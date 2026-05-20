"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (anon key).
 *
 * The cookie storage is automatic — `@supabase/ssr` reads/writes the same
 * cookies the server helper uses, so session state stays in sync.
 *
 * Not used by any route in INF-03 (all auth flows are server actions) but
 * declared here because domain stories (Katara live charts, SecondServe map
 * realtime, ...) will need a client-side subscriber.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
