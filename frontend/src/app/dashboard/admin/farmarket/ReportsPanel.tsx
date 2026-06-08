import type { AdminStats, OrderStatus } from "./types";
import { ORDER_STATUS_LABELS } from "./orderStatus";

// Static (Tailwind-scannable) bar fills — must not be built at runtime or the
// JIT compiler won't emit the CSS.
const BAR_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-amber-400",
  PARTIALLY_ACCEPTED: "bg-sky-400",
  ACCEPTED: "bg-blue-400",
  IN_PROGRESS: "bg-indigo-400",
  DELIVERED: "bg-emerald-400",
  REJECTED: "bg-red-400",
  CANCELLED: "bg-neutral-400",
  RETURNED: "bg-orange-400",
};

type Props = {
  stats: AdminStats | null;
};

const STATUS_ORDER: OrderStatus[] = [
  "PENDING",
  "PARTIALLY_ACCEPTED",
  "ACCEPTED",
  "IN_PROGRESS",
  "DELIVERED",
  "REJECTED",
  "CANCELLED",
  "RETURNED",
];

export function ReportsPanel({ stats }: Props) {
  if (!stats) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
        Rapports indisponibles pour le moment.
      </div>
    );
  }

  const total = stats.orders_total || 1; // avoid /0 for bar widths

  return (
    <div className="space-y-6">
      {/* Headline report figures */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReportCard
          label="Ventes (CA réservé)"
          value={`${fmt(stats.revenue_booked_mad)} MAD`}
        />
        <ReportCard
          label="Commandes livrées"
          value={String(stats.delivered_count)}
        />
        <ReportCard
          label="Commandes annulées"
          value={String(stats.cancelled_count)}
          sub={`${pct(stats.cancellation_rate)} du total`}
        />
        <ReportCard
          label="Taux de retour"
          value={pct(stats.return_rate)}
          sub={`${stats.returned_count} retournée(s)`}
        />
      </div>

      {/* Distribution by status */}
      <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-neutral-900">
          Répartition des commandes par statut
        </h3>
        <ul className="space-y-2.5">
          {STATUS_ORDER.map((st) => {
            const count = stats.orders_by_status[st] ?? 0;
            const width = Math.round((count / total) * 100);
            return (
              <li key={st} className="flex items-center gap-3 text-xs">
                <span className="w-40 shrink-0 text-neutral-600">
                  {ORDER_STATUS_LABELS[st]}
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full ${BAR_COLORS[st]}`}
                    style={{ width: `${count === 0 ? 0 : Math.max(width, 4)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right font-mono font-semibold text-neutral-800">
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[11px] text-neutral-400">
          Total : {stats.orders_total} commande(s). Taux d&apos;annulation{" "}
          {pct(stats.cancellation_rate)} · taux de retour {pct(stats.return_rate)}.
        </p>
      </div>
    </div>
  );
}

function ReportCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-neutral-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-neutral-400">{sub}</p>}
    </div>
  );
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)} %`;
}

function fmt(v: string): string {
  return Number(v).toLocaleString("fr-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
