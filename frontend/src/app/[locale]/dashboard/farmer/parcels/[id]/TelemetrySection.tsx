"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  type DeviceHistoryEntry,
  type DeviceHistoryResponse,
  type HistoryResponse,
  type LatestTelemetry,
  type Window as TelemetryWindow,
} from "./telemetry-actions";
import { DeviceHistoryCard } from "./DeviceHistoryCard";
import { Sparkline } from "./Sparkline";
import type { Metric, ThresholdRow } from "./thresholds-actions";

interface Props {
  parcelId: string;
  initialLatest: LatestTelemetry | null;
  initialHistory: HistoryResponse;
  /** KAT-13 — server-side fetch of every device that ever contributed to
   *  this parcel. Client revalidates on window/filter changes. */
  initialDevicesHistory: DeviceHistoryEntry[];
  accessToken: string; // Supabase session token, passed from the server page
  /** KAT-05 — lifted state from the page; an empty object renders identically
   *  to the KAT-04 behaviour. */
  thresholdsByMetric?: Partial<Record<Metric, ThresholdRow>>;
}

/**
 * KAT-05 helper — turn a threshold row into the (min, max) the Sparkline
 * expects. Disabled rows resolve to `undefined` so the band is not drawn.
 */
function bandFor(
  row: ThresholdRow | undefined,
): { min: number | null | undefined; max: number | null | undefined } {
  if (!row || !row.enabled) return { min: undefined, max: undefined };
  return { min: row.min_value, max: row.max_value };
}

const WINDOW_VALUES: TelemetryWindow[] = ["24h", "7d", "30d"];

const POLL_INTERVAL_MS = 30_000;

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

// i18n-KAT04
export function TelemetrySection({
  parcelId,
  initialLatest,
  initialHistory,
  initialDevicesHistory,
  accessToken,
  thresholdsByMetric,
}: Props) {
  const t = useTranslations("farmer.parcels.detail.telemetry");
  const tRelative = useTranslations("farmer.parcels.detail.telemetry.relative");
  const moistureBand = bandFor(thresholdsByMetric?.soil_moisture);
  const tempBand = bandFor(thresholdsByMetric?.soil_temperature);
  const phBand = bandFor(thresholdsByMetric?.soil_ph);
  const condBand = bandFor(thresholdsByMetric?.soil_conductivity);
  const [latest, setLatest] = useState<LatestTelemetry | null>(initialLatest);
  const [history, setHistory] = useState<HistoryResponse>(initialHistory);
  const [activeWindow, setActiveWindow] = useState<TelemetryWindow>("24h");
  // KAT-13 — selected device filter. `null` = aggregate across all devices
  // (KAT-04 back-compat default). Set by the <DeviceHistoryCard> action.
  const [selectedDeviceUuid, setSelectedDeviceUuid] = useState<string | null>(
    null,
  );
  const [devicesHistory, setDevicesHistory] = useState<DeviceHistoryEntry[]>(
    initialDevicesHistory,
  );
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [, forceTick] = useState(0); // drives the "il y a … s" relative label

  // KAT-13 — when the latest reading came from an UNLINKED device the chart
  // would be empty under a default-device filter. We never auto-apply that
  // filter, but if the user later un-pairs the only device on the parcel the
  // DeviceHistoryCard becomes the only way to see the history. Refresh the
  // device list whenever `latest` flips identity.
  const fetchDevicesHistory = useCallback(async () => {
    try {
      const r = await fetch(
        `${API_BASE}/api/v1/katara/parcels/${parcelId}/devices-history`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      if (r.ok) {
        const body = (await r.json()) as DeviceHistoryResponse;
        setDevicesHistory(body.devices);
      }
    } catch {
      // Network blip — keep the previous list; the next refresh recovers.
    }
  }, [parcelId, accessToken]);

  const fetchLatest = useCallback(async () => {
    try {
      const r = await fetch(
        `${API_BASE}/api/v1/katara/parcels/${parcelId}/telemetry/latest`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      if (r.status === 204) {
        setLatest(null);
        return;
      }
      if (r.ok) {
        const body = (await r.json()) as LatestTelemetry;
        setLatest(body);
      }
      // 401 (token rotated mid-session) and 5xx: leave the existing tile in
      // place rather than blanking it; the next visibility-change retries.
    } catch {
      // Network blip — silent. The next interval will recover.
    }
  }, [parcelId, accessToken]);

  const fetchHistory = useCallback(async () => {
    const filter = selectedDeviceUuid
      ? `&device_id=${selectedDeviceUuid}`
      : "";
    try {
      const r = await fetch(
        `${API_BASE}/api/v1/katara/parcels/${parcelId}/telemetry/history?window=${activeWindow}${filter}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      if (r.ok) {
        const h = (await r.json()) as HistoryResponse;
        setHistory(h);
      }
    } catch {
      // Network blip — keep the previous chart.
    }
  }, [parcelId, accessToken, activeWindow, selectedDeviceUuid]);

  // Window-change OR device-filter-change → refetch history with loading indicator.
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    const filter = selectedDeviceUuid
      ? `&device_id=${selectedDeviceUuid}`
      : "";
    fetch(
      `${API_BASE}/api/v1/katara/parcels/${parcelId}/telemetry/history?window=${activeWindow}${filter}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    )
      .then((r) =>
        r.ok ? (r.json() as Promise<HistoryResponse>) : Promise.reject(r),
      )
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        // Keep the previous chart; show no toast — the loading flag clears.
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWindow, parcelId, accessToken, selectedDeviceUuid]);

  // Polling + Page Visibility gating. Only the 24h tab polls; longer windows
  // change slowly enough that a fresh fetch on window-switch is sufficient.
  // Both latest tile and history charts are refreshed on every tick so the
  // charts update automatically as the simulator sends new readings.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    function tick() {
      void fetchLatest();
      void fetchHistory();
    }
    function start() {
      if (pollRef.current !== null) return;
      if (activeWindow !== "24h") return;
      pollRef.current = window.setInterval(tick, POLL_INTERVAL_MS);
    }
    function stop() {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    function onVisChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      stop();
    };
  }, [fetchLatest, fetchHistory, activeWindow]);

  // Tick the "il y a 47 s" label once a second while we have a reading.
  useEffect(() => {
    if (!latest) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1_000);
    return () => window.clearInterval(id);
  }, [latest]);

  // KAT-13 — when the latest reading's device toggles UNLINKED (e.g. the
  // farmer just unlinked from the DevicesSection), refresh the device-history
  // list so the card reflects the new state without a page reload.
  const latestDeviceStatus = latest?.device_status;
  useEffect(() => {
    if (latestDeviceStatus === "UNLINKED") {
      void fetchDevicesHistory();
    }
  }, [latestDeviceStatus, fetchDevicesHistory]);

  const relativeTs = useMemo(
    () => formatRelative(latest?.recorded_at, tRelative),
    // Re-runs once per tick because `latest` is referentially the same but
    // forceTick triggers a re-render that recomputes this memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latest, latest?.recorded_at],
  );

  // KAT-13 — clearing a stale filter when the chosen device disappears from
  // the list (e.g. row-level RLS reshuffle). Keeps the chart from looking
  // stuck on an empty filtered view.
  useEffect(() => {
    if (!selectedDeviceUuid) return;
    if (!devicesHistory.some((d) => d.device_uuid === selectedDeviceUuid)) {
      setSelectedDeviceUuid(null);
    }
  }, [selectedDeviceUuid, devicesHistory]);

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <RequestDiagnosticSlot />
      </div>

      {latest === null ? (
        <EmptyState hasHistory={devicesHistory.length > 0} />
      ) : (
        <>
          <LatestTile latest={latest} relativeTs={relativeTs} tRelative={tRelative} />

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-medium">
              {t("history")}
              {selectedDeviceUuid && (
                <span className="ms-2 text-sm font-normal text-neutral-500">
                  {t("filteredOneSensor")}
                </span>
              )}
            </h3>
            <div
              role="tablist"
              aria-label={t("windowAriaLabel")}
              className="inline-flex gap-1 rounded-md border border-neutral-200 bg-white p-1 shadow-sm"
            >
              {WINDOW_VALUES.map((w) => (
                <button
                  key={w}
                  type="button"
                  role="tab"
                  aria-selected={activeWindow === w}
                  onClick={() => setActiveWindow(w)}
                  className={
                    "rounded px-3 py-1 text-sm font-medium transition-colors " +
                    (activeWindow === w
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-neutral-700 hover:bg-neutral-100")
                  }
                >
                  {t(`windows.${w}`)}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-2 text-xs text-neutral-500">
            {t("pointsCount", { count: history.point_count, granularity: history.granularity })}
            {loadingHistory ? t("loadingSuffix") : ""}
          </p>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Sparkline
              title={t("metrics.soilMoisture")}
              values={history.buckets}
              field="soil_moisture"
              color="#0ea5e9"
              unit="%"
              thresholdMin={moistureBand.min}
              thresholdMax={moistureBand.max}
              t={t}
            />
            <Sparkline
              title={t("metrics.soilTemperature")}
              values={history.buckets}
              field="soil_temperature"
              color="#ef4444"
              unit="°C"
              thresholdMin={tempBand.min}
              thresholdMax={tempBand.max}
              t={t}
            />
            <Sparkline
              title={t("metrics.soilPh")}
              values={history.buckets}
              field="soil_ph"
              color="#a855f7"
              thresholdMin={phBand.min}
              thresholdMax={phBand.max}
              t={t}
            />
            <Sparkline
              title={t("metrics.conductivity")}
              values={history.buckets}
              field="soil_conductivity"
              color="#f59e0b"
              unit="µS/cm"
              thresholdMin={condBand.min}
              thresholdMax={condBand.max}
              t={t}
            />
          </div>

          <DeviceHistoryCard
            devices={devicesHistory}
            selectedDeviceUuid={selectedDeviceUuid}
            onSelectDevice={setSelectedDeviceUuid}
          />
        </>
      )}
    </section>
  );
}

// i18n-KAT04 / KAT-13 — adds the "Détaché" pill when the most recent reading
// came from an UNLINKED device. The pill is exclusive with the (future)
// KAT-11 OFFLINE pill — an UNLINKED device cannot be ACTIVE/OFFLINE by
// definition, so we only render one.
function LatestTile({
  latest,
  relativeTs,
  tRelative,
}: {
  latest: LatestTelemetry;
  relativeTs: string;
  tRelative: Translator;
}) {
  const t = useTranslations("farmer.parcels.detail.telemetry");
  const tLatest = useTranslations("farmer.parcels.detail.telemetry.latestTile");
  const cells: { label: string; value: string }[] = [
    { label: tLatest("soilMoisture"), value: `${latest.soil_moisture.toFixed(1)} %` },
    {
      label: tLatest("soilTemperature"),
      value: `${latest.soil_temperature.toFixed(1)} °C`,
    },
    { label: tLatest("soilPh"), value: latest.soil_ph.toFixed(2) },
    {
      label: tLatest("conductivity"),
      value: `${Math.round(latest.soil_conductivity)} µS/cm`,
    },
  ];

  const isUnlinked = latest.device_status === "UNLINKED";

  return (
    <div>
      {isUnlinked && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          <span className="font-medium">{t("unlinkedBadge")}</span>
          <span className="text-amber-800">
            {t("unlinkedDetail", { deviceLabel: latest.device_label ? ` ${latest.device_label}` : "" })}
            {latest.device_unlinked_at
              ? t("unlinkedAtSuffix", { relative: formatRelative(latest.device_unlinked_at, tRelative) })
              : t("unlinkedNoSuffix")}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
          >
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              {c.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {c.value}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <BatteryDot level={latest.battery_level} />
        <span>{t("battery", { level: latest.battery_level })}</span>
        <span className="text-neutral-300">·</span>
        <span>{t("lastReading", { relative: relativeTs })}</span>
        {latest.device_label && (
          <>
            <span className="text-neutral-300">·</span>
            <span className="font-mono">{latest.device_label}</span>
          </>
        )}
      </div>
    </div>
  );
}

function BatteryDot({ level }: { level: number }) {
  const color =
    level >= 60
      ? "bg-emerald-500"
      : level >= 25
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 rounded-full ${color}`}
    />
  );
}

// i18n-KAT04 / KAT-13 — distinguishes the three empty-state shapes:
//   (a) no device ever paired → "associate a sensor".
//   (b) device paired but no telemetry yet → "first reading within 15 min".
//   (c) handled by the page render branch above: there *is* a latest reading
//       from an UNLINKED device, so this empty-state never fires when
//       devices_history is non-empty AND latest is null only after a
//       cross-farmer RLS event — vanishingly rare.
function EmptyState({ hasHistory }: { hasHistory: boolean }) {
  const t = useTranslations("farmer.parcels.detail.telemetry");
  if (hasHistory) {
    // The parcel had telemetry once, but the only reading just dropped (e.g.
    // the underlying view returned 0 rows mid-render). Tell the user the
    // history is still there and how to retrieve it.
    return (
      <div className="rounded-md border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-600">
        <p className="font-medium text-neutral-800">
          {t("emptyHasHistoryTitle")}
        </p>
        <p className="mt-1">
          {t("emptyHasHistoryBody")}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-600">
      <p className="font-medium text-neutral-800">
        {t("emptyNoHistoryTitle")}
      </p>
      <p className="mt-1">
        {t("emptyNoHistoryBody")}
      </p>
    </div>
  );
}

/**
 * KAT-07 hand-off placeholder. Renders a disabled button next to the window
 * selector; KAT-07 enables it and wires the diagnostic-request server action.
 */
// i18n-KAT04
function RequestDiagnosticSlot() {
  const t = useTranslations("farmer.parcels.detail.telemetry");
  return (
    <button
      type="button"
      disabled
      title={t("requestDiagnosticDisabledTitle")}
      className="cursor-not-allowed rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 opacity-70"
    >
      {t("requestDiagnostic")}
    </button>
  );
}

// i18n-KAT04
function formatRelative(iso: string | undefined, t: Translator): string {
  if (!iso) return t("dash");
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 60) return t("seconds", { count: seconds });
  if (seconds < 3600) return t("minutes", { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("hours", { count: Math.floor(seconds / 3600) });
  return t("days", { count: Math.floor(seconds / 86400) });
}
