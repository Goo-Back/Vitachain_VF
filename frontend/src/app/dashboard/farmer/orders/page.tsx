import Link from "next/link";

import { ArrowRightIcon, InfoIcon, PackageIcon, StoreIcon } from "../_ui/Icon";
import { PageHeader } from "../_ui/PageHeader";
import { fetchIncomingItems } from "./actions";
import { IncomingItemRow } from "./IncomingItemRow";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "Resto (anonyme)",
  "Annonce",
  "Quantité",
  "Total",
  "Région",
  "Statut",
  "Actions",
];

export default async function FarmerOrdersPage() {
  const items = await fetchIncomingItems();
  const pending = items.filter((it) => it.status === "PENDING").length;

  return (
    <div className="mx-auto max-w-6xl vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Mon exploitation", href: "/dashboard/farmer" },
          { label: "Commandes" },
        ]}
        eyebrow="FarMarket"
        title="Commandes entrantes"
        subtitle="Les restaurateurs sont anonymisés — vous ne voyez qu'un identifiant opaque et la région de livraison. VitaChain gère la coordination logistique."
        actions={
          items.length > 0 ? (
            <span className={`vc-pill ${pending > 0 ? "vc-pill-warn" : "vc-pill-leaf"}`}>
              <PackageIcon size={12} />
              {pending > 0
                ? `${pending} en attente`
                : `${items.length} commande${items.length > 1 ? "s" : ""}`}
            </span>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="vc-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-100 text-sm">
              <thead className="bg-neutral-50/80">
                <tr>
                  {COLUMNS.map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
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
        </section>
      )}

      {items.length > 0 ? (
        <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-neutral-400">
          <InfoIcon size={12} />
          Faites défiler horizontalement sur mobile pour voir toutes les colonnes.
        </p>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="vc-card p-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-sky-tint-50">
        <PackageIcon size={28} className="text-sky-tint-700" />
      </span>
      <p className="mt-4 text-base font-semibold text-neutral-900">
        Aucune commande pour le moment.
      </p>
      <p className="mt-1 text-sm text-neutral-500">
        Quand un restaurateur passera une commande sur vos annonces, elle
        apparaîtra ici.
      </p>
      <Link href="/dashboard/farmer/ads" className="vc-btn-ghost mt-5">
        <StoreIcon size={14} /> Gérer mes annonces
        <ArrowRightIcon size={14} />
      </Link>
    </div>
  );
}
