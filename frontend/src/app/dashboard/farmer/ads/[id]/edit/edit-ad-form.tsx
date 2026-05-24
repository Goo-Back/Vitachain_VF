"use client";

import { useActionState, useRef, useState } from "react";

import { MOROCCO_REGIONS } from "../../../ads/new/regions";
import { updateAd, type Ad, type AdUpdateFormState } from "../../actions";

const ERROR_COPY: Record<string, string> = {
  no_fields_to_update: "Modifiez au moins un champ avant de sauvegarder.",
  ad_not_found: "Annonce introuvable.",
  not_ad_owner: "Vous n'êtes pas propriétaire de cette annonce.",
  "ad_not_editable: only ACTIVE ads can be edited":
    "Seules les annonces actives peuvent être modifiées.",
  too_many_photos: "Maximum 5 photos autorisées.",
  photo_too_large: "Chaque photo ne doit pas dépasser 2 Mo.",
  invalid_photo_type: "Seules les images sont acceptées.",
  network_error: "Erreur réseau. Vérifiez votre connexion et réessayez.",
  not_authenticated: "Session expirée. Reconnectez-vous.",
};

interface Props {
  ad: Ad;
}

export function EditAdForm({ ad }: Props) {
  const boundAction = updateAd.bind(null, ad.id);
  const [state, formAction, pending] = useActionState<AdUpdateFormState, FormData>(
    boundAction,
    { error: null },
  );

  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const errorMsg = state.error
    ? (ERROR_COPY[state.error] ?? `Erreur : ${state.error}`)
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
          Titre de l&apos;annonce
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
          Description
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
          Type de produit
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
            Prix (MAD/kg)
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
            Quantité (kg)
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
          Région
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
          Photos (laisser vide pour conserver les photos actuelles)
        </label>
        {ad.photo_urls.length > 0 && photoFiles.length === 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {ad.photo_urls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={`Photo ${i + 1}`}
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
          className="mt-2 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-leaf-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-leaf-700"
          onChange={(e) => setPhotoFiles(Array.from(e.target.files ?? []))}
        />
        {photoFiles.length > 0 && (
          <p className="mt-1 text-xs text-warn-600">
            {photoFiles.length} nouvelle{photoFiles.length !== 1 ? "s" : ""} photo
            {photoFiles.length !== 1 ? "s" : ""} — remplacera toutes les photos existantes.
          </p>
        )}
        <p className="mt-1 text-xs text-neutral-400">
          Max 5 photos · 2 Mo par photo · formats image uniquement
        </p>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <a href="/dashboard/farmer/ads" className="vc-btn-ghost">
          Annuler
        </a>
        <button type="submit" disabled={pending} className="vc-btn-primary">
          {pending ? "Enregistrement…" : "Enregistrer les modifications"}
        </button>
      </div>
    </form>
  );
}
