import { beforeAll, describe, expect, it } from "vitest";
import { findCompanyNumbers } from "@/pipeline/websites/fetch-page";
import {
  loadWebsiteCases,
  runWebsiteEval,
  withLiveAnswers,
  type WebsiteEvalResult,
} from "./websites";

// The gate (D64): no wrong automatic link. Never relabel a
// case to pass: change a rule, and say why in fixtures/websites/README.md.
describe("website eval", () => {
  let result: WebsiteEvalResult;

  beforeAll(async () => {
    result = await runWebsiteEval();
  }, 120_000);

  it("makes no wrong automatic link", () => {
    expect(result.wrong.map((r) => r.id)).toEqual([]);
    expect(result.score.precision).toBe(1);
  });

  it("asks the LLM only where the rules need it, with every answer recorded", () => {
    expect(result.llmCalls).toBeGreaterThan(0);
    expect(result.llmCalls).toBeLessThan(result.score.cases);
    expect(result.liveAnswers.size).toBe(0);
  });

  it("keeps a manual rejection rejected", () => {
    const manual = result.results.filter((r) =>
      r.tags.includes("manual-rejection"),
    );
    expect(manual.length).toBeGreaterThan(0);
    for (const r of manual) {
      expect(r).toMatchObject({ predicted: "rejected", rule: "manual" });
    }
  });

  it("sends an over-budget LLM check to review", () => {
    const refused = result.results.filter((r) =>
      r.tags.includes("over-budget"),
    );
    expect(refused.length).toBeGreaterThan(0);
    for (const r of refused) {
      expect(r).toMatchObject({ predicted: "candidate", rule: "C1" });
    }
  });
});

describe("website cases", () => {
  const cases = loadWebsiteCases();

  it("covers the hard cases the task asks for", () => {
    const tags = new Set(cases.flatMap((c) => c.tags));
    for (const tag of [
      "true-site",
      "namesake-abroad",
      "namesake-sector",
      "short-name",
      "generic-name",
      "placeholder-name",
      "news-host",
      "investor-domain",
      "accelerator-host",
      "link-in-bio",
      "app-store",
      "parked",
      "held-by-other",
      "redirect",
      "rebrand",
      "other-legal-entity",
      "reseller-footer",
      "over-budget",
      "manual-rejection",
      "company-number",
      "not-read",
    ]) {
      expect(tags, tag).toContain(tag);
    }
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(
      cases.filter((c) => c.pageFrom === "fetched").length,
    ).toBeGreaterThanOrEqual(20);
  });

  it("stores the company numbers that the footer text shows", () => {
    for (const c of cases) {
      expect(findCompanyNumbers(c.page.text), c.id).toEqual(
        c.page.companyNumbers,
      );
    }
  });

  it("keeps fixtures short: no long text, no email addresses or phone numbers", () => {
    for (const c of cases) {
      const text = JSON.stringify(c.page);
      expect(c.page.text.length, c.id).toBeLessThanOrEqual(300);
      expect(text, c.id).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text, c.id).not.toMatch(/\b0\d{3}\s?\d{3}\s?\d{4}\b/);
    }
  });

  // A hand-written page must not pass for a real site's content: it uses a
  // reserved .example domain, unless the host itself is what the case tests.
  it("uses reserved .example domains for hand-written pages, except listed hosts", () => {
    for (const c of cases.filter((c) => c.pageFrom === "hand-written")) {
      const domains = [c.page.domain, c.page.finalDomain ?? c.page.domain];
      const allowed = (d: string) =>
        d.endsWith(".example") ||
        [
          "sifted.eu",
          "ycombinator.com",
          "linktr.ee",
          "apple.com",
          "crunchbase.com",
          "linkedin.com",
          "asynchronics.notion.site",
          "sedo.com",
          "ranketta.com",
        ].includes(d);
      for (const domain of domains)
        expect(allowed(domain), `${c.id} ${domain}`).toBe(true);
    }
  });
});

describe("withLiveAnswers", () => {
  it("writes answers into the matching cases only", () => {
    const text = JSON.stringify({
      version: 1,
      cases: [
        { id: "a", llm: { answer: "same", recorded: "hand-written stand-in" } },
        { id: "b", llm: null },
      ],
    });
    const out = JSON.parse(
      withLiveAnswers(text, new Map([["a", "unsure"]]), "model 2026-11-24"),
    ) as { cases: Array<{ id: string; llm: unknown }> };
    expect(out.cases).toEqual([
      { id: "a", llm: { answer: "unsure", recorded: "model 2026-11-24" } },
      { id: "b", llm: null },
    ]);
  });
});
