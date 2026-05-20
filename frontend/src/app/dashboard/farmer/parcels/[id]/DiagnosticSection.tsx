"use client";

import { useState, useTransition } from "react";

import { usePolling } from "@/hooks/usePolling";

import {
  fetchLatestDiagnostic,
  requestDiagnostic,
  type DiagnosticOut,
  type DiagnosticStatus,
} from "./diagnostic-actions";

interface Props {
  parcelId: string;
  isVerified: boolean;
  initialDiagnostic: DiagnosticOut | null;
  hasTelemetry: boolean;
}

const STATUS_CHIP: Record<
  DiagnosticStatus,
  { label: string; className: string }
> = {
  PENDING:    { label: "En attente",   className: "bg-yellow-100 text-yellow-800" },
  PROCESSING: { label: "En cours…",    className: "bg-blue-100 text-blue-800" },
  COMPLETED:  { label: "Complété",     className: "bg-emerald-100 text-emerald-800" },
  FAILED:     { label: "Échec",        className: "bg-red-100 text-red-800" },
};

const POLLING_INTERVAL_MS = 5_000;
const TERMINAL_STATUSES: ReadonlySet<DiagnosticStatus> = new Set([
  "COMPLETED",
  "FAILED",
]);

const ERROR_COPY: Record<string, string> = {
  diagnostic_already_in_progress:
    "Un diagnostic est déjà en cours pour cette parcelle.",
  diagnostic_rate_limit_exceeded:
    "Limite journalière atteinte (3 diagnostics / 24h).",
  verification_required:
    "Votre compte doit être vérifié pour demander un diagnostic.",
  role_not_allowed:
    "Seuls les agriculteurs peuvent demander un diagnostic.",
  not_authenticated:
    "Session expirée — veuillez vous reconnecter.",
};

function formatError(code: string): string {
  return ERROR_COPY[code] ?? "Une erreur est survenue. Veuillez réessayer.";
}

/**
 * KAT-07 — entry point for the AI diagnostic flow. KAT-10 — live polling.
 *
 * Renders an idempotent "request" button + status chip + a collapsible
 * result card on COMPLETED. While the latest diagnostic is in-flight
 * (PENDING / PROCESSING), `usePolling` re-fetches the row every 5 s and
 * stops on terminal status.
 */
export function DiagnosticSection({
  parcelId,
  isVerified,
  initialDiagnostic,
  hasTelemetry,
}: Props) {
  const [diagnostic, setDiagnostic] = useState<DiagnosticOut | null>(
    initialDiagnostic,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inFlight =
    diagnostic?.status === "PENDING" || diagnostic?.status === "PROCESSING";

  usePolling({
    enabled: diagnostic !== null && !TERMINAL_STATUSES.has(diagnostic.status),
    intervalMs: POLLING_INTERVAL_MS,
    label: "diagnostic-status",
    callback: async () => {
      const row = await fetchLatestDiagnostic(parcelId);
      if (row === null) return;
      if (row.parcel_id !== parcelId) return;
      setDiagnostic((prev) => {
        if (prev !== null && prev.id === row.id && prev.status === row.status) {
          return prev;
        }
        return row;
      });
    },
  });

  const canRequest = isVerified && hasTelemetry && !inFlight && !isPending;

  const disabledReason = !isVerified
    ? "Compte non vérifié"
    : !hasTelemetry
      ? "Aucune donnée capteur disponible"
      : inFlight
        ? "Un diagnostic est déjà en cours"
        : undefined;

  function handleRequest() {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await requestDiagnostic(parcelId);
      if (result.ok) {
        setDiagnostic(result.data);
      } else {
        setErrorMsg(result.error);
      }
    });
  }

  const chip = diagnostic ? STATUS_CHIP[diagnostic.status] : null;

  return (
    <section
      aria-labelledby="diagnostic-heading"
      className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
    >
      <header className="mb-4">
        <h2
          id="diagnostic-heading"
          className="text-lg font-semibold text-neutral-900"
        >
          Diagnostic IA
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Analyse de vos données capteurs, météo et satellite par l&apos;IA
          agronomique.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleRequest}
          disabled={!canRequest}
          aria-disabled={!canRequest}
          title={disabledReason}
          className="inline-flex items-center rounded-lg bg-emerald-600 px-4
                     py-2 text-sm font-medium text-white shadow-sm transition
                     hover:bg-emerald-700 focus:outline-none focus:ring-2
                     focus:ring-emerald-500 focus:ring-offset-2
                     disabled:cursor-not-allowed disabled:bg-neutral-300
                     disabled:text-neutral-600"
        >
          {isPending ? "Envoi…" : "Demander un diagnostic IA"}
        </button>

        {chip && (
          <span
            role="status"
            className={`inline-flex items-center rounded-full px-2.5 py-0.5
                        text-xs font-medium ${chip.className}`}
          >
            {chip.label}
          </span>
        )}
      </div>

      {errorMsg && (
        <p
          role="alert"
          className="mt-3 text-sm text-red-600"
        >
          {formatError(errorMsg)}
        </p>
      )}

      {diagnostic?.status === "COMPLETED" && diagnostic.result_text && (
        <details className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-emerald-700">
            Voir le résultat
          </summary>
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-white p-4
                          text-sm leading-relaxed text-neutral-800">
            {diagnostic.result_text}
          </pre>
        </details>
      )}

      {diagnostic?.status === "FAILED" && (
        <p className="mt-3 text-sm text-red-600">
          Le diagnostic a échoué. Vous pouvez en demander un nouveau.
        </p>
      )}
    </section>
  );
}
