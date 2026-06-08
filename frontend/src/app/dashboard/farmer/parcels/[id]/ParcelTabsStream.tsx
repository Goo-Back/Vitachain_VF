import { fetchParcelDevices } from "./actions";
import { fetchLatestDiagnostic } from "./diagnostic-actions";
import { ParcelPageTabs } from "./ParcelPageTabs";
import { fetchInitialTelemetry } from "./telemetry-actions";
import { fetchThresholds } from "./thresholds-actions";

/**
 * The heavy half of the parcel detail page, isolated behind a Suspense
 * boundary so the parcel identity (header + meta) can paint after a single
 * fast read while these stream in.
 *
 * These four reads fan out to ~6 backend calls (telemetry alone hits
 * latest + 24h history + devices-history), and only the default "Données" tab
 * is visible on arrival — keeping them off the critical path is what makes the
 * click-through feel immediate.
 */
export async function ParcelTabsStream({
  parcelId,
  parcelName,
  token,
  isVerified,
}: {
  parcelId: string;
  parcelName: string;
  token: string;
  isVerified: boolean;
}) {
  const [devices, initialTelemetry, initialThresholds, initialDiagnostic] =
    await Promise.all([
      isVerified ? fetchParcelDevices(parcelId).catch(() => []) : Promise.resolve([]),
      fetchInitialTelemetry(parcelId, token).catch(() => null),
      fetchThresholds(parcelId, token),
      fetchLatestDiagnostic(parcelId, token).catch(() => null),
    ]);

  return (
    <ParcelPageTabs
      parcelId={parcelId}
      parcelName={parcelName}
      accessToken={token}
      isVerified={isVerified}
      initialDevices={devices}
      canPair={isVerified}
      initialTelemetry={initialTelemetry}
      initialThresholds={initialThresholds}
      initialDiagnostic={initialDiagnostic}
    />
  );
}
