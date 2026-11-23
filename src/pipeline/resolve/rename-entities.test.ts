import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  entityMerges,
  investorAliases,
  investors,
} from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { previewRename, renameEntity } from "./rename-entities";
import { insertCompany, insertInvestor } from "./testing";

let testDb: TestDb;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
}, 30_000);

afterEach(async () => {
  await testDb.close();
});

async function snapshot() {
  return {
    companies: await db.select().from(companies).orderBy(asc(companies.id)),
    aliases: await db
      .select()
      .from(companyAliases)
      .orderBy(asc(companyAliases.id)),
    audit: await db.select().from(entityMerges),
  };
}

async function aliasesOf(companyId: number): Promise<string[]> {
  const rows = await db
    .select({ alias: companyAliases.alias })
    .from(companyAliases)
    .where(eq(companyAliases.companyId, companyId))
    .orderBy(asc(companyAliases.id));
  return rows.map((row) => row.alias);
}

describe("renameEntity", () => {
  it("previews without changing anything", async () => {
    const placeholder = await insertCompany(db, { name: "startup" });
    const before = await snapshot();

    const preview = await previewRename(
      db,
      "company",
      placeholder.id,
      "Acorda",
    );

    expect(preview).toEqual({
      entityType: "company",
      id: placeholder.id,
      oldName: "startup",
      newName: "Acorda",
      oldSlug: "startup",
      newSlug: "acorda",
      oldNameKeptAsAlias: false,
      sameNameIds: [],
      applied: false,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("renames with a unique slug, adds no placeholder alias and records the rename", async () => {
    await insertCompany(db, { name: "Acorda Labs", slug: "acorda" });
    const placeholder = await insertCompany(db, { name: "startup" });

    const result = await renameEntity(db, "company", placeholder.id, "Acorda");

    expect(result).toMatchObject({
      applied: true,
      newSlug: "acorda-2",
      oldNameKeptAsAlias: false,
    });
    const [row] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, placeholder.id));
    expect(row).toMatchObject({
      name: "Acorda",
      normalisedName: "acorda",
      slug: "acorda-2",
    });
    // Only the alias the company already had; "startup" is not added again.
    expect(await aliasesOf(placeholder.id)).toEqual(["startup"]);
    const [audit] = await db.select().from(entityMerges);
    expect(audit).toMatchObject({
      entityType: "company",
      keptId: placeholder.id,
      mergedId: placeholder.id,
    });
    expect(audit?.note).toMatch(/^rename: "startup" \(startup\) to "Acorda"/);
  });

  it("keeps a real old name as an alias", async () => {
    const company = await insertCompany(db, {
      name: "Northwind",
      normalisedName: "northwind",
    });
    await db.delete(companyAliases);

    await renameEntity(db, "company", company.id, "Northwind Labs");

    expect(await aliasesOf(company.id)).toEqual(["Northwind"]);
  });

  it("keeps the slug when only the case changes, and adds no alias", async () => {
    const company = await insertCompany(db, { name: "acorda" });
    await db.delete(companyAliases);

    const result = await renameEntity(db, "company", company.id, "Acorda");

    expect(result.newSlug).toBe(company.slug);
    expect(result.oldNameKeptAsAlias).toBe(false);
    expect(await aliasesOf(company.id)).toEqual([]);
  });

  it("does nothing when the name and slug are unchanged", async () => {
    const company = await insertCompany(db, { name: "Acorda" });
    const before = await snapshot();

    const result = await renameEntity(db, "company", company.id, " Acorda ");

    expect(result.applied).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it("names other companies that already have the new name", async () => {
    const existing = await insertCompany(db, { name: "Acorda" });
    const placeholder = await insertCompany(db, { name: "startup" });

    const preview = await previewRename(
      db,
      "company",
      placeholder.id,
      "Acorda",
    );

    expect(preview.sameNameIds).toEqual([existing.id]);
  });

  it("refuses a placeholder as the new name, a merged company and a missing one", async () => {
    const keep = await insertCompany(db, { name: "Acorda" });
    const merged = await insertCompany(db, { name: "Acorda Ltd" });
    await db
      .update(companies)
      .set({ mergedIntoId: keep.id })
      .where(eq(companies.id, merged.id));

    await expect(
      renameEntity(db, "company", keep.id, "a London startup"),
    ).rejects.toThrow(/placeholder/);
    await expect(
      renameEntity(db, "company", merged.id, "Acorda Group"),
    ).rejects.toThrow(/merged into/);
    await expect(
      renameEntity(db, "company", 999, "Acorda Group"),
    ).rejects.toThrow(/does not exist/);
  });

  it("renames an investor the same way", async () => {
    const investor = await insertInvestor(db, { name: "Example Ventures" });
    await db.delete(investorAliases);

    const result = await renameEntity(
      db,
      "investor",
      investor.id,
      "Example Capital",
    );

    expect(result.newSlug).toBe("example-capital");
    const [row] = await db
      .select()
      .from(investors)
      .where(eq(investors.id, investor.id));
    expect(row).toMatchObject({
      name: "Example Capital",
      slug: "example-capital",
    });
    const aliases = await db.select().from(investorAliases);
    expect(aliases.map((alias) => alias.alias)).toEqual(["Example Ventures"]);
  });
});
