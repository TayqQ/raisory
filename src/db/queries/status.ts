import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";
import type {
  GrantCollectStats,
  GrantResolveStats,
  IngestStats,
} from "@/core/domain";
import {
  EVENT_TYPES,
  type IngestStatus,
  LLM_PURPOSES,
  RECORD_KINDS,
  REGISTRY_KINDS,
  REGISTRY_LINK_METHODS,
  REGISTRY_LINK_STATUSES,
  SOURCE_ITEM_STATUSES,
  type LlmPurpose,
  type RegistryKind,
} from "@/core/enums";
import type {
  ConfirmationStatus,
  FormDStatus,
  IngestRunSummary,
  RegistryLinkCounts,
  RegistryStatus,
  StatusSummary,
} from "@/core/read-models";
import type { Db } from "../client";
import {
  chCompanies,
  derivedRebuilds,
  edgarIndexDays,
  eventConfirmations,
  eventRecordSources,
  events,
  formDFilings,
  fxRates,
  grantParticipants,
  grantProjects,
  ingestRuns,
  llmUsage,
  registryLinks,
  registrySearches,
  sourceItems,
  tags,
  themes,
} from "../schema";

/** The latest ingest run that ran the grants steps. */
export interface LatestGrantsRun {
  startedAt: string;
  status: IngestRunSummary["status"];
  collect: GrantCollectStats | null;
  resolve: GrantResolveStats | null;
}

/** Phase 2 pipeline state (spec-phase2 sections 5.3, 5.4 and 12). */
export interface Phase2Status {
  /** Month-to-date spend in USD micros. Every purpose is present. */
  spendByPurposeUsdMicros: Record<LlmPurpose, number>;
  tags: { embedded: number; pending: number };
  themes: { active: number; unnamed: number; unreviewed: number };
  grants: {
    projects: number;
    /** Organisations turned into a company and an event. */
    participantsKept: number;
    /** Not turned into an event: no grant offer or start date. */
    participantsSkipped: number;
    /** Stored but not yet resolved. */
    participantsUnresolved: number;
  };
  /** ISO timestamps; null when that rebuild has never run. */
  statsRebuiltAt: string | null;
  locationsRebuiltAt: string | null;
  latestGrantsRun: LatestGrantsRun | null;
}

/** `StatusSummary` with the Phase 3 blocks filled in, plus the Phase 2 block. */
export type StatusReport = StatusSummary & {
  ingestHealth: IngestHealth;
  phase2: Phase2Status;
  registry: RegistryStatus;
  formD: FormDStatus;
  confirmations: ConfirmationStatus;
};

/** Linked profiles older than this are overdue for a refresh (D52). */
const PROFILE_STALE_DAYS = 90;

const RECENT_RUN_LIMIT = 10;

/**
 * Hours without a successful news ingest before the status page and
 * `pnpm ingest health` call ingest behind (D73).
 */
export const INGEST_STALE_AFTER_HOURS = 8;

/**
 * A `running` row older than this belongs to a job that died; the next run
 * closes it as failed (D67). Younger ones are shown as in progress.
 */
export const RUN_IN_PROGRESS_MAX_MINUTES = 60;

/**
 * Statuses that count as a successful news ingest. A budget pause still
 * collected and stored the feeds; it only held back paid extraction.
 */
export const NEWS_SUCCESS_STATUSES = [
  "succeeded",
  "budget_paused",
] as const satisfies readonly IngestStatus[];

/**
 * True for a row written by the hourly news run (`pnpm ingest run`), on any
 * trigger. Only that run records a `collect` step time in `stats.stepMs`;
 * the daily runs carry zeroed `collect` stats too, so those do not tell them
 * apart. A row whose stats are null (still running, or the run threw) is not
 * recognised. Keep in step with `NEWS_RUN_SQL`.
 */
export function isNewsIngestRun(run: Pick<IngestRunSummary, "stats">): boolean {
  const stepMs: unknown = (run.stats as { stepMs?: unknown } | null)?.stepMs;
  return (
    stepMs != null &&
    typeof stepMs === "object" &&
    !Array.isArray(stepMs) &&
    Object.hasOwn(stepMs, "collect")
  );
}

/**
 * The one definition of "news ingest succeeded", used by the status page and
 * the health check (D73). Keep in step with `NEWS_SUCCESS_SQL`.
 */
export function isNewsIngestSuccess(
  run: Pick<IngestRunSummary, "status" | "stats">,
): boolean {
  return (
    isNewsIngestRun(run) &&
    (NEWS_SUCCESS_STATUSES as readonly IngestStatus[]).includes(run.status)
  );
}

const NEWS_RUN_SQL = sql`(${ingestRuns.stats} -> 'stepMs') ? 'collect'`;
const NEWS_SUCCESS_SQL = and(
  NEWS_RUN_SQL,
  inArray(ingestRuns.status, [...NEWS_SUCCESS_STATUSES]),
);

/** When a successful run counts from: its finish, else its start. */
export function successTime(
  run: Pick<IngestRunSummary, "startedAt" | "finishedAt">,
): string {
  return run.finishedAt ?? run.startedAt;
}

/**
 * True when the last success is older than `maxAgeHours`, or there is none.
 * Exactly `maxAgeHours` old is still fresh.
 */
export function isIngestStale(
  lastSuccessAt: string | null,
  now: Date,
  maxAgeHours: number = INGEST_STALE_AFTER_HOURS,
): boolean {
  if (lastSuccessAt == null) return true;
  const at = new Date(lastSuccessAt).getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > maxAgeHours * 60 * 60 * 1000;
}

const UK_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "25 Nov 2026, 17:09", in UK time (GMT or BST). */
export function formatUkDateTime(iso: string): string {
  return UK_DATE_TIME.format(new Date(iso));
}

/** News ingest state for the status page and the health check. */
export interface IngestHealth {
  /** Newest news run, whatever its status. */
  latestNewsRun: IngestRunSummary | null;
  /** Newest news run that passes `isNewsIngestSuccess`. */
  lastNewsSuccess: IngestRunSummary | null;
  /**
   * Newest `running` row of any kind started within
   * `RUN_IN_PROGRESS_MAX_MINUTES`. A run writes its stats only when it
   * finishes, so a running news run cannot be told from a daily one: show
   * this as "a run", never as a news run.
   */
  runInProgress: IngestRunSummary | null;
}

type IngestRunRow = typeof ingestRuns.$inferSelect;

function toRunSummary(run: IngestRunRow): IngestRunSummary {
  return {
    id: run.id,
    startedAt: requiredTimestamp(run.startedAt),
    finishedAt: isoTimestamp(run.finishedAt),
    trigger: run.trigger,
    status: run.status,
    stats: asStats(run.stats),
    error: run.error,
  };
}

async function newestRun(db: Db, where: SQL | undefined) {
  const [run] = await db
    .select()
    .from(ingestRuns)
    .where(where)
    .orderBy(desc(ingestRuns.startedAt), desc(ingestRuns.id))
    .limit(1);
  return run ? toRunSummary(run) : null;
}

/**
 * Reads the news runs directly rather than from the recent-runs list, which
 * daily and manual runs can fill (D73).
 */
export async function getIngestHealth(
  db: Db,
  now: Date = new Date(),
): Promise<IngestHealth> {
  const inProgressSince = new Date(
    now.getTime() - RUN_IN_PROGRESS_MAX_MINUTES * 60_000,
  );
  const [latestNewsRun, lastNewsSuccess, runInProgress] = await Promise.all([
    newestRun(db, NEWS_RUN_SQL),
    newestRun(db, NEWS_SUCCESS_SQL),
    newestRun(
      db,
      and(
        eq(ingestRuns.status, "running"),
        gte(ingestRuns.startedAt, inProgressSince),
      ),
    ),
  ]);
  return { latestNewsRun, lastNewsSuccess, runInProgress };
}

function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}

function zeroCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const key of keys) counts[key] = 0;
  return counts;
}

function isoTimestamp(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function requiredTimestamp(value: Date | string): string {
  const iso = isoTimestamp(value);
  if (!iso) throw new Error("Expected a timestamp");
  return iso;
}

function asStats(value: unknown): IngestStats | null {
  if (typeof value === "string") {
    try {
      return asStats(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== "object") return null;
  return value as IngestStats;
}

function capOf(stats: IngestStats | null): number | null {
  if (
    stats == null ||
    typeof stats.capGbp !== "number" ||
    !Number.isFinite(stats.capGbp)
  ) {
    return null;
  }
  return stats.capGbp;
}

function utcMonthWindow(now: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

async function monthToDateUsdMicros(db: Db, now: Date): Promise<number> {
  const { start, end } = utcMonthWindow(now);
  const [row] = await db
    .select({
      total: sql<
        string | number | null
      >`coalesce(sum(${llmUsage.costUsdMicros}), 0)`,
    })
    .from(llmUsage)
    .where(and(gte(llmUsage.occurredAt, start), lt(llmUsage.occurredAt, end)));
  return asCount(row?.total);
}

async function latestPerEur(db: Db, currency: string): Promise<number | null> {
  const [row] = await db
    .select({ perEur: fxRates.perEur })
    .from(fxRates)
    .where(eq(fxRates.currency, currency))
    .orderBy(desc(fxRates.rateDate))
    .limit(1);
  return row?.perEur ?? null;
}

async function spendByPurpose(
  db: Db,
  now: Date,
): Promise<Record<LlmPurpose, number>> {
  const { start, end } = utcMonthWindow(now);
  const rows = await db
    .select({
      purpose: llmUsage.purpose,
      total: sql<
        string | number | null
      >`coalesce(sum(${llmUsage.costUsdMicros}), 0)`,
    })
    .from(llmUsage)
    .where(and(gte(llmUsage.occurredAt, start), lt(llmUsage.occurredAt, end)))
    .groupBy(llmUsage.purpose);
  const out = zeroCounts(LLM_PURPOSES);
  for (const row of rows) out[row.purpose] = asCount(row.total);
  return out;
}

async function countWhere(
  db: Db,
  table: typeof tags | typeof themes | typeof grantProjects,
  where?: SQL,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return asCount(row?.count);
}

async function grantParticipantCounts(
  db: Db,
): Promise<[kept: number, skipped: number, unresolved: number]> {
  const [row] = await db
    .select({
      kept: sql<number>`count(*) filter (where ${grantParticipants.skippedReason} is null and ${grantParticipants.resolvedAt} is not null)::int`,
      skipped: sql<number>`count(*) filter (where ${grantParticipants.skippedReason} is not null)::int`,
      unresolved: sql<number>`count(*) filter (where ${grantParticipants.skippedReason} is null and ${grantParticipants.resolvedAt} is null)::int`,
    })
    .from(grantParticipants);
  return [asCount(row?.kept), asCount(row?.skipped), asCount(row?.unresolved)];
}

async function latestGrantsRun(db: Db): Promise<LatestGrantsRun | null> {
  const [run] = await db
    .select()
    .from(ingestRuns)
    .where(sql`${ingestRuns.stats} ? 'grantCollect'`)
    .orderBy(desc(ingestRuns.startedAt), desc(ingestRuns.id))
    .limit(1);
  if (!run) return null;
  const stats = asStats(run.stats);
  return {
    startedAt: requiredTimestamp(run.startedAt),
    status: run.status,
    collect: stats?.grantCollect ?? null,
    resolve: stats?.grantResolve ?? null,
  };
}

async function getPhase2Status(db: Db, now: Date): Promise<Phase2Status> {
  const [
    spend,
    embedded,
    pending,
    active,
    unnamed,
    unreviewed,
    projects,
    participants,
    rebuilds,
    grantsRun,
  ] = await Promise.all([
    spendByPurpose(db, now),
    countWhere(db, tags, isNotNull(tags.embedding)),
    countWhere(db, tags, isNull(tags.embedding)),
    countWhere(db, themes, eq(themes.status, "active")),
    countWhere(
      db,
      themes,
      and(
        eq(themes.status, "active"),
        isNull(themes.namedAt),
        sql`${themes.nameSource} <> 'manual'`,
      ),
    ),
    countWhere(
      db,
      themes,
      and(eq(themes.status, "active"), isNull(themes.reviewedAt)),
    ),
    countWhere(db, grantProjects),
    grantParticipantCounts(db),
    db.select().from(derivedRebuilds),
    latestGrantsRun(db),
  ]);
  const rebuiltAt = (name: string) =>
    isoTimestamp(rebuilds.find((row) => row.name === name)?.rebuiltAt ?? null);
  return {
    spendByPurposeUsdMicros: spend,
    tags: { embedded, pending },
    themes: { active, unnamed, unreviewed },
    grants: {
      projects,
      participantsKept: participants[0] ?? 0,
      participantsSkipped: participants[1] ?? 0,
      participantsUnresolved: participants[2] ?? 0,
    },
    statsRebuiltAt: rebuiltAt("stats"),
    locationsRebuiltAt: rebuiltAt("locations"),
    latestGrantsRun: grantsRun,
  };
}

async function registryLinkCounts(
  db: Db,
  registry: RegistryKind,
): Promise<RegistryLinkCounts> {
  const rows = await db
    .select({
      status: registryLinks.status,
      method: registryLinks.method,
      count: sql<number>`count(*)::int`,
    })
    .from(registryLinks)
    .where(eq(registryLinks.registry, registry))
    .groupBy(registryLinks.status, registryLinks.method);
  const byStatus = zeroCounts(REGISTRY_LINK_STATUSES);
  const linkedByMethod = zeroCounts(REGISTRY_LINK_METHODS);
  for (const row of rows) {
    const count = asCount(row.count);
    byStatus[row.status] += count;
    if (row.status === "linked" && row.method) {
      linkedByMethod[row.method] += count;
    }
  }
  return { byStatus, linkedByMethod };
}

async function latestRegistryRun(db: Db): Promise<RegistryStatus["lastRun"]> {
  const [run] = await db
    .select({ stats: ingestRuns.stats })
    .from(ingestRuns)
    .where(sql`${ingestRuns.stats} ? 'registry'`)
    .orderBy(desc(ingestRuns.startedAt), desc(ingestRuns.id))
    .limit(1);
  const registry = asStats(run?.stats ?? null)?.registry;
  if (!registry) return null;
  return {
    requests: asCount(registry.requests),
    profilesRefreshed: asCount(registry.profilesRefreshed),
    stoppedAtLimit: registry.stoppedAtLimit === true,
    rateLimited: registry.rateLimited === true,
    skipped: registry.skipped === true,
  };
}

async function getRegistryStatus(db: Db, now: Date): Promise<RegistryStatus> {
  const staleBefore = new Date(
    now.getTime() - PROFILE_STALE_DAYS * 24 * 60 * 60 * 1000,
  );
  const [counts, noMatch, stale, lastRun] = await Promise.all([
    Promise.all(REGISTRY_KINDS.map((kind) => registryLinkCounts(db, kind))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(registrySearches)
      .where(
        and(
          eq(registrySearches.registry, "companies_house"),
          eq(registrySearches.outcome, "none"),
        ),
      ),
    db
      .select({
        count: sql<number>`count(distinct ${chCompanies.companyNumber})::int`,
      })
      .from(chCompanies)
      .innerJoin(
        registryLinks,
        and(
          eq(registryLinks.registryId, chCompanies.companyNumber),
          eq(registryLinks.registry, "companies_house"),
          eq(registryLinks.status, "linked"),
        ),
      )
      .where(lt(chCompanies.fetchedAt, staleBefore)),
    latestRegistryRun(db),
  ]);
  const links = {} as RegistryStatus["links"];
  REGISTRY_KINDS.forEach((kind, i) => {
    const entry = counts[i];
    if (entry) links[kind] = entry;
  });
  return {
    links,
    searchedNoMatch: asCount(noMatch[0]?.count),
    profilesOlderThan90Days: asCount(stale[0]?.count),
    lastRun,
  };
}

async function getFormDStatus(db: Db): Promise<FormDStatus> {
  const [day, filings, funds] = await Promise.all([
    db
      .select({ day: sql<string | null>`max(${edgarIndexDays.day})::text` })
      .from(edgarIndexDays)
      .where(eq(edgarIndexDays.status, "done")),
    db
      .select({
        stored: sql<number>`count(*)::int`,
        linked: sql<number>`count(${formDFilings.companyId})::int`,
      })
      .from(formDFilings),
    db
      .select({
        skipped: sql<
          string | number | null
        >`coalesce(sum(${edgarIndexDays.fundSkipped}), 0)`,
      })
      .from(edgarIndexDays),
  ]);
  return {
    lastDoneDay: day[0]?.day ?? null,
    filingsStored: asCount(filings[0]?.stored),
    fundsSkipped: asCount(funds[0]?.skipped),
    filingsLinked: asCount(filings[0]?.linked),
  };
}

async function getConfirmationStatus(db: Db): Promise<ConfirmationStatus> {
  const [rows, confirmed] = await Promise.all([
    db
      .select({
        kind: eventConfirmations.recordKind,
        count: sql<number>`count(*)::int`,
      })
      .from(eventConfirmations)
      .groupBy(eventConfirmations.recordKind),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          eq(events.evidence, "confirmed"),
          sql`not exists (select 1 from ${eventRecordSources} where ${eventRecordSources.eventId} = ${events.id})`,
        ),
      ),
  ]);
  const byRecordKind = zeroCounts(RECORD_KINDS);
  for (const row of rows) byRecordKind[row.kind] = asCount(row.count);
  return { byRecordKind, newsEventsConfirmed: asCount(confirmed[0]?.count) };
}

export async function getStatusSummary(
  db: Db,
  now: Date = new Date(),
): Promise<StatusReport> {
  const [
    runs,
    itemRows,
    eventRows,
    monthToDate,
    usdPerEur,
    gbpPerEur,
    phase2,
    registry,
    formD,
    confirmations,
    ingestHealth,
  ] = await Promise.all([
    db
      .select()
      .from(ingestRuns)
      .orderBy(desc(ingestRuns.startedAt), desc(ingestRuns.id))
      .limit(RECENT_RUN_LIMIT),
    db
      .select({
        status: sourceItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(sourceItems)
      .groupBy(sourceItems.status),
    db
      .select({
        type: events.type,
        count: sql<number>`count(*)::int`,
      })
      .from(events)
      .groupBy(events.type),
    monthToDateUsdMicros(db, now),
    latestPerEur(db, "USD"),
    latestPerEur(db, "GBP"),
    getPhase2Status(db, now),
    getRegistryStatus(db, now),
    getFormDStatus(db),
    getConfirmationStatus(db),
    getIngestHealth(db, now),
  ]);

  const itemCountsByStatus = zeroCounts(SOURCE_ITEM_STATUSES);
  for (const row of itemRows) {
    itemCountsByStatus[row.status] = asCount(row.count);
  }

  const eventCountsByType = zeroCounts(EVENT_TYPES);
  for (const row of eventRows) {
    eventCountsByType[row.type] = asCount(row.count);
  }

  const recentRuns: IngestRunSummary[] = runs.map(toRunSummary);

  return {
    recentRuns,
    itemCountsByStatus,
    eventCountsByType,
    monthToDateUsdMicros: monthToDate,
    capGbp: capOf(recentRuns[0]?.stats ?? null),
    usdPerGbp: usdPerEur && gbpPerEur ? usdPerEur / gbpPerEur : null,
    ingestHealth,
    phase2,
    registry,
    formD,
    confirmations,
  };
}
