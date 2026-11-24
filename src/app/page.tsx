import { cookies } from "next/headers";
import { FilterBar, SECTOR_RANK_DAYS } from "@/components/filters/filter-bar";
import { FundingSummary } from "@/components/home/funding-summary";
import {
  ShowSummaryButton,
  SummaryFrame,
  SummaryProvider,
} from "@/components/home/summary-state";
import { Pagination } from "@/components/pagination";
import { RoundViews } from "@/components/rounds/round-views";
import { SortControl } from "@/components/rounds/sort-control";
import { ViewSwitch } from "@/components/rounds/view-switch";
import {
  countUnlocatedCompanies,
  listFundingRounds,
} from "@/db/queries/funding";
import { EMPTY_FUNDING_SUMMARY, summaryScope } from "@/db/queries/summary";
import { listThemes } from "@/db/queries/themes";
import { getWebDb } from "@/db/web";
import { cached, cachedFundingSummary, cachedSectorCounts } from "@/lib/cached";
import { describeFundingCriteria } from "@/lib/filter-summary";
import {
  describeAppliedFilters,
  fundingFiltersHref,
  parseFundingFilters,
  serialiseFundingCriteria,
  serialiseFundingFilters,
  unresolvedNearName,
} from "@/lib/funding-filters";
import {
  SUMMARY_COOKIE,
  SUMMARY_PARAM,
  SUMMARY_PERIODS,
  SUMMARY_PERIOD_COOKIE,
  VIEW_COOKIE,
  VIEW_PARAM,
  parseSummaryPeriod,
  parseSummaryState,
  resolveListView,
  resolveSummaryPeriod,
  withSummaryParam,
  withViewParam,
  type SummaryPeriod,
} from "@/lib/view-preference";

export const dynamic = "force-dynamic";

/** The list's default page size. The summary ignores paging. */
const SUMMARY_PAGE_SIZE = 25;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const filters = parseFundingFilters(params);
  const unknownNear = unresolvedNearName(params);
  const key = serialiseFundingFilters(filters);
  const today = new Date().toISOString().slice(0, 10);
  const view = resolveListView({
    param: params[VIEW_PARAM],
    cookie: cookieStore.get(VIEW_COOKIE)?.value,
  });
  // Read on the server, so the summary paints open or hidden with no flash.
  const summaryState = parseSummaryState(
    cookieStore.get(SUMMARY_COOKIE)?.value,
  );
  // The summary covers a recent period (`?summary=`, else the period chosen
  // this session, else 30 days), cut to the list's own dates when it has any.
  const period = resolveSummaryPeriod({
    param: params[SUMMARY_PARAM],
    cookie: cookieStore.get(SUMMARY_PERIOD_COOKIE)?.value,
  });
  const scope = summaryScope(period, filters, today);
  // Sort and paging do not change the summary, so they stay out of its key.
  const summaryFilters = scope.range
    ? {
        ...filters,
        from: scope.range.from,
        to: scope.range.to,
        sort: undefined,
        direction: undefined,
        page: 1,
        pageSize: SUMMARY_PAGE_SIZE,
      }
    : null;

  // The summary is rendered even when hidden, so "Show summary" opens it at
  // once without another request.
  const [page, themes, unlocated, summaryData, sectorCounts] =
    await Promise.all([
      cached(() => listFundingRounds(getWebDb(), filters), ["funding", key]),
      cached(() => listThemes(getWebDb()), ["themes", "active"]),
      filters.near
        ? cached(
            () => countUnlocatedCompanies(getWebDb(), filters),
            ["funding-unlocated", key],
          )
        : Promise.resolve(0),
      summaryFilters
        ? cachedFundingSummary(summaryFilters)
        : Promise.resolve(EMPTY_FUNDING_SUMMARY),
      cachedSectorCounts(SECTOR_RANK_DAYS),
    ]);

  const themeNames = Object.fromEntries(
    themes.map((theme) => [theme.slug, theme.name]),
  );
  const hasCriteria = serialiseFundingCriteria(filters).length > 0;
  const heading = hasCriteria
    ? describeFundingCriteria(filters, { themes: themeNames })
    : null;
  const appliedLabels = describeAppliedFilters(filters, {
    themes: themeNames,
    today,
  }).map((chip) => chip.label);
  const listHref = withViewParam(key ? `/?${key}` : "/", view);
  // A period in the URL stays in the view switch's links.
  const currentHref = parseSummaryPeriod(params[SUMMARY_PARAM])
    ? withSummaryParam(listHref, period)
    : listHref;
  const periodHrefs = Object.fromEntries(
    SUMMARY_PERIODS.map((option) => [
      option,
      withSummaryParam(listHref, option),
    ]),
  ) as Record<SummaryPeriod, string>;

  return (
    <main>
      <h1 className="sr-only">Funding</h1>

      <SummaryProvider initial={summaryState}>
        <div className="space-y-6">
          <SummaryFrame>
            <FundingSummary
              summary={summaryData}
              filters={filters}
              scope={scope}
              periodHrefs={periodHrefs}
            />
          </SummaryFrame>

          <section aria-labelledby="rounds-heading" className="min-w-0">
            <h2 id="rounds-heading" className="sr-only">
              Funding rounds
            </h2>
            <FilterBar
              filters={filters}
              themes={themes}
              total={page.total}
              sectorCounts={sectorCounts}
              today={today}
            />

            <div className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-3">
              <div className="min-w-0">
                {heading ? (
                  <p className="font-display text-[17px] font-semibold leading-snug text-ink">
                    {heading}
                  </p>
                ) : null}
                <p
                  className="text-[13px] tabular-nums text-muted"
                  role="status"
                >
                  {page.total === 1
                    ? "1 round"
                    : `${page.total.toLocaleString("en-GB")} rounds`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <SortControl filters={filters} />
                <ViewSwitch view={view} href={currentHref} />
                <ShowSummaryButton />
              </div>
            </div>

            {unknownNear ? (
              <p className="mb-3 text-[13px] text-ink" role="alert">
                We couldn&apos;t find a UK town called &lsquo;{unknownNear}
                &rsquo;. The distance filter was not applied.
              </p>
            ) : null}
            {filters.near ? (
              <p className="mb-3 text-[13px] text-muted">
                {unlocated === 1
                  ? "1 company in these results has"
                  : `${unlocated} companies in these results have`}{" "}
                no known town, so {unlocated === 1 ? "it is" : "they are"} not
                included in distance searches.
              </p>
            ) : null}

            <RoundViews
              rows={page.items}
              view={view}
              filters={filters}
              appliedLabels={appliedLabels}
              clearHref={fundingFiltersHref({}, filters)}
            />
            <Pagination
              filters={filters}
              total={page.total}
              page={page.page}
              pageSize={page.pageSize}
            />
          </section>
        </div>
      </SummaryProvider>
    </main>
  );
}
