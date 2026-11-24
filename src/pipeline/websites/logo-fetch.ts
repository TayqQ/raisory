/**
 * Polite download of one logo candidate (D72). robots.txt is checked before
 * every request, requests to one host keep the page fetch's spacing, each
 * request times out after 10 seconds, and at most 3 redirects are followed,
 * each only to the company's own site or a CDN host. The body is read up to
 * `MAX_LOGO_BYTES`; a larger file is refused. Nothing here trusts the
 * response's content type: `image-probe.ts` decides from the bytes.
 */
import type { RobotsChecker, RobotsDecision } from "@/lib/robots";
import { MIN_HOST_GAP_MS, type PageFetch } from "./fetch-page";
import { isPermittedLogoUrl } from "./logo-pick";

export const LOGO_TIMEOUT_MS = 10_000;
export const MAX_LOGO_REDIRECTS = 3;
/** The default for `MAX_LOGO_BYTES`, and the most the table holds. */
export const DEFAULT_MAX_LOGO_BYTES = 65_536;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);
const BLOCKED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);
const ACCEPT = "image/png,image/x-icon,image/webp,image/gif,image/jpeg";

/**
 * - `fetched`: the body was read in full, within the cap.
 * - `robots`: robots.txt disallows the URL or refused us its rules.
 * - `blocked`: the site answered 401, 403 or 429.
 * - `not_permitted`: the URL, or a redirect, leads off the permitted hosts.
 * - `too_large`: the file is over `MAX_LOGO_BYTES`.
 * - `failed`: a network error, a timeout, another HTTP error or too many redirects.
 * - `cap`: the run's logo request limit is used up, so nothing was requested.
 */
export type LogoFetchOutcome =
  | "fetched"
  | "robots"
  | "blocked"
  | "not_permitted"
  | "too_large"
  | "failed"
  | "cap";

export type LogoFetchResult =
  | { outcome: "fetched"; url: string; bytes: Uint8Array }
  | {
      outcome: Exclude<LogoFetchOutcome, "fetched">;
      url: string;
      detail: string;
    };

export interface LogoFetcherOptions {
  /** Share it with the page fetcher, wrapped in `withHostSpacing`. */
  robots: RobotsChecker;
  /** `buildUserAgent(HTTP_CONTACT)`. */
  userAgent: string;
  /** `MAX_LOGO_BYTES`. */
  maxBytes: number;
  /** Logo requests allowed this run, redirects included. */
  maxFetches: number;
  /** Production uses the platform `fetch`. */
  fetch?: PageFetch;
  timeoutMs?: number;
}

export interface LogoFetcher {
  /** Downloads `url` for a company whose website is `domain`. */
  fetchLogo(url: string, domain: string): Promise<LogoFetchResult>;
  /** Requests still allowed this run. */
  remaining(): number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wraps a robots checker so that allowed requests to one host are at least a
 * second apart, on top of any `Crawl-delay`. One wrapped checker, shared by
 * the page fetcher and the logo fetcher, spaces both kinds of request.
 */
export function withHostSpacing(
  robots: RobotsChecker,
  options: {
    gapMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): RobotsChecker {
  const gapMs = options.gapMs ?? MIN_HOST_GAP_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  const lastRequestAt = new Map<string, number>();
  return {
    check: (url) => robots.check(url),
    async beforeFetch(url): Promise<RobotsDecision> {
      const decision = await robots.beforeFetch(url);
      if (!decision.allowed) return decision;
      const host = new URL(url).host;
      const last = lastRequestAt.get(host);
      if (last !== undefined) {
        const wait = last + gapMs - now();
        if (wait > 0) await sleep(wait);
      }
      lastRequestAt.set(host, now());
      return decision;
    },
  };
}

class TooLarge extends Error {}

/** Reads the body, failing as soon as it passes `maxBytes`. */
async function readWithin(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new TooLarge();
      chunks.push(value);
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A fetcher for one run: it holds the run's request count. */
export function createLogoFetcher(options: LogoFetcherOptions): LogoFetcher {
  const fetchImpl: PageFetch =
    options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = options.timeoutMs ?? LOGO_TIMEOUT_MS;
  const maxBytes = Math.min(options.maxBytes, DEFAULT_MAX_LOGO_BYTES);
  let remaining = Math.max(0, Math.floor(options.maxFetches));

  /** One request and its body, both inside the timeout. */
  async function request(
    url: string,
  ): Promise<{ status: number; location: string | null; bytes: Uint8Array }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    timeout.catch(() => undefined);
    try {
      const response = await Promise.race([
        fetchImpl(url, {
          method: "GET",
          headers: { "user-agent": options.userAgent, accept: ACCEPT },
          redirect: "manual",
          signal: controller.signal,
        }),
        timeout,
      ]);
      const status = response.status;
      if (status < 200 || status >= 300) {
        await response.body?.cancel().catch(() => undefined);
        return {
          status,
          location: response.headers.get("location"),
          bytes: new Uint8Array(0),
        };
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new TooLarge();
      }
      const bytes = await Promise.race([
        readWithin(response.body, maxBytes),
        timeout,
      ]);
      return { status, location: null, bytes };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchLogo(
    startUrl: string,
    domain: string,
  ): Promise<LogoFetchResult> {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_LOGO_REDIRECTS; hop += 1) {
      if (!isPermittedLogoUrl(url, domain)) {
        return { outcome: "not_permitted", url, detail: "host not permitted" };
      }
      if (remaining <= 0) {
        return { outcome: "cap", url, detail: "logo request limit reached" };
      }
      const decision = await options.robots.beforeFetch(url);
      if (!decision.allowed) {
        return {
          outcome: "robots",
          url,
          detail: `robots.txt ${decision.reason}`,
        };
      }
      remaining -= 1;
      let got: Awaited<ReturnType<typeof request>>;
      try {
        got = await request(url);
      } catch (error) {
        if (error instanceof TooLarge) {
          return {
            outcome: "too_large",
            url,
            detail: `over ${maxBytes} bytes`,
          };
        }
        return { outcome: "failed", url, detail: errorText(error) };
      }
      if (REDIRECT_STATUSES.has(got.status)) {
        let next: URL | null = null;
        try {
          next = got.location ? new URL(got.location, url) : null;
        } catch {
          next = null;
        }
        if (!next) {
          return {
            outcome: "failed",
            url,
            detail: "redirect without a location",
          };
        }
        url = next.href;
        continue;
      }
      if (BLOCKED_STATUSES.has(got.status)) {
        return { outcome: "blocked", url, detail: `HTTP ${got.status}` };
      }
      if (got.status < 200 || got.status >= 300) {
        return { outcome: "failed", url, detail: `HTTP ${got.status}` };
      }
      return { outcome: "fetched", url, bytes: got.bytes };
    }
    return {
      outcome: "failed",
      url,
      detail: `more than ${MAX_LOGO_REDIRECTS} redirects`,
    };
  }

  return { fetchLogo, remaining: () => remaining };
}
