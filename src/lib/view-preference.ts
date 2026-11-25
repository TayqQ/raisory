/**
 * The visitor's list view and summary state (docs/design/design-system.md
 * sections 1 and 2). They live in cookies the server reads, so the first paint
 * is already right. `?view=` overrides the view cookie and `?summary=` the
 * summary period cookie for one visit, which makes those links shareable.
 * Pure helpers: the page reads the cookies, the client writes them with the
 * strings built here.
 */

export const LIST_VIEWS = ["list", "cards"] as const;
export type ListView = (typeof LIST_VIEWS)[number];

export const DEFAULT_LIST_VIEW: ListView = "cards";

export const VIEW_COOKIE = "raisory_view";
export const SUMMARY_COOKIE = "raisory_summary";
/** The URL parameter that overrides the view cookie. */
export const VIEW_PARAM = "view";

/** One year, in seconds. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** A view that no longer exists, kept so old links and cookies show List. */
const RETIRED_VIEWS: ReadonlySet<string> = new Set(["split"]);

/** A valid view from a parameter or cookie. A retired view reads as List. */
export function parseListView(value: unknown): ListView | undefined {
  const text: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  if (typeof text !== "string") return undefined;
  const lower = text.trim().toLowerCase();
  if (RETIRED_VIEWS.has(lower)) return "list";
  return LIST_VIEWS.find((view) => view === lower);
}

/** The view to render: a valid `?view=` first, then a valid cookie, then Cards. */
export function resolveListView({
  param,
  cookie,
}: {
  param?: unknown;
  cookie?: unknown;
}): ListView {
  return parseListView(param) ?? parseListView(cookie) ?? DEFAULT_LIST_VIEW;
}

/** The `document.cookie` assignment that remembers a view for a year. */
export function viewCookie(view: ListView): string {
  return `${VIEW_COOKIE}=${view}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * The summary's state from the `raisory_summary` cookie:
 * - `open`: no cookie (the default);
 * - `closed`: closed for this browser session (a session cookie);
 * - `hidden`: hidden by default (a one-year cookie). "Show summary" then
 *   opens it for this visit without changing the cookie.
 */
export type SummaryState = "open" | "closed" | "hidden";

export function parseSummaryState(cookie: unknown): SummaryState {
  if (typeof cookie !== "string") return "open";
  const value = cookie.trim();
  return value === "closed" || value === "hidden" ? value : "open";
}

/**
 * The `document.cookie` assignment for a summary state: `closed` is a session
 * cookie (no Max-Age), `hidden` lasts a year, and `open` clears the cookie.
 */
export function summaryCookie(state: SummaryState): string {
  if (state === "closed")
    return `${SUMMARY_COOKIE}=closed; Path=/; SameSite=Lax`;
  if (state === "hidden") {
    return `${SUMMARY_COOKIE}=hidden; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
  return `${SUMMARY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * `href` (path plus query) with the view set: Cards, the default, drops the
 * parameter, so the plain URL stays canonical. Paging and filters are kept.
 */
export function withViewParam(href: string, view: ListView): string {
  const [pathPart, ...rest] = href.split("?");
  const path = pathPart || "/";
  const params = new URLSearchParams(rest.join("?"));
  if (view === DEFAULT_LIST_VIEW) params.delete(VIEW_PARAM);
  else params.set(VIEW_PARAM, view);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** The periods the summary covers, shortest first. */
export const SUMMARY_PERIODS = ["7d", "30d", "90d", "12m"] as const;
export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number];

export const DEFAULT_SUMMARY_PERIOD: SummaryPeriod = "30d";

/** The URL parameter that holds the summary period. */
export const SUMMARY_PARAM = "summary";
/** Remembers the period for this browser session, as filters drop `?summary=`. */
export const SUMMARY_PERIOD_COOKIE = "raisory_summary_period";

/** "Last 30 days": the header's statement of the period. */
export const SUMMARY_PERIOD_LABELS: Readonly<Record<SummaryPeriod, string>> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "12m": "Last 12 months",
};

/** "30 days": the period control's option text. */
export const SUMMARY_PERIOD_OPTIONS: Readonly<Record<SummaryPeriod, string>> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

export function parseSummaryPeriod(value: unknown): SummaryPeriod | undefined {
  const text: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  if (typeof text !== "string") return undefined;
  const lower = text.trim().toLowerCase();
  return SUMMARY_PERIODS.find((period) => period === lower);
}

/** The period to summarise: a valid `?summary=`, then the cookie, then 30 days. */
export function resolveSummaryPeriod({
  param,
  cookie,
}: {
  param?: unknown;
  cookie?: unknown;
}): SummaryPeriod {
  return (
    parseSummaryPeriod(param) ??
    parseSummaryPeriod(cookie) ??
    DEFAULT_SUMMARY_PERIOD
  );
}

/** The `document.cookie` assignment that remembers a period for the session. */
export function summaryPeriodCookie(period: SummaryPeriod): string {
  return `${SUMMARY_PERIOD_COOKIE}=${period}; Path=/; SameSite=Lax`;
}

/**
 * `href` (path plus query) with `?summary=` set. Every period is written, the
 * default too, so a link overrides a remembered period. Other parameters are
 * kept.
 */
export function withSummaryParam(href: string, period: SummaryPeriod): string {
  const [pathPart, ...rest] = href.split("?");
  const path = pathPart || "/";
  const params = new URLSearchParams(rest.join("?"));
  params.set(SUMMARY_PARAM, period);
  return `${path}?${params.toString()}`;
}
