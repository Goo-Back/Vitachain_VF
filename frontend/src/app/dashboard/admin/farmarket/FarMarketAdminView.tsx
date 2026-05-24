"use client";

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type AdminAd = {
  id: string;
  farmer_id: string;
  title: string;
  product_type: string;
  region: string;
  price_mad: string;
  quantity_kg: string;
  status: string;
  is_featured: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type Props = {
  ads: AdminAd[];
  accessToken: string;
  adTotal: number;
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  EXPIRED: "bg-yellow-100 text-yellow-700",
  DELETED: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-neutral-100 text-neutral-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function FeaturedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      ★ Mis en avant
    </span>
  );
}

export function FarMarketAdminView({
  ads: initialAds,
  accessToken,
  adTotal,
}: Props) {
  const [ads, setAds] = useState<AdminAd[]>(initialAds);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggleFeatured(adId: string) {
    setToggling(adId);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/farmarket/ads/${adId}/feature`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (res.ok) {
        const updated = await res.json();
        setAds((prev) =>
          prev.map((ad) =>
            ad.id === adId ? { ...ad, is_featured: updated.is_featured } : ad,
          ),
        );
      }
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">FarMarket</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Vue opérateur — annonces du marché B2B agricole ({adTotal}).
        </p>
      </div>

      {/* Ads table (Leads tab removed — see migration 0039 and the rewritten
          FAR-03/FAR-04 stories. Order tracking will land in FAR-10.) */}
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  {["Titre", "Type / Région", "Prix", "Statut", "Épinglé ?", "Actions"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {ads.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                      Aucune annonce.
                    </td>
                  </tr>
                )}
                {ads.map((ad) => (
                  <tr
                    key={ad.id}
                    className={ad.is_featured ? "bg-amber-50" : "hover:bg-neutral-50"}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {ad.is_featured && <FeaturedBadge />}
                        <span className="max-w-xs truncate font-medium text-neutral-900">
                          {ad.title}
                        </span>
                        <span className="text-xs text-neutral-400">
                          {ad.farmer_id.slice(0, 8)}…
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      <div>{ad.product_type}</div>
                      <div className="text-xs text-neutral-400">{ad.region}</div>
                    </td>
                    <td className="px-4 py-3 font-medium text-leaf-700">
                      {Number(ad.price_mad).toFixed(2)} MAD/kg
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={ad.status} />
                    </td>
                    <td className="px-4 py-3">
                      {ad.is_featured ? (
                        <span className="text-xs font-semibold text-amber-700">Oui ★</span>
                      ) : (
                        <span className="text-xs text-neutral-400">Non</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        disabled={toggling === ad.id}
                        onClick={() => toggleFeatured(ad.id)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                          ad.is_featured
                            ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                            : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                        }`}
                      >
                        {toggling === ad.id
                          ? "…"
                          : ad.is_featured
                          ? "Désépingler"
                          : "Épingler"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
}
