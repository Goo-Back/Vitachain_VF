"use client";

import { useRouter, usePathname } from "next/navigation";
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
      className="vc-card flex flex-wrap items-end gap-4 p-4"
    >
      <div className="min-w-[180px] flex-1">
        <label
          htmlFor="region"
          className="block text-xs font-medium text-neutral-600"
        >
          Région
        </label>
        <select
          id="region"
          name="region"
          defaultValue={defaultValues.region}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        >
          <option value="">Toutes les régions</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[180px] flex-1">
        <label
          htmlFor="product_type"
          className="block text-xs font-medium text-neutral-600"
        >
          Type de produit
        </label>
        <input
          id="product_type"
          name="product_type"
          type="text"
          placeholder="Ex: Tomates, Poivrons…"
          defaultValue={defaultValues.product_type}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="min-w-[120px]">
        <label
          htmlFor="price_min"
          className="block text-xs font-medium text-neutral-600"
        >
          Prix min (MAD/kg)
        </label>
        <input
          id="price_min"
          name="price_min"
          type="number"
          step="0.01"
          min="0"
          defaultValue={defaultValues.price_min}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="min-w-[120px]">
        <label
          htmlFor="price_max"
          className="block text-xs font-medium text-neutral-600"
        >
          Prix max (MAD/kg)
        </label>
        <input
          id="price_max"
          name="price_max"
          type="number"
          step="0.01"
          min="0"
          defaultValue={defaultValues.price_max}
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button type="submit" className="vc-btn-primary">
          Filtrer
        </button>
        <button type="button" onClick={handleReset} className="vc-btn-secondary">
          Réinitialiser
        </button>
      </div>
    </form>
  );
}
