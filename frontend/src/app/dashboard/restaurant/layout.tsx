import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CartProvider } from "@/lib/cart";
import type { ProfileRow } from "@/lib/supabase/types";

export default async function RestaurantLayout({
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
    .select("role")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "role">>();

  if (profile?.role !== "RESTAURANT") redirect("/dashboard");

  return (
    <CartProvider>
      <div className="min-h-screen bg-neutral-50">
        <header className="border-b border-neutral-200 bg-white px-6 py-4">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <p className="text-sm font-semibold text-neutral-700">
              Tableau de bord Restaurateur
            </p>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard/restaurant/marketplace" className="text-neutral-600 hover:text-leaf-700">
                Marketplace
              </Link>
              <Link href="/dashboard/restaurant/orders" className="text-neutral-600 hover:text-leaf-700">
                Mes commandes
              </Link>
              <Link
                href="/dashboard/restaurant/cart"
                className="rounded-full bg-leaf-50 px-3 py-1 text-leaf-700 hover:bg-leaf-100"
              >
                Panier
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      </div>
    </CartProvider>
  );
}
