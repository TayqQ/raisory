import type { WebsiteSource } from "@/core/enums";
import { isPlaceholderCompanyName } from "@/pipeline/names/placeholder";
import {
  MIN_NAME_LENGTH,
  registryNormalise,
} from "@/pipeline/registry/link-rules";
import { registrableDomain } from "./registrable-domain";

/**
 * Candidate domains for a company, cheapest and most reliable source first,
 * used by the verification rules. Nothing here fetches or decides.
 */

export interface CandidateInput {
  name: string;
  /** ISO 3166-1 alpha-2, or null when unknown. */
  countryCode: string | null;
  /**
   * True for a company with a news report. A company known only from grants
   * gets its UKRI website and nothing else.
   */
  hasNews: boolean;
  /** `websiteDomain` values from the company's current extractions. */
  articleDomains: readonly (string | null)[];
  /** `grant_participants.website` values from the company's own UKRI records. */
  ukriWebsites: readonly (string | null)[];
}

export interface WebsiteCandidate {
  /** A registrable domain, in lower case. */
  domain: string;
  source: WebsiteSource;
}

/** Endings tried for a guess, in order, before the country's own. */
const GUESS_SUFFIXES: readonly string[] = ["com", "io", "ai", "co", "co.uk"];
export const MAX_GUESSES = 6;

/**
 * Top-level labels a company name may end in to count as written as a domain
 * ("bit.bio", "fal.ai"). Any two-letter country label counts too, except
 * file extensions that appear in product names ("Node.js").
 */
const NAME_TOP_LABELS: ReadonlySet<string> = new Set([
  "app",
  "bio",
  "cloud",
  "com",
  "dev",
  "energy",
  "finance",
  "health",
  "inc",
  "info",
  "money",
  "net",
  "org",
  "space",
  "studio",
  "systems",
  "tech",
  "xyz",
]);
const NOT_NAME_TOP_LABELS: ReadonlySet<string> = new Set(["js", "py", "rb"]);

/** The country's own top-level label, such as `de`, or `uk` for GB. */
function countryTopLabel(countryCode: string | null): string | null {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return null;
  const code = countryCode.toLowerCase();
  return code === "gb" ? "uk" : code;
}

/** The registrable domain of a name written as a domain, or null. */
export function nameAsDomain(name: string): string | null {
  const written = name.trim().toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(written)) return null;
  const top = written.slice(written.lastIndexOf(".") + 1);
  const knownTop =
    NAME_TOP_LABELS.has(top) ||
    (top.length === 2 && !NOT_NAME_TOP_LABELS.has(top));
  return knownTop ? registrableDomain(written) : null;
}

/**
 * The name as one ASCII label ("Acme Robotics Ltd" to "acmerobotics"), or
 * null when it is too short, a placeholder or not plain ASCII once
 * normalised.
 */
export function nameSlug(name: string): string | null {
  if (isPlaceholderCompanyName(name)) return null;
  const slug = registryNormalise(name).replace(/ /g, "");
  if (slug.length < MIN_NAME_LENGTH || slug.length > 63) return null;
  return /^[a-z0-9]+$/.test(slug) ? slug : null;
}

/** At most 6 guesses: the slug with each common ending, then the country's own. */
export function guessDomains(
  name: string,
  countryCode: string | null,
): string[] {
  const slug = nameSlug(name);
  if (!slug) return [];
  const suffixes = [...GUESS_SUFFIXES];
  const own = countryTopLabel(countryCode);
  if (own && !suffixes.includes(own)) suffixes.push(own);
  return suffixes.slice(0, MAX_GUESSES).map((suffix) => `${slug}.${suffix}`);
}

/**
 * Candidates from sources 1-4 in order (article, UKRI, name written as a
 * domain, guesses), one per registrable domain, keeping the first source that
 * gave it. Values that are not web addresses are dropped.
 */
export function websiteCandidates(input: CandidateInput): WebsiteCandidate[] {
  const out: WebsiteCandidate[] = [];
  const seen = new Set<string>();
  const add = (value: string | null, source: WebsiteSource) => {
    const domain = registrableDomain(value);
    if (!domain || seen.has(domain)) return;
    seen.add(domain);
    out.push({ domain, source });
  };

  if (input.hasNews) {
    for (const domain of input.articleDomains) add(domain, "article");
  }
  for (const website of input.ukriWebsites) add(website, "ukri");
  if (!input.hasNews) return out;
  add(nameAsDomain(input.name), "name");
  for (const guess of guessDomains(input.name, input.countryCode)) {
    add(guess, "guess");
  }
  return out;
}
