import Link from "next/link";
import { redirect } from "next/navigation";

import { getServerProfile } from "@/lib/auth/session";

import {
  ArrowRightIcon,
  CalendarIcon,
  InfoIcon,
  MapPinIcon,
  PlusIcon,
  SproutIcon,
} from "../_ui/Icon";

import { PageHeader } from "../_ui/PageHeader";
import { MotionCard, Stagger } from "../_ui/motion";

import { fetchMyParcels, type Parcel } from "./actions";

export const dynamic = "force-dynamic";

export default async function ParcelsPage() {
  const profile = await getServerProfile();
  if (profile?.role !== "FARMER") redirect("/dashboard");

  const isUnverified = profile.verification_status !== "VERIFIED";
  const parcels = isUnverified ? [] : await fetchMyParcels();

  return (
    <div className="mx-auto max-w-6xl vc-fade-in">
      <PageHeader
        crumbs={[{ label: "Mon exploitation", href: "/dashboard/farmer" }, { label: "Mes parcelles" }]}
        eyebrow="Mes parcelles"
        title={`${parcels.length} parcelle${parcels.length > 1 ? "s" : ""} enregistrée${parcels.length > 1 ? "s" : ""}`}
        subtitle={
          isUnverified
            ? undefined
            : "Cliquez sur une parcelle pour voir sa télémétrie, ses seuils et son diagnostic."
        }
        actions={
          isUnverified ? undefined : (
            <Link href="/dashboard/farmer/parcels/new" className="vc-btn-primary">
              <PlusIcon size={14} /> Nouvelle parcelle
            </Link>
          )
        }
      />

      {isUnverified ? (
        <UnverifiedNotice />
      ) : parcels.length === 0 ? (
        <EmptyState />
      ) : (
        <Stagger as="ul" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {parcels.map((p) => (
            <ParcelListItem key={p.id} parcel={p} />
          ))}
        </Stagger>
      )}
    </div>
  );
}

function UnverifiedNotice() {
  return (
    <div className="vc-card flex items-start gap-4 border-warn-500/30 bg-warn-50/60 p-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warn-50 text-warn-700">
        <InfoIcon size={20} />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-warn-700">
          Vérification professionnelle requise.
        </p>
        <p className="mt-1 text-sm text-neutral-700">
          Vous devez d&apos;abord faire valider vos documents pour enregistrer une parcelle.
        </p>
        <Link
          href="/onboarding/verification"
          className="vc-btn-primary mt-3"
        >
          Soumettre mes documents <ArrowRightIcon size={14} />
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="vc-card p-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-leaf-50">
        <SproutIcon size={28} className="text-leaf-700" />
      </span>
      <p className="mt-4 text-base font-semibold text-neutral-900">
        Aucune parcelle pour l&apos;instant.
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        Créez votre première parcelle pour activer l&apos;ingestion IoT.
      </p>
      <Link
        href="/dashboard/farmer/parcels/new"
        className="vc-btn-primary mt-5"
      >
        <PlusIcon size={14} /> Créer une parcelle
      </Link>
    </div>
  );
}

function ParcelListItem({ parcel }: { parcel: Parcel }) {
  return (
    <MotionCard as="li" className="h-full">
      <Link
        href={`/dashboard/farmer/parcels/${parcel.id}`}
        className="katara-card group relative flex h-full flex-col overflow-hidden p-5 focus:outline-none"
      >
        <span aria-hidden="true" className="katara-glow" />
        <div className="relative flex items-start justify-between">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-tint-50 ring-1 ring-inset ring-sky-tint-500/10">
            <MapPinIcon size={20} className="text-sky-tint-700" />
          </span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-neutral-50 text-neutral-300 transition-all duration-300 group-hover:bg-sky-tint-50 group-hover:text-sky-tint-700">
            <ArrowRightIcon
              size={16}
              className="transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </span>
        </div>
        <p className="relative mt-4 truncate text-lg font-semibold text-neutral-900">
          {parcel.name}
        </p>
        <p className="relative mt-1 flex items-center gap-1.5 text-xs text-neutral-600">
          <SproutIcon size={12} className="text-leaf-600" />
          {parcel.crop_type} · {Number(parcel.surface_area_ha).toFixed(2)} ha
        </p>
        <p className="relative mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
          <CalendarIcon size={12} />
          Créée le {new Date(parcel.created_at).toLocaleDateString("fr-FR")}
        </p>
      </Link>
    </MotionCard>
  );
}
