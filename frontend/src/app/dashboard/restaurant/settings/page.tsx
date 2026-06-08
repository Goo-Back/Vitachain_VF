import Link from "next/link";

import { getServerProfile } from "@/lib/auth/session";
import { MOROCCO_REGIONS } from "@/app/dashboard/farmer/ads/new/regions";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  InfoIcon,
  LogoutIcon,
  PackageIcon,
  SettingsIcon,
} from "@/app/dashboard/farmer/_ui/Icon";
import { PageHeader } from "@/app/dashboard/farmer/_ui/PageHeader";

import { DeliveryPreferencesForm } from "./DeliveryPreferencesForm";

export const dynamic = "force-dynamic";

export default async function RestaurantSettingsPage() {
  const profile = await getServerProfile();

  const isVerified = profile?.verification_status === "VERIFIED";
  const localeLabel =
    profile?.locale === "ar"
      ? "العربية"
      : profile?.locale === "en"
        ? "English"
        : "Français";

  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Restaurateur", href: "/dashboard/restaurant" },
          { label: "Paramètres" },
        ]}
        eyebrow="Paramètres"
        title="Votre établissement."
        subtitle="Informations de profil, préférences de livraison et statut de vérification."
      />

      <div className="space-y-6">
        <SectionCard
          icon={<SettingsIcon size={18} className="text-leaf-700" />}
          title="Profil de l'établissement"
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <Row label="Raison sociale" value={profile?.full_name ?? "—"} />
            <Row label="Email" value={profile?.email ?? "—"} />
            <Row label="Téléphone" value={profile?.phone ?? "—"} />
            <Row label="Rôle" value="Restaurateur" />
            <Row label="Langue" value={localeLabel} />
          </dl>
          <p className="mt-4 text-xs text-neutral-500">
            Ces informations sont uniquement utilisées par VitaChain pour
            coordonner vos livraisons. Elles ne sont jamais partagées avec les
            producteurs.
          </p>
        </SectionCard>

        <SectionCard
          icon={<PackageIcon size={18} className="text-leaf-700" />}
          title="Préférences de livraison"
        >
          <DeliveryPreferencesForm regions={MOROCCO_REGIONS} />
        </SectionCard>

        <SectionCard
          icon={<CheckCircleIcon size={18} className="text-leaf-700" />}
          title="Vérification du compte"
        >
          <div
            className={`flex items-start gap-3 rounded-lg p-4 ${
              isVerified
                ? "bg-leaf-50 ring-1 ring-leaf-200"
                : "bg-warn-50 ring-1 ring-warn-500/30"
            }`}
          >
            {isVerified ? (
              <CheckCircleIcon size={20} className="mt-0.5 text-leaf-700" />
            ) : (
              <InfoIcon size={20} className="mt-0.5 text-warn-700" />
            )}
            <div className="flex-1">
              <p
                className={`text-sm font-semibold ${
                  isVerified ? "text-leaf-800" : "text-warn-700"
                }`}
              >
                {isVerified
                  ? "Compte vérifié"
                  : profile?.verification_status === "PENDING"
                    ? "Vérification en cours"
                    : "Vérification requise"}
              </p>
              <p className="mt-1 text-sm text-neutral-700">
                {isVerified
                  ? "Vous pouvez passer commande sans restriction et accéder aux producteurs premium."
                  : "La validation de votre RC ou ICE est nécessaire pour augmenter les plafonds de commande et accéder aux producteurs premium."}
              </p>
              {!isVerified ? (
                <Link
                  href="/onboarding/verification"
                  className="vc-btn-primary mt-3"
                >
                  Soumettre mes documents <ArrowRightIcon size={14} />
                </Link>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={<LogoutIcon size={18} className="text-neutral-500" />}
          title="Session"
        >
          <form action="/auth/signout" method="post">
            <button type="submit" className="vc-btn-ghost">
              <LogoutIcon size={14} /> Se déconnecter
            </button>
          </form>
        </SectionCard>
      </div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="vc-card p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-leaf-50">
          {icon}
        </span>
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-neutral-900">{value}</dd>
    </div>
  );
}
