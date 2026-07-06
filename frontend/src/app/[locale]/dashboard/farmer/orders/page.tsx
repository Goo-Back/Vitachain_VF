import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { toIntlLocale } from "@/lib/intlLocale";

import {
  ArrowRightIcon,
  ChartIcon,
  CheckCircleIcon,
  ClockIcon,
  InfoIcon,
  PackageIcon,
  StoreIcon,
} from "../_ui/Icon";
import { PageHeader } from "../_ui/PageHeader";
import type { IncomingItem } from "./actions";
import { fetchIncomingItems } from "./actions";
import { IncomingItemRow } from "./IncomingItemRow";

export const dynamic = "force-dynamic";

const ACTIVE_ITEM_STATUSES = new Set<IncomingItem["status"]>([
  "PENDING",
  "ACCEPTED",
  "PICKED_UP",
  "IN_TRANSIT",
]);

const COLUMN_KEYS = [
  "resto",
  "ad",
  "quantity",
  "total",
  "region",
  "status",
  "actions",
];

function computeKpis(items: IncomingItem[]) {
  let caLivre = 0;
  let kgLivres = 0;
  let actifs = 0;
  let enAttente = 0;

  for (const it of items) {
    if (it.status === "DELIVERED") {
      caLivre += Number(it.line_total_mad);
      kgLivres += Number(it.quantity_kg);
    }
    if (ACTIVE_ITEM_STATUSES.has(it.status)) actifs++;
    if (it.status === "PENDING") enAttente++;
  }
  return { caLivre, kgLivres, actifs, enAttente };
}

export default async function FarmerOrdersPage() {
  const t = await getTranslations("farmer.orders.list");
  const tCommon = await getTranslations("farmer.common");
  const intlLocale = toIntlLocale(await getLocale());
  const items = await fetchIncomingItems();
  const pending = items.filter((it) => it.status === "PENDING").length;
  const kpi = computeKpis(items);

  return (
    <div className="mx-auto max-w-6xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: tCommon("breadcrumbHome"), href: "/dashboard/farmer" },
          { label: t("breadcrumb") },
        ]}
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          items.length > 0 ? (
            <span className={`vc-pill ${pending > 0 ? "vc-pill-warn" : "vc-pill-leaf"}`}>
              <PackageIcon size={12} />
              {pending > 0
                ? t("pendingBadge", { count: pending })
                : t("ordersCountBadge", { count: items.length })}
            </span>
          ) : null
        }
      />

      {items.length > 0 && (
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile
            icon={<ChartIcon size={18} />}
            tint="leaf"
            label={t("kpi.revenueDelivered")}
            value={`${kpi.caLivre.toLocaleString(intlLocale)} MAD`}
            sub={t("kpi.revenueSub")}
          />
          <KpiTile
            icon={<ClockIcon size={18} />}
            tint="info"
            label={t("kpi.activeLines")}
            value={String(kpi.actifs)}
            sub={t("kpi.activeSub")}
          />
          <KpiTile
            icon={<PackageIcon size={18} />}
            tint="soil"
            label={t("kpi.kgDelivered")}
            value={`${kpi.kgLivres.toLocaleString(intlLocale)} kg`}
            sub={t("kpi.kgSub")}
          />
          <KpiTile
            icon={<CheckCircleIcon size={18} />}
            tint={kpi.enAttente > 0 ? "warn" : "leaf"}
            label={t("kpi.pending")}
            value={String(kpi.enAttente)}
            sub={kpi.enAttente > 0 ? t("kpi.pendingSubAction") : t("kpi.pendingSubNone")}
            highlight={kpi.enAttente > 0}
          />
        </section>
      )}

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="vc-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-100 text-sm">
              <thead className="bg-neutral-50/80">
                <tr>
                  {COLUMN_KEYS.map((k) => (
                    <th
                      key={k}
                      scope="col"
                      className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
                    >
                      {t(`columns.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((it) => (
                  <IncomingItemRow key={it.id} item={it} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {items.length > 0 ? (
        <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-neutral-400">
          <InfoIcon size={12} />
          {t("scrollHint")}
        </p>
      ) : null}
    </div>
  );
}

async function EmptyState() {
  const t = await getTranslations("farmer.orders.list");
  return (
    <div className="vc-card p-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sky-tint-50">
        <PackageIcon size={28} className="text-sky-tint-700" />
      </span>
      <p className="mt-4 text-base font-semibold text-neutral-900">
        {t("emptyTitle")}
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        {t("emptyBody")}
      </p>
      <Link href="/dashboard/farmer/ads" className="vc-btn-ghost mt-5">
        <StoreIcon size={14} /> {t("manageAds")}
        <ArrowRightIcon size={14} className="rtl:-scale-x-100" />
      </Link>
    </div>
  );
}

function KpiTile({
  icon,
  tint,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  tint: "leaf" | "soil" | "info" | "warn";
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  const tintMap = {
    leaf: "bg-leaf-50 text-leaf-700 ring-leaf-100",
    soil: "bg-soil-50 text-soil-700 ring-soil-100",
    info: "bg-sky-tint-50 text-sky-tint-700 ring-sky-tint-50",
    warn: "bg-warn-50 text-warn-700 ring-warn-200",
  }[tint];

  return (
    <div className={`vc-card p-4 ${highlight ? "ring-1 ring-warn-400/40" : ""}`}>
      <span className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ring-inset ${tintMap}`}>
        {icon}
      </span>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-semibold tabular tracking-tight text-neutral-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-neutral-500">{sub}</p>
    </div>
  );
}
