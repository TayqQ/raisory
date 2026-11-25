import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  BACKFILL_JOBS,
  backfillCursorSchemas,
  backfillJobSchema,
  parseBackfillCursor,
} from "./backfill";

/** Through JSON, as the jsonb column stores it. */
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("backfill jobs", () => {
  it("have a cursor schema each", () => {
    expect(Object.keys(backfillCursorSchemas).sort()).toEqual(
      [...BACKFILL_JOBS].sort(),
    );
  });

  it("reject an unknown job name", () => {
    expect(() => backfillJobSchema.parse("ch_everything")).toThrow(ZodError);
    expect(() => parseBackfillCursor("nope" as never, {})).toThrow(ZodError);
  });
});

describe("parseBackfillCursor", () => {
  it("round-trips a Companies House capital history cursor", () => {
    const cursor = { lastCompanyId: 4812 };
    expect(
      parseBackfillCursor("ch_capital_history", roundTrip(cursor)),
    ).toEqual(cursor);
    expect(
      parseBackfillCursor("ch_capital_history", { lastCompanyId: 0 }),
    ).toEqual({ lastCompanyId: 0 });
  });

  it("round-trips an older grants cursor, with and without a start date", () => {
    for (const cursor of [
      { nextPage: 1, oldestStartSeen: null },
      { nextPage: 37, oldestStartSeen: "2019-04-01" },
    ]) {
      expect(
        parseBackfillCursor("gtr_older_grants", roundTrip(cursor)),
      ).toEqual(cursor);
    }
  });

  it.each([
    ["a missing field", {}],
    ["a string id", { lastCompanyId: "4812" }],
    ["a fractional id", { lastCompanyId: 1.5 }],
    ["a negative id", { lastCompanyId: -1 }],
    ["an unknown key", { lastCompanyId: 1, lastCompanyNumber: "01234567" }],
    ["the other job's cursor", { nextPage: 2, oldestStartSeen: null }],
    ["null", null],
  ])("rejects a capital history cursor with %s", (_, cursor) => {
    expect(() => parseBackfillCursor("ch_capital_history", cursor)).toThrow(
      ZodError,
    );
  });

  it.each([
    ["page 0", { nextPage: 0, oldestStartSeen: null }],
    ["a missing start date key", { nextPage: 2 }],
    [
      "a timestamp for the date",
      { nextPage: 2, oldestStartSeen: "2019-04-01T00:00:00Z" },
    ],
    ["an impossible date", { nextPage: 2, oldestStartSeen: "2019-02-30" }],
    ["an unknown key", { nextPage: 2, oldestStartSeen: null, done: true }],
  ])("rejects an older grants cursor with %s", (_, cursor) => {
    expect(() => parseBackfillCursor("gtr_older_grants", cursor)).toThrow(
      ZodError,
    );
  });
});
