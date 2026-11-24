import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client";
import { companies, companyLogos } from "../schema";
import { createTestDb, type TestDb } from "../testing";
import { getLogoFile, getLogoUrls, logoUrl, parseLogoFile } from "./logos";

const SHA = "ab".repeat(32);

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
});

afterEach(async () => {
  await testDb.close();
});

async function addCompany(name: string, websiteDomain: string | null) {
  const [company] = await db
    .insert(companies)
    .values({
      slug: name.toLowerCase(),
      name,
      normalisedName: name.toLowerCase(),
      countryCode: "GB",
      websiteDomain,
    })
    .returning();
  return company!.id;
}

async function addLogo(companyId: number, blocked = false) {
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
          sourceUrl: "https://acme.example/icon.png",
          fetchedAt: new Date("2026-11-24T06:00:00Z"),
        },
  );
}

describe("logoUrl", () => {
  it("builds the address from the id, the hash and the type", () => {
    expect(logoUrl(7, SHA, "image/png")).toBe("/logos/7-abababab.png");
    expect(logoUrl(7, SHA, "image/x-icon")).toBe("/logos/7-abababab.ico");
    expect(logoUrl(7, SHA, "image/svg+xml")).toBeNull();
    expect(logoUrl(7, "not-a-hash", "image/png")).toBeNull();
  });
});

describe("parseLogoFile", () => {
  it("reads a logo address and refuses anything else", () => {
    expect(parseLogoFile("7-abababab.webp")).toEqual({
      companyId: 7,
      hash8: "abababab",
      ext: "webp",
    });
    for (const file of [
      "7-abababab.svg",
      "07-abababab.png",
      "7-ABABABAB.png",
      "7-ababab.png",
      "3000000000-abababab.png",
      "7-abababab.png.svg",
    ]) {
      expect(parseLogoFile(file)).toBeNull();
    }
  });
});

describe("getLogoUrls", () => {
  it("returns addresses for stored logos only, leaving out blocked and unlinked ones", async () => {
    const stored = await addCompany("Stored", "stored.example");
    const blocked = await addCompany("Blocked", "blocked.example");
    const unlinked = await addCompany("Unlinked", null);
    const none = await addCompany("None", "none.example");
    await addLogo(stored);
    await addLogo(blocked, true);
    await addLogo(unlinked);

    expect(await getLogoUrls(db, [stored, blocked, unlinked, none])).toEqual({
      [stored]: `/logos/${stored}-abababab.png`,
    });
    expect(await getLogoUrls(db, [])).toEqual({});
  });
});

describe("getLogoFile", () => {
  it("returns the image only when the hash and extension match", async () => {
    const id = await addCompany("Stored", "stored.example");
    await addLogo(id);
    expect(await getLogoFile(db, `${id}-abababab.png`)).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/png",
    });
    expect(await getLogoFile(db, `${id}-cdcdcdcd.png`)).toBeNull();
    expect(await getLogoFile(db, `${id}-abababab.gif`)).toBeNull();
  });
});
