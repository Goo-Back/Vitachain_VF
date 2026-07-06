import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

import { toIntlLocale } from "@/lib/intlLocale";
import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";
import {
  BellIcon,
  CheckCircleIcon,
  InfoIcon,
  PackageIcon,
  SatelliteIcon,
  ShoppingBagIcon,
  XIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";

import { fetchMyOrders, type Order } from "../orders/actions";

export const dynamic = "force-dynamic";

type FeedItem = {
  id: string;
  order_id: string;
  ts: string;
  kind: "created" | "accepted" | "in_progress" | "delivered" | "cancelled";
  title: string;
  body: string;
};

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function buildFeed(orders: Order[], t: Translator): FeedItem[] {
  const items: FeedItem[] = [];
  for (const o of orders) {
    const short = `VITA-${o.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    items.push({
      id: `${o.id}-created`,
      order_id: o.id,
      ts: o.created_at,
      kind: "created",
      title: t("notifications.createdTitle", { code: short }),
      body: t("notifications.createdBody", {
        count: o.items.length,
        amount: Number(o.total_mad).toFixed(0),
      }),
    });

    if (o.status === "ACCEPTED" || o.status === "PARTIALLY_ACCEPTED") {
      items.push({
        id: `${o.id}-accepted`,
        order_id: o.id,
        ts: o.updated_at,
        kind: "accepted",
        title: t("notifications.acceptedTitle", { code: short }),
        body:
          o.status === "PARTIALLY_ACCEPTED"
            ? t("notifications.acceptedPartialBody")
            : t("notifications.acceptedFullBody"),
      });
    }

    if (o.status === "IN_PROGRESS") {
      items.push({
        id: `${o.id}-in-progress`,
        order_id: o.id,
        ts: o.updated_at,
        kind: "in_progress",
        title: t("notifications.inProgressTitle", { code: short }),
        body: t("notifications.inProgressBody", { region: o.delivery_region }),
      });
    }

    if (o.status === "DELIVERED") {
      items.push({
        id: `${o.id}-delivered`,
        order_id: o.id,
        ts: o.updated_at,
        kind: "delivered",
        title: t("notifications.deliveredTitle", { code: short }),
        body: t("notifications.deliveredBody"),
      });
    }

    if (o.status === "CANCELLED" || o.status === "REJECTED") {
      items.push({
        id: `${o.id}-cancelled`,
        order_id: o.id,
        ts: o.updated_at,
        kind: "cancelled",
        title:
          o.status === "CANCELLED"
            ? t("notifications.cancelledTitle", { code: short })
            : t("notifications.rejectedTitle", { code: short }),
        body:
          o.status === "REJECTED"
            ? t("notifications.rejectedBody")
            : t("notifications.cancelledBody"),
      });
    }
  }
  return items.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

const KIND_META: Record<
  FeedItem["kind"],
  { icon: React.ComponentType<{ size?: number; className?: string }>; bg: string; fg: string }
> = {
  created: { icon: ShoppingBagIcon, bg: "bg-blue-50", fg: "text-blue-700" },
  accepted: { icon: CheckCircleIcon, bg: "bg-emerald-50", fg: "text-emerald-700" },
  in_progress: { icon: SatelliteIcon, bg: "bg-sky-50", fg: "text-sky-700" },
  delivered: { icon: PackageIcon, bg: "bg-leaf-50", fg: "text-leaf-700" },
  cancelled: { icon: XIcon, bg: "bg-red-50", fg: "text-red-700" },
};

export default async function NotificationsPage() {
  const t = await getTranslations("restaurant");
  const intlLocale = toIntlLocale(await getLocale());
  const orders = await fetchMyOrders();
  const feed = buildFeed(orders, t);

  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: t("common.crumbRestaurant"), href: "/dashboard/restaurant" },
          { label: t("notifications.crumbNotifications") },
        ]}
        eyebrow={t("notifications.eyebrow")}
        title={t("notifications.title")}
        subtitle={t("notifications.subtitle")}
      />

      {feed.length === 0 ? (
        <div className="vc-card p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-neutral-50">
            <BellIcon size={20} className="text-neutral-400" />
          </div>
          <p className="mt-3 text-sm font-semibold text-neutral-900">
            {t("notifications.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {t("notifications.emptyBody")}
          </p>
          <Link
            href="/dashboard/restaurant/marketplace"
            className="vc-btn-primary mt-4"
          >
            {t("common.goToCatalog")}
          </Link>
        </div>
      ) : (
        <ul className="vc-card divide-y divide-neutral-100 p-2">
          {feed.map((it) => {
            const meta = KIND_META[it.kind];
            const Icon = meta.icon;
            return (
              <li key={it.id}>
                <Link
                  href={`/dashboard/restaurant/orders/${it.order_id}`}
                  className="flex items-start gap-3 rounded-lg px-3 py-3 transition hover:bg-neutral-50"
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${meta.bg}`}
                  >
                    <Icon size={16} className={meta.fg} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-neutral-900">
                      {it.title}
                    </p>
                    <p className="text-xs text-neutral-500">{it.body}</p>
                  </div>
                  <p className="hidden text-[11px] text-neutral-400 sm:block">
                    {new Date(it.ts).toLocaleString(intlLocale)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 flex items-start gap-3 rounded-lg border border-leaf-100 bg-leaf-50/60 p-4 text-sm">
        <InfoIcon size={16} className="mt-0.5 text-leaf-700" />
        <p className="text-leaf-800">
          {t("notifications.footerNote")}
        </p>
      </div>
    </div>
  );
}
