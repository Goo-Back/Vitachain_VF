import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import { Sidebar } from "./_ui/Sidebar";
import { Topbar } from "./_ui/Topbar";

/**
 * Shared shell for every /dashboard/farmer/* route.
 *
 * Single auth + role check at the layout level — child pages still call
 * supabase.auth.getUser() for type-narrowing and defence-in-depth, but the
 * redirect logic is centralised here so a new sub-route picks it up
 * automatically.
 */

export const dynamic = "force-dynamic";

function initialsOf(name?: string | null, email?: string | null) {
  const src = (name ?? email ?? "").trim();
  if (!src) return "·";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return src[0]?.toUpperCase() ?? "·";
  if (parts.length === 1) {
    const first = parts[0] ?? "";
    return first.slice(0, 2).toUpperCase();
  }
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "·";
}

export default async function FarmerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "role" | "full_name" | "email">>();

  if (profile?.role !== "FARMER") redirect("/dashboard");

  const displayName = profile?.full_name ?? profile?.email ?? user.email ?? null;
  const initials = initialsOf(profile?.full_name, profile?.email ?? user.email);

  return (
    <div className="min-h-screen">
      <Sidebar />

      {/* lg:pl-64 so content clears the fixed sidebar rail. */}
      <div className="lg:pl-64">
        <Topbar userName={displayName} userInitials={initials} />
        <main className="px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
