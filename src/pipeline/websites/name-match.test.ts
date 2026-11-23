import { describe, expect, it } from "vitest";
import { isWeakName, titleParts, websiteNameMatch } from "./name-match";

describe("titleParts", () => {
  it.each([
    ["Acme | Home", ["Acme | Home", "Acme", "Home"]],
    ["Home - Acme", ["Home - Acme", "Home", "Acme"]],
    ["Acme – Robots", ["Acme – Robots", "Acme", "Robots"]],
    [
      "Acme: robots for all",
      ["Acme: robots for all", "Acme", "robots for all"],
    ],
    ["Acme · Home", ["Acme · Home", "Acme", "Home"]],
    ["Home \\ Acme", ["Home \\ Acme", "Home", "Acme"]],
    ["Govern AI — Acme", ["Govern AI — Acme", "Govern AI", "Acme"]],
  ])("splits %s", (title, parts) => {
    expect(titleParts(title)).toEqual(parts);
  });

  it("keeps hyphenated and colon names whole", () => {
    expect(titleParts("Optimise-AI | Home")).toContain("Optimise-AI");
    expect(titleParts("21:12 Communications")).toEqual([
      "21:12 Communications",
    ]);
  });
});

describe("isWeakName", () => {
  it.each([
    ["BCD", true],
    ["XYZ Ltd", true],
    ["Fintech", true],
    ["Robotics", true],
    ["a London startup", true],
    ["startup", true],
    ["LATO", false],
    ["Agon", false],
    ["fal.ai", false],
    ["Brightwell Robotics", false],
  ])("%s is weak: %s", (name, weak) => {
    expect(isWeakName(name)).toBe(weak);
  });
});

describe("websiteNameMatch", () => {
  it("matches og:site_name after normalisation", () => {
    expect(
      websiteNameMatch(["Brightwell Robotics Ltd"], {
        siteName: "Brightwell Robotics",
        title: "Welcome",
      }),
    ).toEqual({
      matched: true,
      field: "site_name",
      name: "Brightwell Robotics Ltd",
      pageName: "Brightwell Robotics",
      weak: false,
    });
  });

  it("matches a title part, ignoring case, spaces and '&'", () => {
    const match = websiteNameMatch(["Bread & Butter"], {
      siteName: null,
      title: "Home | BREAD AND BUTTER",
    });
    expect(match).toMatchObject({ matched: true, field: "title" });
    expect(
      websiteNameMatch(["AcmeBio"], {
        siteName: null,
        title: "Acme Bio - Home",
      }).matched,
    ).toBe(true);
  });

  it("does not match a title that only contains the name", () => {
    expect(
      websiteNameMatch(["Acme"], { siteName: null, title: "Welcome to Acme" })
        .matched,
    ).toBe(false);
    expect(
      websiteNameMatch(["Disseqt AI"], {
        siteName: null,
        title: "AI Assurance Platform | Disseqt",
      }).matched,
    ).toBe(false);
  });

  it("matches an alias", () => {
    expect(
      websiteNameMatch(["Brightwell Robotics", "Brightwell"], {
        siteName: "Brightwell",
        title: null,
      }),
    ).toMatchObject({ matched: true, name: "Brightwell", weak: false });
  });

  it("prefers a strong name over a weak alias", () => {
    expect(
      websiteNameMatch(["BCD Studio Ltd", "BCD"], {
        siteName: "BCD",
        title: "BCD Studio | Design",
      }),
    ).toMatchObject({ name: "BCD Studio Ltd", field: "title", weak: false });
  });

  it("flags a match on a weak alias only", () => {
    expect(
      websiteNameMatch(["BCD Studio Ltd", "BCD"], {
        siteName: "BCD",
        title: null,
      }),
    ).toMatchObject({ matched: true, name: "BCD", weak: true });
  });

  it("returns no match for an empty page", () => {
    expect(
      websiteNameMatch(["Acme"], { siteName: null, title: null }).matched,
    ).toBe(false);
  });
});
