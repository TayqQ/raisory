import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import {
  companies,
  companyLogos,
  companyWebsites,
  type WebsiteIconCandidate,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import type { LogoFetcher, LogoFetchResult } from "./logo-fetch";
import {
  deleteLogo,
  deleteUnlinkedLogos,
  LOGO_RETRY_DAYS,
  logosDue,
  refreshLogo,
  removeLogo,
  storeLogo,
} from "./logo-store";
import { pngBytes, textBytes } from "./logo-testing";

const NOW = new Date("2026-11-24T06:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const DOMAIN = "acme.example";

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
});

afterEach(async () => {
  await testDb.close();
});

async function addCompany(name: string, websiteDomain: string | null = null) {
  const [company] = await db
    .insert(companies)
    .values({
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      normalisedName: name.toLowerCase(),
      countryCode: "GB",
      websiteDomain,
    })
    .returning();
  return company!;
}

async function link(
  companyId: number,
  domain: string,
  iconCandidates: WebsiteIconCandidate[] = [],
  status: "linked" | "rejected" = "linked",
) {
  await db.insert(companyWebsites).values({
    companyId,
    domain,
    status,
    rule: "W2",
    source: "article",
    evidence: "test",
    iconCandidates,
    checkedAt: NOW,
    decidedBy: "auto",
    fingerprint: "f",
  });
}

function icon(url: string, rel = "apple-touch-icon"): WebsiteIconCandidate {
  return { url, rel, sizes: null, type: null };
}

function logo(companyId: number, bytes = pngBytes(64, 64)) {
  return {
    companyId,
    bytes,
    mime: "image/png" as const,
    width: 64,
    height: 64,
    sourceUrl: `https://${DOMAIN}/apple.png`,
    now: NOW,
  };
}

async function logoRow(companyId: number) {
  const [row] = await db
    .select()
    .from(companyLogos)
    .where(eq(companyLogos.companyId, companyId));
  return row;
}

function fakeLogos(
  files: Record<string, Uint8Array>,
): LogoFetcher & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    remaining: () => 100,
    fetchLogo(url): Promise<LogoFetchResult> {
      fetched.push(url);
      const bytes = files[url];
      return Promise.resolve(
        bytes
          ? { outcome: "fetched", url, bytes }
          : { outcome: "failed", url, detail: "HTTP 404" },
      );
    },
  };
}

describe("storeLogo and deleteLogo", () => {
  it("stores the image with its SHA-256 and replaces it on the next store", async () => {
    const company = await addCompany("Acme", DOMAIN);
    const first = pngBytes(64, 64);
    expect(await storeLogo(db, logo(company.id, first))).toBe(true);
    expect((await logoRow(company.id))?.sha256).toBe(
      createHash("sha256").update(first).digest("hex"),
    );
    const second = pngBytes(48, 48);
    await storeLogo(db, { ...logo(company.id, second), width: 48, height: 48 });
    expect(await logoRow(company.id)).toMatchObject({
      width: 48,
      sha256: createHash("sha256").update(second).digest("hex"),
    });
  });

  it("never overwrites or deletes a blocked row", async () => {
    const company = await addCompany("Acme", DOMAIN);
    await removeLogo(db, company.id, { apply: true });
    expect(await storeLogo(db, logo(company.id))).toBe(false);
    expect(await deleteLogo(db, company.id)).toBe(false);
    expect(await logoRow(company.id)).toMatchObject({
      blocked: true,
      bytes: null,
    });
  });
});

describe("removeLogo", () => {
  it("previews without changing anything, then deletes the image and blocks it", async () => {
    const company = await addCompany("Acme", DOMAIN);
    await storeLogo(db, logo(company.id));

    const preview = await removeLogo(db, company.id, { apply: false });
    expect(preview.ok).toBe(true);
    expect(preview.message).toMatch(/^preview: would delete the logo of Acme/);
    expect((await logoRow(company.id))?.bytes).not.toBeNull();

    const applied = await removeLogo(db, company.id, { apply: true });
    expect(applied.message).toMatch(/^removed/);
    expect(await logoRow(company.id)).toMatchObject({
      blocked: true,
      bytes: null,
      mime: null,
      sha256: null,
      sourceUrl: null,
    });

    expect(await removeLogo(db, company.id, { apply: true })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/already removed/) as unknown,
    });
  });

  it("blocks a company that has no logo yet, and refuses an unknown id", async () => {
    const company = await addCompany("Acme", DOMAIN);
    await removeLogo(db, company.id, { apply: true });
    expect((await logoRow(company.id))?.blocked).toBe(true);
    expect(await removeLogo(db, 999, { apply: true })).toEqual({
      ok: false,
      message: "no company 999",
    });
  });
});

describe("refreshLogo", () => {
  it("tries the next candidate after one the probe refuses", async () => {
    const company = await addCompany("Acme", DOMAIN);
    const svg = `https://${DOMAIN}/logo`;
    const png = `https://${DOMAIN}/icon.png`;
    const logos = fakeLogos({
      [svg]: textBytes("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      [png]: pngBytes(64, 64),
    });
    const result = await refreshLogo(db, {
      companyId: company.id,
      domain: DOMAIN,
      iconCandidates: [icon(svg, "json-ld"), icon(png, "icon")],
      fetcher: logos,
      now: () => NOW,
    });
    expect(result).toEqual({
      outcome: "stored",
      url: png,
      tries: [
        { url: svg, outcome: "unknown-type" },
        { url: png, outcome: "fetched" },
      ],
    });
    expect((await logoRow(company.id))?.sourceUrl).toBe(png);
  });

  it("does not fetch for a blocked row", async () => {
    const company = await addCompany("Acme", DOMAIN);
    await removeLogo(db, company.id, { apply: true });
    const logos = fakeLogos({});
    const result = await refreshLogo(db, {
      companyId: company.id,
      domain: DOMAIN,
      iconCandidates: [icon(`https://${DOMAIN}/icon.png`)],
      fetcher: logos,
      now: () => NOW,
    });
    expect(result.outcome).toBe("blocked");
    expect(logos.fetched).toEqual([]);
  });

  it("keeps an earlier logo from the same site when no candidate works, and drops one from an old site", async () => {
    const company = await addCompany("Acme", DOMAIN);
    await storeLogo(db, logo(company.id));
    const none = {
      companyId: company.id,
      iconCandidates: [icon(`https://${DOMAIN}/gone.png`)],
      fetcher: fakeLogos({}),
      now: () => NOW,
    };
    expect((await refreshLogo(db, { ...none, domain: DOMAIN })).outcome).toBe(
      "none",
    );
    expect(await logoRow(company.id)).toBeDefined();

    await refreshLogo(db, { ...none, domain: "acme-new.example" });
    expect(await logoRow(company.id)).toBeUndefined();
  });
});

describe("deleteUnlinkedLogos", () => {
  it("deletes logos of companies with no linked website, and keeps blocked rows", async () => {
    const linked = await addCompany("Linked", "linked.example");
    const rejected = await addCompany("Rejected");
    const merged = await addCompany("Merged", "merged.example");
    const blocked = await addCompany("Blocked");
    await link(linked.id, "linked.example");
    await link(rejected.id, "rejected.example", [], "rejected");
    await link(merged.id, "merged.example");
    await db
      .update(companies)
      .set({ mergedIntoId: linked.id })
      .where(eq(companies.id, merged.id));
    for (const company of [linked, rejected, merged]) {
      await storeLogo(db, logo(company.id));
    }
    await removeLogo(db, blocked.id, { apply: true });

    expect(await deleteUnlinkedLogos(db)).toBe(2);
    expect(await logoRow(linked.id)).toBeDefined();
    expect(await logoRow(rejected.id)).toBeUndefined();
    expect(await logoRow(merged.id)).toBeUndefined();
    expect((await logoRow(blocked.id))?.blocked).toBe(true);
  });
});

describe("logosDue", () => {
  /** A date on which the company's id comes up. */
  function slotFor(companyId: number): Date {
    const day = Math.floor(NOW.getTime() / DAY_MS);
    const offset =
      (((companyId - day) % LOGO_RETRY_DAYS) + LOGO_RETRY_DAYS) %
      LOGO_RETRY_DAYS;
    return new Date(NOW.getTime() + offset * DAY_MS);
  }

  it("returns a linked site with no logo row on its day only", async () => {
    const company = await addCompany("Acme", DOMAIN);
    const candidates = [icon(`https://${DOMAIN}/icon.png`)];
    await link(company.id, DOMAIN, candidates);
    const day = slotFor(company.id);

    expect(await logosDue(db, day, 20)).toEqual([
      { companyId: company.id, domain: DOMAIN, iconCandidates: candidates },
    ]);
    expect(await logosDue(db, new Date(day.getTime() + DAY_MS), 20)).toEqual(
      [],
    );
  });

  it("leaves out a site with a logo or a blocked row, and keeps to the limit", async () => {
    const stored = await addCompany("Stored", "stored.example");
    await link(stored.id, "stored.example");
    await storeLogo(db, logo(stored.id));
    expect(await logosDue(db, slotFor(stored.id), 20)).toEqual([]);

    const blocked = await addCompany("Blocked", "blocked.example");
    await link(blocked.id, "blocked.example");
    await removeLogo(db, blocked.id, { apply: true });
    expect(await logosDue(db, slotFor(blocked.id), 20)).toEqual([]);

    const due = await addCompany("Due", "due.example");
    await link(due.id, "due.example");
    expect(await logosDue(db, slotFor(due.id), 0)).toEqual([]);
  });
});
