"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type KycSubmission = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  document_type: "RC" | "CIN" | "AGRI_CARD" | "OTHER";
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
  preview_url: string | null;
};

async function _adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");

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

export async function fetchPendingSubmissions(): Promise<KycSubmission[]> {
  const r = await _adminFetch("/admin/kyc/pending");
  if (!r.ok) throw new Error(`fetch_failed:${r.status}`);
  return (await r.json()) as KycSubmission[];
}

export async function approveSubmission(
  _prevState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const submissionId = formData.get("submission_id") as string;
  if (!submissionId) return { error: "Identifiant manquant." };

  const r = await _adminFetch(`/admin/kyc/${submissionId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision: "APPROVED" }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return { error: `Erreur ${r.status}${body ? `: ${body}` : ""}` };
  }
  revalidatePath("/admin/kyc");
  return { error: null };
}

export async function rejectSubmission(
  _prevState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const submissionId = formData.get("submission_id") as string;
  const note = (formData.get("reviewer_note") as string | null) ?? "";
  if (!submissionId) return { error: "Identifiant manquant." };

  const r = await _adminFetch(`/admin/kyc/${submissionId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision: "REJECTED", note: note || null }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return { error: `Erreur ${r.status}${body ? `: ${body}` : ""}` };
  }
  revalidatePath("/admin/kyc");
  return { error: null };
}
