"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

type Props = {
  photos: string[];
  alt: string;
};

export function PhotoGallery({ photos, alt }: Props) {
  const t = useTranslations("restaurant.marketplace.common");
  const [active, setActive] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="flex h-72 w-full items-center justify-center rounded-lg bg-leaf-50 ring-1 ring-leaf-100">
        <span className="text-6xl">🌿</span>
      </div>
    );
  }

  const current = photos[active] ?? photos[0];

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current}
        alt={alt}
        className="h-72 w-full rounded-lg object-cover ring-1 ring-neutral-200"
      />
      {photos.length > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto">
          {photos.map((p, i) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-md ring-1 transition ${
                  i === active
                    ? "ring-2 ring-leaf-500"
                    : "ring-neutral-200 hover:ring-leaf-300"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p}
                  alt={t("photoAlt", { alt, index: i + 1 })}
                  className="h-full w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
