// @vitest-environment jsdom

import { NextIntlClientProvider } from "next-intl";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiagnosticSection } from "@/app/[locale]/dashboard/farmer/parcels/[id]/DiagnosticSection";
import type { DiagnosticOut } from "@/app/[locale]/dashboard/farmer/parcels/[id]/diagnostic-actions";
import farmerMessages from "@/i18n/messages/farmer/fr.json";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="fr" messages={farmerMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/app/[locale]/dashboard/farmer/parcels/[id]/diagnostic-actions", () => ({
  fetchLatestDiagnostic: vi.fn(),
  requestDiagnostic: vi.fn(),
}));

const { fetchLatestDiagnostic } = await import(
  "@/app/[locale]/dashboard/farmer/parcels/[id]/diagnostic-actions"
);
const fetchLatestMock = vi.mocked(fetchLatestDiagnostic);

const PARCEL_ID = "11111111-1111-1111-1111-111111111111";
const FARMER_ID = "22222222-2222-2222-2222-222222222222";

function diag(over: Partial<DiagnosticOut>): DiagnosticOut {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    parcel_id: PARCEL_ID,
    farmer_id: FARMER_ID,
    status: "PENDING",
    result_text: null,
    error_detail: null,
    requested_at: "2026-05-17T09:00:00Z",
    started_at: null,
    completed_at: null,
    ...over,
  };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DiagnosticSection — KAT-10 polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchLatestMock.mockReset();
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("S1 — starts polling on PENDING and stops on COMPLETED", async () => {
    fetchLatestMock
      .mockResolvedValueOnce(diag({ status: "PROCESSING" }))
      .mockResolvedValueOnce(
        diag({
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          status: "COMPLETED",
          result_text: "All good.",
        }),
      );

    renderWithIntl(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        isVerified
        initialDiagnostic={diag({ status: "PENDING" })}
        hasTelemetry
      />,
    );

    expect(screen.getByText("En attente")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await flush();
    expect(screen.getByText("En cours…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await flush();
    expect(screen.getByText("Complété")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchLatestMock).toHaveBeenCalledTimes(2);
  });

  it("S2 — does not poll when initial status is COMPLETED", async () => {
    renderWithIntl(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        isVerified
        initialDiagnostic={diag({ status: "COMPLETED", result_text: "done" })}
        hasTelemetry
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchLatestMock).not.toHaveBeenCalled();
  });

  it("S3 — does not poll when initial diagnostic is null", async () => {
    renderWithIntl(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        isVerified
        initialDiagnostic={null}
        hasTelemetry
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchLatestMock).not.toHaveBeenCalled();
  });

  it("S4 — pauses while tab is hidden, catches up on visible", async () => {
    fetchLatestMock.mockResolvedValue(diag({ status: "PROCESSING" }));

    renderWithIntl(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        isVerified
        initialDiagnostic={diag({ status: "PROCESSING" })}
        hasTelemetry
      />,
    );

    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchLatestMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(fetchLatestMock).toHaveBeenCalledTimes(1);
  });

  it("S5 — ignores responses whose parcel_id does not match", async () => {
    fetchLatestMock.mockResolvedValueOnce(
      diag({ status: "COMPLETED", parcel_id: "other-parcel" }),
    );

    renderWithIntl(
      <DiagnosticSection
        parcelId={PARCEL_ID}
        isVerified
        initialDiagnostic={diag({ status: "PROCESSING" })}
        hasTelemetry
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await flush();

    expect(screen.queryByText("Complété")).not.toBeInTheDocument();
    expect(screen.getByText("En cours…")).toBeInTheDocument();
  });
});
