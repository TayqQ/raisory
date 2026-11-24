import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import type {
  FundingFilters,
  FundingSummary,
  FundingTotals,
  SectorTotal,
} from "@/core/read-models";
import { SECTORS, SECTOR_LABELS, type Sector } from "@/core/sectors";
import type { SummaryPeriod } from "@/lib/view-preference";
import type { Db } from "../client";
import { companies, events, fundingRounds } from "../schema";
import {
  asCount,
  fundingColumns,
  fundingWhere,
  mainSectorOf,
  normalisedQuery,
  sicCodesSql,
  themeStrengthsSql,
  withConfirmations,
} from "./funding";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BIGGEST_COUNT = 3;
const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / DAY_MS;
}

function isoDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The window just before the filter's own, of the same length in days. A
 * window with a start but no end runs to `today` (date presets such as "last
 * 90 days" may set only `from`). Null without a start, or when the dates are
 * reversed.
 */
export function previousWindow(
  filters: Pick<FundingFilters, "from" | "to">,
  today: string = new Date().toISOString().slice(0, 10),
): { from: string; to: string } | null {
  const { from } = filters;
  const to = filters.to ?? today;
  if (!from || !DATE.test(from) || !DATE.test(to)) return null;
  const start = dayNumber(from);
  const length = dayNumber(to) - start + 1;
  if (!Number.isFinite(length) || length < 1) return null;
  return { from: isoDay(start - length), to: isoDay(start - 1) };
}

/** A closed range of days, YYYY-MM-DD at both ends. */
export interface DateRange {
  from: string;
  to: string;
}

const PERIOD_DAYS: Readonly<Record<Exclude<SummaryPeriod, "12m">, number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * The days a summary period covers, up to and including `today`. "Last 30
 * days" starts 30 days back, like the list's date presets; "Last 12 months"
 * starts on the same date a year back.
 */
export function summaryPeriodRange(
  period: SummaryPeriod,
  today: string,
): DateRange {
  const start = new Date(`${today}T00:00:00Z`);
  if (period === "12m") start.setUTCFullYear(start.getUTCFullYear() - 1);
  else start.setUTCDate(start.getUTCDate() - PERIOD_DAYS[period]);
  return { from: start.toISOString().slice(0, 10), to: today };
}

/**
 * The days the summary covers: the period, cut to the list's own dates when
 * the list has any (the overlap of the two). Null when they do not overlap.
 */
export function summaryRange(
  period: DateRange,
  filters: Pick<FundingFilters, "from" | "to">,
): DateRange | null {
  const from =
    filters.from && DATE.test(filters.from) && filters.from > period.from
      ? filters.from
      : period.from;
  const to =
    filters.to && DATE.test(filters.to) && filters.to < period.to
      ? filters.to
      : period.to;
  return from <= to ? { from, to } : null;
}

/** What the summary covers, worked out from the period and the list's dates. */
export interface SummaryScope {
  period: SummaryPeriod;
  /** Every day of the period, to today. */
  periodRange: DateRange;
  /**
   * The days summarised: the period, cut to the list's dates when it has
   * any. Null when the two do not overlap.
   */
  range: DateRange | null;
  /** The days of the same length just before `range`, for the comparison. */
  previous: DateRange | null;
}

export function summaryScope(
  period: SummaryPeriod,
  filters: Pick<FundingFilters, "from" | "to">,
  today: string,
): SummaryScope {
  const periodRange = summaryPeriodRange(period, today);
  const range = summaryRange(periodRange, filters);
  return {
    period,
    periodRange,
    range,
    previous: range ? previousWindow(range, today) : null,
  };
}

/** A summary with nothing in it, for a range with no days. */
export const EMPTY_FUNDING_SUMMARY: FundingSummary = {
  totalGbpMinor: 0,
  count: 0,
  medianGbpMinor: null,
  previous: null,
  sectors: [],
  biggest: [],
};

function totals(
  total: unknown,
  count: unknown,
  median: unknown,
): FundingTotals {
  const medianValue =
    median == null || Number.isNaN(Number(median))
      ? null
      : Math.round(Number(median));
  return {
    totalGbpMinor: asCount(total),
    count: asCount(count),
    medianGbpMinor: medianValue,
  };
}

/**
 * One statement for both windows. The filter's date range is widened to
 * start at the previous window, and `filter (where ...)` splits the two.
 * `percentile_cont` skips null amounts, so the median ignores them.
 */
async function windowTotals(
  db: Db,
  filters: FundingFilters,
  previous: { from: string; to: string } | null,
): Promise<{ current: FundingTotals; previous: FundingTotals | null }> {
  const query = normalisedQuery(filters.q);
  const widened = previous ? { ...filters, from: previous.from } : filters;
  const where = fundingWhere(widened, query);

  const inCurrent: SQL =
    previous && filters.from
      ? sql`${events.announcedOn} >= ${filters.from}`
      : sql`true`;
  const inPrevious: SQL =
    previous && filters.from
      ? sql`${events.announcedOn} < ${filters.from}`
      : sql`false`;
  const gbp = fundingRounds.amountGbpMinor;

  const [row] = await db
    .select({
      curTotal: sql<unknown>`coalesce(sum(${gbp}) filter (where ${inCurrent}), 0)::float8`,
      curCount: sql<unknown>`(count(*) filter (where ${inCurrent}))::int`,
      curMedian: sql<unknown>`percentile_cont(0.5) within group (order by ${gbp}) filter (where ${inCurrent})`,
      prevTotal: sql<unknown>`coalesce(sum(${gbp}) filter (where ${inPrevious}), 0)::float8`,
      prevCount: sql<unknown>`(count(*) filter (where ${inPrevious}))::int`,
      prevMedian: sql<unknown>`percentile_cont(0.5) within group (order by ${gbp}) filter (where ${inPrevious})`,
    })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(where);

  return {
    current: totals(row?.curTotal, row?.curCount, row?.curMedian),
    previous: previous
      ? totals(row?.prevTotal, row?.prevCount, row?.prevMedian)
      : null,
  };
}

/** Rounds and GBP by each round's company main sector, biggest first. */
async function sectorTotals(db: Db, where: SQL): Promise<SectorTotal[]> {
  const rows = await db
    .select({
      gbp: fundingRounds.amountGbpMinor,
      themeStrengths: themeStrengthsSql(),
      sicCodes: sicCodesSql(),
    })
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(where);

  const bySector = new Map<Sector | null, SectorTotal>();
  for (const row of rows) {
    const sector = mainSectorOf(row);
    const entry = bySector.get(sector) ?? { sector, gbpMinor: 0, count: 0 };
    entry.count += 1;
    entry.gbpMinor += asCount(row.gbp);
    bySector.set(sector, entry);
  }
  const order = (sector: Sector | null) =>
    sector === null ? SECTORS.length : SECTORS.indexOf(sector);
  return [...bySector.values()].sort(
    (a, b) =>
      b.gbpMinor - a.gbpMinor ||
      b.count - a.count ||
      order(a.sector) - order(b.sector),
  );
}

/**
 * The "What's happening" summary of the rounds a filter matches, computed from
 * the same filtered set as `listFundingRounds` with paging ignored: totals and
 * median for the window, the same for the previous window, sectors by GBP, and
 * the three biggest rounds.
 */
export async function getFundingSummary(
  db: Db,
  filters: FundingFilters,
): Promise<FundingSummary> {
  const previous = previousWindow(filters);
  const query = normalisedQuery(filters.q);
  const where = fundingWhere(filters, query);

  const [windows, sectors, biggestRows] = await Promise.all([
    windowTotals(db, filters, previous),
    sectorTotals(db, where),
    db
      .select(fundingColumns())
      .from(events)
      .innerJoin(companies, eq(companies.id, events.companyId))
      .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
      .where(and(where, isNotNull(fundingRounds.amountGbpMinor)))
      .orderBy(
        sql`${fundingRounds.amountGbpMinor} desc`,
        sql`${events.announcedOn} desc`,
        sql`${events.id} asc`,
      )
      .limit(BIGGEST_COUNT),
  ]);

  return {
    ...windows.current,
    previous: windows.previous,
    sectors,
    biggest: await withConfirmations(db, biggestRows),
  };
}

/** A sector and its number of rounds, for the sector filter's order. */
export interface SectorCount {
  sector: Sector;
  count: number;
}

/**
 * Rounds per sector over the last `days` days up to `today`, for every sector
 * in `SECTORS`: highest first, ties (including the sectors with none, which
 * come last) in alphabetical order of their labels. The count is what that
 * sector filter alone would list over the window (the default list, so grants
 * are out, D44), and it ignores every other filter, so the order does not move
 * as the visitor filters. One statement: a `count(*) filter (where ...)` per
 * sector. A round whose company sits in two sectors counts in both.
 */
export async function getSectorCounts(
  db: Db,
  {
    days,
    today = new Date().toISOString().slice(0, 10),
  }: {
    days: number;
    today?: string;
  },
): Promise<SectorCount[]> {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  const from = start.toISOString().slice(0, 10);
  const base: FundingFilters = { from, to: today, page: 1, pageSize: 1 };
  const columns: Record<string, SQL<unknown>> = {};
  SECTORS.forEach((sector, index) => {
    const own = fundingWhere({ page: 1, pageSize: 1, sectors: [sector] }, null);
    columns[`s${index}`] = sql<unknown>`(count(*) filter (where ${own}))::int`;
  });

  const [row] = await db
    .select(columns)
    .from(events)
    .innerJoin(companies, eq(companies.id, events.companyId))
    .innerJoin(fundingRounds, eq(fundingRounds.eventId, events.id))
    .where(fundingWhere(base, null));

  return SECTORS.map((sector, index) => ({
    sector,
    count: asCount(row?.[`s${index}`]),
  })).sort(
    (a, b) =>
      b.count - a.count ||
      SECTOR_LABELS[a.sector].localeCompare(SECTOR_LABELS[b.sector], "en-GB"),
  );
}
