/**
 * Stores, refreshes and removes company logos (D72). A logo is kept only for
 * a company with a linked website. A `blocked` row is a person's removal: it
 * holds no image and is never fetched again.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  companies,
  companyLogos,
  companyWebsites,
  type WebsiteIconCandidate,
} from "@/db/schema";
import { probeImage, type LogoMime, type ProbeRejection } from "./image-probe";
import type { LogoFetchOutcome, LogoFetcher } from "./logo-fetch";
import { isPermittedLogoUrl, pickLogoCandidates } from "./logo-pick";

/** A linked website with no logo is tried again once in this many days. */
export const LOGO_RETRY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoredLogo {
  companyId: number;
  bytes: Uint8Array;
  mime: LogoMime;
  width: number;
  height: number;
  sourceUrl: string;
  now: Date;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Inserts or replaces a company's logo. Returns false for a blocked row. */
export async function storeLogo(db: Db, logo: StoredLogo): Promise<boolean> {
  const values = {
    bytes: logo.bytes,
    mime: logo.mime,
    width: logo.width,
    height: logo.height,
    sha256: sha256(logo.bytes),
    sourceUrl: logo.sourceUrl,
    fetchedAt: logo.now,
  };
  const written = await db
    .insert(companyLogos)
    .values({ companyId: logo.companyId, ...values })
    .onConflictDoUpdate({
      target: companyLogos.companyId,
      set: values,
      setWhere: eq(companyLogos.blocked, false),
    })
    .returning({ companyId: companyLogos.companyId });
  return written.length > 0;
}

/** Deletes a company's logo, keeping a blocked row. Returns true when one went. */
export async function deleteLogo(db: Db, companyId: number): Promise<boolean> {
  const deleted = await db
    .delete(companyLogos)
    .where(
      and(
        eq(companyLogos.companyId, companyId),
        eq(companyLogos.blocked, false),
      ),
    )
    .returning({ companyId: companyLogos.companyId });
  return deleted.length > 0;
}

export async function isLogoBlocked(
  db: Db,
  companyId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ blocked: companyLogos.blocked })
    .from(companyLogos)
    .where(eq(companyLogos.companyId, companyId));
  return row?.blocked ?? false;
}

/**
 * Deletes the logos of companies with no linked website: a demotion, a
 * rejection by hand or a merge. Blocked rows stay. Returns how many went.
 */
export async function deleteUnlinkedLogos(db: Db): Promise<number> {
  const deleted = await db
    .delete(companyLogos)
    .where(
      and(
        eq(companyLogos.blocked, false),
        notExists(
          db
            .select({ id: companyWebsites.id })
            .from(companyWebsites)
            .innerJoin(companies, eq(companies.id, companyWebsites.companyId))
            .where(
              and(
                eq(companyWebsites.companyId, companyLogos.companyId),
                eq(companyWebsites.status, "linked"),
                isNull(companies.mergedIntoId),
              ),
            ),
        ),
      ),
    )
    .returning({ companyId: companyLogos.companyId });
  return deleted.length;
}

export interface RemoveLogoResult {
  ok: boolean;
  message: string;
}

/**
 * The `remove-logo` action: marks the company's logo blocked and deletes the
 * image, so it is never served or fetched again. Without `apply` it only
 * says what it would do.
 */
export async function removeLogo(
  db: Db,
  companyId: number,
  options: { apply: boolean },
): Promise<RemoveLogoResult> {
  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) return { ok: false, message: `no company ${companyId}` };
  const [row] = await db
    .select({
      blocked: companyLogos.blocked,
      sourceUrl: companyLogos.sourceUrl,
    })
    .from(companyLogos)
    .where(eq(companyLogos.companyId, companyId));
  if (row?.blocked) {
    return {
      ok: false,
      message: `skipped: the logo of ${company.name} (company ${companyId}) is already removed`,
    };
  }
  const what = row
    ? `the logo of ${company.name} (company ${companyId}, from ${row.sourceUrl})`
    : `${company.name} (company ${companyId}), which has no logo now,`;
  if (!options.apply) {
    return {
      ok: true,
      message: `preview: would delete ${what} and block it from being fetched again`,
    };
  }
  const blocked = {
    bytes: null,
    mime: null,
    width: null,
    height: null,
    sha256: null,
    sourceUrl: null,
    fetchedAt: null,
    blocked: true,
  };
  await db
    .insert(companyLogos)
    .values({ companyId, ...blocked })
    .onConflictDoUpdate({ target: companyLogos.companyId, set: blocked });
  return { ok: true, message: `removed ${what} and blocked it` };
}

export interface LogoTry {
  url: string;
  outcome: LogoFetchOutcome | ProbeRejection;
}

export type RefreshLogoResult =
  | { outcome: "stored"; url: string; tries: LogoTry[] }
  /** Every candidate failed. An earlier logo stays if it came from this site. */
  | { outcome: "none"; tries: LogoTry[] }
  | { outcome: "blocked"; tries: [] }
  /** The run's logo request limit ran out. */
  | { outcome: "cap"; tries: LogoTry[] };

/**
 * Fetches and stores the best usable icon of a linked website, trying at
 * most three candidates in order. Never fetches for a blocked row.
 */
export async function refreshLogo(
  db: Db,
  input: {
    companyId: number;
    domain: string;
    iconCandidates: readonly WebsiteIconCandidate[];
    fetcher: LogoFetcher;
    now: () => Date;
  },
): Promise<RefreshLogoResult> {
  if (await isLogoBlocked(db, input.companyId)) {
    return { outcome: "blocked", tries: [] };
  }
  const tries: LogoTry[] = [];
  for (const candidate of pickLogoCandidates(
    input.iconCandidates,
    input.domain,
  )) {
    const got = await input.fetcher.fetchLogo(candidate.url, input.domain);
    if (got.outcome === "cap") return { outcome: "cap", tries };
    if (got.outcome !== "fetched") {
      tries.push({ url: candidate.url, outcome: got.outcome });
      continue;
    }
    const probe = probeImage(got.bytes);
    if (!probe.ok) {
      tries.push({ url: candidate.url, outcome: probe.reason });
      continue;
    }
    tries.push({ url: candidate.url, outcome: "fetched" });
    const stored = await storeLogo(db, {
      companyId: input.companyId,
      bytes: got.bytes,
      mime: probe.mime,
      width: probe.width,
      height: probe.height,
      sourceUrl: got.url,
      now: input.now(),
    });
    // A person blocked it while the file downloaded.
    if (!stored) return { outcome: "blocked", tries: [] };
    return { outcome: "stored", url: got.url, tries };
  }
  const [old] = await db
    .select({ sourceUrl: companyLogos.sourceUrl })
    .from(companyLogos)
    .where(eq(companyLogos.companyId, input.companyId));
  if (old?.sourceUrl && !isPermittedLogoUrl(old.sourceUrl, input.domain)) {
    await deleteLogo(db, input.companyId);
  }
  return { outcome: "none", tries };
}

export interface LogoDue {
  companyId: number;
  domain: string;
  iconCandidates: WebsiteIconCandidate[];
}

/**
 * Linked websites with no logo row, for a retry. Each company comes up on one
 * day in every 30 (its id modulo 30), so a site with no usable icon is asked
 * again at most once a month. Links made by hand are found here too, since
 * the queue never re-checks them.
 */
export async function logosDue(
  db: Db,
  now: Date,
  limit: number,
): Promise<LogoDue[]> {
  const slot = Math.floor(now.getTime() / DAY_MS) % LOGO_RETRY_DAYS;
  return db
    .select({
      companyId: companyWebsites.companyId,
      domain: companyWebsites.domain,
      iconCandidates: companyWebsites.iconCandidates,
    })
    .from(companyWebsites)
    .innerJoin(companies, eq(companies.id, companyWebsites.companyId))
    .where(
      and(
        eq(companyWebsites.status, "linked"),
        isNull(companies.mergedIntoId),
        sql`${companyWebsites.companyId} % ${LOGO_RETRY_DAYS} = ${slot}`,
        notExists(
          db
            .select({ companyId: companyLogos.companyId })
            .from(companyLogos)
            .where(eq(companyLogos.companyId, companyWebsites.companyId)),
        ),
      ),
    )
    .orderBy(asc(companyWebsites.companyId))
    .limit(limit);
}
