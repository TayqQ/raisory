// `pnpm ingest websites` (spec-phase3.5 sections 4 and 9, D64): finds and
// checks each company's own homepage. Companies with a news report come
// first, then grant-only companies with a UKRI website. A company is checked
// again after 180 days, or when its name, aliases, country, Companies House
// number or candidate domains change (a fingerprint, as `registry_searches`
// does). Search is off.
//
// The step stops between companies at the time limit or when the run's page
// limit is used up. A company stopped part way is not recorded, so it stays
// due for the next run. Nothing here stores page text.
//
// Logos (D72): when a check links a website, the step fetches its logo from
// the icons the homepage listed. At the end it deletes the logos of companies
// with no linked website, then retries a few linked websites with no logo.

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { WebsiteSource } from "@/core/enums";
import type { BudgetGuard, Clock, LlmClient } from "@/core/ports";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  companyTags,
  companyWebsites,
  eventSources,
  events,
  extractions,
  grantParticipants,
  registryLinks,
  tags,
  type WebsiteIconCandidate,
} from "@/db/schema";
import { registryNormalise } from "@/pipeline/registry/link-rules";
import { TimeLimit } from "@/pipeline/step-timing";
import { websiteCandidates, type WebsiteCandidate } from "./candidates";
import type { WebsiteFetcher } from "./fetch-page";
import { WEBSITE_CHECK_MODEL, verifyWebsite } from "./llm-check";
import type { LogoFetcher } from "./logo-fetch";
import {
  deleteUnlinkedLogos,
  logosDue,
  refreshLogo,
  type RefreshLogoResult,
} from "./logo-store";
import {
  decideWebsite,
  type WebsiteCompany,
  type WebsiteDecision,
  type WebsiteRuleInput,
} from "./rules";
import { findDomainHolder, recordWebsiteResult } from "./website-store";

/** A company is checked again after this long. */
export const RECHECK_DAYS = 180;
/** The default for `MAX_WEBSITE_MINUTES_PER_RUN`. */
export const DEFAULT_WEBSITE_MINUTES = 10;
/** The step stops after this many companies in a row fail with an error. */
export const MAX_CONSECUTIVE_ERRORS = 3;
/** Linked websites with no logo retried per run, after the checks. */
export const MAX_LOGO_RETRIES_PER_RUN = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_CHUNK = 500;

type RuleCounts = Record<string, number>;

/** What the step reports, stored on the run and shown in the step summary. */
export interface WebsiteRunStats {
  /** Companies due at the start with at least one domain to try. */
  due: number;
  /** Companies fully checked and recorded. */
  checked: number;
  /** Domains read (a page fetched or refused). */
  domainsTried: number;
  linked: number;
  candidate: number;
  rejected: number;
  /** Results by status, then by rule (W1, C2, X1, none, ...). */
  byRule: { linked: RuleCounts; candidate: RuleCounts; rejected: RuleCounts };
  /** A re-check that could not read the page left the earlier result in place. */
  kept: number;
  /**
   * Domains whose site answered 401, 403 or 429 (A53). On a guessed domain
   * the result is `rejected` with X1; on a domain the article or UKRI gave
   * it is a `candidate` with C2. Both are read again at the re-check.
   */
  blocked: number;
  /** Domains robots.txt refused. */
  robots: number;
  /** Pages read this run, manifests and legal pages included. */
  fetches: number;
  maxFetches: number;
  llmChecks: number;
  /** Companies left due because a check threw. */
  errored: number;
  stoppedAtTime: boolean;
  stoppedAtFetchCap: boolean;
  stoppedAtErrors: boolean;
  /** Logos stored or replaced. */
  logosStored: number;
  /** Linked websites where no candidate gave a usable icon. */
  logosNone: number;
  /** Logos deleted because the company has no linked website. */
  logosRemoved: number;
  /** Logo requests this run, redirects included. */
  logoFetches: number;
  maxLogoFetches: number;
}

export function emptyWebsiteStats(): WebsiteRunStats {
  return {
    due: 0,
    checked: 0,
    domainsTried: 0,
    linked: 0,
    candidate: 0,
    rejected: 0,
    byRule: { linked: {}, candidate: {}, rejected: {} },
    kept: 0,
    blocked: 0,
    robots: 0,
    fetches: 0,
    maxFetches: 0,
    llmChecks: 0,
    errored: 0,
    stoppedAtTime: false,
    stoppedAtFetchCap: false,
    stoppedAtErrors: false,
    logosStored: 0,
    logosNone: 0,
    logosRemoved: 0,
    logoFetches: 0,
    maxLogoFetches: 0,
  };
}

export interface WebsitesStepOptions {
  db: Db;
  clock: Clock;
  /** One fetcher per run: it holds the page limit and the host spacing. */
  fetcher: WebsiteFetcher;
  /** One per run. Without it no logo is fetched, but unlinked logos are still deleted. */
  logoFetcher?: LogoFetcher;
  /** Null without an LLM key: candidates that need the check become C1. */
  llm: LlmClient | null;
  budget: BudgetGuard;
  /** The model `llm` is bound to. Defaults to the website check model. */
  model?: string;
  runId?: number;
  /** `MAX_WEBSITE_MINUTES_PER_RUN`. */
  maxMinutes?: number;
  /** Never receives page text or secrets. */
  log: (message: string) => void;
}

// ---------------------------------------------------------------------------
// The queue

export interface QueuedCompany {
  id: number;
  /** 1: has a news report. 2: grant-only with a UKRI website. */
  priority: 1 | 2;
  company: WebsiteCompany;
  /** Domains to try, in order: an automatic link first, then the sources. */
  candidates: WebsiteCandidate[];
  fingerprint: string;
  /** Newest automatic check, or null when never checked. */
  lastCheckedAt: Date | null;
}

interface ExistingRow {
  domain: string;
  source: WebsiteSource;
  status: string;
  decidedBy: string;
  checkedAt: Date;
  fingerprint: string;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** A hash of what the candidate list and the rules read about the company. */
export function websiteFingerprint(input: {
  name: string;
  aliases: readonly string[];
  countryCode: string | null;
  linkedCompanyNumber: string | null;
  candidates: readonly WebsiteCandidate[];
}): string {
  const body = {
    name: registryNormalise(input.name),
    aliases: input.aliases.map(registryNormalise).sort(),
    countryCode: input.countryCode,
    linkedCompanyNumber: input.linkedCompanyNumber,
    candidates: input.candidates.map((c) => [c.domain, c.source]),
  };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/**
 * True when a company needs checking: never checked, changed, or 180 days
 * old. Only the newest automatic row counts. A re-check that stops at the
 * linked domain leaves older rows with the old fingerprint, and those must
 * not make the company due on every run.
 */
export function isDue(
  rows: readonly Pick<ExistingRow, "decidedBy" | "checkedAt" | "fingerprint">[],
  fingerprint: string,
  now: Date,
): boolean {
  // Manual rows are final and keep the fingerprint they were made with.
  const auto = rows.filter((row) => row.decidedBy === "auto");
  if (auto.length === 0) return true;
  const newest = auto.reduce((a, b) =>
    b.checkedAt.getTime() > a.checkedAt.getTime() ? b : a,
  );
  if (newest.fingerprint !== fingerprint) return true;
  return now.getTime() - newest.checkedAt.getTime() >= RECHECK_DAYS * DAY_MS;
}

/**
 * The companies due for a check, in order: news companies first, then
 * grant-only companies; never-checked before re-checks; the longest-waiting
 * first; then by id. Merged companies and companies with a manual link are
 * left out, and so are domains a person rejected.
 */
export async function websiteQueue(
  db: Db,
  now: Date,
): Promise<QueuedCompany[]> {
  const newsRows = await db
    .selectDistinct({ companyId: events.companyId })
    .from(eventSources)
    .innerJoin(events, eq(events.id, eventSources.eventId));
  const newsIds = new Set(newsRows.map((row) => row.companyId));

  const ukriRows = await db
    .select({
      companyId: grantParticipants.companyId,
      website: grantParticipants.website,
    })
    .from(grantParticipants)
    .where(
      and(
        isNotNull(grantParticipants.companyId),
        isNotNull(grantParticipants.website),
        ne(grantParticipants.website, ""),
      ),
    )
    .orderBy(asc(grantParticipants.id));
  const ukriBy = new Map<number, string[]>();
  for (const row of ukriRows) {
    if (row.companyId !== null && row.website) {
      pushTo(ukriBy, row.companyId, row.website);
    }
  }

  const eligible = [...new Set([...newsIds, ...ukriBy.keys()])].sort(
    (a, b) => a - b,
  );
  const queue: QueuedCompany[] = [];

  for (const ids of chunks(eligible, ID_CHUNK)) {
    const [base, aliasRows, tagRows, numberRows, articleRows, websiteRows] =
      await Promise.all([
        db
          .select({
            id: companies.id,
            name: companies.name,
            description: companies.description,
            countryCode: companies.countryCode,
            city: companies.city,
          })
          .from(companies)
          .where(
            and(
              inArray(companies.id, ids),
              sql`${companies.mergedIntoId} is null`,
            ),
          ),
        db
          .select({
            companyId: companyAliases.companyId,
            alias: companyAliases.alias,
          })
          .from(companyAliases)
          .where(
            and(
              inArray(companyAliases.companyId, ids),
              ne(companyAliases.source, "registry"),
            ),
          )
          .orderBy(asc(companyAliases.id)),
        db
          .select({ companyId: companyTags.companyId, label: tags.label })
          .from(companyTags)
          .innerJoin(tags, eq(tags.id, companyTags.tagId))
          .where(inArray(companyTags.companyId, ids))
          .orderBy(desc(companyTags.mentionCount), asc(tags.id)),
        db
          .select({
            companyId: registryLinks.companyId,
            registryId: registryLinks.registryId,
          })
          .from(registryLinks)
          .where(
            and(
              inArray(registryLinks.companyId, ids),
              eq(registryLinks.registry, "companies_house"),
              eq(registryLinks.status, "linked"),
            ),
          ),
        db
          .select({
            companyId: events.companyId,
            domain: sql<
              string | null
            >`${extractions.result} #>> array['events', ${eventSources.eventIndex}::text, 'company', 'websiteDomain']`,
          })
          .from(eventSources)
          .innerJoin(events, eq(events.id, eventSources.eventId))
          .innerJoin(
            extractions,
            and(
              eq(extractions.id, eventSources.extractionId),
              eq(extractions.isCurrent, true),
            ),
          )
          .where(inArray(events.companyId, ids))
          .orderBy(desc(events.announcedOn), desc(eventSources.extractionId)),
        db
          .select({
            companyId: companyWebsites.companyId,
            domain: companyWebsites.domain,
            source: companyWebsites.source,
            status: companyWebsites.status,
            decidedBy: companyWebsites.decidedBy,
            checkedAt: companyWebsites.checkedAt,
            fingerprint: companyWebsites.fingerprint,
          })
          .from(companyWebsites)
          .where(inArray(companyWebsites.companyId, ids)),
      ]);

    const aliasesBy = new Map<number, string[]>();
    for (const row of aliasRows) pushTo(aliasesBy, row.companyId, row.alias);
    const tagBy = new Map<number, string>();
    for (const row of tagRows) {
      if (!tagBy.has(row.companyId)) tagBy.set(row.companyId, row.label);
    }
    const numberBy = new Map<number, string>();
    for (const row of numberRows) numberBy.set(row.companyId, row.registryId);
    const articleBy = new Map<number, string[]>();
    for (const row of articleRows) {
      if (row.domain) pushTo(articleBy, row.companyId, row.domain);
    }
    const existingBy = new Map<number, ExistingRow[]>();
    for (const row of websiteRows) pushTo(existingBy, row.companyId, row);

    for (const row of base) {
      const existing = existingBy.get(row.id) ?? [];
      // A manual link is final: no automatic result is written for it.
      if (
        existing.some((r) => r.status === "linked" && r.decidedBy === "manual")
      )
        continue;

      const aliases = aliasesBy.get(row.id) ?? [];
      const linkedCompanyNumber = numberBy.get(row.id) ?? null;
      const all = websiteCandidates({
        name: row.name,
        countryCode: row.countryCode,
        hasNews: newsIds.has(row.id),
        articleDomains: articleBy.get(row.id) ?? [],
        ukriWebsites: ukriBy.get(row.id) ?? [],
      });
      if (all.length === 0) continue;
      const fingerprint = websiteFingerprint({
        name: row.name,
        aliases,
        countryCode: row.countryCode,
        linkedCompanyNumber,
        candidates: all,
      });
      if (!isDue(existing, fingerprint, now)) continue;

      // An automatic link is read first, then the sources in order. A
      // domain a person rejected is never tried again.
      const rejectedByHand = new Set(
        existing
          .filter((r) => r.decidedBy === "manual" && r.status === "rejected")
          .map((r) => r.domain),
      );
      const linked = existing.find((r) => r.status === "linked");
      const ordered = linked
        ? [
            { domain: linked.domain, source: linked.source },
            ...all.filter((c) => c.domain !== linked.domain),
          ]
        : all;
      const candidates = ordered.filter((c) => !rejectedByHand.has(c.domain));
      if (candidates.length === 0) continue;

      const autoRows = existing.filter((r) => r.decidedBy === "auto");
      queue.push({
        id: row.id,
        priority: newsIds.has(row.id) ? 1 : 2,
        company: {
          name: row.name,
          aliases,
          linkedCompanyNumber,
          description: row.description,
          firstTag: tagBy.get(row.id) ?? null,
          countryCode: row.countryCode,
          city: row.city,
        },
        candidates,
        fingerprint,
        lastCheckedAt:
          autoRows.length === 0
            ? null
            : new Date(Math.max(...autoRows.map((r) => r.checkedAt.getTime()))),
      });
    }
  }

  return queue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if ((a.lastCheckedAt === null) !== (b.lastCheckedAt === null)) {
      return a.lastCheckedAt === null ? -1 : 1;
    }
    if (a.lastCheckedAt && b.lastCheckedAt) {
      const gap = a.lastCheckedAt.getTime() - b.lastCheckedAt.getTime();
      if (gap !== 0) return gap;
    }
    return a.id - b.id;
  });
}

// ---------------------------------------------------------------------------
// One company

interface Evaluated {
  decision: WebsiteDecision;
  source: WebsiteSource;
  iconCandidates: WebsiteIconCandidate[];
}

class FetchLimitReached extends Error {
  constructor() {
    super("page limit reached");
    this.name = "FetchLimitReached";
  }
}

/**
 * Reads the company's candidate domains in order and decides each. Stops at
 * the first `linked` result. Throws `FetchLimitReached` when the page limit
 * ends it part way, so nothing is recorded for the company.
 */
async function evaluateCompany(
  options: WebsitesStepOptions,
  item: QueuedCompany,
  stats: WebsiteRunStats,
): Promise<Evaluated[]> {
  const { db, fetcher, llm, budget } = options;
  const model = options.model ?? WEBSITE_CHECK_MODEL;
  const results: Evaluated[] = [];
  const decided = new Set<string>();

  for (const candidate of item.candidates) {
    if (decided.has(candidate.domain)) continue;
    if (fetcher.remaining() <= 0) throw new FetchLimitReached();
    const page = await fetcher.fetchPage(candidate.domain);
    if (page.outcome === "cap") throw new FetchLimitReached();

    stats.domainsTried += 1;
    if (page.outcome === "blocked") stats.blocked += 1;
    if (page.outcome === "robots") stats.robots += 1;

    const domain = page.finalDomain || page.domain;
    decided.add(candidate.domain);
    decided.add(domain);
    const holder = await findDomainHolder(db, item.id, domain);
    const input: WebsiteRuleInput = {
      company: item.company,
      page,
      source: candidate.source,
      holder,
    };
    let decision: WebsiteDecision;
    if (llm) {
      const verified = await verifyWebsite(input, {
        llm,
        budget,
        model,
        runId: options.runId,
      });
      if (verified.check && verified.check.answer !== "over_budget") {
        stats.llmChecks += 1;
      }
      decision = verified.decision;
    } else {
      decision = decideWebsite(input);
    }
    results.push({
      decision,
      source: candidate.source,
      iconCandidates: page.iconCandidates,
    });
    if (decision.status === "linked") break;
  }
  return results;
}

function countLogo(stats: WebsiteRunStats, result: RefreshLogoResult): void {
  if (result.outcome === "stored") stats.logosStored += 1;
  else if (result.outcome === "none") stats.logosNone += 1;
}

function countResult(
  stats: WebsiteRunStats,
  status: "linked" | "candidate" | "rejected",
  rule: string,
): void {
  stats[status] += 1;
  stats.byRule[status][rule] = (stats.byRule[status][rule] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// The step

/**
 * Checks the due companies, within the time limit and the page limit. Both
 * are checked between companies. A check that throws leaves its company due
 * and the step goes on, but three in a row end the step (a rejected key, a
 * network that is down).
 */
export async function websitesStep(
  options: WebsitesStepOptions,
): Promise<WebsiteRunStats> {
  const { db, clock, fetcher, logoFetcher, log } = options;
  const stats = emptyWebsiteStats();
  const startRemaining = fetcher.remaining();
  stats.maxFetches = startRemaining;
  const startLogoRemaining = logoFetcher?.remaining() ?? 0;
  stats.maxLogoFetches = startLogoRemaining;
  const limit = new TimeLimit(
    clock,
    options.maxMinutes ?? DEFAULT_WEBSITE_MINUTES,
  );
  const now = clock.now();

  const queue = await websiteQueue(db, now);
  stats.due = queue.length;
  let failures = 0;
  let logoCapped = false;
  const logoTried = new Set<number>();

  /** Logo work never fails a company: an error is logged and the step goes on. */
  async function logoFor(
    companyId: number,
    domain: string,
    iconCandidates: WebsiteIconCandidate[],
  ): Promise<void> {
    if (!logoFetcher || logoCapped) return;
    logoTried.add(companyId);
    try {
      const result = await refreshLogo(db, {
        companyId,
        domain,
        iconCandidates,
        fetcher: logoFetcher,
        now: () => clock.now(),
      });
      countLogo(stats, result);
      if (result.outcome === "cap") logoCapped = true;
    } catch (error) {
      log(
        `websites: logo for company ${companyId} not stored: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  try {
    for (const item of queue) {
      if (limit.reached()) {
        stats.stoppedAtTime = true;
        break;
      }
      if (fetcher.remaining() <= 0) {
        stats.stoppedAtFetchCap = true;
        break;
      }
      try {
        const results = await evaluateCompany(options, item, stats);
        for (const result of results) {
          const written = await recordWebsiteResult(db, {
            companyId: item.id,
            decision: result.decision,
            source: result.source,
            iconCandidates: result.iconCandidates,
            fingerprint: item.fingerprint,
            now: clock.now(),
          });
          if (written.outcome === "written") {
            countResult(stats, written.status, written.rule);
            if (written.status === "linked" && !limit.reached()) {
              await logoFor(
                item.id,
                result.decision.domain,
                result.iconCandidates,
              );
            }
          } else if (written.outcome === "kept") {
            stats.kept += 1;
          }
        }
        stats.checked += 1;
        failures = 0;
      } catch (error) {
        if (error instanceof FetchLimitReached) {
          stats.stoppedAtFetchCap = true;
          break;
        }
        stats.errored += 1;
        failures += 1;
        log(
          `websites: company ${item.id} left for the next run: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (failures >= MAX_CONSECUTIVE_ERRORS) {
          stats.stoppedAtErrors = true;
          break;
        }
      }
    }

    // Demoted, rejected or merged since the logo was stored.
    stats.logosRemoved = await deleteUnlinkedLogos(db);
    if (logoFetcher && !stats.stoppedAtErrors) {
      for (const due of await logosDue(db, now, MAX_LOGO_RETRIES_PER_RUN)) {
        if (logoCapped || limit.reached()) break;
        if (logoTried.has(due.companyId)) continue;
        await logoFor(due.companyId, due.domain, due.iconCandidates);
      }
    }
  } finally {
    stats.fetches = startRemaining - fetcher.remaining();
    stats.logoFetches = startLogoRemaining - (logoFetcher?.remaining() ?? 0);
  }
  if (limit.hit) stats.stoppedAtTime = true;

  const stop = stats.stoppedAtTime
    ? "; stopped: time limit"
    : stats.stoppedAtFetchCap
      ? "; stopped: page limit"
      : stats.stoppedAtErrors
        ? "; stopped: repeated errors"
        : "";
  log(
    `websites: search off; checked ${stats.checked} of ${stats.due} due, ` +
      `linked ${stats.linked}, candidates ${stats.candidate}, rejected ${stats.rejected}, ` +
      `blocked ${stats.blocked}, robots ${stats.robots}, fetches ${stats.fetches}; ` +
      `logos stored ${stats.logosStored}, none usable ${stats.logosNone}, ` +
      `removed ${stats.logosRemoved}, logo fetches ${stats.logoFetches}${stop}`,
  );
  return stats;
}
