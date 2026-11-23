import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { HttpFetcher } from "@/core/ports";
import { createRobotsChecker } from "@/lib/robots";
import {
  createWebsiteFetcher,
  findCompanyNumbers,
  iconCandidates,
  MAX_BODY_BYTES,
  readHeadIcons,
  readManifestIcons,
  visibleText,
  type PageFetch,
  type PageResponse,
} from "./fetch-page";

const HEADS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/websites/heads",
);
const head = (name: string) =>
  readFileSync(path.join(HEADS, `${name}.html`), "utf8");

// ---------------------------------------------------------------------------
// Company numbers

describe("findCompanyNumbers", () => {
  it.each([
    [
      "© 2026 Acme Robotics Ltd. Registered in England and Wales. Company number 12345678.",
      ["12345678"],
    ],
    ["Company No. 09876543 | VAT GB 123 4567 89", ["09876543"]],
    ["Registered in Scotland No. SC123456", ["SC123456"]],
    [
      "Acme Ltd is registered in Northern Ireland, company number NI654321.",
      ["NI654321"],
    ],
    ["Companies House registration: 01234567", ["01234567"]],
    [
      "Registration number: OC398765 (a limited liability partnership)",
      ["OC398765"],
    ],
    ["Company Reg. No. 11223344", ["11223344"]],
    [
      "Registered number 07766554. Registered office: 1 High Street, London EC1A 1BB",
      ["07766554"],
    ],
    ["company no: sc123456", ["SC123456"]],
    ["Our number 12345678 is our company number.", ["12345678"]],
    [
      "Company number 12345678. Acme Ltd, company no 12345678, registered in England.",
      ["12345678"],
    ],
    ["Charity R0 in Wales: registered in Wales R0123456", ["R0123456"]],
  ])("finds the number in %j", (text, expected) => {
    expect(findCompanyNumbers(text)).toEqual(expected);
  });

  it.each([
    [
      "Call 12345678 for sales. " +
        "We build warehouse robots for retailers across the country. " +
        "Company number on request.",
    ],
    [`Company number ${"x".repeat(61)} 12345678`],
    ["Company number 123456789"],
    ["Order AB12345678 shipped. Company number pending."],
    ["Phone 12345678"],
  ])("ignores a number not next to a cue: %j", (text) => {
    expect(findCompanyNumbers(text)).toEqual([]);
  });

  it("reads numbers across tags and entities in a footer", () => {
    const html =
      "<footer><p>Acme&nbsp;Robotics&nbsp;Ltd</p><p>Company&nbsp;No.&nbsp;<b>12345678</b></p></footer>";
    expect(findCompanyNumbers(visibleText(html))).toEqual(["12345678"]);
  });
});

describe("visibleText", () => {
  it("drops the head, scripts, styles and comments and decodes entities", () => {
    const html = `<html><head><title>T</title><style>.a{}</style></head>
      <body><script>var hidden = 1;</script><noscript>no</noscript>
      <!-- note --><h1>Acme &amp; Co</h1><p>Robots&#x2019; <em>arms</em></p></body></html>`;
    expect(visibleText(html)).toBe("Acme & Co Robots’ arms");
  });
});

// ---------------------------------------------------------------------------
// Icon candidates from saved <head> snippets

function candidatesFor(name: string, pageUrl: string) {
  const icons = readHeadIcons(head(name), pageUrl);
  return { icons, candidates: iconCandidates(icons, [], pageUrl) };
}

describe("icon candidates", () => {
  it("reads a JSON-LD logo, a sized icon and the manifest link (monzo.com)", () => {
    const { icons, candidates } = candidatesFor(
      "monzo.com",
      "https://monzo.com/",
    );
    expect(icons.manifestUrl).toBe("https://monzo.com/manifest.json");
    expect(
      candidates.map(({ rel, sizes, type }) => [rel, sizes, type]),
    ).toEqual([
      ["json-ld", null, null],
      ["icon", "any", null],
      ["favicon", null, null],
    ]);
    expect(candidates[0]?.url).toBe(
      "https://monzo.com/static/images/monzo-logo-stacked.svg",
    );
  });

  it("orders apple-touch-icon, then the largest sized icons (octopus.energy)", () => {
    const { candidates } = candidatesFor(
      "octopus.energy",
      "https://octopus.energy/",
    );
    expect(candidates).toEqual([
      {
        url: "https://static.octopuscdn.com/favicons/apple-touch-icon.png",
        rel: "apple-touch-icon",
        sizes: "180x180",
        type: "image/png",
      },
      {
        url: "https://static.octopuscdn.com/favicons/android-chrome-512x512.png",
        rel: "icon",
        sizes: "512x512",
        type: "image/png",
      },
      {
        url: "https://static.octopuscdn.com/favicons/android-chrome-192x192.png",
        rel: "icon",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "https://octopus.energy/favicon.ico",
        rel: "favicon",
        sizes: null,
        type: null,
      },
    ]);
  });

  it("skips unsized icons and keeps the manifest link (github.com)", () => {
    const { icons, candidates } = candidatesFor(
      "github.com",
      "https://github.com/",
    );
    expect(icons.manifestUrl).toBe("https://github.com/manifest.json");
    expect(candidates.map((c) => c.rel)).toEqual(["favicon"]);
  });

  it("decodes entities in icon URLs (stripe.com)", () => {
    const { candidates } = candidatesFor("stripe.com", "https://stripe.com/");
    expect(candidates.map((c) => [c.rel, c.sizes])).toEqual([
      ["apple-touch-icon", "180x180"],
      ["icon", "96x96"],
      ["favicon", null],
    ]);
    expect(candidates[0]?.url).toMatch(/favicon\.png\?w=180&h=180$/);
  });

  it("keeps at most two sized icons, largest first (wise.com)", () => {
    const { candidates } = candidatesFor("wise.com", "https://wise.com/");
    expect(candidates.map((c) => [c.rel, c.sizes])).toEqual([
      ["json-ld", null],
      ["apple-touch-icon", "180x180"],
      ["icon", "32x32"],
      ["icon", "16x16"],
      ["favicon", null],
    ]);
  });

  it("resolves against <base href>, skips data: URLs and reads a manifest", () => {
    const pageUrl = "https://acme.example/";
    const icons = readHeadIcons(head("synthetic-manifest-base"), pageUrl);
    expect(icons.manifestUrl).toBe("https://acme.example/en/site.webmanifest");
    const manifest = readManifestIcons(
      JSON.stringify({
        icons: [
          { src: "icons/192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/512.png", sizes: "512x512", type: "IMAGE/PNG" },
          { src: "data:image/png;base64,AAAA", sizes: "48x48" },
          { sizes: "64x64" },
        ],
      }),
      icons.manifestUrl!,
    );
    expect(iconCandidates(icons, manifest, pageUrl)).toEqual([
      {
        url: "https://acme.example/icons/touch-152.png",
        rel: "apple-touch-icon",
        sizes: "152x152",
        type: null,
      },
      {
        url: "https://acme.example/icons/512.png",
        rel: "manifest",
        sizes: "512x512",
        type: "image/png",
      },
      {
        url: "https://acme.example/en/icons/192.png",
        rel: "manifest",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "https://acme.example/icons/32.png",
        rel: "icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "https://acme.example/icons/16.png",
        rel: "icon",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "https://acme.example/favicon.ico",
        rel: "favicon",
        sizes: null,
        type: null,
      },
    ]);
  });

  it("reads an Organization logo from a JSON-LD @graph and ignores broken JSON", () => {
    const { candidates } = candidatesFor(
      "synthetic-jsonld-graph",
      "https://orbitalforge.example/",
    );
    expect(candidates).toEqual([
      {
        url: "https://orbitalforge.example/media/logo-512.png",
        rel: "json-ld",
        sizes: "512x512",
        type: "image/png",
      },
      {
        url: "https://orbitalforge.example/favicon.ico",
        rel: "favicon",
        sizes: null,
        type: null,
      },
    ]);
  });

  it("reads upper-case tags, single-quoted and unquoted attributes", () => {
    const html = `<HEAD><LINK REL='Apple-Touch-Icon' SIZES=120x120 HREF=/t.png>
      <link rel=icon sizes="48x48" href='/i.png' type=image/png></HEAD>`;
    const icons = readHeadIcons(html, "https://acme.example/");
    expect(icons.appleTouch).toEqual([
      {
        url: "https://acme.example/t.png",
        rel: "apple-touch-icon",
        sizes: "120x120",
        type: null,
      },
    ]);
    expect(icons.sizedIcons[0]).toMatchObject({
      url: "https://acme.example/i.png",
      type: "image/png",
    });
  });

  it("falls back to /favicon.ico alone and never lists more than 10", () => {
    expect(
      candidatesFor("synthetic-bare", "https://acme.example/").candidates,
    ).toEqual([
      {
        url: "https://acme.example/favicon.ico",
        rel: "favicon",
        sizes: null,
        type: null,
      },
    ]);
    const many = Array.from({ length: 20 }, (_, i) => ({
      url: `https://acme.example/${i}.png`,
      rel: "manifest",
      sizes: `${i}x${i}`,
      type: null,
    }));
    const icons = {
      jsonLd: many.slice(0, 5).map((icon) => ({ ...icon, rel: "json-ld" })),
      appleTouch: many.slice(5, 10),
      sizedIcons: many.slice(10, 15),
      manifestUrl: null,
    };
    expect(
      iconCandidates(icons, many.slice(15), "https://acme.example/"),
    ).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// The fetcher, over a fake site

type Route = () => PageResponse | Promise<PageResponse>;

const htmlPage =
  (body: string, status = 200, type = "text/html; charset=utf-8"): Route =>
  () =>
    new Response(body, { status, headers: { "content-type": type } });

const redirectTo =
  (location: string, status = 301): Route =>
  () =>
    new Response(null, { status, headers: { location } });

const HOME = `<!doctype html><html><head>
  <title>Acme Robotics | Warehouse robots</title>
  <meta property="og:site_name" content="Acme Robotics">
  <meta property="og:title" content="Acme Robotics">
  <meta name="description" content="Robots for warehouses.">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <style>body { color: red }</style>
  </head><body><script>window.secret = "not text";</script>
  <h1>Warehouse robots</h1>
  <footer>Acme Robotics Ltd. Registered in England and Wales, company number 12345678.</footer>
  </body></html>`;

interface FakeOptions {
  routes: Record<string, Route>;
  robots?: Record<string, { status: number; body?: string }>;
  maxFetches?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

function fakeSite(options: FakeOptions) {
  const calls: { url: string; init: Parameters<PageFetch>[1] }[] = [];
  const robotsRequests: string[] = [];
  let clock = 1_000_000;
  const sleep = vi.fn((ms: number) => {
    clock += ms;
    return Promise.resolve();
  });
  const robotsFetcher: HttpFetcher = {
    get: (url) => {
      robotsRequests.push(url);
      const answer = options.robots?.[new URL(url).origin];
      return Promise.resolve({
        status: answer?.status ?? 404,
        body: answer?.body ?? "",
        etag: null,
        lastModified: null,
      });
    },
  };
  const fetch: PageFetch = (url, init) => {
    calls.push({ url, init });
    const route = options.routes[url];
    return Promise.resolve(
      route ? route() : new Response("not found", { status: 404 }),
    );
  };
  const fetcher = createWebsiteFetcher({
    robots: createRobotsChecker({
      fetcher: robotsFetcher,
      now: () => clock,
      sleep,
    }),
    userAgent: "Raisory/0.1.0 (+https://example.com/contact)",
    maxFetches: options.maxFetches ?? 300,
    fetch,
    now: () => clock,
    sleep,
    timeoutMs: options.timeoutMs,
    maxBodyBytes: options.maxBodyBytes,
  });
  return { fetcher, calls, robotsRequests, sleep };
}

describe("createWebsiteFetcher", () => {
  it("reads the homepage and a same-site manifest into a summary", async () => {
    const { fetcher, calls } = fakeSite({
      routes: {
        "https://acme.example/": htmlPage(HOME),
        "https://acme.example/site.webmanifest": () =>
          new Response(
            JSON.stringify({
              icons: [{ src: "/icon-512.png", sizes: "512x512" }],
            }),
            { headers: { "content-type": "application/manifest+json" } },
          ),
      },
    });

    const page = await fetcher.fetchPage("acme.example");

    expect(page).toMatchObject({
      outcome: "fetched",
      detail: null,
      domain: "acme.example",
      finalDomain: "acme.example",
      redirectedFrom: null,
      title: "Acme Robotics | Warehouse robots",
      siteName: "Acme Robotics",
      ogTitle: "Acme Robotics",
      metaDescription: "Robots for warehouses.",
      companyNumbers: ["12345678"],
      parked: false,
      legalPageChecked: false,
      blocked: false,
    });
    expect(page.text).toBe(
      "Warehouse robots Acme Robotics Ltd. Registered in England and Wales, company number 12345678.",
    );
    expect(page.iconCandidates.map((icon) => icon.url)).toEqual([
      "https://acme.example/apple-touch-icon.png",
      "https://acme.example/icon-512.png",
      "https://acme.example/favicon.ico",
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://acme.example/",
      "https://acme.example/site.webmanifest",
    ]);
    expect(calls[0]?.init).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "Raisory/0.1.0 (+https://example.com/contact)" },
    });
    expect(fetcher.remaining()).toBe(298);
  });

  it("keeps at most 3,000 characters of visible text", async () => {
    const words = "robot ".repeat(1_000);
    const { fetcher } = fakeSite({
      routes: {
        "https://acme.example/": htmlPage(
          `<html><body><p>${words}</p></body></html>`,
        ),
      },
    });
    const page = await fetcher.fetchPage("acme.example");
    expect(page.text).toHaveLength(3_000);
  });

  it("makes no page request when robots.txt disallows it", async () => {
    const { fetcher, calls, robotsRequests } = fakeSite({
      routes: { "https://acme.example/": htmlPage(HOME) },
      robots: {
        "https://acme.example": {
          status: 200,
          body: "User-agent: Raisory\nDisallow: /\n",
        },
      },
    });

    const page = await fetcher.fetchPage("acme.example");

    expect(page).toMatchObject({
      outcome: "robots",
      detail: "robots.txt disallowed",
      blocked: false,
      companyNumbers: [],
    });
    expect(robotsRequests).toEqual(["https://acme.example/robots.txt"]);
    expect(calls).toEqual([]);
  });

  it("treats a refused robots.txt as robots, with no page request", async () => {
    const { fetcher, calls } = fakeSite({
      routes: { "https://acme.example/": htmlPage(HOME) },
      robots: { "https://acme.example": { status: 403 } },
    });
    expect(await fetcher.fetchPage("acme.example")).toMatchObject({
      outcome: "robots",
      detail: "robots.txt unavailable",
    });
    expect(calls).toEqual([]);
  });

  it.each([401, 403, 429])(
    "reports HTTP %i as blocked and does not retry",
    async (status) => {
      const { fetcher, calls } = fakeSite({
        routes: { "https://acme.example/": htmlPage("denied", status) },
      });
      const page = await fetcher.fetchPage("acme.example");
      expect(page).toMatchObject({
        outcome: "blocked",
        blocked: true,
        detail: `HTTP ${status}`,
      });
      expect(calls).toHaveLength(1);
    },
  );

  it("fails other HTTP errors and non-HTML pages", async () => {
    const { fetcher } = fakeSite({
      routes: {
        "https://gone.example/": htmlPage("gone", 410),
        "https://pdf.example/": htmlPage("%PDF-1.7", 200, "application/pdf"),
        "https://plain.example/": htmlPage("just text", 200, ""),
        "https://sniffed.example/": htmlPage(
          "<!DOCTYPE html><title>Sniffed</title>",
          200,
          "",
        ),
      },
    });
    expect(await fetcher.fetchPage("gone.example")).toMatchObject({
      outcome: "failed",
      detail: "HTTP 410",
    });
    expect(await fetcher.fetchPage("pdf.example")).toMatchObject({
      outcome: "not_html",
      detail: "application/pdf",
    });
    expect(await fetcher.fetchPage("plain.example")).toMatchObject({
      outcome: "not_html",
    });
    expect(await fetcher.fetchPage("sniffed.example")).toMatchObject({
      outcome: "fetched",
      title: "Sniffed",
    });
  });

  it("stops reading the body at the 1 MB cap", async () => {
    const chunk = new TextEncoder().encode("a ".repeat(32 * 1024));
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const { fetcher } = fakeSite({
      routes: {
        "https://huge.example/": () =>
          new Response(endless, {
            headers: { "content-type": "text/html" },
          }),
      },
    });

    const page = await fetcher.fetchPage("huge.example");

    expect(page.outcome).toBe("fetched");
    expect(pulled).toBeGreaterThanOrEqual(MAX_BODY_BYTES);
    expect(pulled).toBeLessThanOrEqual(MAX_BODY_BYTES + 3 * chunk.byteLength);
    expect(page.text).toHaveLength(3_000);
  });

  it("parses only what fits in a smaller cap", async () => {
    const { fetcher } = fakeSite({
      maxBodyBytes: 40,
      routes: {
        "https://acme.example/": htmlPage(
          "<html><body>Short start. Company number 12345678</body></html>",
        ),
      },
    });
    const page = await fetcher.fetchPage("acme.example");
    expect(page.text).toBe("Short start. Company number");
    expect(page.companyNumbers).toEqual([]);
  });

  it("gives up after the timeout when the server never answers", async () => {
    let signal: AbortSignal | undefined;
    const slow = createWebsiteFetcher({
      robots: createRobotsChecker({
        fetcher: {
          get: () =>
            Promise.resolve({
              status: 404,
              body: "",
              etag: null,
              lastModified: null,
            }),
        },
      }),
      userAgent: "Raisory/test",
      maxFetches: 10,
      timeoutMs: 20,
      fetch: (_url, init) => {
        signal = init.signal;
        return new Promise<PageResponse>(() => undefined);
      },
    });
    const page = await slow.fetchPage("slow.example");

    expect(page).toMatchObject({
      outcome: "failed",
      detail: "timed out after 20ms",
    });
    expect(signal?.aborted).toBe(true);
  });

  it("gives up after the timeout when the body never ends", async () => {
    const { fetcher } = fakeSite({
      timeoutMs: 20,
      routes: {
        "https://drip.example/": () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("<html>"));
              },
            }),
            { headers: { "content-type": "text/html" } },
          ),
      },
    });
    expect(await fetcher.fetchPage("drip.example")).toMatchObject({
      outcome: "failed",
      detail: "timed out after 20ms",
    });
  });

  it("follows up to 5 redirects and fails on the sixth", async () => {
    const chain = (prefix: string, hops: number): Record<string, Route> => {
      const routes: Record<string, Route> = {};
      for (let i = 0; i < hops; i += 1) {
        const from = i === 0 ? `https://${prefix}/` : `https://${prefix}/${i}`;
        routes[from] = redirectTo(`/${i + 1}`);
      }
      routes[`https://${prefix}/${hops}`] = htmlPage(HOME);
      return routes;
    };
    const { fetcher, calls } = fakeSite({
      routes: { ...chain("five.example", 5), ...chain("six.example", 6) },
    });

    expect((await fetcher.fetchPage("five.example")).outcome).toBe("fetched");
    const before = calls.length;
    expect(await fetcher.fetchPage("six.example")).toMatchObject({
      outcome: "failed",
      detail: "more than 5 redirects",
    });
    // Six hops, then one retry at www (which finds nothing).
    expect(calls.length - before).toBe(7);
  });

  it("follows one redirect to another domain and notes it", async () => {
    const { fetcher } = fakeSite({
      routes: {
        "https://oldname.example/": redirectTo("https://www.newname.example/"),
        "https://www.newname.example/": htmlPage(
          HOME.replace('<link rel="manifest" href="/site.webmanifest">', ""),
        ),
        "https://hop.example/": redirectTo("https://hop-two.example/"),
        "https://hop-two.example/": redirectTo("https://hop-three.example/"),
      },
    });

    expect(await fetcher.fetchPage("oldname.example")).toMatchObject({
      outcome: "fetched",
      domain: "oldname.example",
      finalDomain: "newname.example",
      redirectedFrom: "oldname.example",
    });
    expect(await fetcher.fetchPage("hop.example")).toMatchObject({
      outcome: "failed",
      detail: "redirected to another domain twice",
    });
  });

  it("checks robots.txt on the host a redirect leads to", async () => {
    const { fetcher, calls } = fakeSite({
      routes: {
        "https://acme.example/": redirectTo("https://shop.acme.example/"),
        "https://shop.acme.example/": htmlPage(HOME),
      },
      robots: {
        "https://shop.acme.example": {
          status: 200,
          body: "User-agent: *\nDisallow: /",
        },
      },
    });
    expect((await fetcher.fetchPage("acme.example")).outcome).toBe("robots");
    expect(calls.map((call) => call.url)).toEqual(["https://acme.example/"]);
  });

  it("reads one legal page when the homepage shows no company number", async () => {
    const home = `<html><body><h1>Acme</h1><footer>
      <a href="https://other.example/imprint">Partner imprint</a>
      <a href="/contact">Contact</a>
      <a href="/legal/terms">Terms of use</a>
      <a href="/imprint#top">Imprint</a>
      </footer></body></html>`;
    const { fetcher, calls } = fakeSite({
      routes: {
        "https://acme.example/": htmlPage(home),
        "https://acme.example/imprint": htmlPage(
          "<html><body>Acme Ltd, registered in Scotland, SC123456.</body></html>",
        ),
      },
    });

    const page = await fetcher.fetchPage("acme.example");

    expect(page).toMatchObject({
      legalPageChecked: true,
      companyNumbers: ["SC123456"],
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://acme.example/",
      "https://acme.example/imprint",
    ]);
  });

  it("does not read a legal page when the homepage shows a number", async () => {
    const { fetcher, calls } = fakeSite({
      routes: {
        "https://acme.example/": htmlPage(
          `${HOME.replace('<link rel="manifest" href="/site.webmanifest">', "")}<a href="/privacy">Privacy</a>`,
        ),
      },
    });
    const page = await fetcher.fetchPage("acme.example");
    expect(page.legalPageChecked).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("ignores a manifest on another site", async () => {
    const { fetcher, calls } = fakeSite({
      routes: {
        "https://acme.example/": htmlPage(
          HOME.replace(
            "/site.webmanifest",
            "https://cdn.example/site.webmanifest",
          ),
        ),
      },
    });
    await fetcher.fetchPage("acme.example");
    expect(calls.map((call) => call.url)).toEqual(["https://acme.example/"]);
  });

  it("retries at www when the bare domain fails, and keeps the first failure if www fails too", async () => {
    const { fetcher, calls } = fakeSite({
      routes: {
        "https://split.example/": redirectTo("https://www.split.example/s"),
        "https://www.split.example/": htmlPage(HOME),
      },
    });
    expect(await fetcher.fetchPage("split.example")).toMatchObject({
      outcome: "fetched",
      finalDomain: "split.example",
      redirectedFrom: null,
    });
    expect(calls.map((call) => call.url)).toContain(
      "https://www.split.example/",
    );

    const gone = fakeSite({
      routes: { "https://gone.example/": htmlPage("gone", 410) },
    });
    expect(await gone.fetcher.fetchPage("gone.example")).toMatchObject({
      outcome: "failed",
      detail: "HTTP 410",
    });
  });

  it("flags parked and for-sale pages", async () => {
    const { fetcher } = fakeSite({
      routes: {
        "https://forsale.example/": htmlPage(
          "<html><head><title>forsale.example</title></head><body>This domain is for sale! Make an offer.</body></html>",
        ),
        "https://parked.example/": htmlPage(
          '<html><body><script src="https://www.sedoparking.com/frmpark/parked.js"></script></body></html>',
        ),
        "https://moved.example/": redirectTo(
          "https://sedo.com/search/details/?domain=moved.example",
        ),
        "https://sedo.com/search/details/?domain=moved.example": htmlPage(
          "<html><body>Buy now</body></html>",
        ),
        // GoDaddy's holding page, as nowdoctor.co.uk served it.
        "https://lander.example/": htmlPage(
          '<!DOCTYPE html><html><head><script>window.onload=function(){window.location.href="/lander"}</script></head></html>',
        ),
      },
    });
    expect((await fetcher.fetchPage("lander.example")).parked).toBe(true);
    expect((await fetcher.fetchPage("forsale.example")).parked).toBe(true);
    expect((await fetcher.fetchPage("parked.example")).parked).toBe(true);
    expect(await fetcher.fetchPage("moved.example")).toMatchObject({
      parked: true,
      finalDomain: "sedo.com",
    });
    expect(
      (
        await fakeSite({
          routes: { "https://acme.example/": htmlPage(HOME) },
        }).fetcher.fetchPage("acme.example")
      ).parked,
    ).toBe(false);
  });

  it("waits a second between requests to one host", async () => {
    const { fetcher, sleep } = fakeSite({
      routes: {
        "https://acme.example/": htmlPage("<html><body>Hi</body></html>"),
      },
    });
    await fetcher.fetchPage("acme.example");
    await fetcher.fetchPage("acme.example");
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("counts manifests and legal pages in the run's cap, and stops at it", async () => {
    const { fetcher, calls } = fakeSite({
      maxFetches: 2,
      routes: {
        "https://acme.example/": htmlPage(HOME),
        "https://acme.example/site.webmanifest": () =>
          new Response("{}", {
            headers: { "content-type": "application/json" },
          }),
        "https://second.example/": htmlPage(HOME),
      },
    });

    expect((await fetcher.fetchPage("acme.example")).outcome).toBe("fetched");
    expect(fetcher.remaining()).toBe(0);
    expect(await fetcher.fetchPage("second.example")).toMatchObject({
      outcome: "cap",
      detail: "page limit reached",
    });
    expect(calls).toHaveLength(2);
  });

  it("rejects a value that is not a web domain without a request", async () => {
    const { fetcher, calls } = fakeSite({ routes: {} });
    expect(await fetcher.fetchPage("N/A")).toMatchObject({
      outcome: "failed",
      detail: "not a web domain",
    });
    expect(calls).toEqual([]);
    expect(fetcher.remaining()).toBe(300);
  });
});
