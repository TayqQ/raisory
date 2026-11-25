// Where each backfill job has got to, so a run that stops can resume (D75).
// The pipeline owns these rows; every cursor is checked against its job's
// schema on the way in and on the way out.

import { and, eq, isNull } from "drizzle-orm";
import {
  type BackfillCursor,
  type BackfillJob,
  backfillJobSchema,
  parseBackfillCursor,
} from "@/core/backfill";
import type { Db } from "./client";
import { backfillProgress } from "./schema";

export interface BackfillProgress<J extends BackfillJob> {
  job: J;
  /** Null until the first `saveBackfillCursor`. */
  cursor: BackfillCursor<J> | null;
  startedAt: Date;
  updatedAt: Date;
  /** Null until `finishBackfill`. */
  finishedAt: Date | null;
}

type Row = typeof backfillProgress.$inferSelect;

function toProgress<J extends BackfillJob>(
  job: J,
  row: Row,
): BackfillProgress<J> {
  return {
    job,
    cursor: row.cursor == null ? null : parseBackfillCursor(job, row.cursor),
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  };
}

/** The job's progress, or null if it has never started. Throws if the stored cursor no longer fits its schema. */
export async function getBackfillProgress<J extends BackfillJob>(
  db: Db,
  job: J,
): Promise<BackfillProgress<J> | null> {
  backfillJobSchema.parse(job);
  const [row] = await db
    .select()
    .from(backfillProgress)
    .where(eq(backfillProgress.job, job));
  return row ? toProgress(job, row) : null;
}

/**
 * Starts the job if it has never started, and returns its progress. A job that
 * has already started, or finished, is left as it is, so a rerun resumes from
 * its cursor (or sees `finishedAt` and stops).
 */
export async function startBackfill<J extends BackfillJob>(
  db: Db,
  job: J,
  now: Date = new Date(),
): Promise<BackfillProgress<J>> {
  backfillJobSchema.parse(job);
  await db
    .insert(backfillProgress)
    .values({ job, cursor: null, startedAt: now, updatedAt: now })
    .onConflictDoNothing({ target: backfillProgress.job });
  const progress = await getBackfillProgress(db, job);
  if (!progress) throw new Error(`Backfill ${job} did not start`);
  return progress;
}

/** Records how far an unfinished job has got. Throws if the cursor is invalid, or the job is not started or already finished. */
export async function saveBackfillCursor<J extends BackfillJob>(
  db: Db,
  job: J,
  cursor: BackfillCursor<J>,
  now: Date = new Date(),
): Promise<void> {
  const checked = parseBackfillCursor(job, cursor);
  const updated = await db
    .update(backfillProgress)
    .set({ cursor: checked, updatedAt: now })
    .where(
      and(eq(backfillProgress.job, job), isNull(backfillProgress.finishedAt)),
    )
    .returning({ job: backfillProgress.job });
  if (updated.length === 0) {
    throw new Error(`Backfill ${job} is not running: start it first`);
  }
}

/** Marks the job done, keeping its last cursor. Finishing it again changes nothing. Throws if it never started. */
export async function finishBackfill(
  db: Db,
  job: BackfillJob,
  now: Date = new Date(),
): Promise<void> {
  backfillJobSchema.parse(job);
  await db
    .update(backfillProgress)
    .set({ finishedAt: now, updatedAt: now })
    .where(
      and(eq(backfillProgress.job, job), isNull(backfillProgress.finishedAt)),
    );
  const progress = await getBackfillProgress(db, job);
  if (!progress) throw new Error(`Backfill ${job} never started`);
}
