import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";

import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";
import {
  ArrowRightIcon,
  BellIcon,
  CheckCircleIcon,
  PackageIcon,
  SatelliteIcon,
} from "@/app/[locale]/dashboard/farmer/_ui/Icon";

import { fetchOrderById } from "../../actions";
import { PaymentEcho } from "./PaymentEcho";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function OrderConfirmationPage({ params }: Props) {
  const t = await getTranslations("restaurant");
  const { id } = await params;
  const order = await fetchOrderById(id);
  if (!order) notFound();

  const short = `VITA-${order.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

  return (
    <div className="mx-auto max-w-3xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: t("common.crumbRestaurant"), href: "/dashboard/restaurant" },
          { label: t("orders.confirmation.crumbOrders"), href: "/dashboard/restaurant/orders" },
          { label: t("orders.confirmation.crumbConfirmation") },
        ]}
        title={t("orders.confirmation.title")}
        subtitle={t("orders.confirmation.subtitle")}
      />

      <section className="vc-card overflow-hidden p-0">
        <div className="bg-gradient-to-br from-leaf-500 to-leaf-700 px-6 py-8 text-white">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
              <CheckCircleIcon size={24} className="text-white" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/80">
                {t("orders.confirmation.reference")}
              </p>
              <p className="font-mono text-xl font-bold">{short}</p>
              <p className="mt-1 text-sm text-white/90">
                {t("orders.confirmation.itemsAndTotal", {
                  count: order.items.length,
                  amount: Number(order.total_mad).toFixed(2),
                })}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-3">
          <Stat label={t("orders.confirmation.subtotalLabel")} value={`${Number(order.subtotal_mad).toFixed(2)} MAD`} />
          <Stat
            label={t("orders.confirmation.logisticsLabel")}
            value={`${Number(order.logistics_fee_mad).toFixed(2)} MAD`}
          />
          <Stat
            label={t("orders.confirmation.regionLabel")}
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
          {t("orders.confirmation.nextStepsTitle")}
        </h2>
        <ol className="space-y-4">
          <NextStep
            icon={<BellIcon size={16} className="text-leaf-700" />}
            title={t("orders.confirmation.step1Title")}
            body={t("orders.confirmation.step1Body")}
            eta={t("orders.confirmation.step1Eta")}
          />
          <NextStep
            icon={<SatelliteIcon size={16} className="text-leaf-700" />}
            title={t("orders.confirmation.step2Title")}
            body={t("orders.confirmation.step2Body")}
            eta={t("orders.confirmation.step2Eta")}
          />
          <NextStep
            icon={<PackageIcon size={16} className="text-leaf-700" />}
            title={t("orders.confirmation.step3Title")}
            body={t("orders.confirmation.step3Body")}
            eta={t("orders.confirmation.step3Eta")}
          />
        </ol>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/dashboard/restaurant/orders/${order.id}`}
          className="vc-btn-primary"
        >
          {t("orders.confirmation.viewTracking")} <ArrowRightIcon size={14} className="rtl:-scale-x-100" />
        </Link>
        <Link
          href={`/dashboard/restaurant/orders/${order.id}/receipt`}
          className="vc-btn-secondary"
        >
          {t("orders.confirmation.receiptPdf")}
        </Link>
        <Link
          href="/dashboard/restaurant/marketplace"
          className="vc-btn-ghost"
        >
          {t("orders.confirmation.continueShopping")}
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
