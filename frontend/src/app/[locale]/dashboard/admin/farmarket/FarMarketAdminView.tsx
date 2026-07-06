"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { CodReconciliationPanel } from "./CodReconciliationPanel";
import { OrdersManagementPanel } from "./OrdersManagementPanel";
import { ReportsPanel } from "./ReportsPanel";
import { StatsDashboard } from "./StatsDashboard";
import type { AdminOrderListItem, AdminStats } from "./types";

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
  outstandingCod: AdminOrderListItem[];
  outstandingCodTotal: number;
  orders: AdminOrderListItem[];
  ordersTotal: number;
  stats: AdminStats | null;
};

type Tab = "dashboard" | "orders" | "ads" | "cod" | "reports";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  EXPIRED: "bg-yellow-100 text-yellow-700",
  DELETED: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-neutral-100 text-neutral-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

function FeaturedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      {label}
    </span>
  );
}

export function FarMarketAdminView({
  ads: initialAds,
  accessToken,
  adTotal,
  outstandingCod,
  outstandingCodTotal,
  orders,
  ordersTotal,
  stats,
}: Props) {
  const t = useTranslations("admin.farmarket.adminView");
  const [tab, setTab] = useState<Tab>("dashboard");
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
        <h1 className="text-2xl font-bold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t("subtitle")}
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
        <TabButton
          active={tab === "dashboard"}
          onClick={() => setTab("dashboard")}
          label={t("tabs.dashboard")}
          count={stats?.orders_total ?? 0}
        />
        <TabButton
          active={tab === "orders"}
          onClick={() => setTab("orders")}
          label={t("tabs.orders")}
          count={ordersTotal}
        />
        <TabButton
          active={tab === "ads"}
          onClick={() => setTab("ads")}
          label={t("tabs.ads")}
          count={adTotal}
        />
        <TabButton
          active={tab === "cod"}
          onClick={() => setTab("cod")}
          label={t("tabs.cod")}
          count={outstandingCodTotal}
          highlight={outstandingCodTotal > 0}
        />
        <TabButton
          active={tab === "reports"}
          onClick={() => setTab("reports")}
          label={t("tabs.reports")}
          count={stats?.delivered_count ?? 0}
        />
      </nav>

      {tab === "dashboard" && <StatsDashboard stats={stats} />}

      {tab === "orders" && (
        <OrdersManagementPanel initial={orders} accessToken={accessToken} />
      )}

      {tab === "reports" && <ReportsPanel stats={stats} />}

      {tab === "ads" && (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  {[
                    t("table.title"),
                    t("table.typeRegion"),
                    t("table.price"),
                    t("table.status"),
                    t("table.pinned"),
                    t("table.actions"),
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {ads.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-neutral-400"
                    >
                      {t("empty")}
                    </td>
                  </tr>
                )}
                {ads.map((ad) => (
                  <tr
                    key={ad.id}
                    className={
                      ad.is_featured ? "bg-amber-50" : "hover:bg-neutral-50"
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {ad.is_featured && <FeaturedBadge label={t("featured")} />}
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
                        <span className="text-xs font-semibold text-amber-700">
                          {t("pinnedYes")}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">{t("pinnedNo")}</span>
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
                          ? t("togglePending")
                          : ad.is_featured
                            ? t("unpin")
                            : t("pin")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "cod" && (
        <CodReconciliationPanel
          initial={outstandingCod}
          accessToken={accessToken}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  highlight,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition ${
        active
          ? "border-leaf-600 font-medium text-leaf-700"
          : "border-transparent text-neutral-500 hover:text-neutral-800"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          highlight && !active
            ? "bg-amber-100 text-amber-800"
            : active
              ? "bg-leaf-100 text-leaf-800"
              : "bg-neutral-100 text-neutral-600"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
