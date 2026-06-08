import Link from "next/link";
import { notFound } from "next/navigation";

import { getServerProfile } from "@/lib/auth/session";

import { fetchOrderById } from "../../actions";
import { PaymentTerms } from "./PaymentTerms";
import { PrintControls } from "./PrintControls";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function ReceiptPage({ params }: Props) {
  const { id } = await params;
  const order = await fetchOrderById(id);
  if (!order) notFound();

  const profile = await getServerProfile();

  const short = `VITA-${order.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const createdAt = new Date(order.created_at).toLocaleDateString("fr-MA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/restaurant/orders/${order.id}`}
          className="text-xs text-leaf-700 hover:underline"
        >
          ← Retour à la commande
        </Link>
        <PrintControls />
      </div>

      <article
        id="receipt"
        className="rounded-lg border border-neutral-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
      >
        <header className="flex items-start justify-between border-b border-neutral-200 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-leaf-700">
              VitaChain · FarMarket
            </p>
            <h1 className="mt-1 text-2xl font-bold text-neutral-900">
              Bon de commande
            </h1>
            <p className="mt-1 text-xs text-neutral-500">
              Document généré le {new Date().toLocaleDateString("fr-MA")}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm font-semibold text-neutral-900">
              {short}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">{createdAt}</p>
            <p className="mt-2 inline-block rounded-full bg-leaf-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-leaf-700 ring-1 ring-leaf-200">
              {order.status}
            </p>
          </div>
        </header>

        <section className="mt-6 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Facturé à
            </p>
            <p className="mt-1 font-medium text-neutral-900">
              {profile?.full_name ?? "—"}
            </p>
            <p className="text-xs text-neutral-600">{profile?.email ?? "—"}</p>
            <p className="text-xs text-neutral-600">{profile?.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Livraison
            </p>
            <p className="mt-1 font-medium text-neutral-900">
              {order.delivery_region}
            </p>
            <p className="text-xs text-neutral-600">
              {order.delivery_notes ?? "Aucune note particulière"}
            </p>
          </div>
        </section>

        <section className="mt-8">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                {["Article", "Quantité", "Prix unitaire", "Sous-total"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`py-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 ${
                        i > 0 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {order.items.map((it, i) => (
                <tr key={it.id}>
                  <td className="py-3">
                    <p className="text-neutral-900">Article #{i + 1}</p>
                    <p className="text-[11px] font-mono text-neutral-400">
                      ad:{it.ad_id.slice(0, 8)}…
                    </p>
                  </td>
                  <td className="py-3 text-right">
                    {Number(it.quantity_kg).toFixed(2)} kg
                  </td>
                  <td className="py-3 text-right">
                    {Number(it.unit_price_mad).toFixed(2)} MAD
                  </td>
                  <td className="py-3 text-right font-medium">
                    {Number(it.line_total_mad).toFixed(2)} MAD
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-6 flex justify-end">
          <dl className="w-full max-w-xs space-y-1.5 text-sm">
            <Row label="Sous-total" value={Number(order.subtotal_mad)} />
            <Row label="Logistique VitaChain" value={Number(order.logistics_fee_mad)} />
            <div className="flex justify-between border-t border-neutral-300 pt-2 text-base font-bold">
              <dt>Total TTC</dt>
              <dd>{Number(order.total_mad).toFixed(2)} MAD</dd>
            </div>
          </dl>
        </section>

        <section className="mt-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Conditions de règlement
          </p>
          <PaymentTerms
            orderId={order.id}
            amount={Number(order.total_mad)}
            paymentMethod={order.payment_method}
            paymentStatus={order.payment_status}
            paidAt={order.paid_at}
          />
        </section>

        <footer className="mt-10 border-t border-neutral-200 pt-4 text-[11px] text-neutral-500">
          <p>
            VitaChain SARL · ICE 002 154 178 000 081 · Casablanca, Maroc
          </p>
          <p className="mt-1">
            Les identités des producteurs sont gardées confidentielles
            conformément aux conditions logistiques de la plateforme.
            support@vitachain.ma · +212 5 22 00 00 00
          </p>
        </footer>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-neutral-500">{label}</dt>
      <dd>{value.toFixed(2)} MAD</dd>
    </div>
  );
}
