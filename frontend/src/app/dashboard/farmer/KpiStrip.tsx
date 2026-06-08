import {
  AlertIcon,
  ChartIcon,
  DropletIcon,
  MapPinIcon,
} from "./_ui/Icon";
import { MotionCard, Stagger } from "./_ui/motion";
import type { FarmKpiRollup } from "./overview-types";

/**
 * KAT-14 — farm-wide rollup tiles above the parcel grid.
 *
 * Visual upgrade: each tile gets a tinted icon, a primary numeric value,
 * and a secondary "delta" line that contextualises the count (offline /
 * pending / unlinked sensors under the active count, hectares under the
 * parcel count, etc.). The breach tile flips to a warning tone when the
 * count is non-zero — the only colour cue on the strip by design.
 */

export function KpiStrip({ kpi }: { kpi: FarmKpiRollup }) {
  const breachTone = kpi.parcels_with_open_breach > 0 ? "warn" : "neutral";
  return (
    <Stagger
      as="section"
      ariaLabel="Indicateurs de l'exploitation"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<MapPinIcon size={18} />}
          tint="info"
          label="Parcelles"
          value={kpi.parcel_count}
          sub={`${Number(kpi.total_surface_ha).toFixed(2)} ha au total`}
        />
      </MotionCard>
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<ChartIcon size={18} />}
          tint="soil"
          label="Surface"
          value={`${Number(kpi.total_surface_ha).toFixed(2)} ha`}
          sub={kpi.parcel_count > 0 ? `~${(Number(kpi.total_surface_ha) / kpi.parcel_count).toFixed(2)} ha / parcelle` : "—"}
        />
      </MotionCard>
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<DropletIcon size={18} />}
          tint="info"
          label="Capteurs actifs"
          value={kpi.device_active_count}
          sub={
            kpi.device_offline_count + kpi.device_pending_count + kpi.device_unlinked_count > 0
              ? [
                  kpi.device_offline_count > 0 ? `${kpi.device_offline_count} hors-ligne` : null,
                  kpi.device_pending_count > 0 ? `${kpi.device_pending_count} en attente` : null,
                  kpi.device_unlinked_count > 0 ? `${kpi.device_unlinked_count} détaché${kpi.device_unlinked_count > 1 ? "s" : ""}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Tous opérationnels"
          }
        />
      </MotionCard>
      <MotionCard as="div" interactive={false}>
        <Tile
          icon={<AlertIcon size={18} />}
          tint={breachTone === "warn" ? "warn" : "leaf"}
          label="Alertes ouvertes"
          value={kpi.parcels_with_open_breach}
          sub={
            kpi.parcels_with_open_breach > 0
              ? "Parcelles à vérifier"
              : "Aucun seuil dépassé"
          }
          emphasise={breachTone === "warn"}
        />
      </MotionCard>
    </Stagger>
  );
}

function Tile({
  icon,
  tint,
  label,
  value,
  sub,
  emphasise,
}: {
  icon: React.ReactNode;
  tint: "leaf" | "soil" | "info" | "warn";
  label: string;
  value: string | number;
  sub: string;
  emphasise?: boolean;
}) {
  const tintMap = {
    leaf: { bg: "bg-leaf-50", fg: "text-leaf-700", border: "border-leaf-100" },
    soil: { bg: "bg-soil-50", fg: "text-soil-700", border: "border-soil-100" },
    info: { bg: "bg-sky-tint-50", fg: "text-sky-tint-700", border: "border-sky-tint-50" },
    warn: { bg: "bg-warn-50", fg: "text-warn-700", border: "border-warn-500/30" },
  }[tint];

  return (
    <div
      className={`katara-card group h-full overflow-hidden p-4 ${
        emphasise ? "ring-1 ring-warn-500/30" : ""
      }`}
    >
      <span aria-hidden="true" className="katara-glow" />
      <div className="flex items-start justify-between">
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ${tintMap.bg} ${tintMap.fg} ring-1 ring-inset ring-black/[0.03] transition-transform duration-300 group-hover:scale-105`}
        >
          {icon}
        </span>
        {emphasise ? (
          <span className="vc-pill vc-pill-warn">À vérifier</span>
        ) : null}
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-0.5 text-3xl font-semibold tabular tracking-tight text-neutral-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-neutral-500">{sub}</p>
    </div>
  );
}
