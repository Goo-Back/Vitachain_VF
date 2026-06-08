import { PageHeader } from "@/app/dashboard/farmer/_ui/PageHeader";

import { FavoritesList } from "./FavoritesList";

export const dynamic = "force-dynamic";

export default function FavoritesPage() {
  return (
    <div className="vc-fade-in">
      <PageHeader
        crumbs={[
          { label: "Restaurateur", href: "/dashboard/restaurant" },
          { label: "Favoris" },
        ]}
        eyebrow="FarMarket"
        title="Mes favoris."
        subtitle="Annonces que vous avez sauvegardées pour les retrouver rapidement. Les favoris sont stockés localement sur cet appareil."
      />
      <FavoritesList />
    </div>
  );
}
