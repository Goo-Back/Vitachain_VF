import { CartPageClient } from "./CartPageClient";
import { MOROCCO_REGIONS } from "@/app/dashboard/farmer/ads/new/regions";

export const dynamic = "force-dynamic";

export default function CartPage() {
  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          FarMarket
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-neutral-900">Panier</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Vérifiez vos articles et passez commande. VitaChain gère la
          logistique — vos coordonnées ne sont jamais partagées avec les
          producteurs.
        </p>
      </div>

      <CartPageClient regions={MOROCCO_REGIONS} />
    </div>
  );
}
