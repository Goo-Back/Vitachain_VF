import { getTranslations } from "next-intl/server";

const STATUS_CLASSES: Record<string, string> = {
  PENDING: "bg-blue-100 text-blue-700",
  PARTIALLY_ACCEPTED: "bg-amber-100 text-amber-700",
  ACCEPTED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700",
  DELIVERED: "bg-green-100 text-green-700",
  CANCELLED: "bg-neutral-200 text-neutral-700",
  RETURNED: "bg-orange-100 text-orange-700",
};

const ITEM_STATUS_CLASSES: Record<string, string> = {
  PENDING: "bg-blue-100 text-blue-700",
  ACCEPTED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  PICKED_UP: "bg-sky-100 text-sky-700",
  IN_TRANSIT: "bg-sky-100 text-sky-700",
  DELIVERED: "bg-green-100 text-green-700",
};

export async function OrderStatusBadge({ status }: { status: string }) {
  const t = await getTranslations("restaurant.orders.statusBadge.statuses");
  const cls = STATUS_CLASSES[status] ?? "bg-neutral-100 text-neutral-700";
  const label = STATUS_CLASSES[status] ? t(status) : status;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export async function ItemStatusBadge({ status }: { status: string }) {
  const t = await getTranslations("restaurant.orders.statusBadge.itemStatuses");
  const cls = ITEM_STATUS_CLASSES[status] ?? "bg-neutral-100 text-neutral-700";
  const label = ITEM_STATUS_CLASSES[status] ? t(status) : status;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
