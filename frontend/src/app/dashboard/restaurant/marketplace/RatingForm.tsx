"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { submitRating, type MyRating } from "./actions";

/**
 * Verified-buyer rating form (FAR-12). Shown only when `canRate` is true.
 * Pre-fills the caller's existing review so submitting edits it (upsert).
 */
export function RatingForm({
  farmerId,
  initial,
}: {
  farmerId: string;
  initial: MyRating;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rating, setRating] = useState<number>(initial.my_rating?.rating ?? 0);
  const [hover, setHover] = useState<number>(0);
  const [review, setReview] = useState<string>(initial.my_rating?.review ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!initial.can_rate) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-500">
        Vous pourrez noter ce producteur après la livraison d&apos;une commande
        passée auprès de lui.
      </div>
    );
  }

  const isEditing = initial.my_rating != null;

  function onSubmit() {
    setError(null);
    if (rating < 1) {
      setError("Choisissez une note entre 1 et 5 étoiles.");
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
        {isEditing ? "Modifier votre avis" : "Noter ce producteur"}
      </h3>

      <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="Note">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
            className="p-0.5 transition-transform hover:scale-110"
          >
            <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 2l2.9 6.26L21.5 9l-5 4.6L18 21l-6-3.5L6 21l1.5-7.4-5-4.6 6.6-.74z"
                fill={n <= display ? "#f59e0b" : "#e5e7eb"}
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
        placeholder="Partagez votre expérience avec ce producteur (qualité, fraîcheur, ponctualité…)"
        className="mt-3 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
      />

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {done && (
        <p className="mt-2 text-xs text-leaf-700">✓ Merci, votre avis est enregistré.</p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={isPending}
        className="vc-btn-primary mt-3 disabled:opacity-60"
      >
        {isPending ? "Envoi…" : isEditing ? "Mettre à jour" : "Publier mon avis"}
      </button>
    </div>
  );
}
