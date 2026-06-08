/**
 * Read-only star rating display. Renders 5 stars with a fractional fill for
 * the average, plus an optional count. Pure presentational — usable in server
 * components.
 */

export function StarRating({
  value,
  count,
  size = 16,
  showValue = true,
}: {
  value: number | null;
  count?: number;
  size?: number;
  showValue?: boolean;
}) {
  const v = value ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Note ${v.toFixed(1)} sur 5`}>
      <span className="inline-flex" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.max(0, Math.min(1, v - i));
          return <Star key={i} fill={fill} size={size} />;
        })}
      </span>
      {showValue && value != null && (
        <span className="text-xs font-medium text-neutral-700">{v.toFixed(1)}</span>
      )}
      {typeof count === "number" && (
        <span className="text-xs text-neutral-400">
          {count === 0 ? "Aucun avis" : `(${count} avis)`}
        </span>
      )}
    </span>
  );
}

function Star({ fill, size }: { fill: number; size: number }) {
  const id = `star-${Math.random().toString(36).slice(2)}`;
  const pct = `${Math.round(fill * 100)}%`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id}>
          <stop offset={pct} stopColor="#f59e0b" />
          <stop offset={pct} stopColor="#e5e7eb" />
        </linearGradient>
      </defs>
      <path
        d="M12 2l2.9 6.26L21.5 9l-5 4.6L18 21l-6-3.5L6 21l1.5-7.4-5-4.6 6.6-.74z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}
