import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { fetchFarmerOverview } from "@/app/dashboard/farmer/overview-actions";
import { getServerProfile, getServerSession } from "@/lib/auth/session";

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
import { ParcelSwitcher } from "./ParcelSwitcher";
import { ParcelTabsStream } from "./ParcelTabsStream";

export const dynamic = "force-dynamic";

export default async function ParcelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) redirect("/login");

  const profile = await getServerProfile();
  if (profile?.role !== "FARMER") redirect("/dashboard");

  const isVerified = profile.verification_status === "VERIFIED";

  // Token forwarded to all backend calls to avoid redundant getSession()
  // round-trips inside each server action.
  const token = session.access_token;

  // Critical path: only the parcel identity (one fast read) + the overview that
  // feeds the switcher/status pill. The heavy telemetry/devices/diagnostic
  // reads stream in below via <Suspense>, so the header paints immediately.
  const [parcel, overview] = await Promise.all([
    fetchParcel(id),
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

      <Suspense
        fallback={
          <div aria-busy="true">
            <div className="vc-skeleton h-10 w-full max-w-sm" />
            <div className="vc-skeleton mt-6 h-64 w-full" />
          </div>
        }
      >
        <ParcelTabsStream
          parcelId={parcel.id}
          parcelName={parcel.name}
          token={token}
          isVerified={isVerified}
        />
      </Suspense>
    </div>
  );
}
