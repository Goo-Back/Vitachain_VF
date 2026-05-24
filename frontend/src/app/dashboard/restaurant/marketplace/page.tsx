import Link from "next/link";

import { fetchCatalog } from "./actions";
import { CatalogFilters } from "./CatalogFilters";
import { AdCatalogCard } from "./AdCatalogCard";
import { MOROCCO_REGIONS } from "@/app/dashboard/farmer/ads/new/regions";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

type Props = {
  searchParams: Promise<SearchParams>;
};

export default async function MarketplacePage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);

  const catalog = await fetchCatalog({
    region: sp.region as string | undefined,
    product_type: sp.product_type as string | undefined,
    price_min: sp.price_min as string | undefined,
    price_max: sp.price_max as string | undefined,
    page,
  });

  const defaultFilters = {
    region: (sp.region as string) ?? "",
    product_type: (sp.product_type as string) ?? "",
    price_min: (sp.price_min as string) ?? "",
    price_max: (sp.price_max as string) ?? "",
  };

  return (
    <div className="vc-fade-in">
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
          FarMarket
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-neutral-900">
          Catalogue Producteurs
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {catalog.total} annonce{catalog.total !== 1 ? "s" : ""} disponible
          {catalog.total !== 1 ? "s" : ""}
        </p>
      </div>

      <CatalogFilters regions={MOROCCO_REGIONS} defaultValues={defaultFilters} />

      {catalog.items.length === 0 ? (
        <div className="vc-card mt-6 p-10 text-center">
          <p className="text-base font-semibold text-neutral-900">
            Aucune annonce trouvée.
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Essayez d&apos;élargir vos filtres de recherche.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.items.map((ad) => (
            <AdCatalogCard key={ad.id} ad={ad} />
          ))}
        </ul>
      )}

      <PaginationBar
        page={catalog.page}
        hasNext={catalog.has_next}
        currentSearchParams={sp as Record<string, string>}
      />
    </div>
  );
}

function PaginationBar({
  page,
  hasNext,
  currentSearchParams,
}: {
  page: number;
  hasNext: boolean;
  currentSearchParams: Record<string, string>;
}) {
  const buildHref = (p: number) => {
    const qs = new URLSearchParams({ ...currentSearchParams, page: String(p) });
    return `/dashboard/restaurant/marketplace?${qs.toString()}`;
  };

  if (page === 1 && !hasNext) return null;

  return (
    <div className="mt-8 flex items-center justify-between">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className="vc-btn-secondary">
          ← Précédent
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-neutral-500">Page {page}</span>
      {hasNext ? (
        <Link href={buildHref(page + 1)} className="vc-btn-secondary">
          Suivant →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
