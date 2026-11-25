import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RoundType } from "@/core/enums";
import type { FundingFilters } from "@/core/read-models";
import { SECTORS, SECTOR_LABELS } from "@/core/sectors";
import { normaliseCompanyName, slugify } from "@/lib/normalise";
import type { Db } from "../client";
import {
  companies,
  companySectors,
  companyThemes,
  events,
  fundingRounds,
  tags,
  themes,
} from "../schema";
import { createTestDb, type TestDb } from "../testing";
import {
  getFundingSummary,
  getSectorCounts,
  previousWindow,
  summaryPeriodRange,
  summaryRange,
  summaryScope,
} from "./summary";

async function addCompany(db: Db, name: string): Promise<number> {
  const [row] = await db
    .insert(companies)
    .values({
      slug: slugify(name),
      name,
      normalisedName: normaliseCompanyName(name),
      countryCode: "GB",
    })
    .returning({ id: companies.id });
  if (!row) throw new Error("Company insert failed");
  return row.id;
}

async function addRound(
  db: Db,
  companyId: number,
  date: string,
  gbp: number | null,
  type: RoundType = "seed",
): Promise<number> {
  const [event] = await db
    .insert(events)
    .values({ type: "funding_round", companyId, announcedOn: date })
    .returning({ id: events.id });
  if (!event) throw new Error("Event insert failed");
  await db.insert(fundingRounds).values({
    eventId: event.id,
    roundType: type,
    amountMinor: gbp,
    currency: gbp == null ? null : "GBP",
    amountGbpMinor: gbp,
  });
  return event.id;
}

async function addTheme(db: Db, slug: string, sector: string): Promise<number> {
  const [tag] = await db
    .insert(tags)
    .values({ slug: `tag-${slug}`, label: slug })
    .returning({ id: tags.id });
  if (!tag) throw new Error("Tag insert failed");
  const [theme] = await db
    .insert(themes)
    .values({
      slug,
      name: slug,
      sector,
      seedTagId: tag.id,
      centroid: new Array<number>(512).fill(0),
      embeddingModel: "test",
    })
    .returning({ id: themes.id });
  if (!theme) throw new Error("Theme insert failed");
  return theme.id;
}

function filters(overrides: Partial<FundingFilters> = {}): FundingFilters {
  return { page: 1, pageSize: 24, ...overrides };
}

describe("previousWindow", () => {
  it("is the window of equal length just before", () => {
    expect(previousWindow({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      from: "2026-08-31",
      to: "2026-09-30",
    });
    expect(previousWindow({ from: "2026-01-01", to: "2026-01-01" })).toEqual({
      from: "2025-12-31",
      to: "2025-12-31",
    });
  });

  it("runs an open-ended window to today", () => {
    expect(previousWindow({ from: "2026-10-01" }, "2026-10-31")).toEqual({
      from: "2026-08-31",
      to: "2026-09-30",
    });
  });

  it("is null without a start, or when the dates are reversed", () => {
    expect(previousWindow({ to: "2026-10-31" })).toBeNull();
    expect(previousWindow({})).toBeNull();
    expect(previousWindow({ from: "2026-10-31", to: "2026-10-01" })).toBeNull();
  });
});

describe("summaryPeriodRange", () => {
  const TODAY = "2026-11-24";

  it("runs back from today like the list's date presets", () => {
    expect(summaryPeriodRange("7d", TODAY)).toEqual({
      from: "2026-11-17",
      to: TODAY,
    });
    expect(summaryPeriodRange("30d", TODAY)).toEqual({
      from: "2026-10-25",
      to: TODAY,
    });
    expect(summaryPeriodRange("90d", TODAY)).toEqual({
      from: "2026-08-26",
      to: TODAY,
    });
  });

  it("starts 12 months on the same date a year back", () => {
    expect(summaryPeriodRange("12m", TODAY)).toEqual({
      from: "2025-11-24",
      to: TODAY,
    });
  });

  it("compares with the period of the same length before", () => {
    expect(previousWindow(summaryPeriodRange("30d", TODAY))).toEqual({
      from: "2026-09-24",
      to: "2026-10-24",
    });
  });
});

describe("summaryRange", () => {
  const period = { from: "2026-10-25", to: "2026-11-24" };

  it("is the period when the list has no dates", () => {
    expect(summaryRange(period, {})).toEqual(period);
  });

  it("is the period when the list's dates cover it", () => {
    expect(summaryRange(period, { from: "2026-08-26" })).toEqual(period);
  });

  it("is the overlap with the list's dates", () => {
    expect(summaryRange(period, { from: "2026-11-01" })).toEqual({
      from: "2026-11-01",
      to: "2026-11-24",
    });
    expect(
      summaryRange(period, { from: "2026-09-01", to: "2026-10-31" }),
    ).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(summaryRange(period, { to: "2026-11-10" })).toEqual({
      from: "2026-10-25",
      to: "2026-11-10",
    });
  });

  it("is null when they do not overlap", () => {
    expect(
      summaryRange(period, { from: "2026-01-01", to: "2026-03-31" }),
    ).toBeNull();
  });
});

describe("summaryScope", () => {
  it("covers the period and compares with the one before", () => {
    expect(summaryScope("7d", {}, "2026-11-24")).toEqual({
      period: "7d",
      periodRange: { from: "2026-11-17", to: "2026-11-24" },
      range: { from: "2026-11-17", to: "2026-11-24" },
      previous: { from: "2026-11-09", to: "2026-11-16" },
    });
  });

  it("compares the overlap with the same number of days before it", () => {
    const scope = summaryScope("30d", { from: "2026-11-15" }, "2026-11-24");
    expect(scope.range).toEqual({ from: "2026-11-15", to: "2026-11-24" });
    expect(scope.previous).toEqual({ from: "2026-11-05", to: "2026-11-14" });
  });

  it("has no range and nothing to compare when nothing overlaps", () => {
    const scope = summaryScope(
      "7d",
      { from: "2026-01-01", to: "2026-01-31" },
      "2026-11-24",
    );
    expect(scope.range).toBeNull();
    expect(scope.previous).toBeNull();
  });
});

describe("getFundingSummary", () => {
  let test: TestDb;
  let db: Db;

  beforeEach(async () => {
    test = await createTestDb();
    db = test.db;

    const health = await addTheme(db, "health-ai", "health-life-sciences");
    const fin = await addTheme(db, "fintech", "financial-services");

    const a = await addCompany(db, "Alpha Health");
    const b = await addCompany(db, "Beta Pay");
    const c = await addCompany(db, "Gamma Unknown");
    const d = await addCompany(db, "Delta Health");
    await db.insert(companyThemes).values([
      { companyId: a, themeId: health, tagCount: 2 },
      { companyId: b, themeId: fin, tagCount: 1 },
      { companyId: d, themeId: health, tagCount: 1 },
    ]);

    // Current window, 1 to 30 September: amounts 1M, 3M, 9M, plus a null.
    await addRound(db, a, "2026-09-02", 900_000_000, "series_a");
    await addRound(db, b, "2026-09-10", 300_000_000);
    await addRound(db, d, "2026-09-20", 100_000_000);
    await addRound(db, c, "2026-09-25", null);
    // Previous window, 2 to 31 August: amounts 2M and 4M, plus a null.
    await addRound(db, a, "2026-08-05", 200_000_000);
    await addRound(db, b, "2026-08-15", 400_000_000);
    await addRound(db, c, "2026-08-20", null);
    // Outside both windows, and a grant that is hidden by default.
    await addRound(db, a, "2026-06-01", 5_000_000_000);
    await addRound(db, a, "2026-09-05", 7_000_000_000, "grant");
  });

  afterEach(async () => {
    await test.close();
  });

  const window = filters({ from: "2026-09-01", to: "2026-09-30" });

  it("totals the window, ignoring null amounts for money", async () => {
    const summary = await getFundingSummary(db, window);
    expect(summary.count).toBe(4);
    expect(summary.totalGbpMinor).toBe(1_300_000_000);
    // Odd count of known amounts: the middle one.
    expect(summary.medianGbpMinor).toBe(300_000_000);
  });

  it("takes the median of an even count as the mean of the middle two", async () => {
    const summary = await getFundingSummary(
      db,
      filters({ from: "2026-09-01", to: "2026-09-15" }),
    );
    expect(summary.count).toBe(2);
    expect(summary.medianGbpMinor).toBe(600_000_000);
  });

  it("has a null median when no round has an amount", async () => {
    const summary = await getFundingSummary(
      db,
      filters({ from: "2026-09-25", to: "2026-09-25" }),
    );
    expect(summary.count).toBe(1);
    expect(summary.totalGbpMinor).toBe(0);
    expect(summary.medianGbpMinor).toBeNull();
  });

  it("returns the previous window of equal length", async () => {
    const summary = await getFundingSummary(db, window);
    expect(summary.previous).toEqual({
      totalGbpMinor: 600_000_000,
      count: 3,
      medianGbpMinor: 300_000_000,
    });
  });

  it("has no previous window without a date window", async () => {
    const summary = await getFundingSummary(db, filters());
    expect(summary.previous).toBeNull();
    expect(summary.count).toBe(8);
  });

  it("compares an open-ended window (start only) with the period before it", async () => {
    const open = await getFundingSummary(db, filters({ from: "2026-09-01" }));
    expect(open.previous).not.toBeNull();
  });

  it("ranks sectors by GBP, with companies that have none as null", async () => {
    const summary = await getFundingSummary(db, window);
    expect(summary.sectors).toEqual([
      { sector: "health-life-sciences", gbpMinor: 1_000_000_000, count: 2 },
      { sector: "financial-services", gbpMinor: 300_000_000, count: 1 },
      { sector: null, gbpMinor: 0, count: 1 },
    ]);
  });

  it("returns the three biggest rounds by GBP", async () => {
    const summary = await getFundingSummary(db, window);
    expect(summary.biggest.map((row) => row.companyName)).toEqual([
      "Alpha Health",
      "Beta Pay",
      "Delta Health",
    ]);
    expect(summary.biggest[0]?.mainSector).toBe("health-life-sciences");
  });

  it("uses the same filters as the list, grants included when selected", async () => {
    const withGrant = await getFundingSummary(
      db,
      filters({ ...window, roundTypes: ["grant"] }),
    );
    expect(withGrant.count).toBe(1);
    expect(withGrant.totalGbpMinor).toBe(7_000_000_000);
    const seeds = await getFundingSummary(
      db,
      filters({ ...window, roundTypes: ["seed"] }),
    );
    expect(seeds.count).toBe(3);
    const sector = await getFundingSummary(
      db,
      filters({ ...window, sectors: ["financial-services"] }),
    );
    expect(sector.count).toBe(1);
    expect(sector.previous?.count).toBe(1);
  });

  it("is empty over an empty set", async () => {
    const summary = await getFundingSummary(
      db,
      filters({ from: "2030-01-01", to: "2030-01-31" }),
    );
    expect(summary).toMatchObject({
      count: 0,
      totalGbpMinor: 0,
      medianGbpMinor: null,
      sectors: [],
      biggest: [],
    });
  });
});

describe("getSectorCounts", () => {
  let test: TestDb;
  let db: Db;
  const TODAY = "2026-11-20";

  beforeEach(async () => {
    test = await createTestDb();
    db = test.db;
    const health = await addTheme(db, "health-ai", "health-life-sciences");
    const fin = await addTheme(db, "payments", "financial-services");

    const a = await addCompany(db, "Alpha Health");
    const b = await addCompany(db, "Beta Pay");
    const c = await addCompany(db, "Gamma Learn");
    const d = await addCompany(db, "Delta Both");
    await db.insert(companyThemes).values([
      { companyId: a, themeId: health, tagCount: 2 },
      { companyId: b, themeId: fin, tagCount: 1 },
      { companyId: d, themeId: fin, tagCount: 1 },
    ]);
    // Sectors also come from company_sectors, as the sector filter reads both.
    await db.insert(companySectors).values([
      { companyId: c, sector: "education", source: "theme" },
      { companyId: d, sector: "health-life-sciences", source: "theme" },
    ]);

    // Inside the 90 days (from 2026-08-22).
    await addRound(db, a, "2026-11-19", 100);
    await addRound(db, a, "2026-10-01", 100);
    await addRound(db, b, "2026-09-15", 100);
    await addRound(db, c, "2026-08-22", 100);
    await addRound(db, c, "2026-11-01", null);
    // Delta counts in both of its sectors.
    await addRound(db, d, "2026-10-10", 100);
    // Outside the window, and a grant (hidden by default): not counted.
    await addRound(db, b, "2026-08-21", 100);
    await addRound(db, b, "2026-01-05", 100);
    await addRound(db, b, "2026-11-02", 100, "grant");
  });

  afterEach(async () => {
    await test.close();
  });

  it("ranks by rounds in the window, ties alphabetical, empty sectors last", async () => {
    const counts = await getSectorCounts(db, { days: 90, today: TODAY });
    expect(counts.slice(0, 3)).toEqual([
      { sector: "health-life-sciences", count: 3 },
      // Two each: "Education" before "Financial services".
      { sector: "education", count: 2 },
      { sector: "financial-services", count: 2 },
    ]);
    const rest = counts.slice(3);
    expect(rest.every((entry) => entry.count === 0)).toBe(true);
    const labels = rest.map((entry) => SECTOR_LABELS[entry.sector]);
    expect(labels).toEqual(
      [...labels].sort((x, y) => x.localeCompare(y, "en-GB")),
    );
  });

  it("lists every sector once", async () => {
    const counts = await getSectorCounts(db, { days: 90, today: TODAY });
    expect(counts.map((entry) => entry.sector).sort()).toEqual(
      [...SECTORS].sort(),
    );
  });

  it("follows the window length", async () => {
    const week = await getSectorCounts(db, { days: 7, today: TODAY });
    expect(week[0]).toEqual({ sector: "health-life-sciences", count: 1 });
    expect(week.filter((entry) => entry.count > 0)).toHaveLength(1);
  });
});
