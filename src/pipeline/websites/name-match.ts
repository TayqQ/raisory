import { isPlaceholderCompanyName } from "@/pipeline/names/placeholder";
import {
  registryNameMatch,
  registryNormalise,
} from "@/pipeline/registry/link-rules";
import { nameAsDomain } from "./candidates";

/**
 * Does a homepage carry the company's name (D64)? The name, or one of its
 * aliases, must equal the page's `og:site_name`, or one part of its title,
 * after `registryNormalise` and with spaces ignored, as for registry names.
 */

/** A name this short, once normalised, never links on a name match alone. */
export const MAX_WEAK_NAME_LENGTH = 3;

/**
 * Title separators: `|` and `·` anywhere, `:` before a space, and `-`, `–`,
 * `—`, `/` or `\` between spaces, so names such as "Optimise-AI" and
 * "21:12 Communications" stay whole.
 */
const TITLE_SEPARATOR = /\s*[|·]\s*|:\s+|\s+[-–—/\\]\s+/;

/** The title and each part of it between separators, trimmed, without empty parts. */
export function titleParts(title: string): string[] {
  const parts = [title, ...title.split(TITLE_SEPARATOR)]
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return [...new Set(parts)];
}

/**
 * True when a name is too short or too generic to link a website on a name
 * match alone: 3 characters or fewer once normalised (a name written as a
 * domain, such as "fal.ai", counts in full), or a placeholder such as
 * "startup" or "a London fintech" (`isPlaceholderCompanyName`).
 */
export function isWeakName(name: string): boolean {
  if (isPlaceholderCompanyName(name)) return true;
  const written = nameAsDomain(name);
  const key = (written ?? registryNormalise(name)).replace(/[\s.]/g, "");
  return key.length <= MAX_WEAK_NAME_LENGTH;
}

export interface PageNames {
  siteName: string | null;
  title: string | null;
}

export interface WebsiteNameMatch {
  matched: boolean;
  /** Where the page shows the name. */
  field: "site_name" | "title" | null;
  /** The company name or alias that matched, as given. */
  name: string | null;
  /** The page text that matched: the site name, or the title part. */
  pageName: string | null;
  /** The matched name is too short or generic to link on a name match alone. */
  weak: boolean;
}

const NO_MATCH: WebsiteNameMatch = {
  matched: false,
  field: null,
  name: null,
  pageName: null,
  weak: false,
};

function sameName(name: string, pageName: string): boolean {
  return registryNameMatch([name], pageName) === "exact";
}

/**
 * The first match of the company's names (its name first, then aliases)
 * against the page's `og:site_name`, then against the parts of its title. A
 * strong name wins over a weak one, so a weak alias never hides a good match.
 */
export function websiteNameMatch(
  names: readonly string[],
  page: PageNames,
): WebsiteNameMatch {
  const matches: WebsiteNameMatch[] = [];
  const fields: Array<["site_name" | "title", string[]]> = [
    ["site_name", page.siteName ? [page.siteName] : []],
    ["title", page.title ? titleParts(page.title) : []],
  ];
  for (const [field, pageNames] of fields) {
    for (const pageName of pageNames) {
      for (const name of names) {
        if (!sameName(name, pageName)) continue;
        matches.push({
          matched: true,
          field,
          name,
          pageName,
          weak: isWeakName(name),
        });
      }
    }
  }
  return matches.find((match) => !match.weak) ?? matches[0] ?? NO_MATCH;
}
