import Link from "next/link";

import { fetchMyParcels } from "../parcels/actions";
import {
  ClockIcon,
  CloudIcon,
  CloudRainIcon,
  DropletIcon,
  InfoIcon,
  MapPinIcon,
  SproutIcon,
  SunIcon,
  ThermometerIcon,
  WindIcon,
} from "../_ui/Icon";
import { PageHeader } from "../_ui/PageHeader";
import { Stagger, StaggerItem } from "../_ui/motion";

import {
  fetchWeatherForParcel,
  type WeatherDaily,
  type WeatherIconKind,
} from "./actions";

/**
 * Météo · /dashboard/farmer/weather?parcel=<id>
 *
 * Reads from GET /api/v1/katara/parcels/{id}/weather — the backend handles
 * OpenWeatherMap auth + caching. No API keys live in this surface.
 */

export const dynamic = "force-dynamic";

function WIcon({
  kind,
  size = 18,
  className = "",
}: {
  kind: WeatherIconKind;
  size?: number;
  className?: string;
}) {
  if (kind === "sun") return <SunIcon size={size} className={`text-sun-700 ${className}`} />;
  if (kind === "rain" || kind === "storm")
    return <CloudRainIcon size={size} className={`text-sky-tint-700 ${className}`} />;
  return <CloudIcon size={size} className={`text-neutral-500 ${className}`} />;
}

/** Soft, kind-aware backdrop gradient for the hero — keeps the surface lively. */
function heroGradient(kind: WeatherIconKind): string {
  if (kind === "sun") return "from-sun-50 via-white to-sky-tint-50";
  if (kind === "rain" || kind === "storm")
    return "from-sky-tint-50 via-white to-neutral-50";
  if (kind === "snow") return "from-sky-tint-50 via-white to-white";
  return "from-neutral-50 via-white to-sky-tint-50";
}

const FR_DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

function frDayLabel(iso: string, idx: number): string {
  if (idx === 0) return "Aujourd'hui";
  const d = new Date(iso);
  return FR_DAY_LABELS[d.getUTCDay()] ?? "—";
}

function frHourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function WeatherPage({
  searchParams,
}: {
  searchParams: Promise<{ parcel?: string }>;
}) {
  const sp = await searchParams;
  const parcels = await fetchMyParcels();
  const selectedParcel = sp.parcel
    ? (parcels.find((p) => p.id === sp.parcel) ?? null)
    : (parcels[0] ?? null);

  const weather = selectedParcel
    ? await fetchWeatherForParcel(selectedParcel.id)
    : null;

  return (
    <div className="mx-auto max-w-5xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: "Météo" },
        ]}
        eyebrow="Météo locale"
        title="Conditions actuelles & prévisions."
        subtitle="Données OpenWeatherMap, calculées au centroïde du polygone de la parcelle sélectionnée. Cache backend 3 h."
        actions={
          weather && selectedParcel ? (
            <span className="vc-pill vc-pill-leaf">
              <MapPinIcon size={12} /> {selectedParcel.name} · {weather.current.city_label}
            </span>
          ) : null
        }
      />

      <ParcelPicker
        parcels={parcels}
        selectedId={selectedParcel?.id ?? null}
      />

      {parcels.length === 0 ? (
        <NoParcelsPanel />
      ) : !weather ? (
        <UnavailablePanel />
      ) : (
        <WeatherView weather={weather} />
      )}
    </div>
  );
}

function ParcelPicker({
  parcels,
  selectedId,
}: {
  parcels: { id: string; name: string; crop_type: string }[];
  selectedId: string | null;
}) {
  if (parcels.length === 0) return null;
  return (
    <nav
      aria-label="Choix de la parcelle"
      className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-soft"
    >
      <span className="px-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Parcelle
      </span>
      {parcels.map((p) => {
        const active = p.id === selectedId;
        return (
          <Link
            key={p.id}
            href={`/dashboard/farmer/weather?parcel=${p.id}`}
            scroll={false}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              active
                ? "katara-gradient-strong text-white shadow-sm"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {p.name}
            <span className={`ml-1 ${active ? "text-white/70" : "text-neutral-400"}`}>
              · {p.crop_type}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function WeatherView({
  weather,
}: {
  weather: NonNullable<Awaited<ReturnType<typeof fetchWeatherForParcel>>>;
}) {
  const { current, hourly, daily } = weather;
  const updatedAt = new Date(weather.fetched_at).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      <section className={`vc-card relative overflow-hidden bg-gradient-to-br ${heroGradient(current.icon_kind)}`}>
        {/* Decorative oversized glyph bleeding off the corner — adds depth. */}
        <WIcon
          kind={current.icon_kind}
          size={220}
          className="pointer-events-none absolute -right-8 -top-10 opacity-[0.07]"
        />

        <div className="relative p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="vc-eyebrow text-neutral-500">
                Maintenant · {current.city_label}
              </p>
              <div className="mt-2 flex items-start gap-3">
                <span className="text-6xl font-semibold leading-none tracking-tight tabular text-neutral-900 sm:text-7xl">
                  {Math.round(current.temp_c)}°
                </span>
                <span className="mt-1 hidden sm:block">
                  <WIcon kind={current.icon_kind} size={48} />
                </span>
              </div>
              <p className="mt-3 text-sm capitalize text-neutral-700">
                {current.description}
                <span className="text-neutral-400"> · </span>
                ressenti {Math.round(current.feels_like_c)}°
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <span className="sm:hidden">
                <WIcon kind={current.icon_kind} size={56} />
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200 backdrop-blur">
                <ClockIcon size={12} className="text-neutral-400" />
                Mis à jour à {updatedAt}
              </span>
            </div>
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              icon={<ThermometerIcon size={16} className="text-warn-700" />}
              label="Min / Max"
              value={`${Math.round(current.temp_min_c)}° / ${Math.round(current.temp_max_c)}°`}
            />
            <Metric
              icon={<DropletIcon size={16} className="text-sky-tint-700" />}
              label="Humidité air"
              value={`${current.humidity_pct}%`}
            />
            <Metric
              icon={<WindIcon size={16} className="text-neutral-500" />}
              label="Vent"
              value={`${current.wind_kmh.toFixed(0)} km/h ${current.wind_dir}`}
            />
            <Metric
              icon={<CloudRainIcon size={16} className="text-sky-tint-700" />}
              label="Pluie 3 h"
              value={`${current.rain_mm_3h.toFixed(1)} mm`}
            />
          </dl>
        </div>

        {hourly.length > 0 ? (
          <div className="relative border-t border-neutral-200/60 bg-white/50 p-4 backdrop-blur sm:px-6">
            <p className="vc-eyebrow mb-3">24 prochaines heures</p>
            <ol className="flex gap-2 overflow-x-auto pb-1">
              {hourly.map((h, i) => (
                <li
                  key={h.iso}
                  className={`flex min-w-[64px] flex-1 flex-col items-center rounded-xl px-2 py-3 transition ${
                    i === 0
                      ? "bg-leaf-50 ring-1 ring-inset ring-leaf-200"
                      : "border border-neutral-100 bg-white hover:border-leaf-200"
                  }`}
                >
                  <span className={`text-xs font-medium ${i === 0 ? "text-leaf-700" : "text-neutral-500"}`}>
                    {i === 0 ? "Maint." : frHourLabel(h.iso)}
                  </span>
                  <span className="my-2">
                    <WIcon kind={h.icon_kind} size={20} />
                  </span>
                  <span className="text-sm font-semibold tabular text-neutral-800">
                    {Math.round(h.temp_c)}°
                  </span>
                  <span
                    className={`mt-1.5 inline-flex items-center gap-0.5 text-[10px] tabular ${
                      h.pop_pct > 0 ? "text-sky-tint-700" : "text-transparent"
                    }`}
                  >
                    <DropletIcon size={10} />
                    {h.pop_pct > 0 ? `${h.pop_pct}%` : "0%"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      {daily.length > 0 ? (
        <DailyForecast daily={daily} />
      ) : null}
    </div>
  );
}

/**
 * 7-day outlook with Apple-Weather-style relative temperature bars: each row's
 * range is positioned against the *week's* min/max rather than a fixed 0–40°
 * scale, so the bars actually communicate how the days compare.
 */
function DailyForecast({ daily }: { daily: WeatherDaily[] }) {
  const weekMin = Math.min(...daily.map((d) => d.temp_min_c));
  const weekMax = Math.max(...daily.map((d) => d.temp_max_c));
  const span = Math.max(1, weekMax - weekMin);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
          {daily.length} prochains jours
        </h2>
        <p className="text-xs text-neutral-500">
          Source : OpenWeatherMap · mise à jour automatique
        </p>
      </div>
      <div className="vc-card overflow-hidden">
        <Stagger as="ul" className="divide-y divide-neutral-100">
          {daily.map((d, i) => {
            const left = ((d.temp_min_c - weekMin) / span) * 100;
            const width = Math.max(6, ((d.temp_max_c - d.temp_min_c) / span) * 100);
            return (
              <StaggerItem
                as="li"
                key={d.iso}
                className={`grid grid-cols-[88px_30px_1fr_84px_64px] items-center gap-3 px-4 py-3.5 transition-colors sm:grid-cols-[140px_44px_1fr_120px_84px] sm:px-6 ${
                  i === 0 ? "bg-leaf-50/40" : "hover:bg-neutral-50/60"
                }`}
              >
                <span className={`text-sm font-medium ${i === 0 ? "text-leaf-800" : "text-neutral-800"}`}>
                  {frDayLabel(d.iso, i)}
                </span>
                <WIcon kind={d.icon_kind} size={22} />
                <div className="flex items-center gap-2">
                  <span className="w-7 shrink-0 text-right text-xs tabular text-neutral-400">
                    {Math.round(d.temp_min_c)}°
                  </span>
                  <div className="relative h-2 flex-1 rounded-full bg-neutral-100">
                    <div
                      className="absolute h-2 rounded-full bg-gradient-to-r from-sky-tint-400 via-leaf-400 to-warn-400"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </div>
                  <span className="w-7 shrink-0 text-left text-xs font-medium tabular text-neutral-700">
                    {Math.round(d.temp_max_c)}°
                  </span>
                </div>
                <span className="hidden text-right text-sm tabular text-neutral-700 sm:block">
                  {Math.round(d.temp_min_c)}° – {Math.round(d.temp_max_c)}°
                </span>
                <span className="flex items-center justify-end gap-1 text-xs">
                  <DropletIcon
                    size={12}
                    className={d.pop_pct > 30 ? "text-sky-tint-700" : "text-neutral-300"}
                  />
                  <span
                    className={`tabular ${d.pop_pct > 30 ? "font-medium text-sky-tint-700" : "text-neutral-500"}`}
                  >
                    {d.pop_pct}%
                  </span>
                </span>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white/60 p-3 ring-1 ring-inset ring-white/80 backdrop-blur transition hover:bg-white/80">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular text-neutral-900">{value}</p>
    </div>
  );
}

function NoParcelsPanel() {
  return (
    <div className="vc-card flex items-start gap-4 p-6">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-leaf-50 text-leaf-700">
        <SproutIcon size={20} />
      </span>
      <div>
        <p className="text-sm font-semibold text-neutral-900">
          Aucune parcelle à afficher
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Créez une parcelle avec son polygone GeoJSON pour activer la météo
          locale.
        </p>
        <Link
          href="/dashboard/farmer/parcels/new"
          className="vc-btn-primary mt-3"
        >
          Créer une parcelle
        </Link>
      </div>
    </div>
  );
}

function UnavailablePanel() {
  return (
    <div className="vc-card flex items-start gap-4 p-6">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warn-50 text-warn-700">
        <InfoIcon size={20} />
      </span>
      <div>
        <p className="text-sm font-semibold text-neutral-900">
          Données météo indisponibles
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Le backend n&apos;est pas joignable, OpenWeatherMap renvoie une
          erreur, ou la clé API n&apos;est pas configurée côté serveur
          (variable d&apos;env <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs font-mono">OPENWEATHERMAP_API_KEY</code>).
        </p>
      </div>
    </div>
  );
}
