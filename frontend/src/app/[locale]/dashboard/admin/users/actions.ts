"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type AdminUserRole = "FARMER" | "RESTAURANT" | "CITIZEN" | "ADMIN";

export type AdminUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: AdminUserRole;
  verification_status: string;
  banned: boolean;
  created_at: string;
};

export type AdminUserPage = {
  users: AdminUser[];
  total: number;
  page: number;
  page_size: number;
};

async function _adminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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

export async function fetchUsers(params: {
  q?: string;
  role?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminUserPage> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.role) search.set("role", params.role);
  if (params.status) search.set("status", params.status);
  search.set("page", String(params.page ?? 0));
  search.set("page_size", String(params.pageSize ?? 20));

  const r = await _adminFetch(`/admin/users?${search.toString()}`);
  if (!r.ok) throw new Error(`fetch_failed:${r.status}`);
  return (await r.json()) as AdminUserPage;
}

export async function setUserRole(
  _prevState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const t = await getTranslations("admin.users.actions");
  const userId = formData.get("user_id") as string;
  const role = formData.get("role") as string;
  if (!userId || !role) return { error: t("missingData") };

  const r = await _adminFetch(`/admin/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  if (!r.ok) {
    if (r.status === 409) return { error: t("cannotChangeSelfRole") };
    const body = await r.text().catch(() => "");
    return {
      error: t("genericError", {
        status: r.status,
        detail: body ? `: ${body}` : "",
      }),
    };
  }
  revalidatePath("/dashboard/admin/users");
  return { error: null };
}

export async function setUserBan(
  _prevState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const t = await getTranslations("admin.users.actions");
  const userId = formData.get("user_id") as string;
  const banned = formData.get("banned") === "true";
  if (!userId) return { error: t("missingId") };

  const r = await _adminFetch(`/admin/users/${userId}/ban`, {
    method: "PATCH",
    body: JSON.stringify({ banned }),
  });
  if (!r.ok) {
    if (r.status === 409) return { error: t("cannotBanSelf") };
    const body = await r.text().catch(() => "");
    return {
      error: t("genericError", {
        status: r.status,
        detail: body ? `: ${body}` : "",
      }),
    };
  }
  revalidatePath("/dashboard/admin/users");
  return { error: null };
}
