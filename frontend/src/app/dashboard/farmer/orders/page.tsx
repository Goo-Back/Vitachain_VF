import { fetchIncomingItems } from "./actions";
import { IncomingItemRow } from "./IncomingItemRow";

export const dynamic = "force-dynamic";

export default async function FarmerOrdersPage() {
  const items = await fetchIncomingItems();

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          FarMarket
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-neutral-900">
          Commandes entrantes
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Les restaurateurs sont anonymisés — vous ne voyez qu&apos;un
          identifiant opaque et la région de livraison. VitaChain gère la
          coordination logistique.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-neutral-900">
            Aucune commande pour le moment.
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Quand un restaurateur passera une commande sur vos annonces, elle
            apparaîtra ici.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50">
              <tr>
                {[
                  "Resto (anonyme)",
                  "Annonce",
                  "Quantité",
                  "Total",
                  "Région",
                  "Statut",
                  "Actions",
                ].map((h) => (
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
              {items.map((it) => (
                <IncomingItemRow key={it.id} item={it} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
