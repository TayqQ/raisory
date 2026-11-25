import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { IngestStats } from "@/core/domain";
import type { Db } from "@/db/client";
import { ingestRuns } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import {
  checkIngestHealth,
  closeWebDb,
  redactConnectionStrings,
} from "./check";

// 25 November 2026, 20:00 UTC; GMT, so UK time reads the same.
const NOW = new Date("2026-11-25T20:00:00.000Z");

const NEWS_STATS = {
  collect: { itemsInserted: 2 },
  stepMs: { collect: 1500 },
} as unknown as IngestStats;

function hoursBefore(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

describe("checkIngestHealth", () => {
  let testDb: TestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 60_000);

  beforeEach(async () => {
    await db.delete(ingestRuns);
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("is stale with no runs", async () => {
    const result = await checkIngestHealth(db, { now: NOW });
    expect(result).toEqual({
      healthy: false,
      line: "Ingest stale: no successful news ingest recorded (limit 8 hours).",
    });
  });

  it("is stale with only a running run, and says it is in progress", async () => {
    await db.insert(ingestRuns).values({
      trigger: "schedule",
      status: "running",
      startedAt: hoursBefore(0.25),
    });
    const result = await checkIngestHealth(db, { now: NOW });
    expect(result.healthy).toBe(false);
    expect(result.line).toBe(
      "Ingest stale: no successful news ingest recorded (limit 8 hours). A run of unknown kind (news or daily) started 25 Nov 2026, 19:45 UK time is still running.",
    );
  });

  it("is healthy after a fresh success", async () => {
    await db.insert(ingestRuns).values({
      trigger: "schedule",
      status: "succeeded",
      startedAt: hoursBefore(3),
      finishedAt: hoursBefore(2.9),
      stats: NEWS_STATS,
    });
    const result = await checkIngestHealth(db, { now: NOW });
    expect(result).toEqual({
      healthy: true,
      line: "Ingest healthy: last news ingest success 25 Nov 2026, 17:06 UK time, 2.9 hours ago (limit 8 hours).",
    });
  });

  it("is stale when the only success is over the limit", async () => {
    await db.insert(ingestRuns).values({
      trigger: "schedule",
      status: "succeeded",
      startedAt: hoursBefore(9.1),
      finishedAt: hoursBefore(9),
      stats: NEWS_STATS,
    });
    const result = await checkIngestHealth(db, { now: NOW });
    expect(result.healthy).toBe(false);
    expect(result.line).toBe(
      "Ingest stale: last news ingest success 25 Nov 2026, 11:00 UK time, 9.0 hours ago (limit 8 hours).",
    );
    // A wider limit, as with --max-age-hours 12, makes it healthy.
    const one = await checkIngestHealth(db, { now: NOW, maxAgeHours: 1 });
    expect(one.line).toContain("(limit 1 hour).");
    const wider = await checkIngestHealth(db, { now: NOW, maxAgeHours: 12 });
    expect(wider.healthy).toBe(true);
  });

  it("is stale when a recent news run failed after an old success", async () => {
    await db.insert(ingestRuns).values([
      {
        trigger: "schedule",
        status: "succeeded",
        startedAt: hoursBefore(20),
        finishedAt: hoursBefore(19.9),
        stats: NEWS_STATS,
      },
      {
        trigger: "schedule",
        status: "failed",
        startedAt: hoursBefore(1),
        finishedAt: hoursBefore(0.9),
        stats: NEWS_STATS,
        error: "collect: every feed failed",
      },
      // A fresh daily run is not a news success.
      {
        trigger: "schedule",
        status: "succeeded",
        startedAt: hoursBefore(0.5),
        finishedAt: hoursBefore(0.4),
        stats: { collect: { itemsInserted: 0 } } as unknown as IngestStats,
      },
    ]);
    const result = await checkIngestHealth(db, { now: NOW });
    expect(result.healthy).toBe(false);
    expect(result.line).toBe(
      "Ingest stale: last news ingest success 25 Nov 2026, 00:06 UK time, 19.9 hours ago (limit 8 hours). Latest news run 25 Nov 2026, 19:00 UK time: failed.",
    );
  });

  it("reads summer times as BST", async () => {
    const summer = new Date("2026-07-01T12:00:00.000Z");
    await db.insert(ingestRuns).values({
      trigger: "manual",
      status: "budget_paused",
      startedAt: new Date("2026-07-01T10:00:00.000Z"),
      finishedAt: new Date("2026-07-01T10:05:00.000Z"),
      stats: NEWS_STATS,
    });
    const result = await checkIngestHealth(db, { now: summer });
    expect(result.healthy).toBe(true);
    expect(result.line).toContain("1 Jul 2026, 11:05 UK time");
  });
});

describe("redactConnectionStrings", () => {
  it("removes connection strings from an error message", () => {
    expect(
      redactConnectionStrings(
        "connect failed for postgresql://web:s3cret@ep-x.neon.tech/db?sslmode=require (timeout)",
      ),
    ).toBe("connect failed for [redacted] (timeout)");
  });
});

describe("closeWebDb", () => {
  it("ends a pg pool", async () => {
    const end = vi.fn(() => Promise.resolve());
    await closeWebDb({ $client: { end } } as unknown as Db);
    expect(end).toHaveBeenCalledOnce();
  });

  it("does nothing for a client with nothing to end", async () => {
    const neonHttp = Object.assign(() => undefined, {});
    await expect(
      closeWebDb({ $client: neonHttp } as unknown as Db),
    ).resolves.toBeUndefined();
  });
});
