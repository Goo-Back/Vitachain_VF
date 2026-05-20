import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import { NewParcelForm } from "./new-parcel-form";

export const dynamic = "force-dynamic";

export default async function NewParcelPage() {
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
          href="/dashboard/farmer/parcels"
          className="text-sm text-neutral-500 hover:text-emerald-700"
        >
          ← Mes parcelles
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Nouvelle parcelle
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Renseignez les caractéristiques de la parcelle. Le polygone GeoJSON
          servira aux modules d&apos;irrigation et d&apos;alerte.
        </p>
      </div>

      <NewParcelForm />
    </main>
  );
}
