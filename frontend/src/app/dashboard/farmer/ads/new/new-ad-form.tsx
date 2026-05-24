"use client";

import { useActionState, useRef, useState } from "react";

import { ImageIcon, XIcon } from "../../_ui/Icon";
import { submitAdForm } from "../actions";

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB

const MOROCCO_REGIONS = [
  "Tanger-Tétouan-Al Hoceïma",
  "Oriental",
  "Fès-Meknès",
  "Rabat-Salé-Kénitra",
  "Béni Mellal-Khénifra",
  "Casablanca-Settat",
  "Marrakech-Safi",
  "Drâa-Tafilalet",
  "Souss-Massa",
  "Guelmim-Oued Noun",
  "Laâyoune-Sakia El Hamra",
  "Dakhla-Oued Ed-Dahab",
];

const ERROR_COPY: Record<string, string> = {
  title_required: "Le titre est obligatoire.",
  description_required: "La description est obligatoire.",
  product_type_required: "Le type de produit est obligatoire.",
  price_invalid: "Le prix doit être supérieur à 0.",
  quantity_invalid: "La quantité doit être supérieure à 0.",
  region_required: "La région est obligatoire.",
  not_authenticated: "Session expirée. Veuillez vous reconnecter.",
  network_error: "Erreur réseau. Vérifiez votre connexion et réessayez.",
  verification_required:
    "Votre compte n'est pas encore vérifié. Soumettez vos documents pour continuer.",
  role_not_allowed: "Seuls les comptes FARMER peuvent publier une annonce.",
  too_many_photos: `Maximum ${MAX_PHOTOS} photos autorisées.`,
  photo_too_large: "Une photo dépasse la limite de 2 Mo.",
  invalid_photo_type: "Seules les images sont acceptées (JPEG, PNG, WebP…).",
};

function errorMessage(code: string): string {
  const key = Object.keys(ERROR_COPY).find((k) => code.startsWith(k));
  return key ? ERROR_COPY[key]! : `Erreur inattendue (${code}). Réessayez.`;
}

type PhotoPreview = { file: File; url: string };

const INPUT_CLASS =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-leaf-500 focus:outline-none focus:ring-1 focus:ring-leaf-500";
const LABEL_CLASS = "mb-1 block text-sm font-medium text-neutral-800";

export function NewAdForm() {
  const [state, formAction, pending] = useActionState(submitAdForm, {
    error: null as string | null,
  });

  const [photos, setPhotos] = useState<PhotoPreview[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    setPhotoError(null);
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_PHOTOS) {
        setPhotoError(`Maximum ${MAX_PHOTOS} photos autorisées.`);
        break;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setPhotoError(`"${file.name}" dépasse 2 Mo.`);
        continue;
      }
      if (!file.type.startsWith("image/")) {
        setPhotoError(`"${file.name}" n'est pas une image.`);
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setPhotos(next);
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const updated = [...prev];
      const removed = updated.splice(index, 1)[0];
      if (removed) URL.revokeObjectURL(removed.url);
      return updated;
    });
    setPhotoError(null);
  }

  // Rebuild the FormData with the selected File objects so the server action
  // receives them — file inputs inside <form action={fn}> are transferred
  // via the browser's native FormData, but we keep a controlled list for
  // previews, so we inject the files via a hidden approach: the actual
  // <input type="file" multiple name="photos"> is kept in the DOM and its
  // value reflects the DataTransfer we build on submit.
  //
  // Simpler approach: attach files directly on the input using DataTransfer.
  function syncFileInput() {
    const dt = new DataTransfer();
    for (const { file } of photos) dt.items.add(file);
    if (fileInputRef.current) fileInputRef.current.files = dt.files;
  }

  return (
    <form
      action={formAction}
      onSubmit={syncFileInput}
      className="space-y-5"
    >
      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {errorMessage(state.error)}
        </div>
      )}

      {/* Titre */}
      <div>
        <label htmlFor="title" className={LABEL_CLASS}>
          Titre de l&apos;annonce
        </label>
        <input
          id="title"
          name="title"
          type="text"
          placeholder="Ex : Tomates BIO Souss — calibre A"
          minLength={3}
          maxLength={100}
          required
          className={INPUT_CLASS}
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className={LABEL_CLASS}>
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          placeholder="Décrivez votre produit : variété, conditions de culture, conditionnement…"
          minLength={10}
          maxLength={2000}
          required
          className={INPUT_CLASS}
        />
      </div>

      {/* Produit + Région */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="product_type" className={LABEL_CLASS}>
            Type de produit
          </label>
          <input
            id="product_type"
            name="product_type"
            type="text"
            placeholder="Ex : Tomates, Olives, Blé dur…"
            minLength={2}
            maxLength={80}
            required
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="region" className={LABEL_CLASS}>
            Région
          </label>
          <select
            id="region"
            name="region"
            required
            defaultValue=""
            className={INPUT_CLASS}
          >
            <option value="" disabled>
              — Choisir une région —
            </option>
            {MOROCCO_REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Prix + Quantité */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="price_mad" className={LABEL_CLASS}>
            Prix (MAD / kg)
          </label>
          <input
            id="price_mad"
            name="price_mad"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="4.50"
            required
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="quantity_kg" className={LABEL_CLASS}>
            Quantité disponible (kg)
          </label>
          <input
            id="quantity_kg"
            name="quantity_kg"
            type="number"
            step="0.1"
            min="0.1"
            placeholder="500"
            required
            className={INPUT_CLASS}
          />
        </div>
      </div>

      {/* Photos */}
      <div>
        <p className={LABEL_CLASS}>
          Photos{" "}
          <span className="font-normal text-neutral-500">
            (optionnel — max {MAX_PHOTOS}, 2 Mo chacune)
          </span>
        </p>

        {photoError && (
          <p className="mb-2 text-xs text-red-600">{photoError}</p>
        )}

        {photos.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={`Photo ${i + 1}`}
                  className="h-20 w-20 rounded-lg object-cover ring-1 ring-neutral-200"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label={`Supprimer la photo ${i + 1}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-neutral-500 shadow ring-1 ring-neutral-200 hover:text-red-600"
                >
                  <XIcon size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {photos.length < MAX_PHOTOS && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-600 hover:border-leaf-400 hover:bg-leaf-50/40 hover:text-leaf-700">
            <ImageIcon size={16} />
            <span>Ajouter des photos</span>
            <input
              type="file"
              name="photos"
              ref={fileInputRef}
              multiple
              accept="image/*"
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-leaf-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Publication en cours…" : "Publier l'annonce"}
      </button>
    </form>
  );
}
