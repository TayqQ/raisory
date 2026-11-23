/**
 * Registrable domains (the part a company registers, such as `acme.co.uk` for
 * `www.shop.acme.co.uk`). A short built-in list of multi-label suffixes stands
 * in for the full Public Suffix List: the UK and other common second-level
 * suffixes, plus hosting platforms that give each customer a subdomain.
 */

const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  // United Kingdom
  "ac.uk",
  "co.uk",
  "gov.uk",
  "ltd.uk",
  "me.uk",
  "net.uk",
  "nhs.uk",
  "org.uk",
  "plc.uk",
  "police.uk",
  "sch.uk",
  // Elsewhere
  "ac.jp",
  "ac.nz",
  "co.at",
  "co.id",
  "co.il",
  "co.in",
  "co.jp",
  "co.ke",
  "co.kr",
  "co.nz",
  "co.th",
  "co.za",
  "com.ar",
  "com.au",
  "com.br",
  "com.cn",
  "com.co",
  "com.hk",
  "com.mx",
  "com.my",
  "com.ng",
  "com.ph",
  "com.pk",
  "com.sg",
  "com.tr",
  "com.tw",
  "com.ua",
  "com.vn",
  "edu.au",
  "gov.au",
  "ne.jp",
  "net.au",
  "or.at",
  "or.jp",
  "org.au",
  "org.nz",
  // Hosting platforms: each customer's subdomain is its own site.
  "azurewebsites.net",
  "firebaseapp.com",
  "framer.app",
  "framer.website",
  "github.io",
  "gitlab.io",
  "herokuapp.com",
  "netlify.app",
  "notion.site",
  "pages.dev",
  "vercel.app",
  "web.app",
  "webflow.io",
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** A top-level label: letters only, or an internationalised `xn--` label. */
const TOP_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const MAX_HOST_LENGTH = 253;

/** Lower-case host of a URL or bare host, or null when it is not a usable web host. */
export function hostOf(urlOrHost: string): string | null {
  const trimmed = urlOrHost.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => LABEL.test(label))) return null;
  if (!TOP_LABEL.test(labels[labels.length - 1] ?? "")) return null;
  return host;
}

/**
 * The registrable domain of a URL or host, in lower case, or null for an empty
 * value, an IP address, a single label, a bare suffix or anything that is not
 * an http(s) web address (such as "N/A" or an email address).
 */
export function registrableDomain(
  urlOrHost: string | null | undefined,
): string | null {
  if (!urlOrHost) return null;
  const host = hostOf(urlOrHost);
  if (!host) return null;
  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const suffixLength = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 2 : 1;
  if (labels.length <= suffixLength) return null;
  return labels.slice(-(suffixLength + 1)).join(".");
}

/** True when both URLs or hosts have the same registrable domain. */
export function isSameSite(left: string, right: string): boolean {
  const a = registrableDomain(left);
  return a !== null && a === registrableDomain(right);
}
