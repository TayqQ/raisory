import { unstable_cache } from "next/cache";
import type { FundingFilters } from "@/core/read-models";
import { getLogoUrls } from "@/db/queries/logos";
import { getFundingSummary, getSectorCounts } from "@/db/queries/summary";
import { getWebDb } from "@/db/web";
import { serialiseFundingFilters } from "@/lib/funding-filters";

/** Ten minutes, matching the read cache in D18. */
const DEFAULT_REVALIDATE_SECONDS = 600;

/**
 * Cache a server read. `keyParts` must include every input the callback closes
 * over: Next.js keys `unstable_cache` from these parts, not from the closure.
 * Pages call this around query functions.
 */
export async function cached<T>(
  fn: () => Promise<T>,
  keyParts: readonly string[],
  options?: { revalidateSeconds?: number },
): Promise<T> {
  const revalidate = options?.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS;
  const read = unstable_cache(async () => fn(), [...keyParts], { revalidate });
  return read();
}

/**
 * The "What's happening" summary, cached per filter set like the list. The
 * page passes the summary's own dates (its period, cut to the list's dates).
 */
export function cachedFundingSummary(filters: FundingFilters) {
  return cached(
    () => getFundingSummary(getWebDb(), filters),
    ["funding-summary", serialiseFundingFilters(filters)],
  );
}

/**
 * Rounds per sector over the last `days` days, for the sector filter's order.
 * It ignores the other filters, so one entry per day serves every page.
 */
export function cachedSectorCounts(days: number) {
  const today = new Date().toISOString().slice(0, 10);
  return cached(
    () => getSectorCounts(getWebDb(), { days, today }),
    ["sector-counts", String(days), today],
  );
}

/**
 * Logo addresses (D72) for the companies on one page, in one query. One entry
 * per set of companies; companies with no servable logo are left out.
 */
export function cachedLogoUrls(companyIds: readonly number[]) {
  const ids = [...new Set(companyIds)].sort((a, b) => a - b);
  return cached(
    () => getLogoUrls(getWebDb(), ids),
    ["logo-urls", ids.join(",")],
  );
}
