import { getLocale, getTranslations } from "next-intl/server";

import { toIntlLocale } from "@/lib/intlLocale";

import type { FarmerRating } from "./actions";
import { StarRating } from "./StarRating";

/** Public review list for a farmer (FAR-12). */
export async function ReviewList({ reviews }: { reviews: FarmerRating[] }) {
  const t = await getTranslations("restaurant.marketplace.reviewList");
  const intlLocale = toIntlLocale(await getLocale());
  if (reviews.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 p-6 text-center">
        <p className="text-sm text-neutral-500">
          {t("empty")}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {reviews.map((r, i) => (
        <li
          key={r.id}
          style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}
          className="vc-fade-in group rounded-xl border border-neutral-100 bg-white p-4 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-leaf-200 hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.12)]"
        >
          <div className="flex items-start gap-3">
            <Avatar name={r.reviewer_name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-neutral-900">
                  {r.reviewer_name}
                </p>
                <span className="shrink-0 text-[11px] text-neutral-400">
                  {new Date(r.created_at).toLocaleDateString(intlLocale, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="mt-0.5">
                <StarRating value={r.rating} size={14} showValue={false} />
              </div>
              {r.review && (
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-neutral-700">
                  {r.review}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const AVATAR_TONES = [
  "from-leaf-400 to-leaf-600",
  "from-amber-400 to-amber-600",
  "from-sky-400 to-sky-600",
  "from-rose-400 to-rose-600",
  "from-violet-400 to-violet-600",
];

function Avatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const tone = AVATAR_TONES[name.charCodeAt(0) % AVATAR_TONES.length];
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${tone} text-xs font-semibold text-white shadow-sm`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
