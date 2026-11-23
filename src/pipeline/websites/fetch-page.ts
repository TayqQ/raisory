import type { WebsiteIconCandidate } from "@/db/schema";
import type { RobotsChecker } from "@/lib/robots";
import { registrableDomain } from "./registrable-domain";

/**
 * Polite homepage fetch for company websites. It reads one homepage, at most
 * one legal page (only when the homepage shows no company number) and at most
 * one same-site web app manifest, and returns a summary held in memory.
 * Nothing is written to the database, and the page text is never stored.
 *
 * Politeness: robots.txt is checked through `src/lib/robots.ts` before every
 * request; requests to one host are at least a second apart (longer when
 * robots.txt sets a `Crawl-delay`); each request times out after 10 seconds;
 * at most 5 redirects are followed, only one of them to another registrable
 * domain; bodies are read up to 1 MB; only HTML pages are read. An answer of
 * 401, 403 or 429 is a block: it is reported and never retried or worked
 * around.
 */

export const PAGE_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;
export const MAX_BODY_BYTES = 1024 * 1024;
export const MIN_HOST_GAP_MS = 1_000;
/** Visible text kept for the summary. Company numbers are read from all of it. */
export const MAX_TEXT_CHARS = 3_000;
export const MAX_ICON_CANDIDATES = 10;

const BLOCKED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/** The parts of a `fetch` response this module reads. */
export interface PageResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export type PageFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
  },
) => Promise<PageResponse>;

/**
 * - `fetched`: the homepage was read.
 * - `robots`: robots.txt disallows the page or refused us its rules.
 * - `blocked`: the site answered 401, 403 or 429.
 * - `failed`: a network error, a timeout, another HTTP error or too many redirects.
 * - `not_html`: the page is not HTML.
 * - `cap`: the run's page limit is used up, so nothing was requested.
 */
export type PageOutcome =
  "fetched" | "robots" | "blocked" | "failed" | "not_html" | "cap";

export interface PageSummary {
  outcome: PageOutcome;
  /** A short reason when the outcome is not `fetched`. */
  detail: string | null;
  /** The domain asked for. */
  domain: string;
  /** The registrable domain after redirects, or of the last URL tried. */
  finalDomain: string;
  /** The domain asked for, when a redirect led to another registrable domain. */
  redirectedFrom: string | null;
  title: string | null;
  siteName: string | null;
  ogTitle: string | null;
  metaDescription: string | null;
  /** Visible text, scripts and styles removed, at most 3,000 characters. */
  text: string;
  /** UK company numbers shown next to a cue, homepage first, then the legal page. */
  companyNumbers: string[];
  parked: boolean;
  iconCandidates: WebsiteIconCandidate[];
  /** True when a linked legal page was read because the homepage showed no number. */
  legalPageChecked: boolean;
  /** True when the site answered 401, 403 or 429. */
  blocked: boolean;
}

export interface WebsiteFetcherOptions {
  robots: RobotsChecker;
  /** `buildUserAgent(HTTP_CONTACT)`. */
  userAgent: string;
  /** `MAX_WEBSITE_FETCHES_PER_RUN`: pages read this run, manifests and legal pages included. */
  maxFetches: number;
  /** Production uses the platform `fetch`. */
  fetch?: PageFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export interface WebsiteFetcher {
  fetchPage(domain: string): Promise<PageSummary>;
  /** Pages still allowed this run. */
  remaining(): number;
}

// ---------------------------------------------------------------------------
// HTML reading (pure)

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  ndash: "–",
  mdash: "—",
  middot: "·",
  bull: "•",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  pound: "£",
  euro: "€",
};

export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Opening tags named `name`, with attribute values allowed to hold `>`. */
function openingTags(html: string, name: string): string[] {
  const pattern = new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi");
  return html.match(pattern) ?? [];
}

/** Attributes of one opening tag, names in lower case, values decoded. */
export function tagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const body = tag.replace(/^<[a-z0-9-]+/i, "").replace(/\/?>$/, "");
  const pattern =
    /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of body.matchAll(pattern)) {
    const name = match[1]!.toLowerCase();
    if (attributes.has(name)) continue;
    attributes.set(
      name,
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""),
    );
  }
  return attributes;
}

function stripBlocks(html: string, names: readonly string[]): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const name of names) {
    out = out.replace(
      new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}\\s*>`, "gi"),
      " ",
    );
  }
  return out;
}

/** Visible text: scripts, styles, the head and other hidden blocks removed. */
export function visibleText(html: string): string {
  const stripped = stripBlocks(html, [
    "head",
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "iframe",
  ]);
  return collapse(decodeEntities(stripped.replace(/<[^>]*>/g, " ")));
}

function metaContent(html: string, keys: readonly string[]): string | null {
  for (const tag of openingTags(html, "meta")) {
    const attributes = tagAttributes(tag);
    const key = (
      attributes.get("property") ??
      attributes.get("name") ??
      ""
    ).toLowerCase();
    if (!keys.includes(key)) continue;
    const content = collapse(attributes.get("content") ?? "");
    if (content) return content;
  }
  return null;
}

function pageTitle(html: string): string | null {
  const withoutSvg = stripBlocks(html, ["svg"]);
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(withoutSvg);
  const title = match ? collapse(decodeEntities(match[1]!)) : "";
  return title || null;
}

// Company numbers

/** Cues from the spec, with the common ways sites write them. */
const NUMBER_CUE =
  /company\s+(?:reg(?:istration|\.)?\s+)?(?:number|no\b)|registration\s+(?:number|no\b)|registered\s+(?:number|no\b)|registered\s+in\s+(?:england|scotland|wales|northern\s+ireland)|companies\s+house/gi;
const COMPANY_NUMBER =
  /(?<![a-z0-9])(?:\d{8}|(?:sc|ni|oc|so|nc|r0)\d{6})(?![a-z0-9])/gi;
/** A number counts only this close to a cue, before or after it. */
export const CUE_DISTANCE = 60;

/**
 * UK company numbers (8 digits, or SC, NI, OC, SO, NC or R0 and 6 digits)
 * within 60 characters of a cue such as "company number" or "registered in
 * England", upper case and in order of appearance, without duplicates.
 */
export function findCompanyNumbers(text: string): string[] {
  const cues = [...text.matchAll(NUMBER_CUE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  if (cues.length === 0) return [];
  const out: string[] = [];
  for (const match of text.matchAll(COMPANY_NUMBER)) {
    const start = match.index;
    const end = start + match[0].length;
    const nearCue = cues.some(
      (cue) =>
        (cue.end <= start && start - cue.end <= CUE_DISTANCE) ||
        (cue.start >= end && cue.start - end <= CUE_DISTANCE),
    );
    const number = match[0].toUpperCase();
    if (nearCue && !out.includes(number)) out.push(number);
  }
  return out;
}

// Parked and for-sale pages

/** Hosts that sell or park domains. A redirect to one, or a page loading from one, is parked. */
const PARKING_HOSTS: readonly string[] = [
  "above.com",
  "afternic.com",
  "atom.com",
  "bodis.com",
  "brandbucket.com",
  "buydomains.com",
  "dan.com",
  "domainmarket.com",
  "hugedomains.com",
  "parkingcrew.net",
  "parklogic.com",
  "sedo.com",
  "sedoparking.com",
  "squadhelp.com",
  "undeveloped.com",
];
const PARKING_PHRASES: readonly string[] = [
  "domain is for sale",
  "domain may be for sale",
  "domain name is for sale",
  "buy this domain",
  "make an offer on this domain",
  "this domain is parked",
  "this web page is parked",
  "parked free, courtesy of",
  "this domain has been registered",
  "this domain name has been registered",
  "domain parking",
];
const PARKING_HOST_PATTERN = new RegExp(
  `(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*(?:${PARKING_HOSTS.map((host) =>
    host.replace(/\./g, "\\."),
  ).join("|")})(?![a-z0-9-])`,
  "i",
);

/**
 * GoDaddy's holding page: an empty page whose only content is a script that
 * sends the browser to `/lander`, which refuses automated requests.
 */
const LANDER_REDIRECT = /location(?:\.href)?\s*=\s*["']\/lander["']/i;
const LANDER_MAX_TEXT_CHARS = 40;

/** Parked or for-sale signals in the final domain, the page's own links or its text. */
export function isParked(
  finalDomain: string,
  html: string,
  text: string,
): boolean {
  if (PARKING_HOSTS.includes(finalDomain)) return true;
  if (
    LANDER_REDIRECT.test(html) &&
    text.trim().length <= LANDER_MAX_TEXT_CHARS
  ) {
    return true;
  }
  const sources = [
    ...openingTags(html, "script"),
    ...openingTags(html, "iframe"),
  ]
    .map((tag) => tagAttributes(tag).get("src") ?? "")
    .filter((src) => src !== "");
  if (sources.some((src) => PARKING_HOST_PATTERN.test(src))) return true;
  const lower = text.toLowerCase();
  return PARKING_PHRASES.some((phrase) => lower.includes(phrase));
}

// Links and icons

function resolveUrl(href: string, base: URL): URL | null {
  const trimmed = href.trim();
  if (trimmed === "" || /^data:/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** The page's `<base href>`, when it gives a usable one. */
function baseUrl(html: string, pageUrl: URL): URL {
  const [tag] = openingTags(html, "base");
  const href = tag ? tagAttributes(tag).get("href") : undefined;
  return (href && resolveUrl(href, pageUrl)) || pageUrl;
}

/** The largest side declared in `sizes` ("16x16 32x32"), or 0. */
function largestSide(sizes: string | null): number {
  let best = 0;
  for (const match of (sizes ?? "").matchAll(/(\d+)\s*x\s*(\d+)/gi)) {
    best = Math.max(best, Math.min(Number(match[1]), Number(match[2])));
  }
  return best;
}

function bySizeDescending(
  left: WebsiteIconCandidate,
  right: WebsiteIconCandidate,
): number {
  return largestSide(right.sizes) - largestSide(left.sizes);
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (value && typeof value === "object" && "value" in value) {
    return textOrNull(value.value);
  }
  return null;
}

const ORGANISATION_TYPES: ReadonlySet<string> = new Set([
  "corporation",
  "localbusiness",
  "ngo",
  "onlinebusiness",
  "onlinestore",
  "organization",
  "professionalservice",
]);

function isOrganisationNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (value) =>
      typeof value === "string" && ORGANISATION_TYPES.has(value.toLowerCase()),
  );
}

/** `logo` values of Organization nodes in JSON-LD, nested ones included. */
function jsonLdLogos(
  value: unknown,
  base: URL,
  out: WebsiteIconCandidate[],
  depth = 0,
): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) jsonLdLogos(item, base, out, depth + 1);
    return;
  }
  const node = value as Record<string, unknown>;
  if (isOrganisationNode(node)) {
    const logos = Array.isArray(node.logo) ? node.logo : [node.logo];
    for (const logo of logos) {
      let href: string | null = null;
      let sizes: string | null = null;
      let type: string | null = null;
      if (typeof logo === "string") {
        href = logo;
      } else if (logo && typeof logo === "object") {
        const image = logo as Record<string, unknown>;
        href = textOrNull(image.url) ?? textOrNull(image.contentUrl);
        const width = textOrNull(image.width);
        const height = textOrNull(image.height);
        sizes = width && height ? `${width}x${height}` : null;
        type = textOrNull(image.encodingFormat);
      }
      const url = href ? resolveUrl(href, base) : null;
      if (url) out.push({ url: url.href, rel: "json-ld", sizes, type });
    }
  }
  for (const [key, child] of Object.entries(node)) {
    if (key !== "logo") jsonLdLogos(child, base, out, depth + 1);
  }
}

export interface HeadIcons {
  jsonLd: WebsiteIconCandidate[];
  appleTouch: WebsiteIconCandidate[];
  /** Only `<link rel="icon">` with `sizes`. */
  sizedIcons: WebsiteIconCandidate[];
  /** The `<link rel="manifest">` URL, whatever its site. */
  manifestUrl: string | null;
}

/** Icon links declared in the page, relative URLs resolved against the page. */
export function readHeadIcons(html: string, pageUrl: string): HeadIcons {
  const base = baseUrl(html, new URL(pageUrl));
  const icons: HeadIcons = {
    jsonLd: [],
    appleTouch: [],
    sizedIcons: [],
    manifestUrl: null,
  };

  const ldScripts = html.matchAll(
    /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi,
  );
  for (const match of ldScripts) {
    const type = tagAttributes(`<script${match[1]}>`).get("type") ?? "";
    if (!/^application\/ld\+json/i.test(type.trim())) continue;
    try {
      jsonLdLogos(JSON.parse(match[2]!) as unknown, base, icons.jsonLd);
    } catch {
      // Broken JSON-LD is ignored.
    }
  }

  for (const tag of openingTags(html, "link")) {
    const attributes = tagAttributes(tag);
    const rels = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const url = resolveUrl(attributes.get("href") ?? "", base);
    if (!url) continue;
    const sizes = attributes.get("sizes")?.trim() || null;
    const type = attributes.get("type")?.trim().toLowerCase() || null;
    if (rels.includes("manifest")) {
      icons.manifestUrl ??= url.href;
    } else if (
      rels.includes("apple-touch-icon") ||
      rels.includes("apple-touch-icon-precomposed")
    ) {
      icons.appleTouch.push({
        url: url.href,
        rel: "apple-touch-icon",
        sizes,
        type,
      });
    } else if (rels.includes("icon") && sizes) {
      icons.sizedIcons.push({ url: url.href, rel: "icon", sizes, type });
    }
  }
  return icons;
}

/** Icons listed in a web app manifest, resolved against the manifest's URL. */
export function readManifestIcons(
  json: string,
  manifestUrl: string,
): WebsiteIconCandidate[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(json);
  } catch {
    return [];
  }
  const list =
    manifest && typeof manifest === "object" && "icons" in manifest
      ? manifest.icons
      : null;
  if (!Array.isArray(list)) return [];
  const base = new URL(manifestUrl);
  const out: WebsiteIconCandidate[] = [];
  for (const icon of list) {
    if (!icon || typeof icon !== "object") continue;
    const entry = icon as Record<string, unknown>;
    const url =
      typeof entry.src === "string" ? resolveUrl(entry.src, base) : null;
    if (!url) continue;
    out.push({
      url: url.href,
      rel: "manifest",
      sizes: textOrNull(entry.sizes),
      type: textOrNull(entry.type)?.toLowerCase() ?? null,
    });
  }
  return out;
}

/**
 * Icon candidates in order of preference, at most 10: JSON-LD logo
 * (2), apple-touch-icon (2), manifest icons (3), sized `rel=icon` (2), each
 * group largest first, then `/favicon.ico`. Duplicates are dropped.
 */
export function iconCandidates(
  head: HeadIcons,
  manifestIcons: readonly WebsiteIconCandidate[],
  finalUrl: string,
): WebsiteIconCandidate[] {
  const groups: [readonly WebsiteIconCandidate[], number][] = [
    [head.jsonLd, 2],
    [[...head.appleTouch].sort(bySizeDescending), 2],
    [[...manifestIcons].sort(bySizeDescending), 3],
    [[...head.sizedIcons].sort(bySizeDescending), 2],
    [
      [
        {
          url: new URL("/favicon.ico", finalUrl).href,
          rel: "favicon",
          sizes: null,
          type: null,
        },
      ],
      1,
    ],
  ];
  const out: WebsiteIconCandidate[] = [];
  const seen = new Set<string>();
  for (const [group, limit] of groups) {
    let taken = 0;
    for (const icon of group) {
      if (taken >= limit || out.length >= MAX_ICON_CANDIDATES) break;
      if (seen.has(icon.url)) continue;
      seen.add(icon.url);
      out.push(icon);
      taken += 1;
    }
  }
  return out;
}

const LEGAL_WORDS: readonly string[] = [
  "imprint",
  "impressum",
  "legal",
  "terms",
  "privacy",
  "contact",
];

/**
 * The one linked same-site page most likely to show a company number: the
 * first link whose text or path names, in order of preference, an imprint, a
 * legal page, terms, privacy or contact.
 */
export function findLegalPageUrl(html: string, pageUrl: string): string | null {
  const page = new URL(pageUrl);
  const base = baseUrl(html, page);
  const site = registrableDomain(page.hostname);
  let best: { url: string; rank: number } | null = null;
  const anchors = html.matchAll(
    /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi,
  );
  for (const match of anchors) {
    const href = tagAttributes(`<a${match[1]}>`).get("href") ?? "";
    const url = resolveUrl(href, base);
    if (!url || registrableDomain(url.hostname) !== site) continue;
    url.hash = "";
    if (url.pathname === page.pathname && url.search === page.search) continue;
    const label = `${visibleText(match[2]!)} ${decodeURIComponentSafe(url.pathname)}`;
    const lower = label.toLowerCase();
    const rank = LEGAL_WORDS.findIndex((word) => lower.includes(word));
    if (rank !== -1 && (!best || rank < best.rank)) {
      best = { url: url.href, rank };
    }
  }
  return best?.url ?? null;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface ReadPage {
  title: string | null;
  siteName: string | null;
  ogTitle: string | null;
  metaDescription: string | null;
  /** All visible text. The summary keeps the first 3,000 characters. */
  fullText: string;
  companyNumbers: string[];
  parked: boolean;
  head: HeadIcons;
}

/** Everything the summary needs from one homepage's HTML. */
export function readPage(
  html: string,
  pageUrl: string,
  finalDomain: string,
): ReadPage {
  const fullText = visibleText(html);
  const title = pageTitle(html);
  return {
    title,
    siteName: metaContent(html, ["og:site_name"]),
    ogTitle: metaContent(html, ["og:title"]),
    metaDescription: metaContent(html, ["description", "og:description"]),
    fullText,
    companyNumbers: findCompanyNumbers(fullText),
    parked: isParked(finalDomain, html, `${title ?? ""} ${fullText}`),
    head: readHeadIcons(html, pageUrl),
  };
}

// ---------------------------------------------------------------------------
// Fetching

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

type Got =
  | { kind: "ok"; url: string; body: string }
  | { kind: "robots"; url: string; reason: string }
  | { kind: "blocked"; url: string; status: number }
  | { kind: "failed"; url: string; reason: string }
  | { kind: "not_html"; url: string; contentType: string };

function isHtmlType(contentType: string): boolean {
  return /^\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}

function looksLikeHtml(body: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html\b|<head\b)/i.test(body);
}

function charsetOf(contentType: string, head: Uint8Array): string {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const start = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(start)?.[1] ?? "utf-8";
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = charsetOf(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Reads at most `maxBytes`, then cancels the stream. */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - total;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function emptySummary(
  domain: string,
  outcome: PageOutcome,
  detail: string | null,
  finalDomain = domain,
): PageSummary {
  return {
    outcome,
    detail,
    domain,
    finalDomain,
    redirectedFrom: null,
    title: null,
    siteName: null,
    ogTitle: null,
    metaDescription: null,
    text: "",
    companyNumbers: [],
    parked: false,
    iconCandidates: [],
    legalPageChecked: false,
    blocked: outcome === "blocked",
  };
}

/** Cuts at a whole character, so a surrogate pair is never split. */
function cutText(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/**
 * A fetcher for one run. It holds the run's page count and the time of the
 * last request to each host, so create one per run.
 */
export function createWebsiteFetcher(
  options: WebsiteFetcherOptions,
): WebsiteFetcher {
  const fetchImpl: PageFetch =
    options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  const timeoutMs = options.timeoutMs ?? PAGE_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  let remaining = Math.max(0, Math.floor(options.maxFetches));
  const lastRequestAt = new Map<string, number>();

  async function spaceHost(host: string): Promise<void> {
    const last = lastRequestAt.get(host);
    if (last !== undefined) {
      const wait = last + MIN_HOST_GAP_MS - now();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt.set(host, now());
  }

  interface Requested {
    response: PageResponse;
    /** Reads the body up to the cap, inside the same timeout. */
    read(): Promise<Uint8Array>;
    /** Drops the body unread. */
    close(): Promise<void>;
  }

  /** One request and its body, both inside the timeout. */
  async function request(url: string, accept: string): Promise<Requested> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(timeoutMs));
      }, timeoutMs);
    });
    // Only a race below ever awaits it, so a late timeout is not unhandled.
    timeout.catch(() => undefined);
    const clear = () => clearTimeout(timer);
    let response: PageResponse;
    try {
      response = await Promise.race([
        fetchImpl(url, {
          method: "GET",
          headers: { "user-agent": options.userAgent, accept },
          redirect: "manual",
          signal: controller.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      clear();
      throw error;
    }
    return {
      response,
      async read() {
        try {
          return await Promise.race([
            readCapped(response.body, maxBodyBytes),
            timeout,
          ]);
        } finally {
          clear();
        }
      },
      async close() {
        clear();
        await response.body?.cancel().catch(() => undefined);
      },
    };
  }

  /**
   * GET with robots, spacing and manual redirects. `html` asks for an HTML
   * page; otherwise any body is returned (for a manifest).
   */
  async function get(startUrl: string, html: boolean): Promise<Got> {
    let url = startUrl;
    let crossings = 0;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const decision = await options.robots.beforeFetch(url);
      if (!decision.allowed) {
        return { kind: "robots", url, reason: decision.reason };
      }
      const current = new URL(url);
      await spaceHost(current.host);

      let requested: Requested;
      try {
        requested = await request(
          url,
          html
            ? "text/html,application/xhtml+xml"
            : "application/manifest+json,application/json",
        );
      } catch (error) {
        return { kind: "failed", url, reason: errorText(error) };
      }
      const { response } = requested;

      if (REDIRECT_STATUSES.has(response.status)) {
        await requested.close();
        const location = response.headers.get("location");
        const next = location ? resolveUrl(location, current) : null;
        if (!next) {
          return { kind: "failed", url, reason: "redirect without a location" };
        }
        if (
          registrableDomain(next.hostname) !==
          registrableDomain(current.hostname)
        ) {
          crossings += 1;
          if (crossings > 1) {
            return {
              kind: "failed",
              url,
              reason: "redirected to another domain twice",
            };
          }
        }
        url = next.href;
        continue;
      }
      if (BLOCKED_STATUSES.has(response.status)) {
        await requested.close();
        return { kind: "blocked", url, status: response.status };
      }
      if (response.status < 200 || response.status >= 300) {
        await requested.close();
        return { kind: "failed", url, reason: `HTTP ${response.status}` };
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (html && contentType !== "" && !isHtmlType(contentType)) {
        await requested.close();
        return { kind: "not_html", url, contentType };
      }
      let body: string;
      try {
        body = decodeBody(await requested.read(), contentType);
      } catch (error) {
        return { kind: "failed", url, reason: errorText(error) };
      }
      if (html && contentType === "" && !looksLikeHtml(body)) {
        return { kind: "not_html", url, contentType: "unknown" };
      }
      return { kind: "ok", url, body };
    }
    return {
      kind: "failed",
      url,
      reason: `more than ${MAX_REDIRECTS} redirects`,
    };
  }

  function take(): boolean {
    if (remaining <= 0) return false;
    remaining -= 1;
    return true;
  }

  async function fetchPage(domain: string): Promise<PageSummary> {
    const asked = registrableDomain(domain);
    if (!asked) return emptySummary(domain, "failed", "not a web domain");
    if (!take()) return emptySummary(asked, "cap", "page limit reached");

    let got = await get(`https://${asked}/`, true);
    // Some sites answer only at www: the bare domain errors, or redirects to
    // a broken page (mindfoundry.ai sent it to a 404). One retry at www, as
    // part of the same page. If it fails too, the first failure is reported.
    if (got.kind === "failed") {
      const retry = await get(`https://www.${asked}/`, true);
      if (retry.kind !== "failed") got = retry;
    }
    const reached = registrableDomain(new URL(got.url).hostname) ?? asked;
    switch (got.kind) {
      case "robots":
        return emptySummary(
          asked,
          "robots",
          `robots.txt ${got.reason}`,
          reached,
        );
      case "blocked":
        return emptySummary(asked, "blocked", `HTTP ${got.status}`, reached);
      case "failed":
        return emptySummary(asked, "failed", got.reason, reached);
      case "not_html":
        return emptySummary(
          asked,
          "not_html",
          got.contentType || "no content type",
          reached,
        );
      case "ok":
        break;
    }

    const page = readPage(got.body, got.url, reached);
    const companyNumbers = [...page.companyNumbers];

    let manifestIcons: WebsiteIconCandidate[] = [];
    const manifestUrl = page.head.manifestUrl;
    if (
      manifestUrl &&
      registrableDomain(new URL(manifestUrl).hostname) === reached &&
      take()
    ) {
      const manifest = await get(manifestUrl, false);
      if (manifest.kind === "ok") {
        manifestIcons = readManifestIcons(manifest.body, manifest.url);
      }
    }

    let legalPageChecked = false;
    if (companyNumbers.length === 0) {
      const legalUrl = findLegalPageUrl(got.body, got.url);
      if (legalUrl && take()) {
        const legal = await get(legalUrl, true);
        if (
          legal.kind === "ok" &&
          registrableDomain(new URL(legal.url).hostname) === reached
        ) {
          legalPageChecked = true;
          for (const number of findCompanyNumbers(visibleText(legal.body))) {
            if (!companyNumbers.includes(number)) companyNumbers.push(number);
          }
        }
      }
    }

    return {
      outcome: "fetched",
      detail: null,
      domain: asked,
      finalDomain: reached,
      redirectedFrom: reached !== asked ? asked : null,
      title: page.title,
      siteName: page.siteName,
      ogTitle: page.ogTitle,
      metaDescription: page.metaDescription,
      text: cutText(page.fullText, MAX_TEXT_CHARS),
      companyNumbers,
      parked: page.parked,
      iconCandidates: iconCandidates(page.head, manifestIcons, got.url),
      legalPageChecked,
      blocked: false,
    };
  }

  return { fetchPage, remaining: () => remaining };
}
