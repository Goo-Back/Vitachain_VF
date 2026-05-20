import Link from "next/link";

import { fetchMyParcels } from "../parcels/actions";
import {
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

import { fetchWeatherForParcel, type WeatherIconKind } from "./actions";

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
                ? "bg-leaf-700 text-white shadow-sm"
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
  return (
    <div className="space-y-6">
      <section className="vc-card overflow-hidden">
        <div className="bg-gradient-to-br from-sky-tint-50 via-white to-sun-50 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-neutral-500">
                Maintenant · {current.city_label}
              </p>
              <p className="mt-1 text-5xl font-semibold tracking-tight tabular text-neutral-900">
                {Math.round(current.temp_c)}°
              </p>
              <p className="mt-1 text-sm capitalize text-neutral-600">
                {current.description} · ressenti {Math.round(current.feels_like_c)}°
              </p>
            </div>
            <WIcon kind={current.icon_kind} size={64} />
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <div className="border-t border-neutral-100 p-4">
            <p className="vc-eyebrow mb-3">24 prochaines heures</p>
            <ol className="flex gap-3 overflow-x-auto pb-1">
              {hourly.map((h) => (
                <li
                  key={h.iso}
                  className="flex min-w-[72px] flex-1 flex-col items-center rounded-lg border border-neutral-100 bg-white px-2 py-3"
                >
                  <span className="text-xs text-neutral-500">{frHourLabel(h.iso)}</span>
                  <span className="my-2">
                    <WIcon kind={h.icon_kind} size={20} />
                  </span>
                  <span className="text-sm font-semibold tabular text-neutral-800">
                    {Math.round(h.temp_c)}°
                  </span>
                  {h.pop_pct > 0 ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-sky-tint-700">
                      <DropletIcon size={10} />
                      {h.pop_pct}%
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      {daily.length > 0 ? (
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
            <ul className="divide-y divide-neutral-100">
              {daily.map((d, i) => (
                <li
                  key={d.iso}
                  className="grid grid-cols-[110px_36px_1fr_90px_90px] items-center gap-3 px-4 py-3 sm:grid-cols-[140px_44px_1fr_120px_120px] sm:px-6"
                >
                  <span className="text-sm font-medium text-neutral-800">
                    {frDayLabel(d.iso, i)}
                  </span>
                  <WIcon kind={d.icon_kind} size={22} />
                  <div className="relative h-2 rounded-full bg-neutral-100">
                    <div
                      className="absolute h-2 rounded-full bg-gradient-to-r from-sky-tint-500 to-warn-500"
                      style={{
                        left: `${Math.max(0, (d.temp_min_c / 40) * 100)}%`,
                        right: `${Math.max(0, 100 - (d.temp_max_c / 40) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-right text-sm tabular text-neutral-700">
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
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
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
    <div className="rounded-lg bg-white/70 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-neutral-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-base font-semibold tabular text-neutral-900">{value}</p>
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
