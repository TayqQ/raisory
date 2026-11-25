// Backfill jobs and their saved cursors (D75). Pure: no I/O.
// `src/db/backfill-progress.ts` stores them in `backfill_progress`.

import { z } from "zod";

/**
 * Every backfill job. The database stores the name as plain text, so adding a
 * job needs no migration: append it here with its cursor schema.
 */
export const BACKFILL_JOBS = [
  "ch_capital_history",
  "gtr_older_grants",
] as const;

export const backfillJobSchema = z.enum(BACKFILL_JOBS);
export type BackfillJob = z.infer<typeof backfillJobSchema>;

/** Where each job carries on from. Unknown keys are rejected, so a typo never saves. */
export const backfillCursorSchemas = {
  /** Companies House capital history: the last company id done, in id order. */
  ch_capital_history: z.strictObject({
    lastCompanyId: z.number().int().nonnegative(),
  }),
  /** Older Gateway to Research grants: the next page to fetch, and the oldest start date seen. */
  gtr_older_grants: z.strictObject({
    nextPage: z.number().int().positive(),
    /** A project start date, YYYY-MM-DD, or null before any project is seen. */
    oldestStartSeen: z.iso.date().nullable(),
  }),
} as const satisfies Record<BackfillJob, z.ZodType>;

export type BackfillCursor<J extends BackfillJob> = z.infer<
  (typeof backfillCursorSchemas)[J]
>;

/** The job's cursor, or a `ZodError` when `value` is not one. */
export function parseBackfillCursor<J extends BackfillJob>(
  job: J,
  value: unknown,
): BackfillCursor<J> {
  const schema = backfillCursorSchemas[backfillJobSchema.parse(job)];
  return schema.parse(value) as BackfillCursor<J>;
}
