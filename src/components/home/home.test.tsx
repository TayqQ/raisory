import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryScope } from "@/db/queries/summary";
import type { SummaryPeriod, SummaryState } from "@/lib/view-preference";
import type {
  FundingFilters,
  FundingRow,
  FundingSummary as FundingSummaryData,
} from "@/core/read-models";
import {
  FundingSummary,
  describeChange,
  describeScope,
  sectorBars,
} from "./funding-summary";
import { sectorBarItems } from "./sector-bars";
import { SummaryPeriodLinks } from "./summary-period";
import {
  ShowSummaryButton,
  SummaryFrame,
  SummaryProvider,
} from "./summary-state";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

/** The last 30 days to 18 November 2026, compared with the 31 days before. */
const SCOPE: SummaryScope = {
  period: "30d",
  periodRange: { from: "2026-10-19", to: "2026-11-18" },
  range: { from: "2026-10-19", to: "2026-11-18" },
  previous: { from: "2026-09-18", to: "2026-10-18" },
};

const HREFS: Record<SummaryPeriod, string> = {
  "7d": "/?summary=7d",
  "30d": "/?summary=30d",
  "90d": "/?summary=90d",
  "12m": "/?summary=12m",
};

function filters(overrides: Partial<FundingFilters> = {}): FundingFilters {
  return { page: 1, pageSize: 25, ...overrides };
}

function round(name: string, gbp: number): FundingRow {
  return {
    eventId: gbp,
    companyId: gbp,
    companySlug: name.toLowerCase().replace(/\s+/g, "-"),
    companyName: name,
    countryCode: "GB",
    city: "London",
    companyDescription: null,
    mainSector: "financial-services",
    websiteDomain: null,
    roundType: "series_b",
    roundLabel: null,
    amount: { amountMinor: gbp, currency: "GBP" },
    amountGbpMinor: gbp,
    amountUsdMinor: null,
    announcedOn: "2026-11-01",
    leadInvestors: [],
    investorCount: 0,
    sourceCount: 1,
    tags: [],
  };
}

function summary(
  overrides: Partial<FundingSummaryData> = {},
): FundingSummaryData {
  return {
    totalGbpMinor: 4_200_000_000,
    count: 12,
    medianGbpMinor: 150_000_000,
    previous: {
      totalGbpMinor: 3_000_000_000,
      count: 15,
      medianGbpMinor: 150_000_000,
    },
    sectors: [
      { sector: "financial-services", gbpMinor: 3_000_000_000, count: 4 },
      { sector: "health-life-sciences", gbpMinor: 1_200_000_000, count: 6 },
      { sector: null, gbpMinor: 0, count: 2 },
    ],
    biggest: [
      round("Ledger Bank", 2_000_000_000),
      round("Pay Kit", 600_000_000),
      round("Coin Co", 400_000_000),
    ],
    ...overrides,
  };
}

describe("describeScope", () => {
  it("states the period and the days compared with", () => {
    expect(describeScope(SCOPE)).toEqual({
      heading: "Last 30 days · 19 Oct to 18 Nov 2026",
      note: null,
      previous: "18 Sep to 18 Oct 2026",
    });
  });

  it("says so when the list's dates cut the period", () => {
    const words = describeScope({
      ...SCOPE,
      range: { from: "2026-11-01", to: "2026-11-18" },
      previous: { from: "2026-10-14", to: "2026-10-31" },
    });
    expect(words.heading).toBe("Last 30 days · 19 Oct to 18 Nov 2026");
    expect(words.note).toBe(
      "Covers 1 Nov to 18 Nov 2026 only, where this period overlaps the list's dates.",
    );
  });

  it("says so when the list's dates miss the period", () => {
    const words = describeScope({
      period: "12m",
      periodRange: { from: "2025-11-18", to: "2026-11-18" },
      range: null,
      previous: null,
    });
    expect(words.heading).toBe("Last 12 months · 18 Nov 2025 to 18 Nov 2026");
    expect(words.note).toMatch(/fall outside this period/);
    expect(words.previous).toBeNull();
  });
});

describe("describeChange", () => {
  it("says the change in words", () => {
    expect(describeChange(4_200, 3_000)).toEqual({
      direction: "up",
      text: "Up 40%",
    });
    expect(describeChange(12, 15)).toEqual({
      direction: "down",
      text: "Down 20%",
    });
    expect(describeChange(5, 5).text).toBe("Level");
    expect(describeChange(5, 0)).toEqual({
      direction: "none",
      text: "Nothing to compare",
    });
    expect(describeChange(null, 5).text).toBe("Nothing to compare");
    expect(describeChange(1001, 1000).text).toBe("Up less than 1%");
  });
});

function renderSummary(
  data: FundingSummaryData = summary(),
  {
    scope = SCOPE,
    list = filters(),
  }: { scope?: SummaryScope; list?: FundingFilters } = {},
) {
  return render(
    <FundingSummary
      summary={data}
      filters={list}
      scope={scope}
      periodHrefs={HREFS}
    />,
  );
}

describe("FundingSummary", () => {
  it("shows the headline against the period before", () => {
    renderSummary();
    expect(
      screen.getByRole("heading", { name: "What's happening" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Last 30 days · 19 Oct to 18 Nov 2026"),
    ).toBeInTheDocument();
    expect(screen.getByText("£42.0m")).toBeInTheDocument();
    expect(screen.getByText("Up 40%")).toBeInTheDocument();
    expect(screen.getByText("Down 20%")).toBeInTheDocument();
    expect(screen.getByText("Level")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Changes compare with 18 Sep to 18 Oct 2026, the period of the same length before.",
      ),
    ).toBeInTheDocument();
  });

  it("is a panel with a header, the period control and Hide summary", () => {
    renderSummary();
    const section = screen
      .getByRole("heading", { name: "What's happening" })
      .closest("section");
    expect(section?.className ?? "").toMatch(/border/);
    expect(section?.className ?? "").toMatch(/rounded/);
    expect(section?.querySelector("header")).not.toBeNull();
    // The close button says what it does, in words.
    expect(
      screen.getByRole("button", { name: "Hide summary" }),
    ).toHaveTextContent("Hide summary");
    expect(
      screen.getByRole("checkbox", { name: "Keep hidden by default" }),
    ).not.toBeChecked();
    const group = screen.getByRole("group", { name: "Summary period" });
    expect(
      within(group)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["7 days", "30 days", "90 days", "12 months"]);
  });

  it("says when the summary matches the list's other filters", () => {
    renderSummary(summary(), {
      list: filters({ sectors: ["financial-services"] }),
    });
    expect(
      screen.getByText(
        "Last 30 days · 19 Oct to 18 Nov 2026 · rounds matching your filters",
      ),
    ).toBeInTheDocument();
  });

  it("notes the overlap when the list's dates cut the period", () => {
    renderSummary(summary(), {
      scope: {
        ...SCOPE,
        range: { from: "2026-11-01", to: "2026-11-18" },
        previous: { from: "2026-10-14", to: "2026-10-31" },
      },
      list: filters({ from: "2026-11-01" }),
    });
    expect(
      screen.getByText(/Covers 1 Nov to 18 Nov 2026 only/),
    ).toBeInTheDocument();
    // The header still states the whole period.
    expect(
      screen.getByText("Last 30 days · 19 Oct to 18 Nov 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Changes compare with 14 Oct to 31 Oct 2026/),
    ).toBeInTheDocument();
  });

  it("says so for an empty period", () => {
    renderSummary(
      summary({
        totalGbpMinor: 0,
        count: 0,
        medianGbpMinor: null,
        previous: { totalGbpMinor: 9, count: 3, medianGbpMinor: 3 },
        sectors: [],
        biggest: [],
      }),
    );
    expect(screen.getByText("No rounds in this period")).toBeInTheDocument();
    expect(
      screen.getByText(
        /3 rounds in the period before \(18 Sep to 18 Oct 2026\)/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Biggest rounds")).toBeNull();
  });

  it("explains when the list's dates miss the period", () => {
    renderSummary(
      summary({
        totalGbpMinor: 0,
        count: 0,
        medianGbpMinor: null,
        previous: null,
        sectors: [],
        biggest: [],
      }),
      {
        scope: { ...SCOPE, period: "7d", range: null, previous: null },
        list: filters({ from: "2026-01-01", to: "2026-01-31" }),
      },
    );
    expect(screen.getByText(/fall outside this period/)).toBeInTheDocument();
    expect(screen.getByText(/Choose a longer period/)).toBeInTheDocument();
    expect(
      screen.getByText("No earlier period to compare with."),
    ).toBeInTheDocument();
  });

  it("links each named sector bar to that sector filter", () => {
    renderSummary(summary(), {
      list: filters({
        from: "2026-10-19",
        sectors: ["software-ai"],
        themes: ["generative-ai"],
        sort: "amount",
        page: 3,
      }),
    });
    const link = screen.getByRole("link", { name: /Financial services/ });
    const params = new URLSearchParams(
      (link.getAttribute("href") ?? "").split("?")[1],
    );
    expect(params.getAll("sector")).toEqual(["financial-services"]);
    expect(params.get("theme")).toBeNull();
    expect(params.get("from")).toBe("2026-10-19");
    expect(params.get("sort")).toBe("amount");
    expect(params.get("page")).toBeNull();
    // "Sector pending" is not a filter, so it is not a link.
    expect(screen.queryByRole("link", { name: /Sector pending/ })).toBeNull();
    expect(screen.getByText("Sector pending")).toBeInTheDocument();
  });

  it("lists the three biggest rounds", () => {
    renderSummary();
    const names = screen
      .getAllByRole("listitem")
      .map((item) => within(item).queryByRole("link")?.textContent)
      .filter((name) => name && !name.includes("£"));
    expect(names).toEqual(
      expect.arrayContaining(["Ledger Bank", "Pay Kit", "Coin Co"]),
    );
  });
});

describe("SummaryPeriodLinks", () => {
  beforeEach(() => {
    replace.mockClear();
    document.cookie = "raisory_summary_period=; Path=/; Max-Age=0";
  });

  it("is a row of links to ?summary=, with the current one marked", () => {
    render(<SummaryPeriodLinks period="30d" hrefs={HREFS} />);
    const group = screen.getByRole("group", { name: "Summary period" });
    expect(within(group).getByRole("link", { name: "7 days" })).toHaveAttribute(
      "href",
      "/?summary=7d",
    );
    expect(
      within(group).getByRole("link", { name: "30 days" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(group).getByRole("link", { name: "12 months" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("remembers a choice for the session and replaces the URL", () => {
    render(<SummaryPeriodLinks period="30d" hrefs={HREFS} />);
    act(() => {
      fireEvent.click(screen.getByRole("link", { name: "90 days" }));
    });
    expect(document.cookie).toContain("raisory_summary_period=90d");
    expect(replace).toHaveBeenCalledWith("/?summary=90d", { scroll: false });
  });

  it("leaves a modified click to the browser", () => {
    render(<SummaryPeriodLinks period="30d" hrefs={HREFS} />);
    const link = screen.getByRole("link", { name: "7 days" });
    // jsdom cannot open a new tab, so stop the browser's own handling here.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link, { metaKey: true });
    expect(replace).not.toHaveBeenCalled();
  });
});

function readCookie(): string | undefined {
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith("raisory_summary="))
    ?.slice("raisory_summary=".length);
}

describe("summary state", () => {
  beforeEach(() => {
    document.cookie = "raisory_summary=; Path=/; Max-Age=0";
  });

  function page(initial: SummaryState) {
    return render(
      <SummaryProvider initial={initial}>
        <SummaryFrame>
          <FundingSummary
            summary={summary()}
            filters={filters()}
            scope={SCOPE}
            periodHrefs={HREFS}
          />
        </SummaryFrame>
        <ShowSummaryButton />
      </SummaryProvider>,
    );
  }

  const heading = () =>
    screen.queryByRole("heading", { name: "What's happening" });
  const showButton = () =>
    screen.queryByRole("button", { name: "Show summary" });

  it("is open by default; close removes it and sets the session cookie", () => {
    page("open");
    expect(heading()).toBeInTheDocument();
    expect(showButton()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide summary" }));
    // The whole section, header included, leaves the page.
    expect(heading()).toBeNull();
    expect(readCookie()).toBe("closed");
    expect(showButton()).toHaveFocus();
  });

  it("starts hidden when closed for the session; Show summary clears it", () => {
    page("closed");
    expect(heading()).toBeNull();
    fireEvent.click(showButton() as HTMLElement);
    expect(heading()).toBeInTheDocument();
    expect(showButton()).toBeNull();
    expect(readCookie()).toBeUndefined();
    expect(screen.getByRole("button", { name: "Hide summary" })).toHaveFocus();
  });

  it("keeps hidden by default with the one-year cookie", () => {
    page("open");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Keep hidden by default" }),
    );
    expect(readCookie()).toBe("hidden");
    // It stays on the page until the next load.
    expect(heading()).toBeInTheDocument();
  });

  it("opens for this visit when hidden by default, keeping the cookie", () => {
    document.cookie = "raisory_summary=hidden; Path=/";
    page("hidden");
    expect(heading()).toBeNull();
    fireEvent.click(showButton() as HTMLElement);
    expect(heading()).toBeInTheDocument();
    expect(readCookie()).toBe("hidden");
    const keep = screen.getByRole("checkbox", {
      name: "Keep hidden by default",
    });
    expect(keep).toBeChecked();
    // Closing again leaves the preference alone.
    fireEvent.click(screen.getByRole("button", { name: "Hide summary" }));
    expect(readCookie()).toBe("hidden");
  });

  it("removes the persistent cookie when Keep hidden is unticked", () => {
    document.cookie = "raisory_summary=hidden; Path=/";
    page("hidden");
    fireEvent.click(showButton() as HTMLElement);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Keep hidden by default" }),
    );
    expect(readCookie()).toBeUndefined();
    expect(heading()).toBeInTheDocument();
  });
});

describe("sectorBarItems", () => {
  const bars = sectorBars(summary(), filters());

  it("ranks by £ or by rounds, with Sector pending last", () => {
    expect(sectorBarItems(bars, "gbp").map((item) => item.label)).toEqual([
      "Financial services",
      "Health and life sciences",
      "Sector pending",
    ]);
    const byCount = sectorBarItems(bars, "count");
    expect(byCount.map((item) => item.label)).toEqual([
      "Health and life sciences",
      "Financial services",
      "Sector pending",
    ]);
    expect(byCount[0]?.valueLabel).toBe("6 rounds");
  });
});
