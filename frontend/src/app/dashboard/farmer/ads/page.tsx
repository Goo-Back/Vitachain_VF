import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/supabase/types";

import {
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  InfoIcon,
  PackageIcon,
  PlusIcon,
  StoreIcon,
  TagIcon,
} from "../_ui/Icon";
import { PageHeader } from "../_ui/PageHeader";
import { deleteAd, fetchMyAds, type Ad } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<Ad["status"], string> = {
  ACTIVE: "Active",
  EXPIRED: "Expirée",
  DELETED: "Supprimée",
};

const STATUS_CLASS: Record<Ad["status"], string> = {
  ACTIVE: "bg-leaf-50 text-leaf-700 ring-leaf-200",
  EXPIRED: "bg-neutral-100 text-neutral-500 ring-neutral-200",
  DELETED: "bg-red-50 text-red-600 ring-red-200",
};

export default async function AdsPage() {
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

  const isUnverified = profile.verification_status !== "VERIFIED";
  const ads = isUnverified ? [] : await fetchMyAds();

  return (
    <div className="mx-auto max-w-5xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: "Mes annonces" },
        ]}
        eyebrow="FarMarket"
        title={`${ads.length} annonce${ads.length !== 1 ? "s" : ""}`}
        subtitle={
          isUnverified
            ? undefined
            : "Gérez vos annonces de vente sur le marché agricole B2B."
        }
        actions={
          isUnverified ? undefined : (
            <Link href="/dashboard/farmer/ads/new" className="vc-btn-primary">
              <PlusIcon size={14} /> Nouvelle annonce
            </Link>
          )
        }
      />

      {isUnverified ? (
        <UnverifiedNotice />
      ) : ads.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {ads.map((ad) => (
            <AdCard key={ad.id} ad={ad} />
          ))}
        </ul>
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
          Vous devez d&apos;abord faire valider vos documents pour publier une annonce.
        </p>
        <Link href="/onboarding/verification" className="vc-btn-primary mt-3">
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
        <StoreIcon size={28} className="text-leaf-700" />
      </span>
      <p className="mt-4 text-base font-semibold text-neutral-900">
        Aucune annonce pour l&apos;instant.
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        Publiez votre première annonce pour être visible des restaurateurs.
      </p>
      <Link href="/dashboard/farmer/ads/new" className="vc-btn-primary mt-5">
        <PlusIcon size={14} /> Créer une annonce
      </Link>
    </div>
  );
}

function AdCard({ ad }: { ad: Ad }) {
  const expiresAt = new Date(ad.expires_at);
  const now = new Date();
  const daysLeft = Math.ceil(
    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  return (
    <li>
      <div className="vc-card group block p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-leaf-50">
            {ad.photo_urls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ad.photo_urls[0]}
                alt={ad.title}
                className="h-10 w-10 rounded-lg object-cover"
              />
            ) : (
              <PackageIcon size={20} className="text-leaf-700" />
            )}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLASS[ad.status]}`}
          >
            {STATUS_LABEL[ad.status]}
          </span>
        </div>

        <p className="mt-4 truncate text-base font-semibold text-neutral-900">
          {ad.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
          <TagIcon size={12} className="text-leaf-600" />
          {ad.product_type} · {Number(ad.price_mad).toFixed(2)} MAD/kg
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
          <PackageIcon size={12} />
          {Number(ad.quantity_kg).toFixed(0)} kg · {ad.region}
        </p>

        {ad.status === "ACTIVE" && daysLeft > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
            <ClockIcon size={12} />
            Expire dans {daysLeft} jour{daysLeft !== 1 ? "s" : ""}
          </p>
        )}
        {ad.status === "ACTIVE" && daysLeft <= 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
            <CalendarIcon size={12} />
            Expire aujourd&apos;hui
          </p>
        )}

        {ad.status === "ACTIVE" && (
          <div className="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-4">
            <Link
              href={`/dashboard/farmer/ads/${ad.id}/edit`}
              className="vc-btn-ghost flex-1 py-1.5 text-xs"
            >
              Modifier
            </Link>
            <form
              action={async () => {
                "use server";
                await deleteAd(ad.id);
              }}
              className="flex-1"
            >
              <button
                type="submit"
                className="w-full rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 ring-1 ring-red-200 hover:bg-red-50 transition-colors"
              >
                Supprimer
              </button>
            </form>
          </div>
        )}
      </div>
    </li>
  );
}
