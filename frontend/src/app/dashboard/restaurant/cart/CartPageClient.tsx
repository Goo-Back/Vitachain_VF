"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { computeLogisticsFee, useCart } from "@/lib/cart";
import { placeOrder } from "@/app/dashboard/restaurant/orders/actions";

type Props = {
  regions: readonly string[];
};

export function CartPageClient({ regions }: Props) {
  const router = useRouter();
  const { lines, updateQuantity, removeFromCart, clearCart, subtotal } = useCart();
  const [region, setRegion] = useState<string>(regions[0]);
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const logistics = computeLogisticsFee(subtotal);
  const total = subtotal + logistics;

  // Group by producer for display only — the API accepts a flat item array.
  const groups = lines.reduce<Record<string, typeof lines>>((acc, l) => {
    const k = l.ad_snapshot.farmer_id;
    if (!acc[k]) acc[k] = [];
    acc[k].push(l);
    return acc;
  }, {});

  function handleSubmit() {
    setError(null);
    if (lines.length === 0) {
      setError("Votre panier est vide.");
      return;
    }
    startTransition(async () => {
      const result = await placeOrder({
        delivery_region: region,
        delivery_notes: notes.trim() ? notes.trim() : null,
        items: lines.map((l) => ({
          ad_id: l.ad_id,
          quantity_kg: l.quantity_kg,
        })),
      });
      if (!result.ok) {
        setError(_formatError(result.error));
        return;
      }
      clearCart();
      router.push(`/dashboard/restaurant/orders/${result.order.id}`);
    });
  }

  if (lines.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-neutral-900">
          Votre panier est vide.
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Parcourez le catalogue pour ajouter des produits.
        </p>
        <Link
          href="/dashboard/restaurant/marketplace"
          className="mt-4 inline-block rounded bg-leaf-600 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-700"
        >
          Voir le catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {Object.entries(groups).map(([farmerId, group]) => (
          <div
            key={farmerId}
            className="rounded-lg border border-neutral-200 bg-white p-4"
          >
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
              Producteur — {group[0].ad_snapshot.region}
            </p>
            <ul className="divide-y divide-neutral-100">
              {group.map((l) => {
                const lineTotal = l.quantity_kg * Number(l.ad_snapshot.price_mad);
                return (
                  <li key={l.ad_id} className="py-3">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-neutral-900">
                          {l.ad_snapshot.title}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {l.ad_snapshot.product_type} · {l.ad_snapshot.price_mad} MAD/kg
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={Number(l.ad_snapshot.quantity_kg)}
                            step={1}
                            value={l.quantity_kg}
                            onChange={(e) =>
                              updateQuantity(l.ad_id, Number(e.target.value))
                            }
                            className="w-20 rounded border border-neutral-200 px-2 py-1 text-sm"
                          />
                          <span className="text-xs text-neutral-500">kg</span>
                          <button
                            type="button"
                            onClick={() => removeFromCart(l.ad_id)}
                            className="ml-auto text-xs text-red-600 hover:underline"
                          >
                            Retirer
                          </button>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-neutral-900">
                        {lineTotal.toFixed(2)} MAD
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <aside className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Récapitulatif</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-500">Sous-total</dt>
            <dd>{subtotal.toFixed(2)} MAD</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-500">Frais logistique VitaChain</dt>
            <dd>{logistics.toFixed(2)} MAD</dd>
          </div>
          <div className="flex justify-between border-t border-neutral-200 pt-2 font-semibold">
            <dt>Total</dt>
            <dd>{total.toFixed(2)} MAD</dd>
          </div>
        </dl>

        <div className="mt-4">
          <label htmlFor="region" className="block text-xs font-medium text-neutral-600">
            Région de livraison
          </label>
          <select
            id="region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          >
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3">
          <label htmlFor="notes" className="block text-xs font-medium text-neutral-600">
            Notes de livraison (facultatif)
          </label>
          <textarea
            id="notes"
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Préférences horaires, accès… (n'incluez aucune information de contact)"
            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-neutral-400">
            Vos coordonnées ne sont jamais transmises au producteur.
          </p>
        </div>

        {error && (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="mt-4 w-full rounded bg-leaf-600 px-4 py-2 text-sm font-medium text-white hover:bg-leaf-700 disabled:opacity-60"
        >
          {isPending ? "Envoi…" : "Passer commande"}
        </button>
      </aside>
    </div>
  );
}

function _formatError(code: string): string {
  if (code.startsWith("quantity_exceeds_stock"))
    return "Stock insuffisant sur au moins une annonce. Réajustez les quantités.";
  if (code.startsWith("ad_not_purchasable"))
    return "Une des annonces n'est plus disponible. Retirez-la du panier.";
  if (code === "not_authenticated") return "Session expirée. Reconnectez-vous.";
  return `Erreur (${code}).`;
}
