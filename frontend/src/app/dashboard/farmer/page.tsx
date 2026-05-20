import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import { EmptyState } from "./EmptyState";
import { KpiStrip } from "./KpiStrip";
import { ParcelGrid } from "./ParcelGrid";
import { PageHeader } from "./_ui/PageHeader";
import { fetchFarmerOverview } from "./overview-actions";

/**
 * KAT-14 — farmer-level multi-parcel overview.
 *
 * Layout provides the sidebar + topbar; this page renders the content
 * column only: greeting + KPI strip + parcel grid. Anything beyond that
 * (alerts, insights, calendar, reports) used to live here as mock content
 * — pulled out until those features are backed by real data.
 */
export const dynamic = "force-dynamic";

export default async function FarmerDashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single<Pick<ProfileRow, "role" | "full_name">>();

  if (profile?.role !== "FARMER") redirect("/dashboard");

  const overview = await fetchFarmerOverview();

  if (!overview || overview.parcels.length === 0) {
    return <EmptyState />;
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";
  const firstName = profile?.full_name?.split(/\s+/)[0] ?? "";

  return (
    <div className="mx-auto max-w-7xl vc-fade-in">
      <PageHeader
        eyebrow="Vue d'ensemble"
        title={`${greeting}${firstName ? `, ${firstName}` : ""}.`}
        subtitle="Un aperçu en direct de votre exploitation : capteurs, humidité du sol et état des parcelles."
      />

      <div className="space-y-6">
        <KpiStrip kpi={overview.kpi} />

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
              Mes parcelles
              <span className="ml-2 text-sm font-normal text-neutral-500">
                ({overview.parcels.length})
              </span>
            </h2>
            <Link
              href="/dashboard/farmer/parcels/new"
              className="text-sm font-medium text-leaf-700 hover:underline"
            >
              + Ajouter
            </Link>
          </div>
          <ParcelGrid parcels={overview.parcels} />
        </section>
      </div>
    </div>
  );
}
