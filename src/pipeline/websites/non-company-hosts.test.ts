import { describe, expect, it } from "vitest";
import {
  isNonCompanyHost,
  NON_COMPANY_HOSTS,
  nonCompanyHostKind,
} from "./non-company-hosts";

describe("nonCompanyHostKind", () => {
  it("lists the hosts D64 names", () => {
    const listed = Object.values(NON_COMPANY_HOSTS).flat();
    for (const host of [
      "linkedin.com",
      "x.com",
      "twitter.com",
      "facebook.com",
      "instagram.com",
      "youtube.com",
      "crunchbase.com",
      "pitchbook.com",
      "dealroom.co",
      "tracxn.com",
      "wikipedia.org",
      "techcrunch.com",
      "sifted.eu",
      "tech.eu",
      "uktech.news",
      "eu-startups.com",
      "businesscloud.co.uk",
      "siliconrepublic.com",
      "therecursive.com",
      "techfundingnews.com",
      "gov.uk",
      "find-and-update.company-information.service.gov.uk",
      "ukri.org",
      "medium.com",
      "substack.com",
      "github.com",
      "apps.apple.com",
      "play.google.com",
      "linktr.ee",
      "notion.site",
    ]) {
      expect(listed, host).toContain(host);
    }
  });

  it.each([
    ["sifted.eu", "news"],
    ["https://www.linkedin.com/company/acme", "social"],
    ["uk.linkedin.com", "social"],
    ["en.wikipedia.org", "data"],
    ["acme.substack.com", "publishing"],
    ["acme.notion.site", "publishing"],
    ["find-and-update.company-information.service.gov.uk", "government"],
    ["acme.gov.uk", "government"],
    ["linktr.ee", "link_in_bio"],
    ["ycombinator.com", "accelerator"],
    ["google.com", "search"],
  ] as const)("%s is a %s host", (host, kind) => {
    expect(nonCompanyHostKind(host)).toBe(kind);
  });

  it("matches app store hosts by their registrable domain", () => {
    expect(nonCompanyHostKind("apple.com")).toBe("app_store");
    expect(nonCompanyHostKind("https://apps.apple.com/app/id1")).toBe(
      "app_store",
    );
    expect(nonCompanyHostKind("play.google.com")).toBe("app_store");
  });

  it("leaves company sites alone, including look-alikes", () => {
    for (const host of [
      "acme.com",
      "acme.co.uk",
      "notlinkedin.com",
      "linkedin.com.acme.example",
      "acme.github.io",
      "techeu.example",
    ]) {
      expect(isNonCompanyHost(host), host).toBe(false);
    }
  });

  it("returns null for something that is not a host", () => {
    expect(nonCompanyHostKind("N/A")).toBeNull();
    expect(nonCompanyHostKind("")).toBeNull();
  });
});
