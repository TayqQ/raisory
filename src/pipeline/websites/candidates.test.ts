import { describe, expect, it } from "vitest";
import {
  guessDomains,
  nameAsDomain,
  nameSlug,
  websiteCandidates,
  type CandidateInput,
} from "./candidates";

const news = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
  name: "Acme Robotics Ltd",
  countryCode: "GB",
  hasNews: true,
  articleDomains: [],
  ukriWebsites: [],
  ...overrides,
});

describe("websiteCandidates", () => {
  it("lists sources in order with the source on each, one row per registrable domain", () => {
    expect(
      websiteCandidates(
        news({
          articleDomains: ["https://www.acme-robots.example.com/news", null],
          ukriWebsites: ["acme-robots.example.com", "", "acmerobotics.co.uk"],
        }),
      ),
    ).toEqual([
      { domain: "example.com", source: "article" },
      { domain: "acmerobotics.co.uk", source: "ukri" },
      { domain: "acmerobotics.com", source: "guess" },
      { domain: "acmerobotics.io", source: "guess" },
      { domain: "acmerobotics.ai", source: "guess" },
      { domain: "acmerobotics.co", source: "guess" },
      { domain: "acmerobotics.uk", source: "guess" },
    ]);
  });

  it("tries a name written as a domain before the guesses", () => {
    const candidates = websiteCandidates(
      news({ name: "fal.ai", countryCode: "US" }),
    );
    expect(candidates.slice(0, 2)).toEqual([
      { domain: "fal.ai", source: "name" },
      { domain: "fal.com", source: "guess" },
    ]);
    expect(candidates.map((c) => c.domain)).toEqual([
      "fal.ai",
      "fal.com",
      "fal.io",
      "fal.co",
      "fal.co.uk",
      "fal.us",
    ]);
  });

  it("gives a grant-only company its UKRI website and nothing else", () => {
    expect(
      websiteCandidates(
        news({
          hasNews: false,
          articleDomains: ["acme.example"],
          ukriWebsites: ["www.acmerobotics.co.uk", null],
        }),
      ),
    ).toEqual([{ domain: "acmerobotics.co.uk", source: "ukri" }]);
  });

  it("drops values that are not web addresses", () => {
    expect(
      websiteCandidates(
        news({
          name: "Stealth startup",
          articleDomains: ["N/A", "info@acme.example"],
          ukriWebsites: ["localhost"],
        }),
      ),
    ).toEqual([]);
  });
});

describe("guessDomains", () => {
  it("makes at most 6 guesses, ending with the country's own label", () => {
    expect(guessDomains("Café Robotique SAS", "FR")).toEqual([
      "caferobotique.com",
      "caferobotique.io",
      "caferobotique.ai",
      "caferobotique.co",
      "caferobotique.co.uk",
      "caferobotique.fr",
    ]);
  });

  it("does not repeat a country label already tried, and needs a country", () => {
    expect(guessDomains("Acme Robotics", "CO")).toHaveLength(5);
    expect(guessDomains("Acme Robotics", null)).toHaveLength(5);
  });

  it("makes no guess for short, placeholder or non-ASCII names", () => {
    expect(guessDomains("Ab", "GB")).toEqual([]);
    expect(guessDomains("a London fintech startup", "GB")).toEqual([]);
    expect(nameSlug("東京ロボット")).toBeNull();
  });
});

describe("nameAsDomain", () => {
  it.each([
    ["bit.bio", "bit.bio"],
    ["Fal.ai", "fal.ai"],
    ["app.acme.io", "acme.io"],
    ["Node.js", null],
    ["Acme Robotics", null],
    ["J.P. Ventures", null],
    ["acme.notatld", null],
  ])("reads %s as %s", (name, expected) => {
    expect(nameAsDomain(name)).toBe(expected);
  });
});
