import { describe, expect, it, vi } from "vitest";
import type { RobotsChecker } from "@/lib/robots";
import type { PageFetch, PageResponse } from "./fetch-page";
import { createLogoFetcher, withHostSpacing } from "./logo-fetch";
import { pngBytes } from "./logo-testing";

const DOMAIN = "acme.example";
const UA = "Raisory/test (+https://raisory.example/about)";

function stream(bytes: Uint8Array, chunk = 1024): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(at, at + chunk));
      at += chunk;
    },
  });
}

function response(
  status: number,
  body: Uint8Array | null = null,
  headers: Record<string, string> = {},
): PageResponse {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: body ? stream(body) : null,
  };
}

function fakeFetch(routes: Record<string, () => PageResponse>) {
  return vi.fn<PageFetch>((url) => {
    const route = routes[url];
    if (!route) return Promise.reject(new Error(`unexpected request ${url}`));
    return Promise.resolve(route());
  });
}

function robots(disallowed: readonly string[] = []): RobotsChecker {
  const decide = (url: string) =>
    Promise.resolve(
      disallowed.some((prefix) => url.startsWith(prefix))
        ? ({ allowed: false, reason: "disallowed" } as const)
        : ({ allowed: true, crawlDelayMs: null } as const),
    );
  return { check: decide, beforeFetch: decide };
}

function fetcher(
  fetch: PageFetch,
  options: {
    maxBytes?: number;
    robots?: RobotsChecker;
    maxFetches?: number;
  } = {},
) {
  return createLogoFetcher({
    robots: options.robots ?? robots(),
    userAgent: UA,
    maxBytes: options.maxBytes ?? 65_536,
    maxFetches: options.maxFetches ?? 50,
    fetch,
  });
}

describe("createLogoFetcher", () => {
  it("downloads a file with the project's user agent", async () => {
    const png = pngBytes(64, 64);
    const fetch = fakeFetch({
      "https://acme.example/apple.png": () => response(200, png),
    });
    const result = await fetcher(fetch).fetchLogo(
      "https://acme.example/apple.png",
      DOMAIN,
    );
    expect(result).toEqual({
      outcome: "fetched",
      url: "https://acme.example/apple.png",
      bytes: png,
    });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers["user-agent"]).toBe(UA);
    expect(init?.redirect).toBe("manual");
  });

  it("refuses a file over the cap, declared or streamed", async () => {
    const big = new Uint8Array(70_000).fill(7);
    const fetch = fakeFetch({
      "https://acme.example/streamed.png": () => response(200, big),
      "https://acme.example/declared.png": () =>
        response(200, big, { "content-length": "70000" }),
      "https://acme.example/exact.png": () =>
        response(200, new Uint8Array(1000)),
    });
    const logos = fetcher(fetch, { maxBytes: 1000 });
    for (const name of ["streamed", "declared"]) {
      expect(
        await logos.fetchLogo(`https://acme.example/${name}.png`, DOMAIN),
      ).toMatchObject({ outcome: "too_large" });
    }
    expect(
      await logos.fetchLogo("https://acme.example/exact.png", DOMAIN),
    ).toMatchObject({ outcome: "fetched" });
  });

  it("makes no request when robots.txt disallows the URL", async () => {
    const fetch = fakeFetch({});
    const result = await fetcher(fetch, {
      robots: robots(["https://acme.example/private/"]),
    }).fetchLogo("https://acme.example/private/logo.png", DOMAIN);
    expect(result).toMatchObject({ outcome: "robots" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks robots.txt again after a redirect", async () => {
    const fetch = fakeFetch({
      "https://acme.example/logo.png": () =>
        response(302, null, { location: "/private/logo.png" }),
    });
    const result = await fetcher(fetch, {
      robots: robots(["https://acme.example/private/"]),
    }).fetchLogo("https://acme.example/logo.png", DOMAIN);
    expect(result).toMatchObject({ outcome: "robots" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect only to a permitted host", async () => {
    const png = pngBytes(64, 64);
    const fetch = fakeFetch({
      "https://acme.example/a.png": () =>
        response(301, null, { location: "https://tracker.example/a.png" }),
      "https://acme.example/b.png": () =>
        response(302, null, { location: "https://static.acme.example/b.png" }),
      "https://static.acme.example/b.png": () =>
        response(302, null, {
          location: "https://res.cloudinary.com/acme/b.png",
        }),
      "https://res.cloudinary.com/acme/b.png": () => response(200, png),
    });
    const logos = fetcher(fetch);
    expect(
      await logos.fetchLogo("https://acme.example/a.png", DOMAIN),
    ).toMatchObject({
      outcome: "not_permitted",
      url: "https://tracker.example/a.png",
    });
    expect(fetch).not.toHaveBeenCalledWith(
      "https://tracker.example/a.png",
      expect.anything(),
    );
    expect(
      await logos.fetchLogo("https://acme.example/b.png", DOMAIN),
    ).toMatchObject({
      outcome: "fetched",
      url: "https://res.cloudinary.com/acme/b.png",
    });
  });

  it("follows at most 3 redirects", async () => {
    const hop = (n: number) => () =>
      response(302, null, { location: `/hop-${n + 1}.png` });
    const fetch = fakeFetch({
      "https://acme.example/hop-0.png": hop(0),
      "https://acme.example/hop-1.png": hop(1),
      "https://acme.example/hop-2.png": hop(2),
      "https://acme.example/hop-3.png": hop(3),
    });
    expect(
      await fetcher(fetch).fetchLogo("https://acme.example/hop-0.png", DOMAIN),
    ).toMatchObject({ outcome: "failed", detail: "more than 3 redirects" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("reports a block and other errors, and stops at the request limit", async () => {
    const fetch = fakeFetch({
      "https://acme.example/403.png": () => response(403),
      "https://acme.example/404.png": () => response(404),
    });
    const logos = fetcher(fetch, { maxFetches: 2 });
    expect(
      await logos.fetchLogo("https://acme.example/403.png", DOMAIN),
    ).toMatchObject({ outcome: "blocked" });
    expect(
      await logos.fetchLogo("https://acme.example/404.png", DOMAIN),
    ).toMatchObject({ outcome: "failed", detail: "HTTP 404" });
    expect(
      await logos.fetchLogo("https://acme.example/404.png", DOMAIN),
    ).toMatchObject({ outcome: "cap" });
    expect(logos.remaining()).toBe(0);
  });
});

describe("withHostSpacing", () => {
  it("keeps requests to one host a second apart", async () => {
    let clock = 0;
    const sleep = vi.fn((ms: number) => {
      clock += ms;
      return Promise.resolve();
    });
    const spaced = withHostSpacing(robots(), { now: () => clock, sleep });
    await spaced.beforeFetch("https://acme.example/");
    clock += 200;
    await spaced.beforeFetch("https://acme.example/logo.png");
    await spaced.beforeFetch("https://other.example/");
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(800);
  });

  it("does not wait for a URL robots.txt refuses", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const spaced = withHostSpacing(robots(["https://acme.example/x"]), {
      now: () => 0,
      sleep,
    });
    await spaced.beforeFetch("https://acme.example/");
    expect(await spaced.beforeFetch("https://acme.example/x")).toEqual({
      allowed: false,
      reason: "disallowed",
    });
    expect(sleep).not.toHaveBeenCalled();
  });
});
