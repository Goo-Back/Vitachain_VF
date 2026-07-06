"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { toIntlLocale } from "@/lib/intlLocale";

import { ChartIcon, CloudRainIcon, DropletIcon, ThermometerIcon } from "./_ui/Icon";
import type { TrendHistoryResponse } from "./trend-actions";
import type { WeatherDaily } from "./weather/actions";

type TabKey = "moisture" | "temperature" | "precip";

const TAB_META: { key: TabKey; labelKey: string; icon: React.ReactNode; unit: string; color: string }[] = [
  { key: "moisture", labelKey: "moisture", icon: <DropletIcon size={14} />, unit: "%", color: "oklch(0.58 0.15 245)" },
  { key: "temperature", labelKey: "temperature", icon: <ThermometerIcon size={14} />, unit: "°C", color: "oklch(0.67 0.14 70)" },
  { key: "precip", labelKey: "precip", icon: <CloudRainIcon size={14} />, unit: "mm", color: "oklch(0.62 0.13 220)" },
];

function dayLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: "short" }).replace(".", "");
}

export function TrendChart({
  history,
  daily,
}: {
  history: TrendHistoryResponse;
  daily: WeatherDaily[];
}) {
  const t = useTranslations("farmer.overview.trend");
  const intlLocale = toIntlLocale(useLocale());
  const [tab, setTab] = useState<TabKey>("moisture");
  const activeMeta = TAB_META.find((m) => m.key === tab)!;
  const active = { ...activeMeta, label: t(activeMeta.labelKey) };

  const historyData = useMemo(
    () =>
      history.buckets.map((b) => ({
        label: dayLabel(b.bucket, intlLocale),
        moisture: b.soil_moisture,
        temperature: b.soil_temperature,
      })),
    [history.buckets, intlLocale],
  );

  const precipData = useMemo(
    () =>
      daily.map((d) => ({
        label: dayLabel(d.iso, intlLocale),
        precip: d.rain_mm,
      })),
    [daily, intlLocale],
  );

  // Normalised to a single { label, value } shape regardless of tab — the
  // three tabs have genuinely different source arrays (7 history buckets
  // vs 5 forecast days), so this keeps the chart's data prop single-typed
  // rather than a discriminated union recharts can't infer through.
  const data: { label: string; value: number }[] = useMemo(() => {
    if (tab === "precip") return precipData.map((d) => ({ label: d.label, value: d.precip }));
    if (tab === "temperature") return historyData.map((d) => ({ label: d.label, value: d.temperature }));
    return historyData.map((d) => ({ label: d.label, value: d.moisture }));
  }, [tab, historyData, precipData]);
  const empty = data.length === 0;

  return (
    <div className="katara-card flex h-full flex-col p-5">
      <span aria-hidden="true" className="katara-glow" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-neutral-900">
          <ChartIcon size={16} />
          {t("title")}
        </h3>
        {tab === "precip" && (
          <span className="vc-pill vc-pill-info text-[10px]">{t("forecast5d")}</span>
        )}
      </div>

      <div role="tablist" aria-label={t("tabsAriaLabel")} className="mb-4 flex gap-1 rounded-xl bg-neutral-100 p-1">
        {TAB_META.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={tab === m.key}
            onClick={() => setTab(m.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
              tab === m.key
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {m.icon}
            <span className="hidden sm:inline">{t(m.labelKey)}</span>
          </button>
        ))}
      </div>

      {empty ? (
        <div className="grid flex-1 place-items-center py-10 text-center text-sm text-neutral-500">
          {tab === "precip"
            ? t("noPrecipData")
            : t("noSensorData")}
        </div>
      ) : (
        <div className="h-56 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id={`trend-fill-${tab}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={active.color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={active.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                width={36}
                unit={active.unit}
              />
              <Tooltip
                cursor={{ stroke: active.color, strokeWidth: 1, strokeDasharray: "3 3" }}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
                formatter={(value) => [`${Number(value).toFixed(1)} ${active.unit}`, active.label]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={active.color}
                strokeWidth={2}
                fill={`url(#trend-fill-${tab})`}
                dot={{ r: 3, fill: active.color, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={true}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
