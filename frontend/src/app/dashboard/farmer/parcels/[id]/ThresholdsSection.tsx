"use client";

import { useState, useTransition } from "react";

import type {
  Metric,
  ThresholdRow,
  ThresholdsResponse,
} from "./thresholds-actions";

// i18n-KAT05
const METRIC_LABELS: Record<
  Metric,
  { label: string; unit: string; step: number }
> = {
  soil_moisture:     { label: "Humidité du sol",    unit: "%",     step: 1   },
  soil_temperature:  { label: "Température du sol", unit: "°C",    step: 0.5 },
  soil_ph:           { label: "pH du sol",          unit: "",      step: 0.1 },
  soil_conductivity: { label: "Conductivité",       unit: "µS/cm", step: 50  },
  battery_level:     { label: "Batterie",           unit: "%",     step: 1   },
};

interface Props {
  parcelId: string;
  accessToken: string;
  isVerified: boolean;
  initial: ThresholdsResponse;
  /** Lifted up so TelemetrySection / Sparkline can react without a refetch. */
  onChange: (rows: ThresholdRow[]) => void;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// i18n-KAT05
export function ThresholdsSection({
  parcelId,
  accessToken,
  isVerified,
  initial,
  onChange,
}: Props) {
  const [rows, setRows] = useState<ThresholdRow[]>(initial.rows);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "ok">("idle");
  const [pending, startTransition] = useTransition();

  function patch(metric: Metric, p: Partial<ThresholdRow>) {
    setRows((rs) => {
      const next = rs.map((r) => (r.metric === metric ? { ...r, ...p } : r));
      onChange(next);
      return next;
    });
    setSaved("idle");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch(
          `${API_BASE}/api/v1/katara/parcels/${parcelId}/thresholds`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ rows }),
          },
        );
        if (r.status === 403) {
          setError("verification_required");
          return;
        }
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as {
            detail?: unknown;
          };
          const detail =
            typeof body.detail === "string"
              ? body.detail
              : `error_${r.status}`;
          setError(detail);
          return;
        }
        const fresh = (await r.json()) as ThresholdsResponse;
        setRows(fresh.rows);
        onChange(fresh.rows);
        setSaved("ok");
      } catch {
        setError("network_error");
      }
    });
  }

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-semibold">Seuils d&apos;alerte</h2>

      {!isVerified && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Vous devez être vérifié pour enregistrer des seuils. La consultation
          reste possible.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Métrique</th>
              <th className="px-3 py-2 text-right">Min</th>
              <th className="px-3 py-2 text-right">Max</th>
              <th className="px-3 py-2 text-center">Activé</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = METRIC_LABELS[r.metric];
              const disabled = !isVerified || pending;
              return (
                <tr key={r.metric} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-medium text-neutral-800">
                    {meta.label}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step={meta.step}
                      inputMode="decimal"
                      disabled={disabled}
                      className="w-24 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums disabled:bg-neutral-100 disabled:text-neutral-500"
                      value={r.min_value ?? ""}
                      onChange={(e) =>
                        patch(r.metric, {
                          min_value:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      aria-label={`${meta.label} minimum`}
                    />
                    {meta.unit && (
                      <span className="ml-1 text-xs text-neutral-500">
                        {meta.unit}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step={meta.step}
                      inputMode="decimal"
                      disabled={disabled}
                      className="w-24 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums disabled:bg-neutral-100 disabled:text-neutral-500"
                      value={r.max_value ?? ""}
                      onChange={(e) =>
                        patch(r.metric, {
                          max_value:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      aria-label={`${meta.label} maximum`}
                    />
                    {meta.unit && (
                      <span className="ml-1 text-xs text-neutral-500">
                        {meta.unit}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={r.enabled}
                      onChange={(e) =>
                        patch(r.metric, { enabled: e.target.checked })
                      }
                      aria-label={`${meta.label} activer`}
                      className="h-4 w-4 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-neutral-500">
          Laissez Min ou Max vide pour désactiver ce côté. Les alertes sont
          envoyées au maximum une fois toutes les 24 h par métrique.
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!isVerified || pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error === "verification_required"
            ? "Vous devez être vérifié pour enregistrer des seuils."
            : `Une erreur est survenue (${error}).`}
        </div>
      )}
      {saved === "ok" && !error && (
        <div className="mt-2 text-sm text-emerald-700">
          Seuils enregistrés.
        </div>
      )}
    </section>
  );
}
