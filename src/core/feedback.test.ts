import { describe, expect, it } from "vitest";
import {
  cleanFeedbackLine,
  cleanFeedbackMessage,
  FEEDBACK_FILTERS_MAX,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PATH_MAX,
  feedbackInputSchema,
} from "./feedback";

function parse(input: unknown) {
  return feedbackInputSchema.safeParse(input);
}

describe("cleanFeedbackLine", () => {
  it("removes control characters and bidirectional overrides, then trims", () => {
    expect(
      cleanFeedbackLine("  /a\u0000b\u0007c\u007f\u0085\u202Ed\u2066  "),
    ).toBe("/abcd");
    expect(cleanFeedbackLine("a\nb\tc")).toBe("abc");
  });

  it("removes lone surrogates but keeps emoji", () => {
    expect(cleanFeedbackLine("a\uD800b\uDC00c 🚀")).toBe("abc 🚀");
  });
});

describe("cleanFeedbackMessage", () => {
  it("keeps line breaks, turns tabs into spaces and removes other controls", () => {
    expect(
      cleanFeedbackMessage(" one\r\ntwo\rthree\tfour\u0000\u001b[31m "),
    ).toBe("one\ntwo\nthree four[31m");
  });
});

describe("feedbackInputSchema", () => {
  it("accepts a missing-data message and cleans it", () => {
    const result = parse({
      kind: "missing",
      path: " /companies/acme ",
      message: "  No Series B for Acme\u0000.\n\nThanks  ",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      kind: "missing",
      path: "/companies/acme",
      filters: null,
      message: "No Series B for Acme.\n\nThanks",
    });
  });

  it("accepts interest in alerts with the page's filters and no message", () => {
    const result = parse({
      kind: "alerts_interest",
      path: "/funding",
      filters: "?sector=fintech&stage=seed&q=open%20banking",
    });
    expect(result.data).toEqual({
      kind: "alerts_interest",
      path: "/funding",
      filters: "sector=fintech&stage=seed&q=open%20banking",
    });
  });

  it("stores empty or missing filters as null", () => {
    for (const filters of [undefined, null, "", "  ", "?"]) {
      const result = parse({ kind: "alerts_interest", path: "/", filters });
      expect(result.success, String(filters)).toBe(true);
      expect(result.data?.filters).toBeNull();
    }
  });

  it.each([
    ["empty", ""],
    ["only spaces and line breaks", "  \n\t \r\n "],
    ["only control characters", "\u0000\u0007\u202E"],
  ])("rejects a message that is %s", (_, message) => {
    expect(parse({ kind: "missing", path: "/", message }).success).toBe(false);
  });

  it("rejects a missing-data entry with no message", () => {
    expect(parse({ kind: "missing", path: "/" }).success).toBe(false);
  });

  it("enforces each cap, counting code points", () => {
    const longPath = `/${"a".repeat(FEEDBACK_PATH_MAX - 1)}`;
    const longFilters = `q=${"a".repeat(FEEDBACK_FILTERS_MAX - 2)}`;
    const longMessage = "🚀".repeat(FEEDBACK_MESSAGE_MAX);

    expect(
      parse({
        kind: "missing",
        path: longPath,
        filters: longFilters,
        message: longMessage,
      }).success,
    ).toBe(true);
    expect(
      parse({ kind: "missing", path: `${longPath}a`, message: "x" }).success,
    ).toBe(false);
    expect(
      parse({ kind: "alerts_interest", path: "/", filters: `${longFilters}a` })
        .success,
    ).toBe(false);
    expect(
      parse({ kind: "missing", path: "/", message: `${longMessage}a` }).success,
    ).toBe(false);
  });

  it("checks length after trimming", () => {
    const message = ` ${"a".repeat(FEEDBACK_MESSAGE_MAX)} `;
    expect(parse({ kind: "missing", path: "/", message }).success).toBe(true);
  });

  it.each([
    ["no leading slash", "companies"],
    ["a query", "/funding?sector=fintech"],
    ["a fragment", "/funding#top"],
    ["a host", "//evil.example/path"],
    ["a full URL", "https://evil.example/"],
    ["a space", "/a b"],
    ["nothing", "   "],
  ])("rejects a path with %s", (_, path) => {
    expect(parse({ kind: "missing", path, message: "x" }).success).toBe(false);
  });

  it("rejects filters that are free text rather than an encoded query", () => {
    expect(
      parse({ kind: "alerts_interest", path: "/", filters: "my name is Alex" })
        .success,
    ).toBe(false);
    expect(
      parse({ kind: "alerts_interest", path: "/", filters: "q=<script>" })
        .success,
    ).toBe(false);
  });

  it("rejects a message on interest in alerts", () => {
    expect(
      parse({ kind: "alerts_interest", path: "/", message: "hello" }).success,
    ).toBe(false);
  });

  it("rejects any other field, so no identifier can be sent", () => {
    for (const extra of [
      { email: "someone@example.com" },
      { ip: "203.0.113.7" },
      { userAgent: "Mozilla/5.0" },
      { createdAt: "2020-01-01T00:00:00Z" },
    ]) {
      expect(
        parse({ kind: "missing", path: "/", message: "x", ...extra }).success,
      ).toBe(false);
    }
  });

  it("rejects an unknown kind", () => {
    expect(parse({ kind: "praise", path: "/", message: "x" }).success).toBe(
      false,
    );
  });
});
