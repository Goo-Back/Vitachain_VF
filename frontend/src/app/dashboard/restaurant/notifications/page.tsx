import Link from "next/link";

import { PageHeader } from "@/app/dashboard/farmer/_ui/PageHeader";
import {
  BellIcon,
  CheckCircleIcon,
  InfoIcon,
  PackageIcon,
  SatelliteIcon,
  ShoppingBagIcon,
  XIcon,
} from "@/app/dashboard/farmer/_ui/Icon";

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

function buildFeed(orders: Order[]): FeedItem[] {
  const items: FeedItem[] = [];
  for (const o of orders) {
    const short = `VITA-${o.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    items.push({
      id: `${o.id}-created`,
      order_id: o.id,
      ts: o.created_at,
      kind: "created",
      title: `${short} — Commande créée`,
      body: `${o.items.length} article${o.items.length !== 1 ? "s" : ""} · ${Number(o.total_mad).toFixed(0)} MAD`,
    });

    if (o.status === "ACCEPTED" || o.status === "PARTIALLY_ACCEPTED") {
      items.push({
        id: `${o.id}-accepted`,
        order_id: o.id,
        ts: o.updated_at,
        kind: "accepted",
        title: `${short} — Commande acceptée`,
        body:
          o.status === "PARTIALLY_ACCEPTED"
            ? "Partiellement acceptée — certaines lignes non honorées."
            : "Tous les producteurs ont validé votre commande.",
      });
    }

    if (o.status === "IN_PROGRESS") {
      items.push({
        id: `${o.id}-in-progress`,
        order_id: o.id,
        ts: o.updated_at,
        kind: "in_progress",
        title: `${short} — En cours de livraison`,
        body: `Logistique en route vers ${o.delivery_region}.`,
      });
    }

    if (o.status === "DELIVERED") {
      items.push({
        id: `${o.id}-delivered`,
        order_id: o.id,
        ts: o.updated_at,
        kind: "delivered",
        title: `${short} — Commande livrée`,
        body: "Merci de confirmer la réception depuis la page de la commande.",
      });
    }

    if (o.status === "CANCELLED" || o.status === "REJECTED") {
      items.push({
        id: `${o.id}-cancelled`,
        order_id: o.id,
        ts: o.updated_at,
        kind: "cancelled",
        title: `${short} — ${o.status === "CANCELLED" ? "Commande annulée" : "Commande refusée"}`,
        body:
          o.status === "REJECTED"
            ? "Les producteurs n'ont pas pu honorer la commande."
            : "Commande annulée à votre demande.",
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
  const orders = await fetchMyOrders();
  const feed = buildFeed(orders);

  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Restaurateur", href: "/dashboard/restaurant" },
          { label: "Notifications" },
        ]}
        eyebrow="Notifications"
        title="Activité de vos commandes."
        subtitle="Tous les évènements liés à vos commandes — du dépôt à la livraison. Les identités des producteurs restent masquées."
      />

      {feed.length === 0 ? (
        <div className="vc-card p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-neutral-50">
            <BellIcon size={20} className="text-neutral-400" />
          </div>
          <p className="mt-3 text-sm font-semibold text-neutral-900">
            Aucune notification.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Dès que vous passerez votre première commande, son activité apparaîtra
            ici.
          </p>
          <Link
            href="/dashboard/restaurant/marketplace"
            className="vc-btn-primary mt-4"
          >
            Aller au catalogue
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
                    {new Date(it.ts).toLocaleString("fr-MA")}
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
          Vous pouvez aussi recevoir ces notifications par email — activez
          l&apos;option dans vos préférences (à venir).
        </p>
      </div>
    </div>
  );
}
