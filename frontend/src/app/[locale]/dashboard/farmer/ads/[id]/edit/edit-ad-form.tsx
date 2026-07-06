"use client";

import { Link } from "@/i18n/navigation";
import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { MOROCCO_REGIONS } from "../../../ads/new/regions";
import { updateAd, type Ad, type AdUpdateFormState } from "../../actions";

const ERROR_KEY_MAP: Record<string, string> = {
  no_fields_to_update: "no_fields_to_update",
  ad_not_found: "ad_not_found",
  not_ad_owner: "not_ad_owner",
  "ad_not_editable: only ACTIVE ads can be edited": "not_editable",
  too_many_photos: "too_many_photos",
  photo_too_large: "photo_too_large",
  invalid_photo_type: "invalid_photo_type",
  network_error: "network_error",
  not_authenticated: "not_authenticated",
};

interface Props {
  ad: Ad;
}

export function EditAdForm({ ad }: Props) {
  const t = useTranslations("farmer.ads.edit.form");
  const boundAction = updateAd.bind(null, ad.id);
  const [state, formAction, pending] = useActionState<AdUpdateFormState, FormData>(
    boundAction,
    { error: null },
  );

  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const errorMsg = state.error
    ? t(ERROR_KEY_MAP[state.error] ? `errors.${ERROR_KEY_MAP[state.error]}` : "errors.generic", { error: state.error })
    : null;

  return (
    <form action={formAction} className="vc-card mt-6 space-y-5 p-6">
      {errorMsg && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {errorMsg}
        </div>
      )}

      <div>
        <label className="vc-label" htmlFor="title">
          {t("titleLabel")}
        </label>
        <input
          id="title"
          name="title"
          type="text"
          defaultValue={ad.title}
          minLength={3}
          maxLength={100}
          className="vc-input mt-1 w-full"
        />
      </div>

      <div>
        <label className="vc-label" htmlFor="description">
          {t("descriptionLabel")}
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={ad.description}
          rows={4}
          minLength={10}
          maxLength={2000}
          className="vc-input mt-1 w-full resize-none"
        />
      </div>

      <div>
        <label className="vc-label" htmlFor="product_type">
          {t("productTypeLabel")}
        </label>
        <input
          id="product_type"
          name="product_type"
          type="text"
          defaultValue={ad.product_type}
          minLength={2}
          maxLength={80}
          className="vc-input mt-1 w-full"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="vc-label" htmlFor="price_mad">
            {t("priceLabel")}
          </label>
          <input
            id="price_mad"
            name="price_mad"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={Number(ad.price_mad).toFixed(2)}
            className="vc-input mt-1 w-full"
          />
        </div>
        <div>
          <label className="vc-label" htmlFor="quantity_kg">
            {t("quantityLabel")}
          </label>
          <input
            id="quantity_kg"
            name="quantity_kg"
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={Number(ad.quantity_kg).toFixed(1)}
            className="vc-input mt-1 w-full"
          />
        </div>
      </div>

      <div>
        <label className="vc-label" htmlFor="region">
          {t("regionLabel")}
        </label>
        <select
          id="region"
          name="region"
          defaultValue={ad.region}
          className="vc-input mt-1 w-full"
        >
          {MOROCCO_REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="vc-label">
          {t("photosLabel")}
        </label>
        {ad.photo_urls.length > 0 && photoFiles.length === 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {ad.photo_urls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={t("photoAlt", { index: i + 1 })}
                className="h-20 w-20 rounded-lg object-cover ring-1 ring-neutral-200"
              />
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          name="photos"
          accept="image/*"
          multiple
          className="mt-2 block w-full text-sm text-neutral-600 file:me-3 file:rounded-lg file:border-0 file:bg-leaf-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-leaf-700"
          onChange={(e) => setPhotoFiles(Array.from(e.target.files ?? []))}
        />
        {photoFiles.length > 0 && (
          <p className="mt-1 text-xs text-warn-600">
            {t("newPhotosNotice", { count: photoFiles.length })}
          </p>
        )}
        <p className="mt-1 text-xs text-neutral-400">
          {t("photosHelp")}
        </p>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Link href="/dashboard/farmer/ads" className="vc-btn-ghost">
          {t("cancel")}
        </Link>
        <button type="submit" disabled={pending} className="vc-btn-primary">
          {pending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
