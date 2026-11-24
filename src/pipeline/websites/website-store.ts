// The only code that writes `company_websites`, and `companies.website_domain`
// from it (D64). Mirrors the registry link store (D53):
// - a manual decision is final: automatic calls never change it, and while a
//   company has a manual link no automatic result is written for it;
// - one company has at most one `linked` domain, and a domain is linked to at
//   most one company; a second strong result becomes a `candidate`;
// - `companies.website_domain` follows the one `linked` row: it is set when a
//   row is linked and cleared when that row stops being linked.

import { and, eq, inArray, ne } from "drizzle-orm";
import type {
  RegistryLinkStatus,
  WebsiteRule,
  WebsiteSource,
} from "@/core/enums";
import type { Db } from "@/db/client";
import {
  companies,
  companyWebsites,
  investors,
  type WebsiteIconCandidate,
} from "@/db/schema";
import { MAX_ICON_CANDIDATES } from "./fetch-page";
import {
  clip,
  MAX_EVIDENCE_CHARS,
  type WebsiteDecision,
  type WebsiteHolder,
} from "./rules";

type WebsiteRow = typeof companyWebsites.$inferSelect;

export interface WebsiteResultInput {
  companyId: number;
  decision: WebsiteDecision;
  source: WebsiteSource;
  iconCandidates: readonly WebsiteIconCandidate[];
  /** Hash of the company inputs the check used. */
  fingerprint: string;
  now: Date;
}

export type RecordWebsiteResult =
  /** The row was inserted or updated with this status and rule. */
  | {
      outcome: "written";
      id: number;
      status: RegistryLinkStatus;
      rule: WebsiteRule;
    }
  /** A manual decision stands: nothing was written. `id` is that row, when it is this domain. */
  | { outcome: "blocked"; id: number | null }
  /** The page could not be read, so the automatic link or candidate stands unchanged. */
  | { outcome: "kept"; id: number };

export interface WebsiteActionResult {
  ok: boolean;
  message: string;
}

function evidence(text: string): string {
  return clip(text, MAX_EVIDENCE_CHARS);
}

async function companyRow(db: Db, companyId: number) {
  const [row] = await db
    .select({
      id: companies.id,
      mergedIntoId: companies.mergedIntoId,
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!row) throw new Error(`Company ${companyId} does not exist`);
  if (row.mergedIntoId !== null) {
    throw new Error(
      `Company ${companyId} was merged into ${row.mergedIntoId}. Use that company`,
    );
  }
  return row;
}

async function rowsFor(db: Db, companyId: number): Promise<WebsiteRow[]> {
  return db
    .select()
    .from(companyWebsites)
    .where(eq(companyWebsites.companyId, companyId));
}

/**
 * Another company that holds the domain: through a `linked` row, or its
 * `website_domain` column (merged companies included, as the column is
 * unique). Null when nobody else holds it.
 */
async function companyHolder(
  db: Db,
  companyId: number,
  domain: string,
): Promise<WebsiteHolder | null> {
  const [linked] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companyWebsites)
    .innerJoin(companies, eq(companies.id, companyWebsites.companyId))
    .where(
      and(
        eq(companyWebsites.domain, domain),
        eq(companyWebsites.status, "linked"),
        ne(companyWebsites.companyId, companyId),
      ),
    );
  if (linked) return { kind: "company", ...linked };
  const [held] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(
      and(eq(companies.websiteDomain, domain), ne(companies.id, companyId)),
    );
  return held ? { kind: "company", ...held } : null;
}

/**
 * Who else holds a domain, for rule X3: another company (a `linked` row or
 * its `website_domain`), else an investor whose website it is.
 */
export async function findDomainHolder(
  db: Db,
  companyId: number,
  domain: string,
): Promise<WebsiteHolder | null> {
  const company = await companyHolder(db, companyId, domain);
  if (company) return company;
  const [investor] = await db
    .select({ id: investors.id, name: investors.name })
    .from(investors)
    .where(inArray(investors.websiteDomain, [domain, `www.${domain}`]));
  return investor ? { kind: "investor", ...investor } : null;
}

async function setWebsiteDomain(
  db: Db,
  companyId: number,
  domain: string,
): Promise<void> {
  await db
    .update(companies)
    .set({ websiteDomain: domain })
    .where(eq(companies.id, companyId));
}

/** Clears `companies.website_domain`, but only when it holds this domain. */
async function clearWebsiteDomain(
  db: Db,
  companyId: number,
  domain: string,
): Promise<void> {
  await db
    .update(companies)
    .set({ websiteDomain: null })
    .where(
      and(eq(companies.id, companyId), eq(companies.websiteDomain, domain)),
    );
}

/**
 * Stores one automatic decision, keeping the invariants above. A `linked`
 * decision becomes a `candidate` when the company already has another linked
 * domain, or (rule X3) when another company holds this one. A decision made
 * without reading the page leaves an automatic link or candidate in place
 * (only its check time and fingerprint move). Re-checking a
 * linked domain with another result demotes it and clears the column.
 */
export async function recordWebsiteResult(
  db: Db,
  input: WebsiteResultInput,
): Promise<RecordWebsiteResult> {
  return db.transaction(async (tx) => {
    const { companyId, decision } = input;
    await companyRow(tx, companyId);
    const rows = await rowsFor(tx, companyId);
    const same = rows.find((row) => row.domain === decision.domain);

    if (same?.decidedBy === "manual")
      return { outcome: "blocked", id: same.id };
    const manualLink = rows.find(
      (row) => row.status === "linked" && row.decidedBy === "manual",
    );
    if (manualLink) return { outcome: "blocked", id: null };
    if (!decision.judged && same && same.status !== "rejected") {
      // The result stands, but the check happened: record when, so the
      // domain is read again at the next re-check and not on every run.
      await tx
        .update(companyWebsites)
        .set({ checkedAt: input.now, fingerprint: input.fingerprint })
        .where(eq(companyWebsites.id, same.id));
      return { outcome: "kept", id: same.id };
    }

    let { status, rule } = decision;
    let text = decision.evidence;
    if (status === "linked") {
      const other = rows.find(
        (row) => row.status === "linked" && row.domain !== decision.domain,
      );
      const holder = other
        ? null
        : await companyHolder(tx, companyId, decision.domain);
      if (other) {
        status = "candidate";
        text = `${text}; company already linked to ${other.domain}`;
      } else if (holder) {
        status = "candidate";
        rule = "X3";
        text = `domain held by company ${holder.id}; ${text}`;
      }
    }

    const values = {
      status,
      rule,
      source: input.source,
      evidence: evidence(text),
      companyNumberSeen: decision.companyNumberSeen,
      iconCandidates: input.iconCandidates.slice(0, MAX_ICON_CANDIDATES),
      checkedAt: input.now,
      decidedBy: "auto" as const,
      fingerprint: input.fingerprint,
    };
    const [written] = await tx
      .insert(companyWebsites)
      .values({ ...values, companyId, domain: decision.domain })
      .onConflictDoUpdate({
        target: [companyWebsites.companyId, companyWebsites.domain],
        set: values,
      })
      .returning({ id: companyWebsites.id });

    if (status === "linked") {
      await setWebsiteDomain(tx, companyId, decision.domain);
    } else if (same?.status === "linked") {
      await clearWebsiteDomain(tx, companyId, decision.domain);
    }
    return { outcome: "written", id: written!.id, status, rule };
  });
}

async function rowById(db: Db, id: number): Promise<WebsiteRow | null> {
  const [row] = await db
    .select()
    .from(companyWebsites)
    .where(eq(companyWebsites.id, id));
  return row ?? null;
}

/**
 * A manual link of a candidate row, which is then final. Refused when the
 * company already has another linked domain (reject that first) or another
 * company holds this one.
 */
export async function approveWebsite(
  db: Db,
  id: number,
): Promise<WebsiteActionResult> {
  return db.transaction(async (tx) => {
    const row = await rowById(tx, id);
    if (!row) return { ok: false, message: "no such row" };
    if (row.status !== "candidate") {
      return {
        ok: false,
        message: `skipped: the row is ${row.status}, not a candidate`,
      };
    }
    await companyRow(tx, row.companyId);
    const rows = await rowsFor(tx, row.companyId);
    const other = rows.find((r) => r.status === "linked" && r.id !== row.id);
    if (other) {
      return {
        ok: false,
        message: `refused: the company is already linked to ${other.domain}. Reject it first`,
      };
    }
    const holder = await companyHolder(tx, row.companyId, row.domain);
    if (holder) {
      return {
        ok: false,
        message: `refused: ${row.domain} is held by ${holder.name} (company ${holder.id})`,
      };
    }
    await tx
      .update(companyWebsites)
      .set({
        status: "linked",
        rule: "manual",
        decidedBy: "manual",
        evidence: evidence(`approved in review; was: ${row.evidence}`),
      })
      .where(eq(companyWebsites.id, row.id));
    await setWebsiteDomain(tx, row.companyId, row.domain);
    return { ok: true, message: `linked ${row.domain}` };
  });
}

/**
 * A manual rejection of any row, linked ones included: the domain is never
 * linked or proposed automatically for this company again. Rejecting the
 * linked row clears `companies.website_domain`.
 */
export async function rejectWebsite(
  db: Db,
  id: number,
): Promise<WebsiteActionResult> {
  return db.transaction(async (tx) => {
    const row = await rowById(tx, id);
    if (!row) return { ok: false, message: "no such row" };
    if (row.status === "rejected" && row.decidedBy === "manual") {
      return { ok: false, message: "skipped: already rejected by hand" };
    }
    await tx
      .update(companyWebsites)
      .set({
        status: "rejected",
        rule: "manual",
        decidedBy: "manual",
        evidence: evidence(`rejected in review; was: ${row.evidence}`),
      })
      .where(eq(companyWebsites.id, row.id));
    if (row.status === "linked") {
      await clearWebsiteDomain(tx, row.companyId, row.domain);
    }
    return { ok: true, message: `rejected ${row.domain}` };
  });
}
