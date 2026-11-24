import { describe, expect, it } from "vitest";
import type { WebsiteIconCandidate } from "@/db/schema";
import { isPermittedLogoUrl, pickLogoCandidates } from "./logo-pick";

function icon(
  url: string,
  rel: string,
  overrides: Partial<WebsiteIconCandidate> = {},
): WebsiteIconCandidate {
  return { url, rel, sizes: null, type: null, ...overrides };
}

describe("pickLogoCandidates", () => {
  it("keeps the stored order by kind and at most three", () => {
    const picked = pickLogoCandidates(
      [
        icon("https://acme.example/favicon.ico", "favicon"),
        icon("https://acme.example/icon-192.png", "icon", { sizes: "192x192" }),
        icon("https://acme.example/m-512.png", "manifest"),
        icon("https://acme.example/apple.png", "apple-touch-icon"),
        icon("https://acme.example/logo.png", "json-ld"),
      ],
      "acme.example",
    );
    expect(picked.map((c) => c.rel)).toEqual([
      "json-ld",
      "apple-touch-icon",
      "manifest",
    ]);
  });

  it("drops SVG, data URLs and other sites", () => {
    const picked = pickLogoCandidates(
      [
        icon("https://acme.example/logo.svg", "json-ld"),
        icon("https://acme.example/logo", "apple-touch-icon", {
          type: "image/svg+xml",
        }),
        icon("data:image/png;base64,iVBORw0KGgo=", "icon"),
        icon("https://other.example/logo.png", "icon"),
        icon("javascript:alert(1)", "icon"),
        icon("https://acme.example/favicon.ico", "favicon"),
      ],
      "acme.example",
    );
    expect(picked.map((c) => c.url)).toEqual([
      "https://acme.example/favicon.ico",
    ]);
  });

  it("keeps a subdomain of the company's site and a CDN host the page linked", () => {
    const picked = pickLogoCandidates(
      [
        icon("https://static.acme.co.uk/logo.png", "json-ld"),
        icon("https://cdn.prod.website-files.com/abc/icon.png", "icon"),
      ],
      "acme.co.uk",
    );
    expect(picked).toHaveLength(2);
  });

  it("removes duplicates", () => {
    const url = "https://acme.example/apple.png";
    expect(
      pickLogoCandidates(
        [icon(url, "apple-touch-icon"), icon(url, "icon")],
        "acme.example",
      ),
    ).toHaveLength(1);
  });
});

describe("isPermittedLogoUrl", () => {
  it("allows the company's site and CDN hosts only", () => {
    expect(
      isPermittedLogoUrl("https://www.acme.example/a.png", "acme.example"),
    ).toBe(true);
    expect(
      isPermittedLogoUrl("https://res.cloudinary.com/a.png", "acme.example"),
    ).toBe(true);
    expect(
      isPermittedLogoUrl(
        "https://acme.example.evil.example/a.png",
        "acme.example",
      ),
    ).toBe(false);
    expect(isPermittedLogoUrl("ftp://acme.example/a.png", "acme.example")).toBe(
      false,
    );
    expect(isPermittedLogoUrl("https://127.0.0.1/a.png", "acme.example")).toBe(
      false,
    );
  });
});
