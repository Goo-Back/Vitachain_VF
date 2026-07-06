"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useState } from "react";

import type { NdviResponse } from "../../satellite/actions";
import {
  SatelliteUnavailablePanel,
  SatelliteView,
} from "../../satellite/SatellitePanel";
import type { Device } from "./actions";
import { DevicesSection } from "./DevicesSection";
import { DiagnosticSection } from "./DiagnosticSection";
import type { DiagnosticOut } from "./diagnostic-actions";
import { ParcelTelemetryAndThresholds } from "./ParcelTelemetryAndThresholds";
import type { InitialTelemetry } from "./telemetry-actions";
import type { ThresholdsResponse } from "./thresholds-actions";

type TabId = "données" | "capteurs" | "diagnostic" | "satellite";

const TAB_META: { id: TabId; labelKey: string }[] = [
  { id: "données", labelKey: "data" },
  { id: "capteurs", labelKey: "sensors" },
  { id: "diagnostic", labelKey: "diagnostic" },
  { id: "satellite", labelKey: "satellite" },
];

interface Props {
  parcelId: string;
  parcelName: string;
  accessToken: string;
  isVerified: boolean;
  // Capteurs tab
  initialDevices: Device[];
  canPair: boolean;
  // Données tab
  initialTelemetry: InitialTelemetry | null;
  initialThresholds: ThresholdsResponse | null;
  // Diagnostic tab
  initialDiagnostic: DiagnosticOut | null;
  // Satellite tab
  initialNdvi: NdviResponse | null;
  cropType: string;
  surfaceAreaHa: number;
}

export function ParcelPageTabs({
  parcelId,
  parcelName,
  accessToken,
  isVerified,
  initialDevices,
  canPair,
  initialTelemetry,
  initialThresholds,
  initialDiagnostic,
  initialNdvi,
  cropType,
  surfaceAreaHa,
}: Props) {
  const t = useTranslations("farmer.parcels.detail.tabs");
  const [activeTab, setActiveTab] = useState<TabId>("données");

  return (
    <div>
      <div className="border-b border-neutral-200">
        <nav role="tablist" aria-label={t("navAriaLabel")} className="-mb-px flex gap-1">
          {TAB_META.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={
                "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none " +
                (activeTab === tab.id
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-700")
              }
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>
      </div>

      <div className="pt-6">
        {activeTab === "données" && (
          initialTelemetry && initialThresholds ? (
            <ParcelTelemetryAndThresholds
              parcelId={parcelId}
              accessToken={accessToken}
              isVerified={isVerified}
              initialLatest={initialTelemetry.latest}
              initialHistory={initialTelemetry.history}
              initialDevicesHistory={initialTelemetry.devicesHistory}
              initialThresholds={initialThresholds}
            />
          ) : (
            <p className="text-sm text-neutral-500">
              {t("telemetryUnavailable")}
            </p>
          )
        )}

        {activeTab === "capteurs" && (
          <DevicesSection
            parcelId={parcelId}
            parcelName={parcelName}
            initialDevices={initialDevices}
            canPair={canPair}
          />
        )}

        {activeTab === "diagnostic" && (
          <DiagnosticSection
            parcelId={parcelId}
            isVerified={isVerified}
            initialDiagnostic={initialDiagnostic}
            hasTelemetry={initialTelemetry?.latest != null}
          />
        )}

        {activeTab === "satellite" && (
          <div>
            {initialNdvi ? (
              <SatelliteView
                data={initialNdvi}
                parcelMeta={{ cropType, surfaceAreaHa }}
              />
            ) : (
              <SatelliteUnavailablePanel />
            )}
            <Link
              href={`/dashboard/farmer/satellite?parcel=${parcelId}`}
              className="mt-4 inline-block text-sm font-medium text-sky-tint-700 hover:underline"
            >
              {t("viewAllOnSatellite")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
