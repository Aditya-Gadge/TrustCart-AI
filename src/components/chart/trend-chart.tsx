export type TrendPoint = { label: string; value: number };
export type TrendSeries = { label: string; color: string; points: TrendPoint[] };

/**
 * Lightweight SVG trend chart (no chart library). Pure presentation:
 * normalizes series to a fixed viewBox, draws soft area + line, minimal
 * baseline. Exposed as an image with a human-readable summary label.
 */
export function TrendChart({
  series,
  height = 220,
  ariaLabel,
}: {
  series: TrendSeries[];
  height?: number;
  ariaLabel: string;
}) {
  const width = 720;
  const pad = { top: 12, right: 12, bottom: 24, left: 12 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = Math.max(1, ...allValues);
  const count = Math.max(1, series[0]?.points.length ?? 1);

  const x = (i: number) =>
    pad.left + (count === 1 ? innerW / 2 : (i / (count - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const firstLabel = series[0]?.points[0]?.label ?? "";
  const lastLabel = series[0]?.points[count - 1]?.label ?? "";

  return (
    <figure className="rounded-lg border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full"
      >
        <title>{ariaLabel}</title>
        {/* baseline grid */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH - f * innerH}
            y2={pad.top + innerH - f * innerH}
            stroke="var(--line)"
            strokeWidth={1}
          />
        ))}
        {series.map((s) => {
          if (s.points.length === 0) return null;
          const line = s.points
            .map((p, i) => `${x(i)},${y(p.value)}`)
            .join(" ");
          const area = `${pad.left},${pad.top + innerH} ${line} ${x(
            s.points.length - 1,
          )},${pad.top + innerH}`;
          const isMulti = series.length > 1;
          return (
            <g key={s.label}>
              {isMulti ? null : (
                <polygon points={area} fill={s.color} opacity={0.12} />
              )}
              <polyline
                points={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}
        <text x={pad.left} y={height - 6} className="fill-[var(--muted)]" fontSize="12">
          {firstLabel}
        </text>
        <text x={width - pad.right} y={height - 6} textAnchor="end" className="fill-[var(--muted)]" fontSize="12">
          {lastLabel}
        </text>
      </svg>
      <figcaption className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
        <span className="ml-auto tabular-nums">
          Peak {max}/{count} {count === 1 ? "day" : "days"}
        </span>
      </figcaption>
    </figure>
  );
}
