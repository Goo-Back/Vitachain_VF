"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

import { submitRating, type MyRating } from "./actions";

/**
 * Rating form (FAR-12). Any authenticated restaurant may rate any verified
 * farmer. Pre-fills the caller's existing review so submitting edits it
 * (upsert). `can_rate` is a defensive fallback in case the backend ever
 * re-introduces a gate.
 */
export function RatingForm({
  farmerId,
  initial,
}: {
  farmerId: string;
  initial: MyRating;
}) {
  const t = useTranslations("restaurant.marketplace.ratingForm");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rating, setRating] = useState<number>(initial.my_rating?.rating ?? 0);
  const [hover, setHover] = useState<number>(0);
  const [review, setReview] = useState<string>(initial.my_rating?.review ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!initial.can_rate) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 p-4 text-xs text-neutral-500">
        {t("notAllowed")}
      </div>
    );
  }

  const isEditing = initial.my_rating != null;

  function onSubmit() {
    setError(null);
    if (rating < 1) {
      setError(t("ratingRequiredError"));
      return;
    }
    startTransition(async () => {
      const res = await submitRating(farmerId, {
        rating,
        review: review.trim() || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone(true);
      router.refresh();
      window.setTimeout(() => setDone(false), 3000);
    });
  }

  const display = hover || rating;

  return (
    <div className="vc-card p-5">
      <h3 className="text-sm font-semibold text-neutral-900">
        {isEditing ? t("editTitle") : t("newTitle")}
      </h3>

      <div className="mt-3 flex items-center gap-0.5" role="radiogroup" aria-label={t("ratingAriaLabel")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={t("starAriaLabel", { n })}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="rounded-md p-1 transition-transform duration-150 ease-out hover:scale-125 active:scale-95"
          >
            <svg
              width={28}
              height={28}
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="transition-colors duration-150"
            >
              <path
                d="M12 2l2.9 6.26L21.5 9l-5 4.6L18 21l-6-3.5L6 21l1.5-7.4-5-4.6 6.6-.74z"
                fill={n <= display ? "#f59e0b" : "#e5e7eb"}
                className="transition-[fill] duration-150 ease-out"
              />
            </svg>
          </button>
        ))}
      </div>

      <textarea
        rows={3}
        maxLength={1000}
        value={review}
        onChange={(e) => setReview(e.target.value)}
        placeholder={t("reviewPlaceholder")}
        className="mt-3 w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50/40 px-3.5 py-2.5 text-sm text-neutral-800 transition-colors duration-200 placeholder:text-neutral-400 focus:border-leaf-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-leaf-100"
      />

      {error && (
        <p className="mt-2 animate-[vc-fade-in_240ms_ease-out] text-xs text-red-600">
          {error}
        </p>
      )}
      {done && (
        <p className="mt-2 animate-[vc-fade-in_240ms_ease-out] text-xs font-medium text-leaf-700">
          {t("thankYou")}
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={isPending}
        className="vc-btn-primary mt-3 disabled:pointer-events-none disabled:opacity-60"
      >
        {isPending ? t("sending") : isEditing ? t("update") : t("publish")}
      </button>
    </div>
  );
}
