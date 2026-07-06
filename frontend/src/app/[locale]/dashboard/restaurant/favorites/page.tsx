import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/app/[locale]/dashboard/farmer/_ui/PageHeader";

import { FavoritesList } from "./FavoritesList";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const t = await getTranslations("restaurant");
  return (
    <div className="vc-fade-in">
      <PageHeader
        crumbs={[
          { label: t("common.crumbRestaurant"), href: "/dashboard/restaurant" },
          { label: t("favorites.page.crumbFavorites") },
        ]}
        eyebrow={t("favorites.page.eyebrow")}
        title={t("favorites.page.title")}
        subtitle={t("favorites.page.subtitle")}
      />
      <FavoritesList />
    </div>
  );
}
