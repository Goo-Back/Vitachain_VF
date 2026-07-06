import { getTranslations } from "next-intl/server";

import { MIcon } from "./_ui/Icon";
import { CardLink, Stagger } from "./_ui/motion";

const TILES = [
  {
    href:      () => "/dashboard/farmer/parcels",
    icon:      "map",
    labelKey:  "parcelsLabel",
    subKey:    "parcelsSub",
    bg:        "#1B3A2A",
    iconBg:    "rgba(255,255,255,0.18)",
    iconColor: "#ffffff",
    textColor: "#ffffff",
    subColor:  "rgba(255,255,255,0.55)",
  },
  {
    href:      () => "/dashboard/farmer/ads",
    icon:      "storefront",
    labelKey:  "adsLabel",
    subKey:    "adsSub",
    bg:        "#0D3333",
    iconBg:    "rgba(255,255,255,0.10)",
    iconColor: "#5eead4",
    textColor: "#5eead4",
    subColor:  "rgba(94,234,212,0.55)",
  },
  {
    href:      (firstParcelId: string) => `/dashboard/farmer/satellite?parcel=${firstParcelId}`,
    icon:      "satellite_alt",
    labelKey:  "satelliteLabel",
    subKey:    "satelliteSub",
    bg:        "#FAE5E0",
    iconBg:    "rgba(0,0,0,0.06)",
    iconColor: "#78716c",
    textColor: "#44403c",
    subColor:  "#a8a29e",
  },
] as const;

export async function QuickActions({ firstParcelId }: { firstParcelId: string }) {
  const t = await getTranslations("farmer.overview.quickActions");
  return (
    <Stagger
      as="section"
      ariaLabel={t("ariaLabel")}
      className="grid grid-cols-1 gap-4 sm:grid-cols-3"
    >
      {TILES.map((tile) => {
        const label = t(tile.labelKey);
        return (
          <CardLink
            key={tile.labelKey}
            href={tile.href(firstParcelId)}
            ariaLabel={label}
            className="group flex flex-col items-center justify-center gap-3 rounded-3xl p-8 text-center shadow-card focus:outline-none"
            style={{ backgroundColor: tile.bg }}
          >
            <span
              className="grid h-16 w-16 place-items-center rounded-full transition-transform duration-300 group-hover:scale-110"
              style={{ backgroundColor: tile.iconBg, color: tile.iconColor }}
            >
              <MIcon name={tile.icon} size={32} fill weight={400} />
            </span>

            <div>
              <span
                className="block text-base font-bold leading-snug tracking-tight"
                style={{ color: tile.textColor }}
              >
                {label}
              </span>
              <span
                className="mt-0.5 block text-xs"
                style={{ color: tile.subColor }}
              >
                {t(tile.subKey)}
              </span>
            </div>
          </CardLink>
        );
      })}
    </Stagger>
  );
}
