import { describe, expect, it } from "vitest";
import {
  parseListView,
  parseSummaryPeriod,
  parseSummaryState,
  resolveListView,
  resolveSummaryPeriod,
  summaryCookie,
  summaryPeriodCookie,
  viewCookie,
  withSummaryParam,
  withViewParam,
} from "./view-preference";

describe("resolveListView", () => {
  it("is Cards with no cookie and no parameter", () => {
    expect(resolveListView({})).toBe("cards");
  });

  it("uses the cookie on its own", () => {
    expect(resolveListView({ cookie: "cards" })).toBe("cards");
    expect(resolveListView({ cookie: "list" })).toBe("list");
  });

  it("lets ?view override the cookie", () => {
    expect(resolveListView({ param: "list", cookie: "cards" })).toBe("list");
    expect(resolveListView({ param: "cards", cookie: "list" })).toBe("cards");
    expect(resolveListView({ param: ["cards", "list"] })).toBe("cards");
  });

  it("ignores invalid values and falls through to the next source", () => {
    expect(resolveListView({ param: "grid", cookie: "cards" })).toBe("cards");
    expect(resolveListView({ param: "", cookie: "tiles" })).toBe("cards");
    expect(resolveListView({ param: 3, cookie: undefined })).toBe("cards");
    expect(parseListView(" Cards ")).toBe("cards");
    expect(parseListView("table")).toBeUndefined();
  });

  it("shows List for the retired split view, from a link or a cookie", () => {
    expect(parseListView("split")).toBe("list");
    expect(resolveListView({ param: "split", cookie: "cards" })).toBe("list");
    expect(resolveListView({ cookie: "split" })).toBe("list");
  });
});

describe("cookies", () => {
  it("remembers the view for a year, site-wide, SameSite=Lax", () => {
    expect(viewCookie("cards")).toBe(
      "raisory_view=cards; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});

describe("summary state", () => {
  it("is open with no cookie or an unknown value", () => {
    expect(parseSummaryState(undefined)).toBe("open");
    expect(parseSummaryState("")).toBe("open");
    expect(parseSummaryState("open")).toBe("open");
    expect(parseSummaryState(3)).toBe("open");
  });

  it("reads closed for the session and hidden by default", () => {
    expect(parseSummaryState("closed")).toBe("closed");
    expect(parseSummaryState(" hidden ")).toBe("hidden");
  });

  it("writes closed as a session cookie, with no Max-Age", () => {
    expect(summaryCookie("closed")).toBe(
      "raisory_summary=closed; Path=/; SameSite=Lax",
    );
  });

  it("keeps hidden by default for a year", () => {
    expect(summaryCookie("hidden")).toBe(
      "raisory_summary=hidden; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  it("clears the cookie to open it", () => {
    expect(summaryCookie("open")).toBe(
      "raisory_summary=; Path=/; Max-Age=0; SameSite=Lax",
    );
  });
});

describe("summary period", () => {
  it("is 30 days with no parameter and no cookie", () => {
    expect(resolveSummaryPeriod({})).toBe("30d");
  });

  it("lets ?summary override the cookie", () => {
    expect(resolveSummaryPeriod({ param: "7d", cookie: "90d" })).toBe("7d");
    expect(resolveSummaryPeriod({ cookie: "12m" })).toBe("12m");
    expect(resolveSummaryPeriod({ param: ["90d", "7d"] })).toBe("90d");
  });

  it("ignores invalid values", () => {
    expect(resolveSummaryPeriod({ param: "1y", cookie: "all" })).toBe("30d");
    expect(resolveSummaryPeriod({ param: "", cookie: "7d" })).toBe("7d");
    expect(parseSummaryPeriod(" 12M ")).toBe("12m");
    expect(parseSummaryPeriod(30)).toBeUndefined();
  });

  it("remembers the period for the session", () => {
    expect(summaryPeriodCookie("90d")).toBe(
      "raisory_summary_period=90d; Path=/; SameSite=Lax",
    );
  });

  it("sets ?summary, the default too, and keeps the other parameters", () => {
    expect(withSummaryParam("/?sector=fintech&page=2", "7d")).toBe(
      "/?sector=fintech&page=2&summary=7d",
    );
    expect(withSummaryParam("/?summary=7d&view=cards", "30d")).toBe(
      "/?summary=30d&view=cards",
    );
    expect(withSummaryParam("/", "12m")).toBe("/?summary=12m");
  });
});

describe("withViewParam", () => {
  it("sets the view and keeps the other parameters", () => {
    expect(withViewParam("/?sector=fintech&page=2", "list")).toBe(
      "/?sector=fintech&page=2&view=list",
    );
  });

  it("drops the parameter for Cards, the default", () => {
    expect(withViewParam("/?view=list&q=acme", "cards")).toBe("/?q=acme");
    expect(withViewParam("/?view=list", "cards")).toBe("/");
  });
});
