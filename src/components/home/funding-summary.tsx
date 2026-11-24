import type {
  FundingFilters,
  FundingSummary as FundingSummaryData,
} from "@/core/read-models";
import { SECTOR_LABELS } from "@/core/sectors";
import { Amount } from "@/components/ui/amount";
import { Monogram } from "@/components/ui/monogram";
import { Stat } from "@/components/ui/stat";
import { RoundName } from "@/components/rounds/round-row-parts";
import { chipLabel } from "@/components/rounds/round-row-parts";
import type { DateRange, SummaryScope } from "@/db/queries/summary";
import { formatDate, formatMoneyShort, formatRoundType } from "@/lib/format";
import {
  fundingFiltersHref,
  serialiseFundingCriteria,
} from "@/lib/funding-filters";
import {
  SUMMARY_PERIOD_LABELS,
  type SummaryPeriod,
} from "@/lib/view-preference";
import { SectorBars, type SectorBar } from "./sector-bars";
import { SummaryPeriodLinks } from "./summary-period";
import { HideSummaryButton, KeepHiddenToggle } from "./summary-state";

/** "1 Sep to 30 Sep 2026", or with both years when they differ. */
export function dateRange(from: string, to: string): string {
  const start = formatDate(from);
  const end = formatDate(to);
  if (from === to) return end;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? start.replace(/ \d{4}$/, "") : start} to ${end}`;
}

function sameRange(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

/**
 * The summary's dates in words: the header line that states the period, a
 * short note when the list's own dates cut it (null when they do not), and
 * the days it compares with.
 */
export function describeScope(scope: SummaryScope): {
  heading: string;
  note: string | null;
  previous: string | null;
} {
  const { period, periodRange, range, previous } = scope;
  const heading = `${SUMMARY_PERIOD_LABELS[period]} · ${dateRange(periodRange.from, periodRange.to)}`;
  let note: string | null = null;
  if (!range) {
    note =
      "The list's dates fall outside this period, so there is nothing to summarise.";
  } else if (!sameRange(range, periodRange)) {
    note = `Covers ${dateRange(range.from, range.to)} only, where this period overlaps the list's dates.`;
  }
  return {
    heading,
    note,
    previous: previous ? dateRange(previous.from, previous.to) : null,
  };
}

export interface Change {
  direction: "up" | "down" | "level" | "none";
  text: string;
}

/**
 * A figure against the same figure for the previous window, in words ("Up
 * 24%"), so the arrow and colour are never the only cue.
 */
export function describeChange(
  current: number | null,
  previous: number | null,
): Change {
  if (current === null || previous === null) {
    return { direction: "none", text: "Nothing to compare" };
  }
  if (current === previous) return { direction: "level", text: "Level" };
  // Usually the period before falls where history had not started, so an
  // arrow up from zero would claim growth that was not seen.
  if (previous === 0) return { direction: "none", text: "Nothing to compare" };
  const percent = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(percent));
  const amount = rounded === 0 ? "less than 1%" : `${rounded}%`;
  return percent > 0
    ? { direction: "up", text: `Up ${amount}` }
    : { direction: "down", text: `Down ${amount}` };
}

function ChangeLine({ change }: { change: Change }) {
  const tone =
    change.direction === "up"
      ? "text-up"
      : change.direction === "down"
        ? "text-down"
        : "text-muted";
  const arrow =
    change.direction === "up" ? "↑" : change.direction === "down" ? "↓" : null;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${tone}`}>
      {arrow ? <span aria-hidden="true">{arrow}</span> : null}
      {change.text}
    </span>
  );
}

function money(amount: number | null): string | null {
  return amount === null ? null : formatMoneyShort(amount, "GBP");
}

function roundsText(count: number): string {
  return count === 1 ? "1 round" : `${count.toLocaleString("en-GB")} rounds`;
}

/** A block inside the summary panel, on the panel's own surface. */
const BLOCK = "min-w-0 rounded-[var(--radius)] border border-line";

/**
 * The "What's happening" summary (from direction B), a panel you can close.
 * It covers a recent period (7 days to 12 months, 30 by default, picked in its
 * header) for the list's other filters: £ raised, rounds and the median
 * against the period of the same length before; sectors ranked by £ (or
 * rounds), each a link that filters the list; and the three biggest rounds.
 * When the list has its own dates the summary covers their overlap with the
 * period and says so.
 *
 * Layout, with no dead space:
 * - phones: the stat tiles in a row, then sectors, then biggest rounds;
 * - `md` to `xl`: the tiles, then sectors and biggest rounds side by side;
 * - from `xl`: two columns, the tiles over biggest rounds on the left and
 *   sectors on the right, both ending at the same height.
 */
export function FundingSummary({
  summary,
  filters,
  scope,
  periodHrefs,
}: {
  summary: FundingSummaryData;
  /** The list's filters, for the sector links and the "matching" note. */
  filters: FundingFilters;
  scope: SummaryScope;
  /** The current page with each period set, for the period control. */
  periodHrefs: Readonly<Record<SummaryPeriod, string>>;
}) {
  const words = describeScope(scope);
  const narrowed =
    serialiseFundingCriteria({ ...filters, from: undefined, to: undefined })
      .length > 0;
  const previous = scope.previous ? summary.previous : null;

  return (
    <section
      aria-labelledby="summary-heading"
      className="rounded-[var(--radius-lg)] border border-line bg-surface"
    >
      {/*
       * Phones: the title and "Hide summary" share the first line, then the
       * period in words, then the period control. From `sm` the control and
       * the button sit on the right of the title and the period.
       */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-x-4 sm:gap-y-0">
        <h2
          id="summary-heading"
          className="col-start-1 row-start-1 min-w-0 font-display text-[20px] font-semibold text-ink"
        >
          What&apos;s happening
        </h2>
        <p className="col-span-2 col-start-1 row-start-2 text-[13px] text-muted sm:col-span-1">
          {words.heading}
          {narrowed ? " · rounds matching your filters" : ""}
        </p>
        <div className="col-span-2 col-start-1 row-start-3 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1">
          <SummaryPeriodLinks period={scope.period} hrefs={periodHrefs} />
        </div>
        <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3 sm:row-span-2">
          <HideSummaryButton />
        </div>
      </header>

      <div className="p-3 sm:p-4">
        {words.note ? (
          <p className="mb-3 text-[13px] text-ink">{words.note}</p>
        ) : null}
        {summary.count === 0 ? (
          <EmptyWindow
            summary={summary}
            hasRange={scope.range !== null}
            previousLabel={words.previous}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-rows-[auto_1fr]">
            <div className="min-w-0 md:col-span-2 xl:col-span-1 xl:col-start-1 xl:row-start-1">
              <Headline summary={summary} previous={previous} />
            </div>
            <div
              className={`${BLOCK} px-4 py-3 xl:col-start-2 xl:row-span-2 xl:row-start-1`}
            >
              <SectorBars
                headingId="summary-sectors"
                sectors={sectorBars(summary, filters)}
              />
            </div>
            <div className={`${BLOCK} px-4 py-3 xl:col-start-1 xl:row-start-2`}>
              <BiggestRounds summary={summary} />
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-2.5">
        <p className="min-w-0 text-xs text-muted">
          {previous && words.previous
            ? `Changes compare with ${words.previous}, the period of the same length before.`
            : "No earlier period to compare with."}
        </p>
        <KeepHiddenToggle />
      </footer>
    </section>
  );
}

function EmptyWindow({
  summary,
  hasRange,
  previousLabel,
}: {
  summary: FundingSummaryData;
  /** False when the list's dates and the period do not overlap. */
  hasRange: boolean;
  previousLabel: string | null;
}) {
  return (
    <div className="px-1 py-2">
      <p className="font-display text-[17px] font-semibold text-ink">
        No rounds in this period
      </p>
      <p className="mt-1 text-[13px] text-muted">
        {hasRange
          ? "Nothing matches these filters in these dates. Try a longer period."
          : "Choose a longer period, or change the list's dates."}
        {summary.previous && previousLabel
          ? ` ${roundsText(summary.previous.count)} in the period before (${previousLabel}).`
          : ""}
      </p>
    </div>
  );
}

function Headline({
  summary,
  previous,
}: {
  summary: FundingSummaryData;
  previous: FundingSummaryData["previous"];
}) {
  const total = summary.totalGbpMinor > 0 ? summary.totalGbpMinor : null;
  const change = (current: number | null, before: number | null) =>
    previous ? <ChangeLine change={describeChange(current, before)} /> : null;
  const tile = `${BLOCK} px-2.5 py-2.5 sm:px-4 sm:py-3`;
  return (
    <div className="grid grid-cols-3 items-stretch gap-2 sm:gap-3">
      <div className={tile}>
        <Stat
          label="Raised, in GBP"
          size="lg"
          value={money(total)}
          sub={change(
            summary.totalGbpMinor,
            previous ? previous.totalGbpMinor : null,
          )}
        />
      </div>
      <div className={tile}>
        <Stat
          label="Rounds"
          size="lg"
          value={summary.count.toLocaleString("en-GB")}
          sub={change(summary.count, previous ? previous.count : null)}
        />
      </div>
      <div className={tile}>
        <Stat
          label="Median round"
          size="lg"
          value={money(summary.medianGbpMinor)}
          sub={change(
            summary.medianGbpMinor,
            previous ? previous.medianGbpMinor : null,
          )}
        />
      </div>
    </div>
  );
}

/** The summary's sectors as bars; a click sets that one sector filter. */
export function sectorBars(
  summary: FundingSummaryData,
  filters: FundingFilters,
): SectorBar[] {
  return summary.sectors.map((sector) => {
    if (sector.sector === null) {
      return {
        key: "pending",
        label: "Sector pending",
        gbpMinor: sector.gbpMinor,
        count: sector.count,
      };
    }
    return {
      key: sector.sector,
      label: SECTOR_LABELS[sector.sector],
      gbpMinor: sector.gbpMinor,
      count: sector.count,
      // Themes belong to a sector, so they are cleared with the switch.
      href: fundingFiltersHref(
        { ...filters, sectors: [sector.sector], themes: undefined },
        filters,
      ),
    };
  });
}

function BiggestRounds({ summary }: { summary: FundingSummaryData }) {
  return (
    <div>
      <h3 className="font-display text-[17px] font-semibold text-ink">
        Biggest rounds
      </h3>
      {summary.biggest.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">
          No round in this window has a disclosed amount.
        </p>
      ) : (
        <ol className="mt-2">
          {summary.biggest.map((row, index) => (
            <li
              key={row.eventId}
              className="relative flex min-w-0 items-center gap-3 border-t border-line py-2.5 first:border-t-0"
            >
              <span
                aria-hidden="true"
                className="w-3 shrink-0 font-display text-[13px] font-semibold text-muted"
              >
                {index + 1}
              </span>
              <Monogram name={row.companyName} size={28} />
              <span className="flex min-w-0 flex-1 flex-col">
                <RoundName row={row} className="text-[15px]" />
                <span className="truncate text-xs text-muted">
                  {chipLabel(row.roundLabel) ?? formatRoundType(row.roundType)}{" "}
                  ·{" "}
                  {row.mainSector
                    ? SECTOR_LABELS[row.mainSector]
                    : "Sector pending"}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <Amount
                  amount={row.amount}
                  amountGbpMinor={row.amountGbpMinor}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
