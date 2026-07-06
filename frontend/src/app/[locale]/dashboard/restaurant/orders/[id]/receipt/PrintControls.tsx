"use client";

import { useTranslations } from "next-intl";

import { DownloadIcon } from "@/app/[locale]/dashboard/farmer/_ui/Icon";

export function PrintControls() {
  const t = useTranslations("restaurant.orders.printControls");
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="vc-btn-primary"
    >
      <DownloadIcon size={14} /> {t("printButton")}
    </button>
  );
}
