import { redirect } from "next/navigation";

import { getServerProfile, getServerSession } from "@/lib/auth/session";

import { Sidebar } from "./_ui/Sidebar";
import { Topbar } from "./_ui/Topbar";

/**
 * Shared shell for every /dashboard/farmer/* route.
 *
 * Single auth + role check at the layout level — child pages read the session
 * (local cookie decode, no network) for type-narrowing, but the redirect logic
 * is centralised here so a new sub-route picks it up automatically. The actual
 * token revalidation happens once per request in the middleware via getUser().
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
  const session = await getServerSession();
  if (!session) redirect("/login");

  // cache()-memoised: the child page's getServerProfile() reuses this result,
  // so only one public.profiles query runs for the whole request.
  const profile = await getServerProfile();
  if (profile?.role !== "FARMER") redirect("/dashboard");

  const displayName = profile.full_name ?? profile.email;
  const initials = initialsOf(profile.full_name, profile.email);

  return (
    <div className="theme-katara min-h-screen">
      <Sidebar />

      {/* lg:pl-64 so content clears the fixed sidebar rail. */}
      <div className="lg:pl-64">
        <Topbar userName={displayName} userInitials={initials} />
        <main className="px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
