import type { FarmerRating } from "./actions";
import { StarRating } from "./StarRating";

/** Public review list for a farmer (FAR-12). */
export function ReviewList({ reviews }: { reviews: FarmerRating[] }) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Aucun avis pour le moment. Soyez le premier à noter ce producteur après
        votre première commande livrée.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {reviews.map((r) => (
        <li key={r.id} className="border-b border-neutral-100 pb-4 last:border-0 last:pb-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-neutral-900">{r.reviewer_name}</p>
            <span className="text-[11px] text-neutral-400">
              {new Date(r.created_at).toLocaleDateString("fr-MA", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="mt-1">
            <StarRating value={r.rating} size={14} showValue={false} />
          </div>
          {r.review && (
            <p className="mt-1.5 whitespace-pre-line text-sm text-neutral-700">
              {r.review}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
