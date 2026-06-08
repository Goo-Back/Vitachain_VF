import Link from "next/link";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  MapPinIcon,
} from "@/app/dashboard/farmer/_ui/Icon";

import type { FarmerPublicProfile } from "./actions";
import { StarRating } from "./StarRating";

/**
 * Producer summary shown on the offer detail page. Replaces the old "identity
 * anonyme" blurb — discovery now reveals the verified producer (FAR-11).
 */
export function FarmerCard({
  farmer,
  linkToProfile = true,
}: {
  farmer: FarmerPublicProfile;
  linkToProfile?: boolean;
}) {
  const memberSince = new Date(farmer.member_since).toLocaleDateString("fr-MA", {
    month: "long",
    year: "numeric",
  });
  const initials = farmer.display_name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="vc-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-leaf-100 text-sm font-semibold text-leaf-800">
          {initials || "🌿"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {farmer.display_name}
          </p>
          <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircleIcon size={12} /> Producteur vérifié
          </span>
          <div className="mt-1.5">
            <StarRating value={farmer.rating_avg} count={farmer.rating_count} />
          </div>
        </div>
      </div>

      <dl className="mt-4 space-y-2 text-xs text-neutral-600">
        {farmer.region && (
          <div className="flex items-center gap-2">
            <MapPinIcon size={14} className="text-neutral-400" />
            <span>{farmer.region}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-neutral-400">Membre depuis</span>
          <span className="capitalize">{memberSince}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-400">Annonces actives</span>
          <span>{farmer.active_ad_count}</span>
        </div>
      </dl>

      {linkToProfile && (
        <Link
          href={`/dashboard/restaurant/marketplace/farmer/${farmer.id}`}
          className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-leaf-700 hover:underline"
        >
          Voir le profil du producteur <ArrowRightIcon size={12} />
        </Link>
      )}
    </div>
  );
}
