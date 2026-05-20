"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * AUTH-06 — server actions wrapping the FastAPI /kyc/* endpoints.
 *
 * The client component never holds the raw bearer token: every call is
 * proxied through these server actions, which pull the access token from
 * the Supabase session cookie (refreshed by the middleware) and forward it
 * as `Authorization: Bearer …`.
 *
 * The FastAPI base URL comes from NEXT_PUBLIC_API_URL (set in INF-03's
 * .env.example, defaults to same-origin /api in production behind nginx).
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Submission = {
  id: string;
  document_type: "RC" | "CIN" | "AGRI_CARD" | "OTHER";
  storage_path: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
  preview_url: string | null;
};

async function _authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("not_authenticated");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export async function fetchMySubmissions(): Promise<Submission[]> {
  const r = await _authedFetch("/kyc/me");
  if (!r.ok) {
    // 403 kyc_not_required for citizens — surfaced as empty array so the
    // caller renders the "you don't need verification" copy.
    if (r.status === 403) return [];
    throw new Error(`fetch_failed:${r.status}`);
  }
  return (await r.json()) as Submission[];
}

export async function requestUploadUrl(input: {
  document_type: "RC" | "CIN" | "AGRI_CARD" | "OTHER";
  mime_type: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  size_bytes: number;
}): Promise<{ upload_url: string; storage_path: string }> {
  const r = await _authedFetch("/kyc/upload-url", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`upload_url_failed:${r.status}:${body}`);
  }
  return (await r.json()) as { upload_url: string; storage_path: string };
}

export async function submitDocument(input: {
  document_type: "RC" | "CIN" | "AGRI_CARD" | "OTHER";
  storage_path: string;
}): Promise<{ id: string; status: string }> {
  const r = await _authedFetch("/kyc/submit", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`submit_failed:${r.status}:${body}`);
  }
  return (await r.json()) as { id: string; status: string };
}
