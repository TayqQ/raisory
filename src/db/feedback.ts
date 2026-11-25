// Anonymous site feedback (D75). The site writes it as the web role, which may
// insert and count but never read a row back: the insert has no RETURNING, and
// the count goes through `site_feedback_count_since`, a SECURITY DEFINER
// function that returns only a number.

import { sql } from "drizzle-orm";
import { type FeedbackInputRaw, feedbackInputSchema } from "@/core/feedback";
import type { Db } from "./client";
import { siteFeedback } from "./schema";

/** Checks, cleans and stores one piece of feedback. Throws a ZodError for invalid input. */
export async function insertFeedback(
  db: Db,
  input: FeedbackInputRaw,
): Promise<void> {
  const feedback = feedbackInputSchema.parse(input);
  // Only these four columns: no identifier of any kind is ever stored.
  await db.insert(siteFeedback).values({
    kind: feedback.kind,
    path: feedback.path,
    filters: feedback.filters,
    message: feedback.kind === "missing" ? feedback.message : null,
  });
}

/** How many pieces of feedback have arrived since `since`, for throttling. */
export async function recentFeedbackCount(
  db: Db,
  since: Date,
): Promise<number> {
  const result = await db.execute(
    sql`SELECT public.site_feedback_count_since(${since.toISOString()}::timestamptz) AS count`,
  );
  const rows = (result as { rows: Array<{ count: number | string }> }).rows;
  return Number(rows[0]?.count ?? 0);
}
