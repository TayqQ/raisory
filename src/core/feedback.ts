// Anonymous site feedback (D75). Pure: no I/O. `src/db/feedback.ts` stores it
// in `site_feedback`. There is no field for an email, a name or any other
// identifier, and unknown keys are rejected, so none can be added by mistake.

import { z } from "zod";

/** `missing`: the "What's missing?" box. `alerts_interest`: a click on the alerts button. */
export const FEEDBACK_KINDS = ["missing", "alerts_interest"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

// The same caps are CHECK constraints on `site_feedback`. Lengths count code
// points, as Postgres `char_length` does.
export const FEEDBACK_PATH_MAX = 200;
export const FEEDBACK_FILTERS_MAX = 500;
export const FEEDBACK_MESSAGE_MAX = 1000;

// C0 and C1 control characters and DEL, lone surrogates, and the bidirectional
// overrides and isolates, which can make stored text display out of order.
const UNSAFE = /[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069]/gu;
// The same, but keeping line feeds, so a message keeps its line breaks.
const UNSAFE_EXCEPT_LINE_FEED =
  /(?!\n)[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069]/gu;

/** Removes control characters, then trims. */
export function cleanFeedbackLine(text: string): string {
  return text.replace(UNSAFE, "").trim();
}

/** As `cleanFeedbackLine`, but line breaks become `\n` and tabs spaces. */
export function cleanFeedbackMessage(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(UNSAFE_EXCEPT_LINE_FEED, "")
    .trim();
}

function codePoints(text: string): number {
  return [...text].length;
}

function atMost(max: number) {
  return (text: string) => codePoints(text) <= max;
}

/** A page path such as `/companies/acme`, with no query, fragment or host. */
const pathSchema = z
  .string()
  .transform(cleanFeedbackLine)
  .pipe(
    z
      .string()
      .refine(atMost(FEEDBACK_PATH_MAX), {
        error: `Path is longer than ${FEEDBACK_PATH_MAX} characters`,
      })
      .regex(/^\/(?!\/)[^\s?#]*$/, {
        error: "Path must be a page path, without a query or fragment",
      }),
  );

/**
 * The page's search params as it encodes them, such as `sector=fintech&stage=seed`.
 * A leading `?` is dropped. Missing or empty becomes null.
 */
const filtersSchema = z
  .string()
  .nullish()
  .transform((text) => (text == null ? "" : cleanFeedbackLine(text)))
  .transform((text) => text.replace(/^\?/, ""))
  .pipe(
    z
      .string()
      .refine(atMost(FEEDBACK_FILTERS_MAX), {
        error: `Filters are longer than ${FEEDBACK_FILTERS_MAX} characters`,
      })
      // URL query characters only, so the field cannot carry free text.
      .regex(/^[A-Za-z0-9\-._~%!$&'()*+,;=:@/?]*$/, {
        error: "Filters must be an encoded query string",
      }),
  )
  .transform((text) => (text === "" ? null : text));

const messageSchema = z
  .string()
  .transform(cleanFeedbackMessage)
  .pipe(
    z
      .string()
      .min(1, { error: "Message is empty" })
      .refine(atMost(FEEDBACK_MESSAGE_MAX), {
        error: `Message is longer than ${FEEDBACK_MESSAGE_MAX} characters`,
      }),
  );

/** One piece of feedback from the site. Parse before storing. */
export const feedbackInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("missing"),
    path: pathSchema,
    filters: filtersSchema,
    message: messageSchema,
  }),
  // A click carries no message.
  z.strictObject({
    kind: z.literal("alerts_interest"),
    path: pathSchema,
    filters: filtersSchema,
  }),
]);

/** What a page sends. */
export type FeedbackInputRaw = z.input<typeof feedbackInputSchema>;
/** Cleaned and checked: safe to store. */
export type FeedbackInput = z.output<typeof feedbackInputSchema>;
