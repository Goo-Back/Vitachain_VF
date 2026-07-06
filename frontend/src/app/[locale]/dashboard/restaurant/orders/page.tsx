import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { toIntlLocale } from "@/lib/intlLocale";

import { fetchMyOrders } from "./actions";
import { OrderStatusBadge } from "./OrderStatusBadge";

export const dynamic = "force-dynamic";

export default async function OrdersListPage() {
  const t = await getTranslations("restaurant.orders.list");
  const intlLocale = toIntlLocale(await getLocale());
  const orders = await fetchMyOrders();

  const columns = [
    t("colOrder"),
    t("colItems"),
    t("colTotal"),
    t("colRegion"),
    t("colStatus"),
    t("colDate"),
  ];

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {t("eyebrow")}
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-neutral-900">
          {t("title")}
        </h1>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-neutral-900">
            {t("emptyTitle")}
          </p>
          <Link
            href="/dashboard/restaurant/marketplace"
            className="mt-3 inline-block text-sm text-leaf-700 hover:underline"
          >
            {t("viewCatalog")}
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
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
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/restaurant/orders/${o.id}`}
                      className="font-mono text-xs text-leaf-700 hover:underline"
                    >
                      VITA-{o.id.replace(/-/g, "").slice(0, 8).toUpperCase()}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{o.items.length}</td>
                  <td className="px-4 py-3 font-medium">
                    {Number(o.total_mad).toFixed(2)} MAD
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{o.delivery_region}</td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    {new Date(o.created_at).toLocaleDateString(intlLocale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
