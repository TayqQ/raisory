import { describe, expect, it } from "vitest";
import {
  clip,
  decideWebsite,
  MAX_EVIDENCE_CHARS,
  needsLlmCheck,
  type WebsiteCompany,
  type WebsitePage,
  type WebsiteRuleInput,
} from "./rules";

const company: WebsiteCompany = {
  name: "Brightwell Robotics",
  aliases: [],
  linkedCompanyNumber: null,
  description: "Leeds startup building warehouse robots.",
  firstTag: "robotics",
  countryCode: "GB",
  city: "Leeds",
};

const page: WebsitePage = {
  outcome: "fetched",
  detail: null,
  domain: "brightwell.example",
  finalDomain: "brightwell.example",
  redirectedFrom: null,
  title: "Brightwell Robotics | Warehouse robots",
  siteName: null,
  ogTitle: null,
  metaDescription: "Robots that pick and pack.",
  text: "© 2026 Brightwell Robotics Ltd",
  companyNumbers: [],
  parked: false,
};

function input(
  overrides: {
    company?: Partial<WebsiteCompany>;
    page?: Partial<WebsitePage>;
    source?: WebsiteRuleInput["source"];
    holder?: WebsiteRuleInput["holder"];
  } = {},
): WebsiteRuleInput {
  return {
    company: { ...company, ...overrides.company },
    page: { ...page, ...overrides.page },
    source: overrides.source ?? "guess",
    holder: overrides.holder ?? null,
  };
}

describe("X1: never a company website, not read, or parked", () => {
  it("rejects a news host before anything else", () => {
    const decision = decideWebsite(
      input({ page: { domain: "sifted.eu", finalDomain: "sifted.eu" } }),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      rule: "X1",
      judged: true,
    });
    expect(decision.evidence).toContain("news host");
  });

  it("rejects a guess that redirects to a link-in-bio host", () => {
    const decision = decideWebsite(
      input({
        page: {
          finalDomain: "linktr.ee",
          redirectedFrom: "brightwell.example",
        },
      }),
    );
    expect(decision).toMatchObject({ domain: "linktr.ee", rule: "X1" });
    expect(decision.evidence).toContain("redirected from brightwell.example");
  });

  it("rejects an investor's website", () => {
    const decision = decideWebsite(
      input({
        source: "article",
        holder: { kind: "investor", id: 7, name: "Harbour Lane Ventures" },
      }),
    );
    expect(decision).toMatchObject({ status: "rejected", rule: "X1" });
    expect(decision.evidence).toContain("investor");
  });

  it.each([
    ["robots", "robots.txt"],
    ["blocked", "blocked"],
    ["failed", "fetch failed"],
    ["not_html", "not HTML"],
    ["cap", "page limit"],
  ] as const)(
    "rejects a page that was not read (%s) without a judgement",
    (outcome, text) => {
      const decision = decideWebsite(
        input({ page: { outcome, detail: "HTTP 403" } }),
      );
      expect(decision).toMatchObject({
        status: "rejected",
        rule: "X1",
        judged: false,
      });
      expect(decision.evidence).toContain(text);
    },
  );

  it.each(["article", "ukri"] as const)(
    "sends an unread page on a %s domain to review (C2), but not one left by the page limit",
    (source) => {
      const blocked = decideWebsite(
        input({ source, page: { outcome: "blocked", detail: "HTTP 403" } }),
      );
      expect(blocked).toMatchObject({
        status: "candidate",
        rule: "C2",
        judged: false,
      });
      expect(blocked.evidence).toContain("a person checks");
      expect(
        decideWebsite(input({ source, page: { outcome: "cap" } })),
      ).toMatchObject({ status: "rejected", rule: "X1", judged: false });
    },
  );

  it("rejects a parked page even on a stated domain", () => {
    expect(
      decideWebsite(input({ source: "article", page: { parked: true } })),
    ).toMatchObject({ status: "rejected", rule: "X1" });
  });

  it("rejects a parked page", () => {
    expect(decideWebsite(input({ page: { parked: true } }))).toMatchObject({
      status: "rejected",
      rule: "X1",
      judged: true,
      evidence: "parked or for-sale page",
    });
  });

  it("comes before the company's own number (precedence)", () => {
    const decision = decideWebsite(
      input({
        company: { linkedCompanyNumber: "09876543" },
        page: { parked: true, companyNumbers: ["09876543"] },
      }),
    );
    expect(decision.rule).toBe("X1");
  });
});

describe("X2: another company's number", () => {
  it("rejects a page that shows only numbers other than the company's", () => {
    const decision = decideWebsite(
      input({
        company: { linkedCompanyNumber: "9876543" },
        page: { companyNumbers: ["07654321"] },
      }),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      rule: "X2",
      companyNumberSeen: "07654321",
    });
    expect(decision.evidence).toContain("09876543");
  });

  it("does not apply when the company has no Companies House link", () => {
    const decision = decideWebsite(
      input({ source: "article", page: { companyNumbers: ["07654321"] } }),
    );
    expect(decision).toMatchObject({
      rule: "W2",
      companyNumberSeen: "07654321",
    });
  });

  it("comes before a stated source with a name match (precedence)", () => {
    const decision = decideWebsite(
      input({
        source: "ukri",
        company: { linkedCompanyNumber: "09876543" },
        page: { companyNumbers: ["07654321"] },
      }),
    );
    expect(decision.rule).toBe("X2");
  });

  it("comes before a domain another company holds (precedence)", () => {
    const decision = decideWebsite(
      input({
        company: { linkedCompanyNumber: "09876543" },
        page: { companyNumbers: ["07654321"] },
        holder: { kind: "company", id: 3, name: "Brightwell" },
      }),
    );
    expect(decision.rule).toBe("X2");
  });
});

describe("X3: held by another company", () => {
  it("sends the domain to review", () => {
    const decision = decideWebsite(
      input({
        source: "article",
        holder: { kind: "company", id: 12, name: "Brightwell" },
      }),
    );
    expect(decision).toMatchObject({ status: "candidate", rule: "X3" });
    expect(decision.evidence).toBe('domain held by "Brightwell" (company 12)');
  });

  it("comes before the company's own number (precedence)", () => {
    const decision = decideWebsite(
      input({
        company: { linkedCompanyNumber: "09876543" },
        page: { companyNumbers: ["09876543"] },
        holder: { kind: "company", id: 12, name: "Brightwell" },
      }),
    );
    expect(decision.rule).toBe("X3");
  });
});

describe("W1: the company's own number", () => {
  it("links when the page shows the linked number, with no name match", () => {
    const decision = decideWebsite(
      input({
        company: { linkedCompanyNumber: "SC123456" },
        page: { title: "Home", companyNumbers: ["sc123456"] },
      }),
    );
    expect(decision).toMatchObject({
      status: "linked",
      rule: "W1",
      companyNumberSeen: "SC123456",
    });
  });

  it("links when the page shows its own number among others", () => {
    const decision = decideWebsite(
      input({
        company: { linkedCompanyNumber: "09876543" },
        page: { companyNumbers: ["07654321", "09876543"] },
      }),
    );
    expect(decision.rule).toBe("W1");
  });

  it("comes before the LLM check (precedence)", () => {
    const linked = input({
      company: { linkedCompanyNumber: "09876543" },
      page: { companyNumbers: ["09876543"] },
    });
    expect(needsLlmCheck(linked)).toBe(false);
    expect(decideWebsite(linked, "different").rule).toBe("W1");
  });
});

describe("W2: a stated domain with the name", () => {
  it.each(["article", "ukri"] as const)("links a %s domain", (source) => {
    const decision = decideWebsite(input({ source }));
    expect(decision).toMatchObject({ status: "linked", rule: "W2" });
    expect(needsLlmCheck(input({ source }))).toBe(false);
  });

  it("links a short name, which only W1 or W2 may do", () => {
    const decision = decideWebsite(
      input({
        source: "article",
        company: { name: "BCD Studio Ltd", aliases: ["BCD"] },
        page: { title: "BCD", siteName: null },
      }),
    );
    expect(decision.rule).toBe("W2");
  });

  it("does not apply after a redirect to another site", () => {
    const redirected = input({
      source: "article",
      page: {
        finalDomain: "brightwellhq.example",
        redirectedFrom: "brightwell.example",
      },
    });
    expect(needsLlmCheck(redirected)).toBe(true);
    expect(decideWebsite(redirected, "same")).toMatchObject({
      domain: "brightwellhq.example",
      rule: "W3",
    });
  });

  it("does not apply to a guess", () => {
    expect(needsLlmCheck(input({ source: "guess" }))).toBe(true);
    expect(needsLlmCheck(input({ source: "name" }))).toBe(true);
  });
});

describe("W3 and C1: the LLM check", () => {
  it("links when the LLM says same", () => {
    const decision = decideWebsite(input(), "same");
    expect(decision).toMatchObject({ status: "linked", rule: "W3" });
    expect(decision.evidence).toContain("LLM check says same company");
  });

  it.each([
    ["unsure", "unsure"],
    ["over_budget", "over budget"],
    ["invalid", "no valid answer"],
    [null, "not run"],
  ] as const)("sends %s to review (C1)", (answer, text) => {
    const decision = decideWebsite(input(), answer);
    expect(decision).toMatchObject({ status: "candidate", rule: "C1" });
    expect(decision.evidence).toContain(text);
  });

  it("rejects a guess when the LLM says different", () => {
    expect(decideWebsite(input(), "different")).toMatchObject({
      status: "rejected",
      rule: "none",
    });
  });

  it("rejects a redirected article domain when the LLM says different", () => {
    const decision = decideWebsite(
      input({
        source: "article",
        page: {
          finalDomain: "other.example",
          redirectedFrom: "brightwell.example",
        },
      }),
      "different",
    );
    expect(decision).toMatchObject({ status: "rejected", rule: "none" });
  });

  it("is never asked for a short or placeholder name", () => {
    for (const names of [
      { name: "BCD Studio Ltd", aliases: ["BCD"], title: "BCD" },
      { name: "Genesis AI", aliases: ["Robotics"], title: "Robotics" },
    ]) {
      const weak = input({
        company: { name: names.name, aliases: names.aliases },
        page: { title: names.title },
      });
      expect(needsLlmCheck(weak)).toBe(false);
      const decision = decideWebsite(weak, "same");
      expect(decision).toMatchObject({ status: "rejected", rule: "none" });
      expect(decision.evidence).toContain("too short or generic");
    }
  });
});

describe("C2: a stated domain without a name match", () => {
  it("sends an article domain whose page does not carry the name to review", () => {
    const decision = decideWebsite(
      input({ source: "article", page: { title: "Welcome", siteName: null } }),
    );
    expect(decision).toMatchObject({ status: "candidate", rule: "C2" });
    expect(decision.evidence).toBe(
      'article domain; name does not match title "Welcome"',
    );
  });

  it("sends an empty UKRI page to review", () => {
    const decision = decideWebsite(
      input({ source: "ukri", page: { title: null, siteName: null } }),
    );
    expect(decision).toMatchObject({ status: "candidate", rule: "C2" });
    expect(decision.evidence).toContain("no title");
  });

  it("sends a redirected stated domain with a short name to review", () => {
    const decision = decideWebsite(
      input({
        source: "article",
        company: { name: "BCD Studio Ltd", aliases: ["BCD"] },
        page: {
          title: "BCD",
          finalDomain: "bcd.example",
          redirectedFrom: "bcdstudio.example",
        },
      }),
    );
    expect(decision).toMatchObject({ status: "candidate", rule: "C2" });
    expect(decision.evidence).toContain("redirects to another site");
  });

  it("comes after the LLM check (precedence)", () => {
    const redirected = input({
      source: "article",
      page: {
        finalDomain: "other.example",
        redirectedFrom: "brightwell.example",
      },
    });
    expect(decideWebsite(redirected, "unsure").rule).toBe("C1");
  });
});

describe("anything else", () => {
  it("rejects a guess whose page does not carry the name", () => {
    const decision = decideWebsite(
      input({ page: { title: "Brightwell Dental | Leeds" } }),
    );
    expect(decision).toMatchObject({ status: "rejected", rule: "none" });
    expect(needsLlmCheck(input({ page: { title: "Welcome" } }))).toBe(false);
  });
});

describe("evidence", () => {
  it("is at most 300 characters", () => {
    const decision = decideWebsite(
      input({
        source: "article",
        page: {
          title: "x".repeat(500),
          finalDomain: `${"y".repeat(200)}.example`,
          redirectedFrom: `${"z".repeat(200)}.example`,
        },
      }),
    );
    expect(decision.evidence.length).toBeLessThanOrEqual(MAX_EVIDENCE_CHARS);
  });

  it("clips with an ellipsis", () => {
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
  });
});
