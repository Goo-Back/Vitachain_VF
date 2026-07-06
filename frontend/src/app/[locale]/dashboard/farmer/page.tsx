import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";

import { getServerProfile } from "@/lib/auth/session";

import { EmptyState } from "./EmptyState";
import { KpiStrip } from "./KpiStrip";
import { ParcelGrid } from "./ParcelGrid";
import { QuickActions } from "./QuickActions";
import { SatelliteCard, SatelliteCardSkeleton } from "./SatelliteCard";
import { StatusRow } from "./StatusRow";
import { TrendChart } from "./TrendChart";
import { PageHeader } from "./_ui/PageHeader";
import { fetchFarmerOverview } from "./overview-actions";
import { fetchTelemetryHistory } from "./trend-actions";
import { fetchNdviForParcel } from "./satellite/actions";
import { fetchWeatherForParcel } from "./weather/actions";
import { vigorIndexFromNdvi } from "./ndvi-format";
import type { NdviResponse } from "./satellite/actions";
import type { ParcelOverviewEntry } from "./overview-types";

/**
 * Resolves a Vigor Index (NDVI mean × 100) for every parcel and renders the
 * grid — kept as its own async component so the surrounding <Suspense> can
 * fall back to the plain, vigor-less grid instantly.
 *
 * Takes the same per-parcel NDVI promises shared with SatelliteCard rather
 * than fetching itself — each parcel's Sentinel Hub call happens exactly
 * once regardless of how many surfaces await it. Each promise is awaited
 * independently so one broken parcel never blanks the rest of the grid.
 */
async function ParcelGridWithVigors({
  parcels,
  ndviByParcel,
}: {
  parcels: ParcelOverviewEntry[];
  ndviByParcel: { id: string; ndvi: Promise<NdviResponse | null> }[];
}) {
  const resolved = await Promise.all(
    ndviByParcel.map(async (entry) => {
      const data = await entry.ndvi.catch(() => null);
      return [entry.id, data ? vigorIndexFromNdvi(data.mean_ndvi) : null] as const;
    }),
  );
  const vigorByParcel = Object.fromEntries(resolved);

  return <ParcelGrid parcels={parcels} vigorByParcel={vigorByParcel} />;
}

/**
 * KAT-14 — farmer-level multi-parcel overview.
 *
 * Layout provides the sidebar + topbar; this page renders the content
 * column: greeting, KPI strip, trend chart + satellite preview, and the
 * parcel grid — weather/trend stay scoped to the primary (first) parcel
 * where a farm-wide data source doesn't exist yet.
 */
export const dynamic = "force-dynamic";

export default async function FarmerDashboardPage() {
  const locale = await getLocale();
  const t = await getTranslations("farmer.overview");
  const profile = await getServerProfile();
  if (profile?.role !== "FARMER") return redirect({ href: "/dashboard", locale });

  const overview = await fetchFarmerOverview();

  if (!overview || overview.parcels.length === 0) {
    return <EmptyState />;
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("greetingMorning") : hour < 18 ? t("greetingAfternoon") : t("greetingEvening");
  const firstName = profile?.full_name?.split(/\s+/)[0] ?? "";
  const primaryParcel = overview.parcels[0]!;
  const firstParcelId = primaryParcel.parcel_id;

  // Fast reads (weather cache, telemetry history) run in parallel and block
  // the initial render — neither is slow.
  const [weather, history] = await Promise.all([
    fetchWeatherForParcel(firstParcelId),
    fetchTelemetryHistory(firstParcelId, "7d"),
  ]);

  // NDVI is deliberately NOT awaited here — the backend's satellite image
  // lookup is uncached upstream and can take several seconds per parcel.
  // One promise per parcel is created up front and shared between
  // SatelliteCard's multi-parcel strip and ParcelGrid's Vigor Index badges
  // (each awaits its own copy independently inside its own <Suspense>), so
  // every parcel's Sentinel Hub call happens exactly once regardless of how
  // many surfaces render its NDVI.
  const ndviByParcel = overview.parcels.map((p) => ({
    id: p.parcel_id,
    name: p.name,
    ndvi: fetchNdviForParcel(p.parcel_id),
  }));

  return (
    <div className="mx-auto max-w-7xl vc-fade-in">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={`${greeting}${firstName ? `, ${firstName}` : ""}.`}
        subtitle={t("subtitle")}
      />

      <div className="space-y-8">
        <StatusRow weather={weather?.current ?? null} kpi={overview.kpi} />
        <QuickActions firstParcelId={firstParcelId} />
        <KpiStrip kpi={overview.kpi} weather={weather?.current ?? null} />

        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <TrendChart history={history} daily={weather?.daily ?? []} />
          <Suspense fallback={<SatelliteCardSkeleton />}>
            <SatelliteCard parcels={ndviByParcel} />
          </Suspense>
        </section>

        <section>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-neutral-900">
                {t("myParcelsTitle")}
              </h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                {t("parcelsCount", { count: overview.parcels.length })}
              </p>
            </div>
            <Link
              href="/dashboard/farmer/parcels/new"
              className="inline-flex items-center gap-1.5 rounded-xl bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:bg-leaf-700 hover:shadow-lifted"
            >
              {t("addParcel")}
            </Link>
          </div>
          <Suspense fallback={<ParcelGrid parcels={overview.parcels} />}>
            <ParcelGridWithVigors
              parcels={overview.parcels}
              ndviByParcel={ndviByParcel}
            />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
