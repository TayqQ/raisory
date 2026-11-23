import { describe, expect, it } from "vitest";
import type { ExtractedEventV1, ExtractionV1 } from "@/core/extraction-schema";
import { betterExtraction, placeholderCompanyCount } from "./retry";

function launch(name: string): ExtractedEventV1 {
  return {
    type: "launch",
    company: {
      name,
      websiteDomain: null,
      description: null,
      countryCode: null,
      city: null,
      foundedYear: null,
      tags: [],
    },
    announcedOn: null,
    funding: null,
    acquisition: null,
    launch: { kind: "product", productName: null, url: null },
  };
}

function result(...names: string[]): { result: ExtractionV1 } {
  return {
    result: { isRelevant: names.length > 0, events: names.map(launch) },
  };
}

describe("placeholderCompanyCount", () => {
  it("counts placeholder names and ignores blank names and irrelevant results", () => {
    expect(placeholderCompanyCount(result("startup", "Acorda").result)).toBe(1);
    expect(placeholderCompanyCount(result("", "Acorda").result)).toBe(0);
    expect(
      placeholderCompanyCount({
        isRelevant: false,
        events: [launch("startup")],
      }),
    ).toBe(0);
  });
});

describe("betterExtraction", () => {
  it("keeps the result with fewer placeholder names, and the retry on a tie", () => {
    const first = result("startup");
    const named = result("Acorda");
    expect(betterExtraction(first, named)).toBe(named);
    expect(betterExtraction(named, result("startup"))).toBe(named);
    const retry = result("the company");
    expect(betterExtraction(first, retry)).toBe(retry);
  });
});
