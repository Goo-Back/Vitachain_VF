import { cache } from "react";
import type { Session } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

/**
 * Request-scoped auth reads for Server Components / Server Actions.
 *
 * Two perf properties matter here:
 *
 *  1. We read `getSession()` (a local cookie decode, no network) rather than
 *     `getUser()` (a round-trip to Supabase Auth). The middleware already
 *     revalidates + refreshes the token via `getUser()` once per request, so
 *     trusting the cookie downstream is safe — and the FastAPI `require_*`
 *     dependencies remain the real security boundary.
 *
 *  2. Both functions are wrapped in React `cache()`, which memoises per request.
 *     A layout and its child page can each call `getServerProfile()` and only
 *     ONE `public.profiles` query runs for the whole render.
 */

// Superset of every column any dashboard surface reads. Selecting it once is
// what lets the cache() dedupe across differing call sites collapse to a single
// PostgREST round-trip.
export type ServerProfile = Pick<
  ProfileRow,
  | "id"
  | "full_name"
  | "first_name"
  | "last_name"
  | "farmer_region"
  | "email"
  | "phone"
  | "role"
  | "locale"
  | "verification_status"
>;

const PROFILE_COLUMNS =
  "id, full_name, first_name, last_name, farmer_region, email, phone, role, locale, verification_status";

/** The current session, read from the request cookie (no network). */
export const getServerSession = cache(async (): Promise<Session | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
});

/**
 * The signed-in user's `public.profiles` row (superset of columns), or null
 * when signed out or no profile row exists (e.g. a SecondServe-only account
 * visiting the VitaChain app — see migration 0048).
 */
export const getServerProfile = cache(async (): Promise<ServerProfile | null> => {
  const session = await getServerSession();
  const user = session?.user;
  if (!user) return null;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle<ServerProfile>();
  return data ?? null;
});
