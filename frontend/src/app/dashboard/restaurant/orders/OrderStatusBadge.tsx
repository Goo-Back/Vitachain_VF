const STATUS_LABELS: Record<string, { fr: string; cls: string }> = {
  PENDING: { fr: "En attente", cls: "bg-blue-100 text-blue-700" },
  PARTIALLY_ACCEPTED: { fr: "Partiellement acceptée", cls: "bg-amber-100 text-amber-700" },
  ACCEPTED: { fr: "Acceptée", cls: "bg-emerald-100 text-emerald-700" },
  REJECTED: { fr: "Refusée", cls: "bg-red-100 text-red-700" },
  IN_PROGRESS: { fr: "En cours de livraison", cls: "bg-sky-100 text-sky-700" },
  DELIVERED: { fr: "Livrée", cls: "bg-green-100 text-green-700" },
  CANCELLED: { fr: "Annulée", cls: "bg-neutral-200 text-neutral-700" },
  RETURNED: { fr: "Retournée", cls: "bg-orange-100 text-orange-700" },
};

const ITEM_STATUS_LABELS: Record<string, { fr: string; cls: string }> = {
  PENDING: { fr: "En attente", cls: "bg-blue-100 text-blue-700" },
  ACCEPTED: { fr: "Acceptée", cls: "bg-emerald-100 text-emerald-700" },
  REJECTED: { fr: "Refusée", cls: "bg-red-100 text-red-700" },
  PICKED_UP: { fr: "Récupérée", cls: "bg-sky-100 text-sky-700" },
  IN_TRANSIT: { fr: "En transit", cls: "bg-sky-100 text-sky-700" },
  DELIVERED: { fr: "Livrée", cls: "bg-green-100 text-green-700" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const def = STATUS_LABELS[status] ?? { fr: status, cls: "bg-neutral-100 text-neutral-700" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${def.cls}`}>
      {def.fr}
    </span>
  );
}

export function ItemStatusBadge({ status }: { status: string }) {
  const def = ITEM_STATUS_LABELS[status] ?? { fr: status, cls: "bg-neutral-100 text-neutral-700" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${def.cls}`}>
      {def.fr}
    </span>
  );
}
