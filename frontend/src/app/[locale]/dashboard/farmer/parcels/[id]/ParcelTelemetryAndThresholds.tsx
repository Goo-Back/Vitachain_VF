"use client";

import { useMemo, useState } from "react";

import { TelemetrySection } from "./TelemetrySection";
import { ThresholdsSection } from "./ThresholdsSection";
import type {
  DeviceHistoryEntry,
  HistoryResponse,
  LatestTelemetry,
} from "./telemetry-actions";
import type {
  Metric,
  ThresholdRow,
  ThresholdsResponse,
} from "./thresholds-actions";

interface Props {
  parcelId: string;
  accessToken: string;
  isVerified: boolean;
  initialLatest: LatestTelemetry | null;
  initialHistory: HistoryResponse;
  /** KAT-13 — historical device contributions for the parcel. May be empty
   *  on a parcel that has never received telemetry; the card then hides. */
  initialDevicesHistory: DeviceHistoryEntry[];
  initialThresholds: ThresholdsResponse;
}

/**
 * KAT-05 — lifted-state wrapper. Owns the thresholds array so both
 * TelemetrySection (Sparkline band overlay) and ThresholdsSection (the
 * editor) read from the same source. The optimistic-UI save in
 * ThresholdsSection updates this state immediately, so the bands move the
 * moment the user changes a value — even before the server round-trip lands.
 */
export function ParcelTelemetryAndThresholds({
  parcelId,
  accessToken,
  isVerified,
  initialLatest,
  initialHistory,
  initialDevicesHistory,
  initialThresholds,
}: Props) {
  const [rows, setRows] = useState<ThresholdRow[]>(initialThresholds.rows);

  const byMetric = useMemo(() => {
    const m: Partial<Record<Metric, ThresholdRow>> = {};
    for (const r of rows) m[r.metric] = r;
    return m;
  }, [rows]);

  return (
    <>
      <TelemetrySection
        parcelId={parcelId}
        accessToken={accessToken}
        initialLatest={initialLatest}
        initialHistory={initialHistory}
        initialDevicesHistory={initialDevicesHistory}
        thresholdsByMetric={byMetric}
      />
      <ThresholdsSection
        parcelId={parcelId}
        accessToken={accessToken}
        isVerified={isVerified}
        initial={initialThresholds}
        onChange={setRows}
      />
    </>
  );
}
