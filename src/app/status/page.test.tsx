import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestStats } from "@/core/domain";
import {
  EVENT_TYPES,
  LLM_PURPOSES,
  RECORD_KINDS,
  REGISTRY_KINDS,
  REGISTRY_LINK_METHODS,
  REGISTRY_LINK_STATUSES,
  SOURCE_ITEM_STATUSES,
} from "@/core/enums";
import type { IngestRunSummary } from "@/core/read-models";
import type { StatusReport } from "@/db/queries/status";

const getStatusSummary = vi.fn<() => Promise<StatusReport>>();
const cachedKeys: string[][] = [];

vi.mock("@/db/web", () => ({ getWebDb: () => ({}) }));
vi.mock("@/lib/cached", () => ({
  cached: (fn: () => Promise<unknown>, keyParts: string[]) => {
    cachedKeys.push(keyParts);
    return fn();
  },
}));
vi.mock("@/db/queries/status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/queries/status")>()),
  getStatusSummary: () => getStatusSummary(),
}));

const { default: StatusPage } = await import("./page");

// 25 November 2026, 20:00 UTC (GMT, so UK time is the same).
const NOW = new Date("2026-11-25T20:00:00.000Z");

function zeros<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

function newsRun(finishedAt: string, id = 1): IngestRunSummary {
  return {
    id,
    startedAt: new Date(new Date(finishedAt).getTime() - 120_000).toISOString(),
    finishedAt,
    trigger: "schedule",
    status: "succeeded",
    stats: {
      collect: {
        sourcesAttempted: 5,
        sourcesNotModified: 0,
        sourcesFailed: 0,
        itemsFound: 40,
        itemsInserted: 3,
      },
      extract: {
        itemsAttempted: 3,
        itemsExtracted: 3,
        itemsRelevant: 1,
        itemsErrored: 0,
        itemsFailed: 0,
      },
      spendUsdMicros: 1000,
      capGbp: 10,
      stepMs: { collect: 1200 },
    } as unknown as IngestStats,
    error: null,
  };
}

function report(lastSuccess: IngestRunSummary | null): StatusReport {
  return {
    recentRuns: lastSuccess ? [lastSuccess] : [],
    itemCountsByStatus: zeros(SOURCE_ITEM_STATUSES),
    eventCountsByType: zeros(EVENT_TYPES),
    monthToDateUsdMicros: 0,
    capGbp: 10,
    usdPerGbp: 1.25,
    ingestHealth: {
      latestNewsRun: lastSuccess,
      lastNewsSuccess: lastSuccess,
      runInProgress: null,
    },
    phase2: {
      spendByPurposeUsdMicros: zeros(LLM_PURPOSES),
      tags: { embedded: 0, pending: 0 },
      themes: { active: 0, unnamed: 0, unreviewed: 0 },
      grants: {
        projects: 0,
        participantsKept: 0,
        participantsSkipped: 0,
        participantsUnresolved: 0,
      },
      statsRebuiltAt: null,
      locationsRebuiltAt: null,
      latestGrantsRun: null,
    },
    registry: {
      links: Object.fromEntries(
        REGISTRY_KINDS.map((kind) => [
          kind,
          {
            byStatus: zeros(REGISTRY_LINK_STATUSES),
            linkedByMethod: zeros(REGISTRY_LINK_METHODS),
          },
        ]),
      ) as StatusReport["registry"]["links"],
      searchedNoMatch: 0,
      profilesOlderThan90Days: 0,
      lastRun: null,
    },
    formD: {
      lastDoneDay: null,
      filingsStored: 0,
      fundsSkipped: 0,
      filingsLinked: 0,
    },
    confirmations: {
      byRecordKind: zeros(RECORD_KINDS),
      newsEventsConfirmed: 0,
    },
  };
}

describe("status page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    cachedKeys.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the ingest-behind banner when the last success is over 8 hours old", async () => {
    getStatusSummary.mockResolvedValue(report(newsRun("2026-11-25T11:59:00Z")));
    render(await StatusPage());
    expect(
      screen.getByText(
        "Ingest is behind: last success 25 Nov 2026, 11:59 UK time",
      ),
    ).toBeInTheDocument();
  });

  it("hides the banner when the last success is fresh", async () => {
    getStatusSummary.mockResolvedValue(report(newsRun("2026-11-25T17:09:00Z")));
    render(await StatusPage());
    expect(screen.queryByText(/Ingest is behind/)).not.toBeInTheDocument();
    expect(screen.getByText("News ingest")).toBeInTheDocument();
  });

  it("shows the banner when no news ingest has ever succeeded", async () => {
    getStatusSummary.mockResolvedValue(report(null));
    render(await StatusPage());
    expect(
      screen.getByText("Ingest is behind: no successful news ingest recorded"),
    ).toBeInTheDocument();
  });

  it("shows a run in progress under recent runs as a run of any kind, not as news", async () => {
    const base = report(newsRun("2026-11-25T17:09:00Z"));
    getStatusSummary.mockResolvedValue({
      ...base,
      ingestHealth: {
        ...base.ingestHealth,
        runInProgress: {
          id: 2,
          startedAt: "2026-11-25T19:50:00.000Z",
          finishedAt: null,
          trigger: "schedule",
          status: "running",
          stats: null,
          error: null,
        },
      },
    });
    render(await StatusPage());
    expect(screen.queryByText("Run in progress")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /A run of some kind started at 25 Nov 2026, 19:50 UK time is still running/,
      ),
    ).toBeInTheDocument();
  });

  it("puts the current minute in the cache key, so a quiet spell cannot serve an old read", async () => {
    getStatusSummary.mockResolvedValue(report(newsRun("2026-11-25T17:09:00Z")));
    render(await StatusPage());
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    render(await StatusPage());
    expect(cachedKeys).toEqual([
      ["status-summary", String(NOW.getTime() / 60_000)],
      ["status-summary", String(NOW.getTime() / 60_000 + 1)],
    ]);
  });
});
