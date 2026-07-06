import { getTranslations } from "next-intl/server";

import { CartPageClient } from "./CartPageClient";
import { MOROCCO_REGIONS } from "@/app/[locale]/dashboard/farmer/ads/new/regions";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const t = await getTranslations("restaurant.cart.page");
  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          {t("eyebrow")}
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t("subtitle")}
        </p>
      </div>

      <CartPageClient regions={MOROCCO_REGIONS} />
    </div>
  );
}
