import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type AuthedFetchInit = Omit<RequestInit, "signal"> & {
  /** Per-attempt timeout in ms. A fresh AbortSignal is created for each try. */
  timeoutMs?: number;
};

/**
 * Authenticated fetch to a FastAPI endpoint that self-heals a stale
 * `verification_status` JWT claim.
 *
 * The claim is a snapshot baked into the access token by
 * `custom_access_token_hook` (migration 0014) at login / refresh time. When an
 * admin verifies a professional mid-session, the `profiles` row flips to
 * VERIFIED immediately, but the already-issued access token keeps the old
 * PENDING claim. The backend `require_verified()` dependency (and the mirrored
 * RLS policies) read that claim, so a freshly-verified farmer/restaurant still
 * gets `403 verification_required` even though their profile is verified — and
 * the DB-backed UI gates show them as verified. The symptom: the page says
 * "verified", the action says "you must be verified".
 *
 * On that specific 403 we force `supabase.auth.refreshSession()`, which re-runs
 * the hook against the current DB row and mints a token carrying the up-to-date
 * claim, then retry the request exactly once. Any other status (including a
 * genuine 403 for a still-unverified account, where the retry 403s again) is
 * returned unchanged.
 *
 * `path` is relative to `/api/v1` (e.g. `"/farmarket/ads"`). Throws
 * `"not_authenticated"` when there is no session — callers catch and map it.
 */
export async function authedApiFetch(
  path: string,
  init: AuthedFetchInit = {},
): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");

  const attempt = (token: string): Promise<Response> => {
    const headers = new Headers(rest.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${API_BASE}/api/v1${path}`, {
      ...rest,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  let r = await attempt(session.access_token);

  if (r.status === 403) {
    const detail = await r
      .clone()
      .json()
      .then((b: { detail?: unknown }) => b?.detail)
      .catch(() => undefined);
    if (detail === "verification_required") {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) {
        r = await attempt(data.session.access_token);
      }
    }
  }

  return r;
}
