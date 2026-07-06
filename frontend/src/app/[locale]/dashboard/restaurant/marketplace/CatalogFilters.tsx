"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useRef } from "react";

type DefaultValues = {
  region: string;
  product_type: string;
  price_min: string;
  price_max: string;
};

type Props = {
  regions: readonly string[];
  defaultValues: DefaultValues;
};

export function CatalogFilters({ regions, defaultValues }: Props) {
  const t = useTranslations("restaurant.marketplace.filters");
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const qs = new URLSearchParams();

    const region = fd.get("region") as string;
    const product_type = (fd.get("product_type") as string).trim();
    const price_min = fd.get("price_min") as string;
    const price_max = fd.get("price_max") as string;

    if (region) qs.set("region", region);
    if (product_type) qs.set("product_type", product_type);
    if (price_min) qs.set("price_min", price_min);
    if (price_max) qs.set("price_max", price_max);
    // reset to page 1 on new filter

    router.push(`${pathname}?${qs.toString()}`);
  }

  function handleReset() {
    formRef.current?.reset();
    router.push(pathname);
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="vc-card flex flex-wrap items-end gap-6 divide-neutral-100 p-5 sm:divide-x"
    >
      <div className="min-w-[160px] flex-1">
        <label
          htmlFor="region"
          className="block text-[0.7rem] font-semibold uppercase tracking-wide text-neutral-400"
        >
          {t("regionLabel")}
        </label>
        <select
          id="region"
          name="region"
          defaultValue={defaultValues.region}
          className="mt-1.5 w-full border-0 bg-transparent p-0 text-sm font-medium text-neutral-800 focus:outline-none"
        >
          <option value="">{t("allRegions")}</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[160px] flex-1 sm:ps-6">
        <label
          htmlFor="product_type"
          className="block text-[0.7rem] font-semibold uppercase tracking-wide text-neutral-400"
        >
          {t("productTypeLabel")}
        </label>
        <input
          id="product_type"
          name="product_type"
          type="text"
          placeholder={t("productTypePlaceholder")}
          defaultValue={defaultValues.product_type}
          className="mt-1.5 w-full border-0 bg-transparent p-0 text-sm font-medium text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
        />
      </div>

      <div className="min-w-[200px] sm:ps-6">
        <span className="block text-[0.7rem] font-semibold uppercase tracking-wide text-neutral-400">
          {t("priceRangeLabel")}
        </span>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="price_min"
            name="price_min"
            type="number"
            step="0.01"
            min="0"
            placeholder={t("min")}
            defaultValue={defaultValues.price_min}
            className="w-16 border-0 bg-transparent p-0 text-sm font-medium text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
          />
          <span className="text-neutral-300">—</span>
          <input
            id="price_max"
            name="price_max"
            type="number"
            step="0.01"
            min="0"
            placeholder={t("max")}
            defaultValue={defaultValues.price_max}
            className="w-16 border-0 bg-transparent p-0 text-sm font-medium text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="ml-auto flex gap-2">
        <button
          type="submit"
          className="rounded-lg px-6 py-2.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md"
          style={{ background: "var(--gradient-farmarket-strong)" }}
        >
          {t("filterButton")}
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-neutral-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 transition hover:border-market-blue-300"
        >
          {t("resetButton")}
        </button>
      </div>
    </form>
  );
}
