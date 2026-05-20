import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (anon key).
 *
 * Usage: Server Components, Route Handlers, Server Actions.
 * The middleware (see src/middleware.ts) is responsible for keeping the
 * session cookie fresh — this helper only needs to surface the current value.
 *
 * AUTH-05 — the service_role key is NEVER instantiated here. Backend privileged
 * calls go through FastAPI (INF-04).
 */
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
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          // Server Components are read-only on cookies — `cookies().set` throws there.
          // Route Handlers and Server Actions accept the write. Middleware also
          // refreshes the access-token cookie on every request, so a silent
          // failure here is recoverable.
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* Called from a Server Component — middleware will refresh next request. */
          }
        },
      },
    },
  );
}
