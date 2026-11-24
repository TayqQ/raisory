import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseCompanyName } from "@/lib/normalise";
import type { Db } from "../client";
import { companies, companyLogos, events, fundingRounds } from "../schema";
import { createTestDb, type TestDb } from "../testing";
import { listFundingRounds } from "./funding";
import { getLogoUrls } from "./logos";

const SHA = "cd".repeat(32);

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
});

afterEach(async () => {
  await testDb.close();
});

async function addRound(name: string, websiteDomain: string | null) {
  const [company] = await db
    .insert(companies)
    .values({
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      normalisedName: normaliseCompanyName(name),
      countryCode: "GB",
      websiteDomain,
    })
    .returning({ id: companies.id });
  const [event] = await db
    .insert(events)
    .values({
      type: "funding_round",
      companyId: company!.id,
      announcedOn: "2026-11-01",
      sourceCount: 0,
    })
    .returning({ id: events.id });
  await db.insert(fundingRounds).values({
    eventId: event!.id,
    roundType: "seed",
    amountMinor: 10_000_000,
    currency: "GBP",
    amountGbpMinor: 10_000_000,
    amountUsdMinor: 12_500_000,
  });
  return company!.id;
}

async function addLogo(companyId: number, blocked: boolean) {
  await db.insert(companyLogos).values(
    blocked
      ? { companyId, blocked: true }
      : {
          companyId,
          bytes: new Uint8Array([1, 2, 3]),
          mime: "image/png",
          width: 64,
          height: 64,
          sha256: SHA,
          sourceUrl: "https://example.test/icon.png",
          fetchedAt: new Date("2026-11-24T06:00:00Z"),
        },
  );
}

describe("logo addresses for a page of rows", () => {
  it("gives one batched lookup the row company ids: a logo, none, and a blocked one", async () => {
    const withLogo = await addRound("Logo Co", "logo.example");
    const without = await addRound("Plain Co", "plain.example");
    const blocked = await addRound("Blocked Co", "blocked.example");
    await addLogo(withLogo, false);
    await addLogo(blocked, true);

    const page = await listFundingRounds(db, {
      page: 1,
      pageSize: 25,
    });
    const ids = page.items.map((row) => row.companyId);
    expect(ids.sort()).toEqual([withLogo, without, blocked].sort());

    const urls = await getLogoUrls(db, ids);
    expect(urls).toEqual({ [withLogo]: `/logos/${withLogo}-cdcdcdcd.png` });
    expect(urls[without]).toBeUndefined();
    expect(urls[blocked]).toBeUndefined();
  });
});
