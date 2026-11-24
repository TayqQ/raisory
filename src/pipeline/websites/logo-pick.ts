/**
 * Picks the icon candidates worth fetching for a company's logo (D72). The
 * candidates come from the linked website's homepage, already in order: the
 * JSON-LD logo, apple-touch-icon, the largest manifest icons, the largest
 * sized rel=icon and finally /favicon.ico. SVG and `data:` URLs are dropped,
 * and so is any host that is neither the company's own site nor a known
 * content delivery host.
 */
import type { WebsiteIconCandidate } from "@/db/schema";
import { hostOf, registrableDomain } from "./registrable-domain";

export const MAX_LOGO_TRIES = 3;

/**
 * Hosts that serve files for many sites, where a page's own images often
 * live. A candidate on one of these is kept only because the page linked it.
 */
const CDN_HOSTS: readonly string[] = [
  "cdn.sanity.io",
  "cdn.shopify.com",
  "cloudfront.net",
  "ctfassets.net",
  "framerusercontent.com",
  "imgix.net",
  "res.cloudinary.com",
  "squarespace-cdn.com",
  "website-files.com",
  "wixstatic.com",
];

const REL_ORDER: readonly string[] = [
  "json-ld",
  "apple-touch-icon",
  "manifest",
  "icon",
  "favicon",
];

function isCdnHost(host: string): boolean {
  return CDN_HOSTS.some((cdn) => host === cdn || host.endsWith(`.${cdn}`));
}

/**
 * True when a logo may be fetched from this URL for a company whose website
 * is `domain`: an http(s) address on the company's own site or a CDN host.
 */
export function isPermittedLogoUrl(url: string, domain: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const host = hostOf(url);
  if (!host) return false;
  return (
    registrableDomain(host) === registrableDomain(domain) || isCdnHost(host)
  );
}

function isSvg(candidate: WebsiteIconCandidate): boolean {
  if (candidate.type?.toLowerCase().includes("svg")) return true;
  try {
    return /\.svgz?$/i.test(new URL(candidate.url).pathname);
  } catch {
    return true;
  }
}

function relRank(rel: string): number {
  const rank = REL_ORDER.indexOf(rel);
  return rank === -1 ? REL_ORDER.length : rank;
}

/** Up to three candidates to try, best first. */
export function pickLogoCandidates(
  candidates: readonly WebsiteIconCandidate[],
  domain: string,
): WebsiteIconCandidate[] {
  const seen = new Set<string>();
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        relRank(a.candidate.rel) - relRank(b.candidate.rel) ||
        a.index - b.index,
    )
    .map(({ candidate }) => candidate)
    .filter((candidate) => {
      if (/^data:/i.test(candidate.url.trim())) return false;
      if (isSvg(candidate)) return false;
      if (!isPermittedLogoUrl(candidate.url, domain)) return false;
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .slice(0, MAX_LOGO_TRIES);
}
