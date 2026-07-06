import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

import { getServerProfile, getServerSession } from "@/lib/auth/session";
import { CartProvider } from "@/lib/cart";
import { FavoritesProvider } from "@/lib/favorites";

import { ShellClient } from "./_ui/ShellClient";
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
  const locale = await getLocale();
  const session = await getServerSession();
  if (!session) return redirect({ href: "/login", locale });

  // cache()-memoised: the child page's getServerProfile() reuses this result,
  // so only one public.profiles query runs for the whole request.
  const profile = await getServerProfile();
  if (profile?.role !== "RESTAURANT") return redirect({ href: "/dashboard", locale });

  const displayName = profile.full_name ?? profile.email;
  const initials = initialsOf(profile.full_name, profile.email);

  return (
    <CartProvider>
      <FavoritesProvider>
        <div className="theme-farmarket min-h-screen bg-neutral-50">
          <ShellClient>
            <Topbar userName={displayName} userInitials={initials} />
            <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
              {children}
            </main>
          </ShellClient>
        </div>
      </FavoritesProvider>
    </CartProvider>
  );
}
