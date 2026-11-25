import {
  bandLayout,
  formatAxisValue,
  linearScale,
  niceTicks,
  stack,
} from "@/lib/chart-scale";
import { ChartFigure, EmptyChart } from "./chart-figure";

/*
 * Drawn at its real size, not scaled from a viewBox, so text stays at 12 px
 * however wide the chart is. Heights are pixels; columns are placed in
 * percentages of the plot's width (laid out on a nominal width first, so the
 * gaps keep the same proportion). The y-axis labels sit in their own column.
 */
const HEIGHT = 240;
const MARGIN = { top: 10, bottom: 30 };
const AXIS_WIDTH = 38;
const NOMINAL_WIDTH = 434;
const FONT_SIZE = 12;
const SERIES_COUNT = 4;

export interface ColumnCategory {
  /** Full label, used in the data table and the column tooltip. */
  label: string;
  /** Short label for the x-axis, shown only on every few columns. */
  axisLabel?: string;
}

export interface ColumnSeries {
  key: string;
  label: string;
  values: readonly number[];
}

/** A solid series colour; four tokens, reused if there are more series. */
function seriesFill(index: number): string {
  return `var(--chart-${(index % SERIES_COUNT) + 1})`;
}

/**
 * Weekly columns, stacked when there is more than one series. Stacked series
 * have solid colours, keep the legend's order from the bottom up, and have a
 * text legend and a data table, so colour is never the only cue.
 */
export function ColumnChart({
  title,
  summary,
  categories,
  series,
  valueLabel = "Count",
  labelEvery = 4,
  formatValue = (n) => formatAxisValue(n),
}: {
  /** Accessible name of the chart. */
  title: string;
  /** One sentence stating the main finding. */
  summary: string;
  categories: readonly ColumnCategory[];
  series: readonly ColumnSeries[];
  /** Name of the measure, for the table, such as "Rounds". */
  valueLabel?: string;
  /** Show an x label on every nth column. */
  labelEvery?: number;
  /** Formats y-axis labels. */
  formatValue?: (value: number) => string;
}) {
  const hasData =
    categories.length > 0 &&
    series.length > 0 &&
    series.some((s) => s.values.some((v) => Number.isFinite(v) && v > 0));
  if (!hasData) return <EmptyChart summary={summary} />;

  const stacked = series.length > 1;
  const { layers, totals } = stack(
    series.map((s) => ({ key: s.key, values: s.values })),
  );
  const ticks = niceTicks(Math.max(...totals.slice(0, categories.length)), 4);
  const yMax = ticks[ticks.length - 1]!;
  const plotTop = MARGIN.top;
  const plotBottom = HEIGHT - MARGIN.bottom;
  const y = linearScale([0, yMax], [plotBottom, plotTop]);
  const percent = (n: number) => `${((n / NOMINAL_WIDTH) * 100).toFixed(3)}%`;
  const bands = bandLayout(
    categories.length,
    NOMINAL_WIDTH,
    categories.length > 26 ? 2 : 6,
  );
  const every = Math.max(1, Math.floor(labelEvery));

  const legend = stacked ? (
    <ul
      aria-label="Legend"
      className="mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm"
    >
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-[3px]"
            style={{ background: seriesFill(i) }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  ) : null;

  const tableColumns = stacked
    ? [...series.map((s) => s.label), "Total"]
    : [valueLabel];
  const tableRows = categories.map((category, i) => {
    const values = series.map((s) => s.values[i] ?? 0);
    return {
      label: category.label,
      values: stacked ? [...values, totals[i] ?? 0] : values,
    };
  });

  return (
    <ChartFigure
      summary={summary}
      legend={legend}
      table={{
        caption: `${title}: data`,
        rowHeader: "Period",
        columns: tableColumns,
        rows: tableRows,
      }}
    >
      <div
        className="relative pr-2"
        style={{ paddingLeft: AXIS_WIDTH, height: HEIGHT }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 tabular-nums leading-none"
          style={{
            width: AXIS_WIDTH,
            fontSize: FONT_SIZE,
            color: "var(--chart-text)",
          }}
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-1.5 -translate-y-1/2"
              style={{ top: y(tick) }}
            >
              {formatValue(tick)}
            </span>
          ))}
        </div>
        <svg
          role="img"
          aria-label={title}
          width="100%"
          height={HEIGHT}
          className="block overflow-visible"
          fontSize={FONT_SIZE}
        >
          {ticks.map((tick) => (
            <line
              key={tick}
              x1="0"
              x2="100%"
              y1={y(tick)}
              y2={y(tick)}
              style={{ stroke: "var(--chart-grid)" }}
              strokeWidth={1}
            />
          ))}
          <line
            x1="0"
            x2="100%"
            y1={plotBottom}
            y2={plotBottom}
            style={{ stroke: "var(--chart-axis)" }}
            strokeWidth={1}
          />
          {bands.map((band, i) => {
            const category = categories[i]!;
            return (
              <g key={`${category.label}-${i}`}>
                <title>{`${category.label}: ${formatValue(totals[i] ?? 0)}`}</title>
                {layers.map((layer, layerIndex) => {
                  const segment = layer.segments[i]!;
                  const top = y(segment.end);
                  const height = y(segment.start) - top;
                  if (height <= 0) return null;
                  return (
                    <rect
                      key={layer.key}
                      x={percent(band.x)}
                      y={top}
                      width={percent(band.width)}
                      height={height}
                      style={{
                        fill: seriesFill(layerIndex),
                        stroke: "var(--chart-gap)",
                        strokeWidth: 1,
                      }}
                    />
                  );
                })}
                {i % every === 0 ? (
                  <text
                    x={percent(band.x + band.width / 2)}
                    y={plotBottom + 18}
                    textAnchor="middle"
                    style={{ fill: "var(--chart-text)" }}
                  >
                    {category.axisLabel ?? category.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </ChartFigure>
  );
}
