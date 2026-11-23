import type { ExtractionV1 } from "@/core/extraction-schema";
import { isPlaceholderCompanyName } from "../names/placeholder";

/**
 * Events of a relevant result whose company name is a placeholder such as
 * "startup" (D69). Blank names are not counted: resolve drops them anyway.
 */
export function placeholderCompanyCount(result: ExtractionV1): number {
  if (!result.isRelevant) return 0;
  return result.events.filter((event) => {
    const name = event.company.name.trim();
    return name.length > 0 && isPlaceholderCompanyName(name);
  }).length;
}

/**
 * The better of the first result and the retry: the one with fewer
 * placeholder company names, and the retry (the stronger model) on a tie.
 */
export function betterExtraction<T extends { result: ExtractionV1 }>(
  first: T,
  retry: T,
): T {
  return placeholderCompanyCount(first.result) <
    placeholderCompanyCount(retry.result)
    ? first
    : retry;
}
