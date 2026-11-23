import { hostOf, registrableDomain } from "./registrable-domain";

/**
 * Hosts that are never a company's own website (D64): search, social, news,
 * data and directory hosts, government and registry hosts, publishing and
 * code hosts, app stores, link-in-bio pages and accelerators. A domain from
 * an article or a guess that lands on one of these is rejected before any
 * name is compared.
 */

export type NonCompanyHostKind =
  | "search"
  | "social"
  | "news"
  | "data"
  | "government"
  | "publishing"
  | "app_store"
  | "link_in_bio"
  | "accelerator";

const HOSTS: Readonly<Record<NonCompanyHostKind, readonly string[]>> = {
  search: ["google.com", "bing.com", "duckduckgo.com", "yahoo.com"],
  social: [
    "linkedin.com",
    "x.com",
    "twitter.com",
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "tiktok.com",
    "threads.net",
    "reddit.com",
  ],
  news: [
    "techcrunch.com",
    "sifted.eu",
    "tech.eu",
    "uktech.news",
    "eu-startups.com",
    "businesscloud.co.uk",
    "siliconrepublic.com",
    "therecursive.com",
    "techfundingnews.com",
    "bbc.co.uk",
    "bloomberg.com",
    "businessinsider.com",
    "cityam.com",
    "forbes.com",
    "ft.com",
    "reuters.com",
    "theguardian.com",
    "venturebeat.com",
    "news.ycombinator.com",
  ],
  data: [
    "crunchbase.com",
    "pitchbook.com",
    "dealroom.co",
    "tracxn.com",
    "wikipedia.org",
    "cbinsights.com",
    "zoominfo.com",
    "opencorporates.com",
    "endole.co.uk",
  ],
  government: [
    "gov.uk",
    "find-and-update.company-information.service.gov.uk",
    "ukri.org",
    "europa.eu",
  ],
  publishing: ["medium.com", "substack.com", "github.com", "notion.site"],
  app_store: ["apps.apple.com", "play.google.com"],
  link_in_bio: ["linktr.ee", "beacons.ai", "bio.link", "lnk.bio"],
  accelerator: [
    "ycombinator.com",
    "techstars.com",
    "seedcamp.com",
    "joinef.com",
    "antler.co",
  ],
};

const ENTRIES: ReadonlyArray<{
  host: string;
  site: string | null;
  kind: NonCompanyHostKind;
}> = (
  Object.entries(HOSTS) as [NonCompanyHostKind, readonly string[]][]
).flatMap(([kind, hosts]) =>
  hosts.map((host) => ({ host, site: registrableDomain(host), kind })),
);

/** Every listed host, for tests and documentation. */
export const NON_COMPANY_HOSTS: Readonly<
  Record<NonCompanyHostKind, readonly string[]>
> = HOSTS;

/**
 * The kind of non-company host a URL, host or domain is on, or null. It
 * matches the listed host or any subdomain of it first (the longest listed
 * host wins), then its registrable domain, because candidates are registrable domains: `apps.apple.com` in an article
 * becomes `apple.com`. A suffix such as `gov.uk` or `notion.site` matches
 * every site under it.
 */
export function nonCompanyHostKind(
  urlOrHost: string,
): NonCompanyHostKind | null {
  const host = hostOf(urlOrHost);
  if (!host) return null;
  // The longest listed host wins: `play.google.com` is an app store, not search.
  const exact = ENTRIES.filter(
    (entry) => host === entry.host || host.endsWith(`.${entry.host}`),
  ).sort((a, b) => b.host.length - a.host.length)[0];
  if (exact) return exact.kind;
  const site = registrableDomain(host);
  return (
    ENTRIES.find((entry) => site !== null && site === entry.site)?.kind ?? null
  );
}

/** True when the URL, host or domain is never a company's own website. */
export function isNonCompanyHost(urlOrHost: string): boolean {
  return nonCompanyHostKind(urlOrHost) !== null;
}
