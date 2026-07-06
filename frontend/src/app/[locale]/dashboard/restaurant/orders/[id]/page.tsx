import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";

import { toIntlLocale } from "@/lib/intlLocale";
import { DownloadIcon } from "@/app/[locale]/dashboard/farmer/_ui/Icon";

import { fetchOrderById } from "../actions";
import { ItemStatusBadge, OrderStatusBadge } from "../OrderStatusBadge";
import { CancelButton } from "./CancelButton";
import { ConfirmReceptionButton } from "./ConfirmReceptionButton";
import { OrderTimeline } from "./OrderTimeline";
import { ReorderButton } from "./ReorderButton";
import { PaymentEcho } from "./confirmation/PaymentEcho";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function OrderDetailPage({ params }: Props) {
  const t = await getTranslations("restaurant.orders.detail");
  const intlLocale = toIntlLocale(await getLocale());
  const { id } = await params;
  const order = await fetchOrderById(id);
  if (!order) notFound();

  const shortCode = `VITA-${order.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const reorderItems = order.items.map((it) => ({
    ad_id: it.ad_id,
    quantity_kg: it.quantity_kg,
  }));
  const showReorder =
    order.status === "DELIVERED" ||
    order.status === "CANCELLED" ||
    order.status === "REJECTED";

  const columns = [
    t("colAd"),
    t("colQuantity"),
    t("colUnitPrice"),
    t("colSubtotal"),
    t("colStatus"),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard/restaurant/orders"
            className="text-xs text-leaf-700 hover:underline"
          >
            {t("backToOrders")}
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-neutral-900 font-mono">
              {shortCode}
            </h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {t("placedOn", { date: new Date(order.created_at).toLocaleString(intlLocale) })}{" "}
            <span className="font-medium">{order.delivery_region}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/restaurant/orders/${order.id}/receipt`}
            className="vc-btn-secondary"
          >
            <DownloadIcon size={14} /> {t("receiptLink")}
          </Link>
          {showReorder && (
            <ReorderButton items={reorderItems} variant="primary" />
          )}
        </div>
      </div>

      <PaymentEcho
        orderId={order.id}
        amount={Number(order.total_mad)}
        paymentMethod={order.payment_method}
        paymentStatus={order.payment_status}
        paidAt={order.paid_at}
      />

      <OrderTimeline
        status={order.status}
        createdAt={order.created_at}
        updatedAt={order.updated_at}
      />

      {order.status === "DELIVERED" && (
        <ConfirmReceptionButton
          orderId={order.id}
          amount={Number(order.total_mad)}
          paymentMethod={order.payment_method}
          paymentStatus={order.payment_status}
        />
      )}

      <div className="rounded-lg border border-neutral-200 bg-white">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50">
            <tr>
              {columns.map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {order.items.map((it) => (
              <tr key={it.id}>
                <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                  {it.ad_id.slice(0, 8)}…
                </td>
                <td className="px-4 py-3">
                  {Number(it.quantity_kg).toFixed(2)} kg
                </td>
                <td className="px-4 py-3">
                  {Number(it.unit_price_mad).toFixed(2)} MAD
                </td>
                <td className="px-4 py-3 font-medium">
                  {Number(it.line_total_mad).toFixed(2)} MAD
                </td>
                <td className="px-4 py-3">
                  <ItemStatusBadge status={it.status} />
                  {it.producer_note && (
                    <p className="mt-1 text-xs italic text-neutral-500">
                      {t("producerNoteQuote", { note: it.producer_note })}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">
            {t("totalsTitle")}
          </h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-500">{t("subtotalLabel")}</dt>
              <dd>{Number(order.subtotal_mad).toFixed(2)} MAD</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">{t("logisticsLabel")}</dt>
              <dd>{Number(order.logistics_fee_mad).toFixed(2)} MAD</dd>
            </div>
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold">
              <dt>{t("totalLabel")}</dt>
              <dd>{Number(order.total_mad).toFixed(2)} MAD</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-900">{t("notesTitle")}</h2>
          <p className="text-sm text-neutral-600">
            {order.delivery_notes ?? t("notesEmpty")}
          </p>
          {order.status === "PENDING" && (
            <div className="mt-4 border-t border-neutral-100 pt-3">
              <CancelButton orderId={order.id} />
            </div>
          )}
        </div>
      </aside>

      <p className="rounded-lg border border-leaf-100 bg-leaf-50/40 p-4 text-xs text-leaf-800">
        <strong>{t("disputeTitle")}</strong> {t("disputeBodyBeforeEmail")}{" "}
        <a
          href="mailto:support@vitachain.ma"
          className="font-medium underline underline-offset-2"
        >
          support@vitachain.ma
        </a>{" "}
        {t("disputeBodyAfterEmail")}
      </p>
    </div>
  );
}
