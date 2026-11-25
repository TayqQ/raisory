import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  finishBackfill,
  getBackfillProgress,
  saveBackfillCursor,
  startBackfill,
} from "./backfill-progress";
import type { Db } from "./client";
import { backfillProgress } from "./schema";
import { createTestDb, type TestDb } from "./testing";

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

const T0 = new Date("2026-12-01T09:00:00Z");
const T1 = new Date("2026-12-01T09:05:00Z");
const T2 = new Date("2026-12-01T09:10:00Z");

describe("backfill progress", () => {
  it("is null for a job that has never started", async () => {
    expect(await getBackfillProgress(db, "ch_capital_history")).toBeNull();
  });

  it("starts a job with no cursor", async () => {
    expect(await startBackfill(db, "ch_capital_history", T0)).toEqual({
      job: "ch_capital_history",
      cursor: null,
      startedAt: T0,
      updatedAt: T0,
      finishedAt: null,
    });
  });

  it("round-trips each job's cursor through the database", async () => {
    await startBackfill(db, "ch_capital_history", T0);
    await saveBackfillCursor(
      db,
      "ch_capital_history",
      { lastCompanyId: 4812 },
      T1,
    );
    await startBackfill(db, "gtr_older_grants", T0);
    await saveBackfillCursor(
      db,
      "gtr_older_grants",
      { nextPage: 37, oldestStartSeen: "2019-04-01" },
      T1,
    );

    expect(await getBackfillProgress(db, "ch_capital_history")).toEqual({
      job: "ch_capital_history",
      cursor: { lastCompanyId: 4812 },
      startedAt: T0,
      updatedAt: T1,
      finishedAt: null,
    });
    expect((await getBackfillProgress(db, "gtr_older_grants"))?.cursor).toEqual(
      {
        nextPage: 37,
        oldestStartSeen: "2019-04-01",
      },
    );
  });

  it("resumes rather than restarts when started again", async () => {
    await startBackfill(db, "gtr_older_grants", T0);
    await saveBackfillCursor(
      db,
      "gtr_older_grants",
      { nextPage: 5, oldestStartSeen: null },
      T1,
    );

    const again = await startBackfill(db, "gtr_older_grants", T2);
    expect(again.startedAt).toEqual(T0);
    expect(again.cursor).toEqual({ nextPage: 5, oldestStartSeen: null });
  });

  it("rejects an invalid cursor and keeps the last good one", async () => {
    await startBackfill(db, "ch_capital_history", T0);
    await saveBackfillCursor(
      db,
      "ch_capital_history",
      { lastCompanyId: 10 },
      T1,
    );

    for (const cursor of [
      { lastCompanyId: "11" },
      { lastCompanyId: -1 },
      { nextPage: 2, oldestStartSeen: null },
      { lastCompanyId: 11, extra: true },
    ]) {
      await expect(
        saveBackfillCursor(db, "ch_capital_history", cursor as never, T2),
      ).rejects.toThrow(ZodError);
    }
    expect(await getBackfillProgress(db, "ch_capital_history")).toMatchObject({
      cursor: { lastCompanyId: 10 },
      updatedAt: T1,
    });
  });

  it("refuses to read a stored cursor that no longer fits its schema", async () => {
    await db.insert(backfillProgress).values({
      job: "ch_capital_history",
      cursor: { lastCompanyNumber: "01234567" },
    });
    await expect(getBackfillProgress(db, "ch_capital_history")).rejects.toThrow(
      ZodError,
    );
  });

  it("rejects an unknown job name", async () => {
    await expect(getBackfillProgress(db, "nope" as never)).rejects.toThrow(
      ZodError,
    );
    await expect(startBackfill(db, "nope" as never)).rejects.toThrow(ZodError);
  });

  it("cannot save a cursor before the job starts", async () => {
    await expect(
      saveBackfillCursor(db, "ch_capital_history", { lastCompanyId: 1 }),
    ).rejects.toThrow(/not running/);
  });

  it("finishes a job once, keeping its last cursor", async () => {
    await startBackfill(db, "ch_capital_history", T0);
    await saveBackfillCursor(
      db,
      "ch_capital_history",
      { lastCompanyId: 99 },
      T1,
    );
    await finishBackfill(db, "ch_capital_history", T1);
    await finishBackfill(db, "ch_capital_history", T2);

    expect(await getBackfillProgress(db, "ch_capital_history")).toEqual({
      job: "ch_capital_history",
      cursor: { lastCompanyId: 99 },
      startedAt: T0,
      updatedAt: T1,
      finishedAt: T1,
    });
    // A finished job stays finished when started again, and takes no new cursor.
    expect(
      (await startBackfill(db, "ch_capital_history", T2)).finishedAt,
    ).toEqual(T1);
    await expect(
      saveBackfillCursor(db, "ch_capital_history", { lastCompanyId: 100 }, T2),
    ).rejects.toThrow(/not running/);
  });

  it("cannot finish a job that never started", async () => {
    await expect(finishBackfill(db, "gtr_older_grants")).rejects.toThrow(
      /never started/,
    );
  });

  it("only stores a JSON object as the cursor", async () => {
    await startBackfill(db, "ch_capital_history", T0);
    await expect(
      db.execute(
        sql`UPDATE backfill_progress SET cursor = '[1, 2]'::jsonb WHERE job = 'ch_capital_history'`,
      ),
    ).rejects.toThrow();
    const [row] = await db
      .select()
      .from(backfillProgress)
      .where(eq(backfillProgress.job, "ch_capital_history"));
    expect(row?.cursor).toBeNull();
  });
});
