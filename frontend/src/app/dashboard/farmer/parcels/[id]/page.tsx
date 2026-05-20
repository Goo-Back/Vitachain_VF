import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { fetchFarmerOverview } from "@/app/dashboard/farmer/overview-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import {
  AlertIcon,
  CalendarIcon,
  CheckCircleIcon,
  EditIcon,
  InfoIcon,
  SproutIcon,
} from "@/app/dashboard/farmer/_ui/Icon";
import { PageHeader } from "@/app/dashboard/farmer/_ui/PageHeader";

import { fetchParcel } from "../actions";
import { DeleteParcelButton } from "./DeleteParcelButton";
import { fetchParcelDevices } from "./actions";
import { fetchLatestDiagnostic } from "./diagnostic-actions";
import { ParcelPageTabs } from "./ParcelPageTabs";
import { ParcelSwitcher } from "./ParcelSwitcher";
import { fetchInitialTelemetry } from "./telemetry-actions";
import { fetchThresholds } from "./thresholds-actions";

export const dynamic = "force-dynamic";

export default async function ParcelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  const isVerified = profile.verification_status === "VERIFIED";

  // Get session once — token is forwarded to all backend calls to avoid
  // redundant getSession() round-trips inside each server action.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const [
    parcel,
    devices,
    initialTelemetry,
    initialThresholds,
    initialDiagnostic,
    overview,
  ] = await Promise.all([
    fetchParcel(id),
    isVerified ? fetchParcelDevices(id).catch(() => []) : Promise.resolve([]),
    fetchInitialTelemetry(id, token).catch(() => null),
    fetchThresholds(id, token),
    fetchLatestDiagnostic(id, token).catch(() => null),
    fetchFarmerOverview(token).catch(() => null),
  ]);

  if (!parcel) notFound();

  const switcherParcels = overview?.parcels ?? [];

  // Derive a quick top-level status pill from the overview entry for this
  // parcel — falls back to "no data" when the overview is unavailable.
  const overviewEntry = overview?.parcels.find((p) => p.parcel_id === id);
  const statusPill =
    overviewEntry?.has_open_threshold_breach
      ? { tone: "warn", label: "Seuil dépassé", icon: <AlertIcon size={12} /> }
      : (overviewEntry?.device_offline_count ?? 0) > 0
        ? { tone: "info", label: "Capteur hors-ligne", icon: <InfoIcon size={12} /> }
        : { tone: "ok", label: "Tout va bien", icon: <CheckCircleIcon size={12} /> };

  return (
    <div className="mx-auto max-w-5xl vc-fade-in">
      <ParcelSwitcher currentParcelId={parcel.id} parcels={switcherParcels} />

      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: parcel.name },
        ]}
        eyebrow="Parcelle"
        title={parcel.name}
        subtitle={undefined}
        actions={
          <>
            <Link
              href={`/dashboard/farmer/parcels/${parcel.id}/edit`}
              className="vc-btn-ghost inline-flex items-center gap-1.5"
            >
              <EditIcon size={14} /> Modifier
            </Link>
            <DeleteParcelButton parcelId={parcel.id} />
            <span className={`vc-pill vc-pill-${statusPill.tone}`}>
              {statusPill.icon}
              {statusPill.label}
            </span>
          </>
        }
      />

      {/* Meta strip */}
      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <SproutIcon size={14} className="text-leaf-600" />
          {parcel.crop_type}
        </span>
        <span className="text-neutral-300">·</span>
        <span className="tabular">{Number(parcel.surface_area_ha).toFixed(2)} ha</span>
        <span className="text-neutral-300">·</span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarIcon size={14} className="text-neutral-400" />
          Créée le{" "}
          {new Date(parcel.created_at).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
      </div>

      <ParcelPageTabs
        parcelId={parcel.id}
        parcelName={parcel.name}
        accessToken={token ?? ""}
        isVerified={isVerified}
        initialDevices={devices}
        canPair={isVerified}
        initialTelemetry={initialTelemetry}
        initialThresholds={initialThresholds}
        initialDiagnostic={initialDiagnostic}
      />
    </div>
  );
}
