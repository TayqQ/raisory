import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { companies, companyWebsites, investors } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import type { WebsiteDecision } from "./rules";
import {
  approveWebsite,
  findDomainHolder,
  recordWebsiteResult,
  rejectWebsite,
  type WebsiteResultInput,
} from "./website-store";

const NOW = new Date("2026-11-23T06:00:00Z");

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function insertCompany(
  slug: string,
  values: Partial<typeof companies.$inferInsert> = {},
) {
  const [company] = await db
    .insert(companies)
    .values({
      slug,
      name: "Brightwell Robotics",
      normalisedName: "brightwell robotics",
      ...values,
    })
    .returning();
  return company!;
}

async function websiteDomain(id: number) {
  const [row] = await db
    .select({ websiteDomain: companies.websiteDomain })
    .from(companies)
    .where(eq(companies.id, id));
  return row?.websiteDomain ?? null;
}

async function rows(companyId: number) {
  return db
    .select()
    .from(companyWebsites)
    .where(eq(companyWebsites.companyId, companyId))
    .orderBy(asc(companyWebsites.id));
}

function decision(overrides: Partial<WebsiteDecision> = {}): WebsiteDecision {
  return {
    domain: "brightwell.example",
    status: "linked",
    rule: "W3",
    evidence: "guessed domain; title matches; LLM check says same company",
    companyNumberSeen: null,
    judged: true,
    ...overrides,
  };
}

function result(
  companyId: number,
  overrides: Partial<WebsiteDecision> = {},
): WebsiteResultInput {
  return {
    companyId,
    decision: decision(overrides),
    source: "guess",
    iconCandidates: [
      {
        url: "https://brightwell.example/icon.png",
        rel: "icon",
        sizes: "64x64",
        type: "image/png",
      },
    ],
    fingerprint: "f1",
    now: NOW,
  };
}

describe("recordWebsiteResult", () => {
  it("links a domain and fills the company's website", async () => {
    const company = await insertCompany("brightwell");
    const written = await recordWebsiteResult(db, result(company.id));
    expect(written).toMatchObject({
      outcome: "written",
      status: "linked",
      rule: "W3",
    });
    const [row] = await rows(company.id);
    expect(row).toMatchObject({
      domain: "brightwell.example",
      status: "linked",
      decidedBy: "auto",
      source: "guess",
      fingerprint: "f1",
      checkedAt: NOW,
    });
    expect(row?.iconCandidates).toHaveLength(1);
    expect(await websiteDomain(company.id)).toBe("brightwell.example");
  });

  it("keeps a candidate or rejection out of the company's website", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(
      db,
      result(company.id, { status: "candidate", rule: "C1" }),
    );
    await recordWebsiteResult(
      db,
      result(company.id, {
        domain: "other.example",
        status: "rejected",
        rule: "none",
      }),
    );
    expect((await rows(company.id)).map((r) => r.status)).toEqual([
      "candidate",
      "rejected",
    ]);
    expect(await websiteDomain(company.id)).toBeNull();
  });

  it("makes a second strong result a candidate", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(db, result(company.id));
    const second = await recordWebsiteResult(
      db,
      result(company.id, { domain: "brightwellhq.example", rule: "W2" }),
    );
    expect(second).toMatchObject({ status: "candidate", rule: "W2" });
    const [, row] = await rows(company.id);
    expect(row?.evidence).toContain(
      "company already linked to brightwell.example",
    );
    expect(await websiteDomain(company.id)).toBe("brightwell.example");
  });

  it("makes a domain another company holds a candidate (X3)", async () => {
    const holder = await insertCompany("brightwell-old", {
      websiteDomain: "brightwell.example",
    });
    const company = await insertCompany("brightwell");
    const written = await recordWebsiteResult(db, result(company.id));
    expect(written).toMatchObject({ status: "candidate", rule: "X3" });
    const [row] = await rows(company.id);
    expect(row?.evidence).toMatch(
      new RegExp(`^domain held by company ${holder.id}`),
    );
    expect(await websiteDomain(company.id)).toBeNull();
  });

  it("demotes a linked domain when a re-check says otherwise", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(db, result(company.id));
    const written = await recordWebsiteResult(
      db,
      result(company.id, {
        status: "rejected",
        rule: "X1",
        evidence: "parked or for-sale page",
      }),
    );
    expect(written).toMatchObject({ outcome: "written", status: "rejected" });
    expect(await rows(company.id)).toHaveLength(1);
    expect(await websiteDomain(company.id)).toBeNull();
  });

  it("keeps an automatic link when the re-check could not read the page", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(db, result(company.id));
    const written = await recordWebsiteResult(
      db,
      result(company.id, { status: "rejected", rule: "X1", judged: false }),
    );
    expect(written.outcome).toBe("kept");
    expect((await rows(company.id))[0]?.status).toBe("linked");
    expect(await websiteDomain(company.id)).toBe("brightwell.example");
  });

  it("keeps an automatic candidate when the re-check could not read the page", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(
      db,
      result(company.id, { status: "candidate", rule: "C1" }),
    );
    const written = await recordWebsiteResult(
      db,
      result(company.id, { status: "rejected", rule: "X1", judged: false }),
    );
    expect(written.outcome).toBe("kept");
    expect((await rows(company.id))[0]?.status).toBe("candidate");
  });

  it("records the time of a re-check that could not read the page", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(
      db,
      result(company.id, { status: "candidate", rule: "C2", judged: false }),
    );
    const later = new Date("2027-05-23T06:00:00Z");
    const written = await recordWebsiteResult(db, {
      ...result(company.id, {
        status: "candidate",
        rule: "C2",
        judged: false,
      }),
      fingerprint: "next",
      now: later,
    });
    expect(written.outcome).toBe("kept");
    const [row] = await rows(company.id);
    expect(row?.checkedAt).toEqual(later);
    expect(row?.fingerprint).toBe("next");
  });

  it("never re-links a manual rejection", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(
      db,
      result(company.id, { status: "candidate", rule: "C1" }),
    );
    const [row] = await rows(company.id);
    await rejectWebsite(db, row!.id);
    for (const rule of ["W1", "W2", "W3"] as const) {
      const written = await recordWebsiteResult(
        db,
        result(company.id, { rule }),
      );
      expect(written).toEqual({ outcome: "blocked", id: row!.id });
    }
    expect((await rows(company.id))[0]).toMatchObject({
      status: "rejected",
      decidedBy: "manual",
      rule: "manual",
    });
    expect(await websiteDomain(company.id)).toBeNull();
  });

  it("writes nothing automatic while the company has a manual link", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(
      db,
      result(company.id, { status: "candidate", rule: "C2" }),
    );
    const [row] = await rows(company.id);
    await approveWebsite(db, row!.id);
    const other = await recordWebsiteResult(
      db,
      result(company.id, {
        domain: "other.example",
        status: "rejected",
        rule: "none",
      }),
    );
    expect(other).toEqual({ outcome: "blocked", id: null });
    expect(await rows(company.id)).toHaveLength(1);
  });

  it("refuses a merged company", async () => {
    const kept = await insertCompany("brightwell");
    const merged = await insertCompany("brightwell-2", {
      mergedIntoId: kept.id,
    });
    await expect(recordWebsiteResult(db, result(merged.id))).rejects.toThrow(
      `merged into ${kept.id}`,
    );
  });

  it("stores at most 10 icon candidates", async () => {
    const company = await insertCompany("brightwell");
    const icon = {
      url: "https://brightwell.example/i.png",
      rel: "icon",
      sizes: null,
      type: null,
    };
    await recordWebsiteResult(db, {
      ...result(company.id),
      iconCandidates: Array.from({ length: 14 }, () => icon),
    });
    expect((await rows(company.id))[0]?.iconCandidates).toHaveLength(10);
  });
});

describe("findDomainHolder", () => {
  it("finds another company through a linked row or its website column", async () => {
    const holder = await insertCompany("holder", { name: "Brightwell" });
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(db, result(holder.id));
    expect(
      await findDomainHolder(db, company.id, "brightwell.example"),
    ).toEqual({
      kind: "company",
      id: holder.id,
      name: "Brightwell",
    });
    expect(
      await findDomainHolder(db, holder.id, "brightwell.example"),
    ).toBeNull();
  });

  it("finds an investor whose website it is", async () => {
    const company = await insertCompany("brightwell");
    const [investor] = await db
      .insert(investors)
      .values({
        slug: "harbour-lane",
        name: "Harbour Lane Ventures",
        normalisedName: "harbour lane ventures",
        websiteDomain: "www.harbourlane.example",
      })
      .returning();
    expect(
      await findDomainHolder(db, company.id, "harbourlane.example"),
    ).toEqual({
      kind: "investor",
      id: investor!.id,
      name: "Harbour Lane Ventures",
    });
  });
});

describe("approveWebsite and rejectWebsite", () => {
  it("approves a candidate as a final manual link", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(
      db,
      result(company.id, { status: "candidate", rule: "C1" }),
    );
    const [row] = await rows(company.id);
    expect(await approveWebsite(db, row!.id)).toEqual({
      ok: true,
      message: "linked brightwell.example",
    });
    expect((await rows(company.id))[0]).toMatchObject({
      status: "linked",
      rule: "manual",
      decidedBy: "manual",
    });
    expect((await rows(company.id))[0]?.evidence).toMatch(
      /^approved in review; was: /,
    );
    expect(await websiteDomain(company.id)).toBe("brightwell.example");

    const demote = await recordWebsiteResult(
      db,
      result(company.id, { status: "rejected", rule: "X1" }),
    );
    expect(demote.outcome).toBe("blocked");
  });

  it("refuses to approve a second link or a domain held elsewhere", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(db, result(company.id));
    await recordWebsiteResult(
      db,
      result(company.id, { domain: "two.example" }),
    );
    const [, second] = await rows(company.id);
    expect(await approveWebsite(db, second!.id)).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "already linked to brightwell.example",
      ) as string,
    });

    const other = await insertCompany("other");
    await recordWebsiteResult(
      db,
      result(other.id, { status: "candidate", rule: "X3" }),
    );
    const [held] = await rows(other.id);
    expect(await approveWebsite(db, held!.id)).toMatchObject({
      ok: false,
      message: expect.stringContaining("is held by") as string,
    });
  });

  it("skips a row that is not a candidate, or does not exist", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(db, result(company.id));
    const [row] = await rows(company.id);
    expect((await approveWebsite(db, row!.id)).ok).toBe(false);
    expect(await approveWebsite(db, 999)).toEqual({
      ok: false,
      message: "no such row",
    });
    expect(await rejectWebsite(db, 999)).toEqual({
      ok: false,
      message: "no such row",
    });
  });

  it("rejects a linked row and clears the company's website", async () => {
    const company = await insertCompany("brightwell");
    await recordWebsiteResult(db, result(company.id));
    const [row] = await rows(company.id);
    expect(await rejectWebsite(db, row!.id)).toEqual({
      ok: true,
      message: "rejected brightwell.example",
    });
    expect(await websiteDomain(company.id)).toBeNull();
    expect((await rejectWebsite(db, row!.id)).ok).toBe(false);
  });
});
