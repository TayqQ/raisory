// The website verification eval (D64). Replays labelled cases through the
// rules, the LLM check and the website store, on an in-memory database, with
// recorded LLM answers: no network and no cost. Each case runs in its own
// transaction, rolled back afterwards, so cases never see each other's rows.

import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  LINK_DECIDED_BY,
  REGISTRY_LINK_STATUSES,
  WEBSITE_RULES,
  WEBSITE_SOURCES,
  type RegistryLinkStatus,
} from "@/core/enums";
import { BudgetExceededError, ExtractionValidationError } from "@/core/errors";
import type { BudgetGuard, LlmClient } from "@/core/ports";
import type { Db } from "@/db/client";
import { companies, companyWebsites, investors } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { normaliseCompanyName } from "@/lib/normalise";
import {
  checkWebsite,
  WEBSITE_CHECK_MODEL,
  type WebsiteCheckDeps,
} from "@/pipeline/websites/llm-check";
import {
  decideWebsite,
  needsLlmCheck,
  type WebsiteLlmAnswer,
  type WebsiteRuleInput,
} from "@/pipeline/websites/rules";
import {
  findDomainHolder,
  recordWebsiteResult,
} from "@/pipeline/websites/website-store";

export const WEBSITE_CASES_PATH = "fixtures/websites/cases.json";

const PAGE_OUTCOMES = [
  "fetched",
  "robots",
  "blocked",
  "failed",
  "not_html",
  "cap",
] as const;
const LLM_ANSWERS = [
  "same",
  "different",
  "unsure",
  "over_budget",
  "invalid",
] as const;

const pageSchema = z.object({
  outcome: z.enum(PAGE_OUTCOMES).default("fetched"),
  detail: z.string().nullable().default(null),
  domain: z.string(),
  /** Defaults to `domain`. */
  finalDomain: z.string().optional(),
  redirectedFrom: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  siteName: z.string().nullable().default(null),
  ogTitle: z.string().nullable().default(null),
  metaDescription: z.string().nullable().default(null),
  /** A short footer snippet: the only visible text kept. */
  text: z.string().default(""),
  companyNumbers: z.array(z.string()).default([]),
  parked: z.boolean().default(false),
});

const caseSchema = z.object({
  id: z.string(),
  tags: z.array(z.string()).min(1),
  note: z.string(),
  company: z.object({
    /** The company's id on the live site, for reference only. */
    id: z.number().int(),
    name: z.string(),
    aliases: z.array(z.string()).default([]),
    countryCode: z.string().length(2).nullable().default(null),
    city: z.string().nullable().default(null),
    description: z.string().nullable().default(null),
    firstTag: z.string().nullable().default(null),
    linkedCompanyNumber: z.string().nullable().default(null),
  }),
  source: z.enum(WEBSITE_SOURCES),
  /** Who already holds the domain: seeded before the case runs. */
  holder: z
    .object({ kind: z.enum(["company", "investor"]), name: z.string() })
    .nullable()
    .default(null),
  /** Rows the company already has: seeded before the case runs. */
  existing: z
    .array(
      z.object({
        domain: z.string(),
        status: z.enum(REGISTRY_LINK_STATUSES),
        decidedBy: z.enum(LINK_DECIDED_BY),
        rule: z.enum(WEBSITE_RULES),
      }),
    )
    .default([]),
  page: pageSchema,
  /** Where the page summary came from: a real fetch, or written by hand. */
  pageFrom: z.enum(["fetched", "hand-written"]),
  /** The recorded LLM answer, or null when the rules never ask. */
  llm: z
    .object({ answer: z.enum(LLM_ANSWERS), recorded: z.string() })
    .nullable()
    .default(null),
  expected: z.object({
    status: z.enum(REGISTRY_LINK_STATUSES),
    /** Defaults to the page's final domain. */
    domain: z.string().optional(),
  }),
});
const fileSchema = z.object({
  version: z.literal(1),
  cases: z.array(caseSchema),
});

export type WebsiteCase = z.infer<typeof caseSchema>;

export function loadWebsiteCases(path = WEBSITE_CASES_PATH): WebsiteCase[] {
  const parsed = fileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const ids = new Set<string>();
  for (const item of parsed.cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate website case ${item.id}`);
    ids.add(item.id);
  }
  return parsed.cases;
}

// ---------------------------------------------------------------------------
// Replay

export interface WebsiteCaseResult {
  id: string;
  tags: string[];
  note: string;
  company: string;
  domain: string;
  expected: RegistryLinkStatus;
  expectedDomain: string;
  /** The stored status after the store applied its invariants. */
  predicted: RegistryLinkStatus;
  rule: string;
  evidence: string;
  llmAsked: boolean;
  /** The answer used: recorded, or from the model in a live run. */
  llmAnswer: WebsiteLlmAnswer | null;
}

export interface WebsiteScore {
  cases: number;
  expectedLinks: number;
  autoLinks: number;
  correctLinks: number;
  wrongLinks: number;
  sentToReview: number;
  missed: number;
  precision: number;
  recall: number;
}

export interface WebsiteEvalResult {
  score: WebsiteScore;
  results: WebsiteCaseResult[];
  wrong: WebsiteCaseResult[];
  toReview: WebsiteCaseResult[];
  missed: WebsiteCaseResult[];
  /** Non-link outcomes that differ from the label (candidate for rejected, or the reverse). */
  outcomeDifferences: WebsiteCaseResult[];
  llmCalls: number;
  /** Answers given by the model in a live run, by case id. */
  liveAnswers: Map<string, WebsiteLlmAnswer>;
}

/** A live run's model, behind its own capped budget. */
export interface LiveCheck {
  deps: WebsiteCheckDeps;
}

class Rollback extends Error {}

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

/** An LLM client that returns one recorded answer through the schema. */
function replayClient(answer: WebsiteLlmAnswer): LlmClient {
  return {
    complete(request) {
      if (answer === "invalid") {
        return Promise.reject(
          new ExtractionValidationError([
            { path: [], message: "recorded answer failed the schema" },
          ]),
        );
      }
      return Promise.resolve({
        data: request.schema.parse({ verdict: answer }),
        usage: NO_USAGE,
        model: WEBSITE_CHECK_MODEL,
      });
    },
  };
}

function replayBudget(refuse: boolean): BudgetGuard {
  return {
    assertCanSpend(estimate) {
      if (!refuse) return Promise.resolve();
      return Promise.reject(
        new BudgetExceededError({
          model: estimate.model,
          estimateUsdMicros: estimate.usdMicros,
          spentUsdMicros: 0,
          capUsdMicros: 0,
        }),
      );
    },
    record: () => Promise.resolve(),
    monthToDate: () => Promise.resolve({ spentUsdMicros: 0, capUsdMicros: 0 }),
  };
}

async function insertCompany(db: Db, slug: string, name: string) {
  const [row] = await db
    .insert(companies)
    .values({ slug, name, normalisedName: normaliseCompanyName(name) })
    .returning({ id: companies.id });
  return row!.id;
}

/** Seeds the case's company, its existing rows and the domain's holder. Returns the company id. */
async function seed(db: Db, testCase: WebsiteCase, domain: string) {
  const companyId = await insertCompany(db, testCase.id, testCase.company.name);
  const now = new Date("2026-11-01T06:00:00Z");
  for (const row of testCase.existing) {
    await db.insert(companyWebsites).values({
      companyId,
      domain: row.domain,
      status: row.status,
      rule: row.rule,
      source: testCase.source,
      evidence: "seeded for the eval",
      checkedAt: now,
      decidedBy: row.decidedBy,
      fingerprint: "seed",
    });
    if (row.status === "linked") {
      await db
        .update(companies)
        .set({ websiteDomain: row.domain })
        .where(eq(companies.id, companyId));
    }
  }
  const holder = testCase.holder;
  if (holder?.kind === "company") {
    const holderId = await insertCompany(
      db,
      `${testCase.id}-holder`,
      holder.name,
    );
    await db.insert(companyWebsites).values({
      companyId: holderId,
      domain,
      status: "linked",
      rule: "W2",
      source: "article",
      evidence: "seeded for the eval",
      checkedAt: now,
      decidedBy: "auto",
      fingerprint: "seed",
    });
    await db
      .update(companies)
      .set({ websiteDomain: domain })
      .where(eq(companies.id, holderId));
  } else if (holder?.kind === "investor") {
    await db.insert(investors).values({
      slug: `${testCase.id}-holder`,
      name: holder.name,
      normalisedName: normaliseCompanyName(holder.name),
      websiteDomain: domain,
    });
  }
  return companyId;
}

async function runCase(
  db: Db,
  testCase: WebsiteCase,
  live: LiveCheck | undefined,
): Promise<{ result: WebsiteCaseResult; liveAnswer: WebsiteLlmAnswer | null }> {
  const page = {
    ...testCase.page,
    finalDomain: testCase.page.finalDomain ?? testCase.page.domain,
  };
  const domain = page.finalDomain;
  let out:
    | { result: WebsiteCaseResult; liveAnswer: WebsiteLlmAnswer | null }
    | undefined;
  try {
    await db.transaction(async (tx) => {
      const companyId = await seed(tx, testCase, domain);
      const input: WebsiteRuleInput = {
        company: testCase.company,
        page,
        source: testCase.source,
        holder: await findDomainHolder(tx, companyId, domain),
      };

      let answer: WebsiteLlmAnswer | null = null;
      let liveAnswer: WebsiteLlmAnswer | null = null;
      const asked = needsLlmCheck(input);
      if (asked) {
        const recorded = testCase.llm?.answer;
        if (!recorded) {
          throw new Error(`Case ${testCase.id} needs a recorded LLM answer`);
        }
        if (live && recorded !== "over_budget") {
          answer = (await checkWebsite(input.company, page, live.deps)).answer;
          if (answer !== "over_budget") liveAnswer = answer;
        } else {
          answer = (
            await checkWebsite(input.company, page, {
              llm: replayClient(recorded),
              budget: replayBudget(recorded === "over_budget"),
              model: WEBSITE_CHECK_MODEL,
            })
          ).answer;
        }
      }
      const decision = decideWebsite(input, answer);
      await recordWebsiteResult(tx, {
        companyId,
        decision,
        source: testCase.source,
        iconCandidates: [],
        fingerprint: "eval",
        now: new Date("2026-11-23T06:00:00Z"),
      });
      const [stored] = await tx
        .select()
        .from(companyWebsites)
        .where(
          and(
            eq(companyWebsites.companyId, companyId),
            eq(companyWebsites.domain, decision.domain),
          ),
        );
      out = {
        result: {
          id: testCase.id,
          tags: testCase.tags,
          note: testCase.note,
          company: testCase.company.name,
          domain: decision.domain,
          expected: testCase.expected.status,
          expectedDomain: testCase.expected.domain ?? domain,
          // No row means a manual link elsewhere blocked the write.
          predicted: stored?.status ?? "rejected",
          rule: stored?.rule ?? decision.rule,
          evidence: stored?.evidence ?? decision.evidence,
          llmAsked: asked,
          llmAnswer: answer,
        },
        liveAnswer,
      };
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (!out) throw new Error(`Case ${testCase.id} produced no result`);
  return out;
}

function isLink(r: WebsiteCaseResult): boolean {
  return r.predicted === "linked";
}

function isCorrectLink(r: WebsiteCaseResult): boolean {
  return isLink(r) && r.expected === "linked" && r.domain === r.expectedDomain;
}

export function scoreWebsites(
  results: readonly WebsiteCaseResult[],
): WebsiteScore {
  const expectedLinks = results.filter((r) => r.expected === "linked").length;
  const autoLinks = results.filter(isLink).length;
  const correctLinks = results.filter(isCorrectLink).length;
  const unlinked = results.filter(
    (r) => r.expected === "linked" && !isCorrectLink(r),
  );
  return {
    cases: results.length,
    expectedLinks,
    autoLinks,
    correctLinks,
    wrongLinks: autoLinks - correctLinks,
    sentToReview: unlinked.filter((r) => r.predicted === "candidate").length,
    missed: unlinked.filter((r) => r.predicted !== "candidate").length,
    precision: autoLinks === 0 ? 1 : correctLinks / autoLinks,
    recall: expectedLinks === 0 ? 1 : correctLinks / expectedLinks,
  };
}

/**
 * Runs every labelled case. Offline by default: recorded answers stand in for
 * the model. With `live`, cases that need the LLM check ask the model instead,
 * and its answers come back in `liveAnswers` for recording.
 */
export async function runWebsiteEval(
  options: { path?: string; live?: LiveCheck } = {},
): Promise<WebsiteEvalResult> {
  const cases = loadWebsiteCases(options.path);
  const test = await createTestDb();
  const results: WebsiteCaseResult[] = [];
  const liveAnswers = new Map<string, WebsiteLlmAnswer>();
  try {
    for (const testCase of cases) {
      const { result, liveAnswer } = await runCase(
        test.db,
        testCase,
        options.live,
      );
      results.push(result);
      if (liveAnswer) liveAnswers.set(testCase.id, liveAnswer);
    }
  } finally {
    await test.close();
  }
  return {
    score: scoreWebsites(results),
    results,
    wrong: results.filter((r) => isLink(r) && !isCorrectLink(r)),
    toReview: results.filter(
      (r) =>
        r.expected === "linked" &&
        !isCorrectLink(r) &&
        r.predicted === "candidate",
    ),
    missed: results.filter(
      (r) =>
        r.expected === "linked" &&
        !isCorrectLink(r) &&
        r.predicted !== "candidate",
    ),
    outcomeDifferences: results.filter(
      (r) =>
        r.expected !== "linked" && !isLink(r) && r.expected !== r.predicted,
    ),
    llmCalls: results.filter((r) => r.llmAsked).length,
    liveAnswers,
  };
}

/**
 * The fixture file with the live answers written in, keeping every other
 * field as it was. Run `pnpm format` afterwards.
 */
export function withLiveAnswers(
  fileText: string,
  answers: ReadonlyMap<string, WebsiteLlmAnswer>,
  recorded: string,
): string {
  const file = JSON.parse(fileText) as {
    cases: Array<{ id: string; llm?: unknown }>;
  };
  for (const item of file.cases) {
    const answer = answers.get(item.id);
    if (answer) item.llm = { answer, recorded };
  }
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Report

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function list(
  results: readonly WebsiteCaseResult[],
  line: (r: WebsiteCaseResult) => string,
): string {
  return results.length === 0 ? "None." : results.map(line).join("\n");
}

export function renderWebsiteReport(result: WebsiteEvalResult): string {
  const s = result.score;
  const rows = result.results
    .map(
      (r) =>
        `| ${r.id} | ${r.company} | ${r.domain} | ${r.expected} | ${r.predicted} | ${r.rule} | ${r.llmAnswer ?? ""} |`,
    )
    .join("\n");
  return `# Website eval results

${s.cases} labelled cases from \`${WEBSITE_CASES_PATH}\`, replayed through the rules, the LLM check and the website store (D64). The gate is no wrong automatic link. Recall has no threshold.

| Cases | Labelled links | Auto-links | Correct | Wrong | Sent to review | Missed | Precision | Recall |
|---|---|---|---|---|---|---|---|---|
| ${s.cases} | ${s.expectedLinks} | ${s.autoLinks} | ${s.correctLinks} | ${s.wrongLinks} | ${s.sentToReview} | ${s.missed} | ${pct(s.precision)} | ${pct(s.recall)} |

LLM checks asked: ${result.llmCalls} of ${s.cases} cases.

## Wrong automatic links

${list(result.wrong, (r) => `- ${r.id}: linked ${r.domain}, labelled ${r.expected}. ${r.evidence}`)}

## Correct links sent to review

${list(result.toReview, (r) => `- ${r.id} (${r.rule}): ${r.evidence}`)}

## Correct links missed

${list(result.missed, (r) => `- ${r.id} (${r.rule}): ${r.evidence}`)}

## Other outcome differences

${list(result.outcomeDifferences, (r) => `- ${r.id}: labelled ${r.expected}, got ${r.predicted} (${r.rule})`)}

## Every case

| Case | Company | Domain | Labelled | Result | Rule | LLM |
|---|---|---|---|---|---|---|
${rows}
`;
}
