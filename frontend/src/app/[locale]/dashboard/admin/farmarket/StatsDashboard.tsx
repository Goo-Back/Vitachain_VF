"use client";

import { useLocale, useTranslations } from "next-intl";

import { toIntlLocale } from "@/lib/intlLocale";

import type { AdminStats } from "./types";

type Props = {
  stats: AdminStats | null;
};

export function StatsDashboard({ stats }: Props) {
  const t = useTranslations("admin.farmarket.stats");
  const intlLocale = toIntlLocale(useLocale());

  if (!stats) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
        {t("unavailable")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label={t("kpis.ordersTotal")}
          value={String(stats.orders_total)}
          tone="leaf"
        />
        <Kpi
          label={t("kpis.revenueBooked")}
          value={`${fmt(stats.revenue_booked_mad, intlLocale)} MAD`}
          hint={t("revenueBookedHint")}
          tone="leaf"
        />
        <Kpi
          label={t("kpis.revenueCollected")}
          value={`${fmt(stats.revenue_collected_mad, intlLocale)} MAD`}
          tone="emerald"
        />
        <Kpi
          label={t("kpis.codOutstanding")}
          value={`${fmt(stats.cod_outstanding_mad, intlLocale)} MAD`}
          tone={Number(stats.cod_outstanding_mad) > 0 ? "amber" : "leaf"}
        />
        <Kpi
          label={t("kpis.productsSold")}
          value={`${fmt(stats.products_sold_kg, intlLocale)} kg`}
          tone="leaf"
        />
        <Kpi
          label={t("kpis.delivered")}
          value={String(stats.delivered_count)}
          tone="emerald"
        />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "leaf" | "amber" | "emerald";
}) {
  const ring =
    tone === "amber"
      ? "ring-amber-100 bg-amber-50"
      : tone === "emerald"
        ? "ring-emerald-100 bg-emerald-50"
        : "ring-leaf-100 bg-leaf-50";
  return (
    <div className={`rounded-lg p-4 ring-1 ${ring}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-neutral-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function fmt(v: string, locale: string): string {
  return Number(v).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
