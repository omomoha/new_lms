/**
 * PairedBarChart — dependency-free SVG grouped bar chart (pre vs post style).
 *
 * Renders one pair of vertical bars per category with value labels, a legend,
 * and an accessible description. Used by the admin Assessment Insights page.
 */

interface PairedBarChartProps {
  data: Array<{ label: string; a: number | null; b: number | null }>;
  aLabel: string;        // e.g. "Pre"
  bLabel: string;        // e.g. "Post"
  unit?: string;         // e.g. "%" or "s"
  maxY?: number;         // default: max value rounded up
  formatValue?: (v: number) => string;
  title: string;         // accessible title
}

const A_COLOR = "#9EB3AD"; // muted (baseline)
const B_COLOR = "#2C7A6B"; // brand teal (outcome)

export function PairedBarChart({
  data,
  aLabel,
  bLabel,
  unit = "",
  maxY,
  formatValue,
  title,
}: PairedBarChartProps) {
  if (data.length === 0) return null;

  const fmt = formatValue ?? ((v: number) => `${Math.round(v)}${unit}`);
  const values = data.flatMap((d) => [d.a ?? 0, d.b ?? 0]);
  const yMax = maxY ?? Math.max(10, Math.ceil(Math.max(...values) / 10) * 10);

  const groupW = 92;
  const barW = 28;
  const gap = 8;
  const chartH = 180;
  const labelH = 36;
  const topPad = 22;
  const width = Math.max(data.length * groupW + 20, 240);
  const height = chartH + labelH + topPad;

  const y = (v: number) => chartH - (Math.min(v, yMax) / yMax) * chartH;

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${title}. ${data
          .map((d) => `${d.label}: ${aLabel} ${d.a != null ? fmt(d.a) : "n/a"}, ${bLabel} ${d.b != null ? fmt(d.b) : "n/a"}`)
          .join("; ")}`}
      >
        <title>{title}</title>
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={topPad + y(yMax * f)}
            y2={topPad + y(yMax * f)}
            stroke="#DDE6DF"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ))}
        {data.map((d, i) => {
          const gx = i * groupW + 20;
          return (
            <g key={d.label + i}>
              {/* A bar */}
              {d.a != null && (
                <>
                  <rect
                    x={gx}
                    y={topPad + y(d.a)}
                    width={barW}
                    height={chartH - y(d.a)}
                    rx={4}
                    fill={A_COLOR}
                  />
                  <text x={gx + barW / 2} y={topPad + y(d.a) - 5} textAnchor="middle" fontSize={10} fill="#5E6E69">
                    {fmt(d.a)}
                  </text>
                </>
              )}
              {/* B bar */}
              {d.b != null && (
                <>
                  <rect
                    x={gx + barW + gap}
                    y={topPad + y(d.b)}
                    width={barW}
                    height={chartH - y(d.b)}
                    rx={4}
                    fill={B_COLOR}
                  />
                  <text
                    x={gx + barW + gap + barW / 2}
                    y={topPad + y(d.b) - 5}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="#13403A"
                  >
                    {fmt(d.b)}
                  </text>
                </>
              )}
              {/* category label */}
              <text
                x={gx + barW + gap / 2}
                y={topPad + chartH + 16}
                textAnchor="middle"
                fontSize={10}
                fill="#1E302C"
              >
                {d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {/* legend */}
      <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: "#5E6E69" }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: A_COLOR }} aria-hidden="true" />
          {aLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: B_COLOR }} aria-hidden="true" />
          {bLabel}
        </span>
      </div>
    </div>
  );
}

/** Small inline delta badge: green ▲ for improvement, red ▼ for decline. */
export function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-xs" style={{ color: "#9EB3AD" }}>—</span>;
  }
  const up = delta > 0;
  const flat = delta === 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold"
      style={
        flat
          ? { backgroundColor: "#F5F7F4", color: "#5E6E69" }
          : up
          ? { backgroundColor: "#E7F1DE", color: "#2C7A6B" }
          : { backgroundColor: "#FDE8E8", color: "#B91C1C" }
      }
    >
      {flat ? "0" : `${up ? "▲" : "▼"} ${Math.abs(Math.round(delta))}`}
      <span aria-hidden="true">pts</span>
    </span>
  );
}
