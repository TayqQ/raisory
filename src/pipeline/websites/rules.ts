import type {
  RegistryLinkStatus,
  WebsiteRule,
  WebsiteSource,
} from "@/core/enums";
import { normaliseCompanyNumber } from "@/core/registry";
import type { PageSummary } from "./fetch-page";
import { websiteNameMatch, type WebsiteNameMatch } from "./name-match";
import { nonCompanyHostKind } from "./non-company-hosts";

/**
 * Website verification rules (D64). One pure function decides `linked`,
 * `candidate` or `rejected` for one candidate domain from the company's
 * facts, the page summary, where the domain came from and who else holds it.
 * The rules are checked in order and the first that applies decides:
 *
 * - X1 rejected: a host that is never a company website (or an investor's
 *   website), a page that could not be read (robots, a block, a failure,
 *   not HTML) on a domain no source stated, or a parked page.
 * - X2 rejected: the page shows UK company numbers, none of them the
 *   company's linked Companies House number.
 * - X3 candidate: another company already holds the domain.
 * - W1 linked: the page shows the company's linked Companies House number.
 * - W2 linked: the domain came from the article or the company's own UKRI
 *   record, was not redirected to another site, and the page name matches.
 * - W3 linked: the name matches, is not too short or generic, and the LLM
 *   check says `same`.
 * - C1 candidate: as W3, but the LLM says `unsure`, refused (over budget) or
 *   gave no valid answer.
 * - C2 candidate: the domain came from the article or the UKRI record, and
 *   the LLM did not say `different`, or its page could not be read.
 * - Otherwise rejected (`none`).
 *
 * Precision comes first: a wrong link shows another company's site, name and
 * logo on a company's page, while a missed link only leaves a gap.
 */

export const MAX_EVIDENCE_CHARS = 300;
const MAX_QUOTE_CHARS = 60;

/** What the rules read from the page. Everything else in the summary is ignored. */
export type WebsitePage = Pick<
  PageSummary,
  | "outcome"
  | "detail"
  | "domain"
  | "finalDomain"
  | "redirectedFrom"
  | "title"
  | "siteName"
  | "ogTitle"
  | "metaDescription"
  | "text"
  | "companyNumbers"
  | "parked"
>;

export interface WebsiteCompany {
  name: string;
  aliases: readonly string[];
  /** The company's `linked` Companies House number, or null. */
  linkedCompanyNumber: string | null;
  /** For the LLM check only. */
  description: string | null;
  /** The company's first tag, for the LLM check only. */
  firstTag: string | null;
  countryCode: string | null;
  city: string | null;
}

/** Another company or an investor that already holds the domain. */
export interface WebsiteHolder {
  kind: "company" | "investor";
  id: number;
  name: string;
}

/**
 * The LLM check's answer, `over_budget` when the budget guard refused the
 * call, or `invalid` when the model's output did not pass the schema.
 */
export type WebsiteLlmAnswer =
  "same" | "different" | "unsure" | "over_budget" | "invalid";

export interface WebsiteRuleInput {
  company: WebsiteCompany;
  page: WebsitePage;
  source: WebsiteSource;
  holder: WebsiteHolder | null;
}

export interface WebsiteDecision {
  /** The registrable domain decided: the final domain after redirects. */
  domain: string;
  status: RegistryLinkStatus;
  rule: WebsiteRule;
  /** Why, in at most 300 characters. */
  evidence: string;
  /** The first UK company number the page shows, normalised, or null. */
  companyNumberSeen: string | null;
  /**
   * False when the page could not be read (robots, a block, a failure, not
   * HTML), so the result says nothing about the domain and an earlier
   * automatic link or candidate stands until the next check.
   */
  judged: boolean;
}

/** Text cut to at most `max` characters, ending in "…" when cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function quote(text: string): string {
  return `"${clip(text.replace(/\s+/g, " ").trim(), MAX_QUOTE_CHARS)}"`;
}

/** True when the source vouches for the domain: the article or the company's own UKRI record. */
export function isStatedSource(source: WebsiteSource): boolean {
  return source === "article" || source === "ukri";
}

function sourceLabel(source: WebsiteSource): string {
  switch (source) {
    case "article":
      return "article domain";
    case "ukri":
      return "UKRI website";
    case "name":
      return "name written as a domain";
    case "guess":
      return "guessed domain";
  }
}

const OUTCOME_TEXT: Readonly<Record<string, string>> = {
  robots: "not read: robots.txt disallows it",
  blocked: "not read: the site blocked the request",
  failed: "not read: the fetch failed",
  not_html: "not read: the page is not HTML",
  cap: "not read: the run's page limit was reached",
};

function pageNumbers(page: WebsitePage): string[] {
  const out: string[] = [];
  for (const raw of page.companyNumbers) {
    const number = normaliseCompanyNumber(raw);
    if (number && !out.includes(number)) out.push(number);
  }
  return out;
}

function matchText(match: WebsiteNameMatch): string {
  const where = match.field === "site_name" ? "og:site_name" : "title";
  return `${where} ${quote(match.pageName ?? "")} matches ${quote(match.name ?? "")}`;
}

/** What the page calls itself, for evidence when the name does not match. */
function pageNameText(page: WebsitePage): string {
  if (page.siteName) return `og:site_name ${quote(page.siteName)}`;
  if (page.title) return `title ${quote(page.title)}`;
  return "no title";
}

type Walked =
  | WebsiteDecision
  | { askLlm: (answer: WebsiteLlmAnswer | null) => WebsiteDecision };

/**
 * Walks the rules up to the LLM check. Returns a decision, or the point
 * where only the LLM's answer is missing.
 */
function walk(input: WebsiteRuleInput): Walked {
  const { company, page, source, holder } = input;
  const domain = page.finalDomain || page.domain;
  const numbers = pageNumbers(page);
  const redirected =
    page.redirectedFrom !== null && page.redirectedFrom !== domain;
  const redirectNote = redirected
    ? `; redirected from ${page.redirectedFrom}`
    : "";

  const decide = (
    status: RegistryLinkStatus,
    rule: WebsiteRule,
    evidence: string,
    judged = true,
  ): WebsiteDecision => ({
    domain,
    status,
    rule,
    evidence: clip(`${evidence}${redirectNote}`, MAX_EVIDENCE_CHARS),
    companyNumberSeen: numbers[0] ?? null,
    judged,
  });

  // X1: never a company website, not read, or parked.
  const hostKind =
    nonCompanyHostKind(domain) ??
    (page.domain ? nonCompanyHostKind(page.domain) : null);
  if (hostKind) {
    return decide(
      "rejected",
      "X1",
      `${hostKind.replace(/_/g, " ")} host: never a company website`,
    );
  }
  if (holder?.kind === "investor") {
    return decide(
      "rejected",
      "X1",
      `investor's website (${quote(holder.name)}, investor ${holder.id}): never a company website`,
    );
  }
  if (page.outcome !== "fetched") {
    const text = OUTCOME_TEXT[page.outcome] ?? "not read";
    const detail = page.detail ? ` (${clip(page.detail, 80)})` : "";
    // A domain the article or UKRI record gave is likely right even when the
    // site refuses us (quantum-systems.com answers 403), so a person checks.
    // The run's page limit is not a refusal: that domain waits for a run.
    if (isStatedSource(source) && page.outcome !== "cap") {
      return decide(
        "candidate",
        "C2",
        `${sourceLabel(source)}; ${text}${detail}, so a person checks`,
        false,
      );
    }
    return decide("rejected", "X1", `${text}${detail}`, false);
  }
  if (page.parked) return decide("rejected", "X1", "parked or for-sale page");

  // X2: the page shows only other companies' numbers.
  const linkedNumber = normaliseCompanyNumber(company.linkedCompanyNumber);
  const showsOwnNumber =
    linkedNumber !== null && numbers.includes(linkedNumber);
  if (linkedNumber !== null && numbers.length > 0 && !showsOwnNumber) {
    return decide(
      "rejected",
      "X2",
      `page shows company number ${numbers.join(", ")}, not the company's Companies House number ${linkedNumber}`,
    );
  }

  // X3: another company holds the domain.
  if (holder) {
    return decide(
      "candidate",
      "X3",
      `domain held by ${quote(holder.name)} (company ${holder.id})`,
    );
  }

  // W1: the company's own number.
  if (showsOwnNumber) {
    return decide(
      "linked",
      "W1",
      `page shows company number ${linkedNumber}, which matches Companies House`,
    );
  }

  const match = websiteNameMatch([company.name, ...company.aliases], page);
  const stated = isStatedSource(source);
  const from = sourceLabel(source);

  // W2: a stated domain, not redirected away, whose page carries the name.
  if (stated && match.matched && !redirected) {
    return decide("linked", "W2", `${from}; ${matchText(match)}`);
  }

  /** C2, or rejected, once W1-W3 and C1 did not apply. */
  const fallBack = (answer: WebsiteLlmAnswer | null): WebsiteDecision => {
    if (stated && answer !== "different") {
      const why = match.matched
        ? `${matchText(match)}, but the domain redirects to another site`
        : `name does not match ${pageNameText(page)}`;
      return decide("candidate", "C2", `${from}; ${why}`);
    }
    if (answer === "different") {
      return decide(
        "rejected",
        "none",
        `${from}; ${matchText(match)}, but the LLM check says another organisation`,
      );
    }
    if (match.matched) {
      return decide(
        "rejected",
        "none",
        `${from}; ${matchText(match)}, but the name is too short or generic to link on a name match`,
      );
    }
    return decide(
      "rejected",
      "none",
      `${from}; name does not match ${pageNameText(page)}`,
    );
  };

  if (!match.matched || match.weak) return fallBack(null);

  // W3 and C1: a usable name match, decided by the LLM check.
  return {
    askLlm: (answer) => {
      if (answer === "same") {
        return decide(
          "linked",
          "W3",
          `${from}; ${matchText(match)}; LLM check says same company`,
        );
      }
      if (answer === "different") return fallBack(answer);
      return decide(
        "candidate",
        "C1",
        `${from}; ${matchText(match)}; ${LLM_TEXT[answer ?? "none"]}`,
      );
    },
  };
}

const LLM_TEXT: Readonly<Record<string, string>> = {
  unsure: "LLM check unsure",
  over_budget: "LLM check refused: over budget",
  invalid: "LLM check gave no valid answer",
  none: "LLM check not run",
};

/** True when the rules reach W3, so the decision needs the LLM check. */
export function needsLlmCheck(input: WebsiteRuleInput): boolean {
  return "askLlm" in walk(input);
}

/**
 * The decision for one candidate. `llm` is the LLM check's answer, or null
 * when it was not asked; a candidate that needed it and has none becomes C1.
 */
export function decideWebsite(
  input: WebsiteRuleInput,
  llm: WebsiteLlmAnswer | null = null,
): WebsiteDecision {
  const walked = walk(input);
  return "askLlm" in walked ? walked.askLlm(llm) : walked;
}
