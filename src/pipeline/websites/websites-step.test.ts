import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UsageRecord } from "@/core/domain";
import type { BudgetGuard, LlmClient, LlmCompleteRequest } from "@/core/ports";
import type { Db } from "@/db/client";
import {
  companies,
  companyWebsites,
  eventSources,
  events,
  extractions,
  grantParticipants,
  grantProjects,
  registryLinks,
  sourceItems,
  sources,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import type { PageSummary, WebsiteFetcher } from "./fetch-page";
import { WEBSITE_CHECK_MODEL } from "./llm-check";
import { approveWebsite, rejectWebsite } from "./website-store";
import {
  isDue,
  RECHECK_DAYS,
  websiteQueue,
  websitesStep,
  type WebsiteRunStats,
  type WebsitesStepOptions,
} from "./websites-step";

const START = new Date("2026-11-24T06:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let testDb: TestDb;
let db: Db;
let now: Date;
let itemCounter = 0;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  now = new Date(START);
  itemCounter = 0;
  newsSourceId = null;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

// ---------------------------------------------------------------------------
// Seeding

let newsSourceId: number | null = null;

async function addCompany(
  name: string,
  values: Partial<typeof companies.$inferInsert> = {},
) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const [company] = await db
    .insert(companies)
    .values({
      slug,
      name,
      normalisedName: name.toLowerCase(),
      countryCode: "GB",
      ...values,
    })
    .returning();
  return company!;
}

/** A company with one news report, whose article may name a domain. */
async function addNews(name: string, articleDomain: string | null = null) {
  const company = await addCompany(name);
  if (newsSourceId === null) {
    const [source] = await db
      .insert(sources)
      .values({
        slug: "news",
        name: "News",
        kind: "rss",
        url: "https://news.test/feed",
      })
      .returning();
    newsSourceId = source!.id;
  }
  itemCounter += 1;
  const [item] = await db
    .insert(sourceItems)
    .values({
      sourceId: newsSourceId,
      externalId: `item-${itemCounter}`,
      url: `https://news.test/${itemCounter}`,
      canonicalUrl: `https://news.test/${itemCounter}`,
      title: "Invented headline",
    })
    .returning();
  const [extraction] = await db
    .insert(extractions)
    .values({
      sourceItemId: item!.id,
      promptVersion: "v2",
      model: "test",
      isRelevant: true,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
      result: {
        isRelevant: true,
        events: [
          {
            type: "funding_round",
            company: {
              name,
              websiteDomain: articleDomain,
              description: null,
              countryCode: null,
              city: null,
              regionText: null,
              foundedYear: null,
              tags: [],
            },
            announcedOn: null,
            funding: null,
            acquisition: null,
            launch: null,
          },
        ],
      },
    })
    .returning();
  const [event] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId: company.id,
      announcedOn: "2026-11-01",
    })
    .returning();
  await db.insert(eventSources).values({
    eventId: event!.id,
    extractionId: extraction!.id,
    sourceItemId: item!.id,
    eventIndex: 0,
  });
  return company;
}

/** A company known only from a grant, with the website UKRI gives for it. */
async function addGrantOnly(name: string, website: string | null) {
  const company = await addCompany(name);
  const [source] = await db
    .insert(sources)
    .values({
      slug: `gtr-${company.id}`,
      name: "GtR",
      kind: "ukri_gtr",
      url: `https://gtr.test/${company.id}`,
      priority: 5,
    })
    .returning();
  const [project] = await db
    .insert(grantProjects)
    .values({
      sourceId: source!.id,
      gtrProjectId: `project-${company.id}`,
      title: "Invented project",
      grantCategory: "Feasibility Studies",
      leadFunder: "Innovate UK",
      status: "Active",
      startOn: "2025-06-01",
      endOn: null,
      gtrUrl: `https://gtr.test/project-${company.id}`,
    })
    .returning();
  await db.insert(grantParticipants).values({
    projectId: project!.id,
    gtrOrgId: `org-${company.id}`,
    organisationName: name,
    role: "lead",
    companyId: company.id,
    website,
  });
  return company;
}

async function rowsFor(companyId: number) {
  return db
    .select()
    .from(companyWebsites)
    .where(eq(companyWebsites.companyId, companyId))
    .orderBy(asc(companyWebsites.id));
}

// ---------------------------------------------------------------------------
// Fakes

function page(
  domain: string,
  overrides: Partial<PageSummary> = {},
): PageSummary {
  return {
    outcome: "fetched",
    detail: null,
    domain,
    finalDomain: domain,
    redirectedFrom: null,
    title: null,
    siteName: null,
    ogTitle: null,
    metaDescription: null,
    text: "",
    companyNumbers: [],
    parked: false,
    iconCandidates: [],
    legalPageChecked: false,
    blocked: false,
    ...overrides,
  };
}

/** A page whose site name is the company's, so a stated domain links by W2. */
function ownPage(domain: string, siteName: string): PageSummary {
  return page(domain, {
    title: `${siteName} | Home`,
    siteName,
    text: `${siteName} builds things.`,
  });
}

interface FakeFetcher extends WebsiteFetcher {
  fetched: string[];
}

/**
 * Serves pages by domain; any other domain fails. Each fetch uses one page
 * of the limit and takes `ticks` milliseconds of the fake clock.
 */
function fakeFetcher(
  pages: Record<string, PageSummary>,
  options: { max?: number; tickMs?: number } = {},
): FakeFetcher {
  let remaining = options.max ?? 300;
  const fetched: string[] = [];
  return {
    fetched,
    remaining: () => remaining,
    fetchPage(domain) {
      if (remaining <= 0) {
        return Promise.resolve(
          page(domain, { outcome: "cap", detail: "page limit" }),
        );
      }
      remaining -= 1;
      fetched.push(domain);
      if (options.tickMs) now = new Date(now.getTime() + options.tickMs);
      return Promise.resolve(
        pages[domain] ??
          page(domain, { outcome: "failed", detail: "HTTP 404" }),
      );
    },
  };
}

function blocked(domain: string): PageSummary {
  return page(domain, {
    outcome: "blocked",
    detail: "HTTP 403",
    blocked: true,
  });
}

interface FakeLlm {
  llm: LlmClient;
  budget: BudgetGuard;
  requests: LlmCompleteRequest<unknown>[];
  usage: UsageRecord[];
}

function fakeLlm(verdict: "same" | "different" | "unsure" | "throw"): FakeLlm {
  const requests: LlmCompleteRequest<unknown>[] = [];
  const usage: UsageRecord[] = [];
  return {
    requests,
    usage,
    llm: {
      complete<T>(request: LlmCompleteRequest<T>) {
        requests.push(request);
        if (verdict === "throw") return Promise.reject(new Error("bad key"));
        return Promise.resolve({
          data: request.schema.parse({ verdict }),
          usage: { inputTokens: 700, outputTokens: 300 },
          model: WEBSITE_CHECK_MODEL,
        });
      },
    },
    budget: {
      assertCanSpend: () => Promise.resolve(),
      record(record) {
        usage.push(record);
        return Promise.resolve();
      },
      monthToDate: () =>
        Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 1_000_000 }),
    },
  };
}

function run(
  fetcher: WebsiteFetcher,
  options: Partial<WebsitesStepOptions> = {},
): Promise<WebsiteRunStats> {
  return websitesStep({
    db,
    clock: { now: () => now },
    fetcher,
    llm: null,
    budget: fakeLlm("same").budget,
    log: () => undefined,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// The queue

describe("isDue", () => {
  const day = 24 * 60 * 60 * 1000;
  const row = (fingerprint: string, daysAgo: number, decidedBy = "auto") => ({
    fingerprint,
    decidedBy,
    checkedAt: new Date(START.getTime() - daysAgo * day),
  });

  it("goes by the newest automatic check, so an older row with an old fingerprint does not make it due", () => {
    expect(isDue([row("new", 1), row("old", 200)], "new", START)).toBe(false);
    expect(isDue([row("old", 1), row("new", 200)], "new", START)).toBe(true);
    expect(isDue([row("new", RECHECK_DAYS)], "new", START)).toBe(true);
  });

  it("ignores manual rows", () => {
    expect(isDue([row("x", 1, "manual")], "new", START)).toBe(true);
  });
});

describe("websiteQueue", () => {
  it("puts news companies first, then grant-only companies, and leaves out the rest", async () => {
    const grantOnly = await addGrantOnly("Quantum Widgets", "qwidgets.example");
    await addGrantOnly("No Website Ltd", null);
    await addGrantOnly("Empty Website Ltd", "");
    const second = await addNews("Second Robotics", "second.example");
    const first = await addNews("First Robotics", "first.example");
    const merged = await addNews("Merged Robotics", "merged.example");
    await db
      .update(companies)
      .set({ mergedIntoId: first.id })
      .where(eq(companies.id, merged.id));
    // Known to nobody: no news and no grant.
    await addCompany("Orphan Ltd");

    const queue = await websiteQueue(db, now);
    expect(queue.map((item) => [item.id, item.priority])).toEqual([
      [second.id, 1],
      [first.id, 1],
      [grantOnly.id, 2],
    ]);
  });

  it("tries a grant-only company's UKRI website and nothing else", async () => {
    await addGrantOnly("Quantum Widgets", "qwidgets.example");
    const [item] = await websiteQueue(db, now);
    expect(item?.candidates).toEqual([
      { domain: "qwidgets.example", source: "ukri" },
    ]);
  });

  it("puts a company never checked before one due for a re-check", async () => {
    const old = await addNews("Old Robotics", "old.example");
    await run(
      fakeFetcher({ "old.example": ownPage("old.example", "Old Robotics") }),
    );
    const fresh = await addNews("Fresh Robotics", "fresh.example");
    now = new Date(now.getTime() + (RECHECK_DAYS + 1) * DAY_MS);

    const queue = await websiteQueue(db, now);
    expect(queue.map((item) => item.id)).toEqual([fresh.id, old.id]);
  });

  it("leaves out a company with a manual link", async () => {
    const company = await addNews("Other Robotics", "other.example");
    await run(
      fakeFetcher({ "other.example": page("other.example", { title: "X" }) }),
    );
    const [candidate] = await rowsFor(company.id);
    expect(candidate?.status).toBe("candidate");
    await approveWebsite(db, candidate!.id);
    now = new Date(now.getTime() + (RECHECK_DAYS + 1) * DAY_MS);
    expect(await websiteQueue(db, now)).toHaveLength(0);
  });

  it("never tries a domain a person rejected", async () => {
    const company = await addNews("Linked Robotics", "linked.example");
    await run(
      fakeFetcher({
        "linked.example": ownPage("linked.example", "Linked Robotics"),
      }),
    );
    const [row] = await rowsFor(company.id);
    await rejectWebsite(db, row!.id);

    const [item] = await websiteQueue(db, now);
    expect(item?.id).toBe(company.id);
    expect(item?.candidates.map((c) => c.domain)).not.toContain(
      "linked.example",
    );
  });
});

// ---------------------------------------------------------------------------
// The step

describe("websitesStep", () => {
  it("links a company on the article's domain when the page carries its name", async () => {
    const company = await addNews("Brightwell Robotics", "brightwell.example");
    const fetcher = fakeFetcher({
      "brightwell.example": ownPage(
        "brightwell.example",
        "Brightwell Robotics",
      ),
    });
    const stats = await run(fetcher);

    expect(stats).toMatchObject({
      due: 1,
      checked: 1,
      domainsTried: 1,
      linked: 1,
      candidate: 0,
      rejected: 0,
      blocked: 0,
      fetches: 1,
      maxFetches: 300,
      stoppedAtTime: false,
      stoppedAtFetchCap: false,
    });
    expect(stats.byRule.linked).toEqual({ W2: 1 });
    // It stops at the first link: no guesses are read.
    expect(fetcher.fetched).toEqual(["brightwell.example"]);
    const [row] = await rowsFor(company.id);
    expect(row).toMatchObject({
      status: "linked",
      rule: "W2",
      source: "article",
    });
    const [updated] = await db
      .select({ domain: companies.websiteDomain })
      .from(companies)
      .where(eq(companies.id, company.id));
    expect(updated?.domain).toBe("brightwell.example");
  });

  it("reads the company number from the page and links on it (W1)", async () => {
    const company = await addNews("Brightwell Robotics", "brightwell.example");
    await db.insert(registryLinks).values({
      companyId: company.id,
      registry: "companies_house",
      registryId: "13579246",
      registryName: "BRIGHTWELL ROBOTICS LTD",
      status: "linked",
      method: "name_location",
      reason: "test",
      decidedBy: "auto",
    });
    const stats = await run(
      fakeFetcher({
        "brightwell.example": page("brightwell.example", {
          title: "Welcome",
          companyNumbers: ["13579246"],
        }),
      }),
    );
    expect(stats.byRule.linked).toEqual({ W1: 1 });
  });

  it("stops between companies at the time limit, on a fake clock", async () => {
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]) {
      await addNews(`${name} Robotics`, `${name.toLowerCase()}.example`);
    }
    const pages: Record<string, PageSummary> = {};
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]) {
      pages[`${name.toLowerCase()}.example`] = ownPage(
        `${name.toLowerCase()}.example`,
        `${name} Robotics`,
      );
    }
    // Each fetch takes a minute; the limit is two.
    const fetcher = fakeFetcher(pages, { tickMs: 60_000 });
    const stats = await run(fetcher, { maxMinutes: 2 });

    expect(stats.due).toBe(5);
    expect(stats.checked).toBe(2);
    expect(stats.stoppedAtTime).toBe(true);
    expect(stats.stoppedAtFetchCap).toBe(false);
    expect(fetcher.fetched).toEqual(["alpha.example", "bravo.example"]);

    // What is left stays due for the next run.
    const next = await run(fakeFetcher(pages), { maxMinutes: 10 });
    expect(next.due).toBe(3);
    expect(next.checked).toBe(3);
    expect(next.stoppedAtTime).toBe(false);
  });

  it("stops between companies when the page limit is used up", async () => {
    const pages: Record<string, PageSummary> = {};
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta"]) {
      await addNews(`${name} Robotics`, `${name.toLowerCase()}.example`);
      pages[`${name.toLowerCase()}.example`] = ownPage(
        `${name.toLowerCase()}.example`,
        `${name} Robotics`,
      );
    }
    const stats = await run(fakeFetcher(pages, { max: 2 }));
    expect(stats).toMatchObject({
      due: 4,
      checked: 2,
      fetches: 2,
      maxFetches: 2,
      stoppedAtFetchCap: true,
      stoppedAtTime: false,
    });
  });

  it("records nothing for a company the page limit stopped part way", async () => {
    // No article domain: the name as a domain and guesses, up to 6 pages.
    const company = await addNews("Brightwell Robotics");
    const stats = await run(fakeFetcher({}, { max: 2 }));
    expect(stats.stoppedAtFetchCap).toBe(true);
    expect(stats.checked).toBe(0);
    expect(await rowsFor(company.id)).toHaveLength(0);
    // It is still due.
    expect(await websiteQueue(db, now)).toHaveLength(1);
  });

  describe("blocked sites (A53)", () => {
    it("rejects a blocked guess with X1 and keeps a blocked article domain as a candidate with C2, counting both", async () => {
      const company = await addNews(
        "Brightwell Robotics",
        "brightwell.example",
      );
      const fetcher = fakeFetcher({
        "brightwell.example": blocked("brightwell.example"),
        "brightwellrobotics.com": blocked("brightwellrobotics.com"),
      });
      const stats = await run(fetcher);

      expect(stats.blocked).toBe(2);
      // The article's domain, then the six guesses.
      expect(stats.domainsTried).toBe(7);
      expect(stats.candidate).toBe(1);
      expect(stats.byRule.candidate).toEqual({ C2: 1 });
      expect(stats.rejected).toBe(6);
      expect(stats.byRule.rejected).toEqual({ X1: 6 });

      const rows = await rowsFor(company.id);
      const byDomain = new Map(rows.map((row) => [row.domain, row]));
      expect(byDomain.get("brightwell.example")).toMatchObject({
        status: "candidate",
        rule: "C2",
        source: "article",
      });
      expect(byDomain.get("brightwellrobotics.com")).toMatchObject({
        status: "rejected",
        rule: "X1",
        source: "guess",
      });
    });

    it("reads blocked domains again at the re-check, and not before", async () => {
      const company = await addNews(
        "Brightwell Robotics",
        "brightwell.example",
      );
      const sites = {
        "brightwell.example": blocked("brightwell.example"),
        "brightwellrobotics.com": blocked("brightwellrobotics.com"),
      };
      await run(fakeFetcher(sites));

      // Ten days on: nothing is due, so nothing is fetched.
      now = new Date(now.getTime() + 10 * DAY_MS);
      const early = fakeFetcher(sites);
      const earlyStats = await run(early);
      expect(earlyStats.due).toBe(0);
      expect(early.fetched).toEqual([]);

      // At the re-check every domain is read again. Still blocked: the
      // article's candidate stays, and the guessed rejection is rewritten.
      now = new Date(START.getTime() + (RECHECK_DAYS + 1) * DAY_MS);
      const again = fakeFetcher(sites);
      const stats = await run(again);
      expect(stats.due).toBe(1);
      expect(again.fetched).toContain("brightwell.example");
      expect(again.fetched).toContain("brightwellrobotics.com");
      expect(stats.blocked).toBe(2);
      expect(stats.kept).toBe(1);
      const rows = await rowsFor(company.id);
      expect(
        rows.every((row) => row.checkedAt.getTime() === now.getTime()),
      ).toBe(true);

      // The check is recorded, so the next day it is not read again.
      now = new Date(now.getTime() + DAY_MS);
      const next = fakeFetcher(sites);
      expect((await run(next)).due).toBe(0);
      expect(next.fetched).toEqual([]);
    });

    it("links at the re-check once the site stops blocking", async () => {
      const company = await addNews(
        "Brightwell Robotics",
        "brightwell.example",
      );
      await run(
        fakeFetcher({ "brightwell.example": blocked("brightwell.example") }),
      );
      now = new Date(START.getTime() + (RECHECK_DAYS + 1) * DAY_MS);
      const stats = await run(
        fakeFetcher({
          "brightwell.example": ownPage(
            "brightwell.example",
            "Brightwell Robotics",
          ),
        }),
      );
      expect(stats.byRule.linked).toEqual({ W2: 1 });
      const linked = (await rowsFor(company.id)).find(
        (row) => row.status === "linked",
      );
      expect(linked?.domain).toBe("brightwell.example");
    });
  });

  it("re-checks a company early when its name changes", async () => {
    const company = await addNews("Brightwell Robotics", "brightwell.example");
    const pages = {
      "brightwell.example": ownPage(
        "brightwell.example",
        "Brightwell Robotics",
      ),
    };
    await run(fakeFetcher(pages));
    expect((await run(fakeFetcher(pages))).due).toBe(0);

    await db
      .update(companies)
      .set({ name: "Brightwell Systems" })
      .where(eq(companies.id, company.id));
    expect((await run(fakeFetcher({}))).due).toBe(1);
  });

  it("re-checks only the linked domain of a linked company", async () => {
    await addNews("Brightwell Robotics", "brightwell.example");
    const pages = {
      "brightwell.example": ownPage(
        "brightwell.example",
        "Brightwell Robotics",
      ),
    };
    await run(fakeFetcher(pages));
    now = new Date(START.getTime() + (RECHECK_DAYS + 1) * DAY_MS);
    const again = fakeFetcher(pages);
    const stats = await run(again);
    expect(stats.byRule.linked).toEqual({ W2: 1 });
    expect(again.fetched).toEqual(["brightwell.example"]);
  });

  it("makes the rest of the candidates a review item when the LLM cannot be asked", async () => {
    // A guessed domain whose page carries the name needs the LLM check; with
    // no key it waits for review as C1.
    const company = await addNews("Brightwell Robotics");
    const stats = await run(
      fakeFetcher({
        "brightwellrobotics.com": ownPage(
          "brightwellrobotics.com",
          "Brightwell Robotics",
        ),
      }),
      { llm: null },
    );
    expect(stats.llmChecks).toBe(0);
    expect(stats.byRule.candidate).toEqual({ C1: 1 });
    const [row] = await rowsFor(company.id);
    expect(row).toMatchObject({ status: "candidate", rule: "C1" });
  });

  it("asks the LLM only when the rules need it, through the budget guard", async () => {
    await addNews("Brightwell Robotics");
    const fake = fakeLlm("same");
    const stats = await run(
      fakeFetcher({
        "brightwellrobotics.com": ownPage(
          "brightwellrobotics.com",
          "Brightwell Robotics",
        ),
      }),
      { llm: fake.llm, budget: fake.budget, runId: 7 },
    );
    expect(stats.llmChecks).toBe(1);
    expect(stats.byRule.linked).toEqual({ W3: 1 });
    expect(fake.requests).toHaveLength(1);
    expect(fake.usage).toHaveLength(1);
    expect(fake.usage[0]).toMatchObject({
      purpose: "website_check",
      ingestRunId: 7,
    });
  });

  it("never asks the LLM for a stated domain that already links by name", async () => {
    await addNews("Brightwell Robotics", "brightwell.example");
    const fake = fakeLlm("same");
    await run(
      fakeFetcher({
        "brightwell.example": ownPage(
          "brightwell.example",
          "Brightwell Robotics",
        ),
      }),
      { llm: fake.llm, budget: fake.budget },
    );
    expect(fake.requests).toHaveLength(0);
  });

  it("leaves a company due when its check throws, and stops after three in a row", async () => {
    const ids: number[] = [];
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta"]) {
      ids.push((await addNews(`${name} Robotics`)).id);
    }
    const pages: Record<string, PageSummary> = {};
    for (const name of ["alpha", "bravo", "charlie", "delta"]) {
      pages[`${name}robotics.com`] = ownPage(
        `${name}robotics.com`,
        `${name[0]!.toUpperCase()}${name.slice(1)} Robotics`,
      );
    }
    const fake = fakeLlm("throw");
    const logs: string[] = [];
    const stats = await run(fakeFetcher(pages), {
      llm: fake.llm,
      budget: fake.budget,
      log: (message) => logs.push(message),
    });
    expect(stats).toMatchObject({
      checked: 0,
      errored: 3,
      stoppedAtErrors: true,
    });
    for (const id of ids) expect(await rowsFor(id)).toHaveLength(0);
    expect(logs.some((line) => line.includes("bad key"))).toBe(true);
    expect(await websiteQueue(db, now)).toHaveLength(4);
  });

  it("reads a grant-only company's UKRI website and links it by name", async () => {
    await addGrantOnly("Quantum Widgets", "qwidgets.example");
    const fetcher = fakeFetcher({
      "qwidgets.example": ownPage("qwidgets.example", "Quantum Widgets"),
    });
    const stats = await run(fetcher);
    expect(fetcher.fetched).toEqual(["qwidgets.example"]);
    expect(stats.byRule.linked).toEqual({ W2: 1 });
  });

  it("checks news companies before grant-only ones within the limits", async () => {
    await addGrantOnly("Quantum Widgets", "qwidgets.example");
    await addNews("Brightwell Robotics", "brightwell.example");
    const fetcher = fakeFetcher(
      {
        "brightwell.example": ownPage(
          "brightwell.example",
          "Brightwell Robotics",
        ),
        "qwidgets.example": ownPage("qwidgets.example", "Quantum Widgets"),
      },
      { max: 1 },
    );
    const stats = await run(fetcher);
    expect(fetcher.fetched).toEqual(["brightwell.example"]);
    expect(stats.checked).toBe(1);
    expect(stats.stoppedAtFetchCap).toBe(true);
  });
});
