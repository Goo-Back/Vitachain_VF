import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/app/dashboard/farmer/_ui/PageHeader";
import {
  ArrowRightIcon,
  BellIcon,
  CheckCircleIcon,
  PackageIcon,
  SatelliteIcon,
} from "@/app/dashboard/farmer/_ui/Icon";

import { fetchOrderById } from "../../actions";
import { PaymentEcho } from "./PaymentEcho";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function OrderConfirmationPage({ params }: Props) {
  const { id } = await params;
  const order = await fetchOrderById(id);
  if (!order) notFound();

  const short = `VITA-${order.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Restaurateur", href: "/dashboard/restaurant" },
          { label: "Mes commandes", href: "/dashboard/restaurant/orders" },
          { label: "Confirmation" },
        ]}
        title="Commande confirmée."
        subtitle="Nous transmettons votre demande aux producteurs sélectionnés. Vous serez notifié à chaque étape."
      />

      <section className="vc-card overflow-hidden p-0">
        <div className="bg-gradient-to-br from-leaf-500 to-leaf-700 px-6 py-8 text-white">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
              <CheckCircleIcon size={24} className="text-white" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/80">
                Référence
              </p>
              <p className="font-mono text-xl font-bold">{short}</p>
              <p className="mt-1 text-sm text-white/90">
                {order.items.length} article{order.items.length !== 1 ? "s" : ""}{" "}
                · Total {Number(order.total_mad).toFixed(2)} MAD
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-3">
          <Stat label="Sous-total" value={`${Number(order.subtotal_mad).toFixed(2)} MAD`} />
          <Stat
            label="Logistique"
            value={`${Number(order.logistics_fee_mad).toFixed(2)} MAD`}
          />
          <Stat
            label="Région"
            value={order.delivery_region}
          />
        </div>
      </section>

      <div className="mt-4">
        <PaymentEcho
          orderId={order.id}
          amount={Number(order.total_mad)}
          paymentMethod={order.payment_method}
          paymentStatus={order.payment_status}
          paidAt={order.paid_at}
        />
      </div>

      <section className="mt-6 vc-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-neutral-900">
          Et maintenant ?
        </h2>
        <ol className="space-y-4">
          <NextStep
            icon={<BellIcon size={16} className="text-leaf-700" />}
            title="Les producteurs reçoivent la commande"
            body="Anonymisée — votre nom et vos coordonnées restent privés. Vous serez notifié dès qu'ils l'auront acceptée."
            eta="Sous 12 h en moyenne"
          />
          <NextStep
            icon={<SatelliteIcon size={16} className="text-leaf-700" />}
            title="La logistique se met en route"
            body="Notre transporteur récupère la marchandise et la consolide pour votre établissement."
            eta="Dans les 24-48 h"
          />
          <NextStep
            icon={<PackageIcon size={16} className="text-leaf-700" />}
            title="Réception chez vous"
            body="Vérifiez la conformité puis confirmez la réception depuis la page de la commande."
            eta="Vous serez notifié 1 h avant"
          />
        </ol>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/dashboard/restaurant/orders/${order.id}`}
          className="vc-btn-primary"
        >
          Voir le suivi détaillé <ArrowRightIcon size={14} />
        </Link>
        <Link
          href={`/dashboard/restaurant/orders/${order.id}/receipt`}
          className="vc-btn-secondary"
        >
          Bon de commande PDF
        </Link>
        <Link
          href="/dashboard/restaurant/marketplace"
          className="vc-btn-ghost"
        >
          Continuer mes achats
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function NextStep({
  icon,
  title,
  body,
  eta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  eta: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-leaf-50">
        {icon}
      </span>
      <div className="flex-1">
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        <p className="text-xs text-neutral-500">{body}</p>
        <p className="mt-1 text-[11px] font-medium text-leaf-700">{eta}</p>
      </div>
    </li>
  );
}
