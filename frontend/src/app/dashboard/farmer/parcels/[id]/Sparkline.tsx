import type { HistoryBucket } from "./telemetry-actions";

interface Props {
  title: string;
  values: HistoryBucket[];
  field: keyof Pick<
    HistoryBucket,
    | "soil_moisture"
    | "soil_temperature"
    | "soil_ph"
    | "soil_conductivity"
    | "battery_level"
  >;
  color: string;
  unit?: string;
  /** KAT-05 — optional horizontal band overlay. Both undefined = identical
   *  to KAT-04 rendering (zero behavioural change). */
  thresholdMin?: number | null;
  thresholdMax?: number | null;
}

/**
 * KAT-04 — dependency-free SVG sparkline. Width is CSS-driven (responsive);
 * the viewBox is fixed so the path scales without re-rendering. For BR-K4-shaped
 * data (≤ 500 points) this renders in well under 5 ms and stays accessible
 * (one <title> per chart). When the chart UX grows beyond "current trend",
 * swap to uplot (~40 KB gz) — not Recharts.
 *
 * KAT-05 — when threshold bounds are provided, the Y axis is stretched to
 * include them and a dashed horizontal line + tinted band overlay is drawn,
 * so the farmer can see at a glance how far the current reading sits from
 * the alert thresholds.
 */
// i18n-KAT04
export function Sparkline({
  title,
  values,
  field,
  color,
  unit,
  thresholdMin,
  thresholdMax,
}: Props) {
  const W = 400;
  const H = 120;
  const PAD = 8;

  if (values.length === 0) {
    return (
      <figure className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <figcaption className="text-sm font-medium text-neutral-700">
          {title}
        </figcaption>
        <div className="mt-3 text-xs text-neutral-400">Aucune donnée.</div>
      </figure>
    );
  }

  const ys = values.map((b) => b[field]);
  // Stretch the Y axis to include threshold bounds so the band is always
  // visible — even when all telemetry sits well inside the safe zone.
  const yPool = [...ys];
  if (thresholdMin != null) yPool.push(thresholdMin);
  if (thresholdMax != null) yPool.push(thresholdMax);
  const min = Math.min(...yPool);
  const max = Math.max(...yPool);
  const range = max - min || 1;

  const yOf = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);

  const denom = Math.max(1, values.length - 1);
  const path = values
    .map((b, i) => {
      const x = PAD + (i / denom) * (W - PAD * 2);
      const y = yOf(b[field]);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Light area fill, then the line on top — cheap depth cue at zero cost.
  const areaPath = `${path} L${PAD + (W - PAD * 2)},${H - PAD} L${PAD},${H - PAD} Z`;

  const last = ys[ys.length - 1] ?? 0;
  const u = unit ? ` ${unit}` : "";

  const hasMin = thresholdMin != null;
  const hasMax = thresholdMax != null;

  return (
    <figure className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-neutral-700">{title}</span>
        <span className="text-xs tabular-nums text-neutral-500">
          {min.toFixed(1)} … {max.toFixed(1)}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-28 w-full"
        role="img"
        aria-label={`${title}, dernière valeur ${last.toFixed(2)}${u}`}
      >
        <title>{title}</title>
        {hasMin && hasMax && (
          <rect
            x={PAD}
            y={yOf(thresholdMax!)}
            width={W - PAD * 2}
            height={Math.max(0, yOf(thresholdMin!) - yOf(thresholdMax!))}
            fill={color}
            fillOpacity={0.07}
          />
        )}
        <path d={areaPath} fill={color} fillOpacity={0.08} stroke="none" />
        {hasMin && (
          <line
            x1={PAD}
            x2={W - PAD}
            y1={yOf(thresholdMin!)}
            y2={yOf(thresholdMin!)}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.6}
          />
        )}
        {hasMax && (
          <line
            x1={PAD}
            x2={W - PAD}
            y1={yOf(thresholdMax!)}
            y2={yOf(thresholdMax!)}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.6}
          />
        )}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-1 text-right text-xs tabular-nums text-neutral-500">
        {values.length} pts
      </div>
    </figure>
  );
}
