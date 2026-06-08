import type { AdminStats } from "./types";

type Props = {
  stats: AdminStats | null;
};

export function StatsDashboard({ stats }: Props) {
  if (!stats) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
        Statistiques indisponibles pour le moment.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label="Commandes (total)"
          value={String(stats.orders_total)}
          tone="leaf"
        />
        <Kpi
          label="Chiffre d'affaires réservé"
          value={`${fmt(stats.revenue_booked_mad)} MAD`}
          hint="Hors annulées / refusées / retournées"
          tone="leaf"
        />
        <Kpi
          label="Encaissé (payé)"
          value={`${fmt(stats.revenue_collected_mad)} MAD`}
          tone="emerald"
        />
        <Kpi
          label="COD à encaisser"
          value={`${fmt(stats.cod_outstanding_mad)} MAD`}
          tone={Number(stats.cod_outstanding_mad) > 0 ? "amber" : "leaf"}
        />
        <Kpi
          label="Produits vendus (livrés)"
          value={`${fmt(stats.products_sold_kg)} kg`}
          tone="leaf"
        />
        <Kpi
          label="Commandes livrées"
          value={String(stats.delivered_count)}
          tone="emerald"
        />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "leaf" | "amber" | "emerald";
}) {
  const ring =
    tone === "amber"
      ? "ring-amber-100 bg-amber-50"
      : tone === "emerald"
        ? "ring-emerald-100 bg-emerald-50"
        : "ring-leaf-100 bg-leaf-50";
  return (
    <div className={`rounded-lg p-4 ring-1 ${ring}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-neutral-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function fmt(v: string): string {
  return Number(v).toLocaleString("fr-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
