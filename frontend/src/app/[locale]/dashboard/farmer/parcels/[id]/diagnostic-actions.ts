"use server";

/**
 * KAT-07 — server action wrapping the FastAPI AI-diagnostic endpoints.
 *
 * Mirrors the pattern in ./thresholds-actions.ts and ./telemetry-actions.ts:
 * the Supabase session cookie is read server-side and the access_token is
 * forwarded to FastAPI. The client-side POST (button click) reuses a
 * short-lived access_token handed to it as a prop, same convention as
 * ThresholdsSection.tsx.
 */

import { authedApiFetch } from "@/lib/api/authed-fetch";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type DiagnosticStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface DiagnosticOut {
  id: string;
  parcel_id: string;
  farmer_id: string;
  status: DiagnosticStatus;
  result_text: string | null;
  error_detail: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Initial server-side fetch — used by page.tsx to hydrate DiagnosticSection.
 *
 * A 404 means the parcel has no diagnostic yet (legitimate empty state); we
 * surface null so the section renders the idle button.
 * Any other non-200 (transient backend hiccup) also returns null so the rest
 * of the parcel page keeps rendering — same degrade-gracefully posture as the
 * sibling actions.
 */
export async function fetchLatestDiagnostic(
  parcelId: string,
  accessToken?: string,
): Promise<DiagnosticOut | null> {
  let token = accessToken;
  if (!token) {
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    token = session.access_token;
  }

  let r: Response;
  try {
    r = await fetch(
      `${API_BASE}/api/v1/katara/parcels/${parcelId}/diagnostics/latest`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return null;
  }
  if (r.status === 404) return null;
  if (!r.ok) return null;
  return (await r.json()) as DiagnosticOut;
}

export type RequestDiagnosticResult =
  | { ok: true; data: DiagnosticOut }
  | { ok: false; error: string };

/**
 * Server action invoked from the client component on button click. The
 * access_token is taken from the active session — the client never touches
 * the raw bearer.
 */
export async function requestDiagnostic(
  parcelId: string,
): Promise<RequestDiagnosticResult> {
  let r: Response;
  try {
    r = await authedApiFetch(
      `/katara/parcels/${parcelId}/diagnostics`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message === "not_authenticated"
          ? "not_authenticated"
          : "network_error",
    };
  }

  if (r.ok) {
    return { ok: true, data: (await r.json()) as DiagnosticOut };
  }

  let error = "diagnostic_request_failed";
  try {
    const body = (await r.json()) as { detail?: string };
    if (typeof body.detail === "string") error = body.detail;
  } catch {
    // ignore parse failure — keep the generic error
  }
  return { ok: false, error };
}
