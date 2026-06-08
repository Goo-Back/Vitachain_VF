import { redirect } from "next/navigation";

import { getServerProfile, getServerSession } from "@/lib/auth/session";
import { CartProvider } from "@/lib/cart";
import { FavoritesProvider } from "@/lib/favorites";

import { Sidebar } from "./_ui/Sidebar";
import { Topbar } from "./_ui/Topbar";

export const dynamic = "force-dynamic";

function initialsOf(name?: string | null, email?: string | null) {
  const src = (name ?? email ?? "").trim();
  if (!src) return "·";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return src[0]?.toUpperCase() ?? "·";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "·";
}

export default async function RestaurantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  // cache()-memoised: the child page's getServerProfile() reuses this result,
  // so only one public.profiles query runs for the whole request.
  const profile = await getServerProfile();
  if (profile?.role !== "RESTAURANT") redirect("/dashboard");

  const displayName = profile.full_name ?? profile.email;
  const initials = initialsOf(profile.full_name, profile.email);

  return (
    <CartProvider>
      <FavoritesProvider>
        <div className="min-h-screen bg-neutral-50">
          <Sidebar />
          <div className="lg:pl-64">
            <Topbar userName={displayName} userInitials={initials} />
            <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
              {children}
            </main>
          </div>
        </div>
      </FavoritesProvider>
    </CartProvider>
  );
}
