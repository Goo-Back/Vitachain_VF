import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import { NewAdForm } from "./new-ad-form";

export const dynamic = "force-dynamic";

export default async function NewAdPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, verification_status")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "role" | "verification_status">>();

  if (profile?.role !== "FARMER") redirect("/dashboard");
  if (profile.verification_status !== "VERIFIED") {
    redirect("/onboarding/verification");
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/dashboard/farmer/ads"
          className="text-sm text-neutral-500 hover:text-leaf-700"
        >
          ← Mes annonces
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900">
          Nouvelle annonce
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Publiez votre produit sur FarMarket. L&apos;annonce expire
          automatiquement après 7 jours et peut être renouvelée.
        </p>
      </div>

      <div className="vc-card p-6">
        <NewAdForm />
      </div>
    </main>
  );
}
