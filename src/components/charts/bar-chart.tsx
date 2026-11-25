import { formatAxisValue } from "@/lib/chart-scale";
import { ChartFigure, EmptyChart } from "./chart-figure";

export interface BarItem {
  label: string;
  value: number;
}

/**
 * Horizontal bars with the label above each bar and the value at the right.
 * Every bar has its value written next to it, so length is never the only cue.
 * Built from HTML at the page's own text size (13 px), so it reads the same
 * at any width; long labels are cut short with an ellipsis.
 */
export function BarChart({
  title,
  summary,
  items,
  valueLabel = "Count",
  formatValue = (n) => formatAxisValue(n),
}: {
  /** Accessible name of the chart. */
  title: string;
  /** One sentence stating the main finding. */
  summary: string;
  items: readonly BarItem[];
  /** Name of the measure, for the table, such as "Rounds led". */
  valueLabel?: string;
  formatValue?: (value: number) => string;
}) {
  const rows = items.filter((item) => Number.isFinite(item.value));
  if (rows.length === 0) return <EmptyChart summary={summary} />;

  const max = Math.max(0, ...rows.map((r) => r.value));
  const share = (value: number) =>
    max > 0 && value > 0 ? Math.max(0.5, (value / max) * 100) : 0;

  return (
    <ChartFigure
      summary={summary}
      table={{
        caption: `${title}: data`,
        rowHeader: "Name",
        columns: [valueLabel],
        rows: rows.map((r) => ({
          label: r.label,
          values: [formatValue(r.value)],
        })),
      }}
    >
      <div role="img" aria-label={title} className="space-y-2.5 text-[13px]">
        {rows.map((row, i) => {
          const width = share(row.value);
          return (
            <div
              key={`${row.label}-${i}`}
              title={`${row.label}: ${formatValue(row.value)}`}
            >
              <div className="flex items-baseline justify-between gap-3 leading-snug text-ink">
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatValue(row.value)}
                </span>
              </div>
              <div
                className="mt-1 h-2 overflow-hidden rounded-full"
                style={{ background: "var(--chart-grid)" }}
              >
                {width > 0 ? (
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${width}%`,
                      background: "var(--chart-bar)",
                    }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </ChartFigure>
  );
}
