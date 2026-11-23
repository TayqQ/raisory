import { and, eq, isNull, ne } from "drizzle-orm";
import type { MergeEntity } from "@/core/enums";
import type { Db } from "@/db/client";
import {
  companies,
  companyAliases,
  entityMerges,
  investorAliases,
  investors,
} from "@/db/schema";
import {
  normaliseCompanyName,
  normaliseInvestorName,
  slugify,
} from "@/lib/normalise";
import { isPlaceholderCompanyName } from "../names/placeholder";
import { allocateSlug } from "./slugs";

/** What a rename changes (D69). The preview and the applied rename share it. */
export interface RenameResult {
  entityType: MergeEntity;
  id: number;
  oldName: string;
  newName: string;
  oldSlug: string;
  newSlug: string;
  /** False when the old name is a placeholder, or the same name in other case. */
  oldNameKeptAsAlias: boolean;
  /** Other live entities of this type with the new name: likely duplicates to merge. */
  sameNameIds: number[];
  applied: boolean;
}

interface EntityRow {
  id: number;
  name: string;
  slug: string;
  mergedIntoId: number | null;
}

function normaliserFor(entityType: MergeEntity): (name: string) => string {
  return entityType === "company"
    ? normaliseCompanyName
    : normaliseInvestorName;
}

async function loadEntity(
  db: Db,
  entityType: MergeEntity,
  id: number,
): Promise<EntityRow> {
  const fields = (table: typeof companies | typeof investors) => ({
    id: table.id,
    name: table.name,
    slug: table.slug,
    mergedIntoId: table.mergedIntoId,
  });
  const [row] =
    entityType === "company"
      ? await db
          .select(fields(companies))
          .from(companies)
          .where(eq(companies.id, id))
      : await db
          .select(fields(investors))
          .from(investors)
          .where(eq(investors.id, id));
  const label = entityType === "company" ? "Company" : "Investor";
  if (!row) throw new Error(`${label} ${id} does not exist`);
  if (row.mergedIntoId !== null) {
    throw new Error(
      `${label} ${id} was merged into ${row.mergedIntoId}; rename that instead`,
    );
  }
  return row;
}

async function sameNameIds(
  db: Db,
  entityType: MergeEntity,
  id: number,
  normalisedName: string,
): Promise<number[]> {
  const rows =
    entityType === "company"
      ? await db
          .select({ id: companies.id })
          .from(companies)
          .where(
            and(
              eq(companies.normalisedName, normalisedName),
              ne(companies.id, id),
              isNull(companies.mergedIntoId),
            ),
          )
      : await db
          .select({ id: investors.id })
          .from(investors)
          .where(
            and(
              eq(investors.normalisedName, normalisedName),
              ne(investors.id, id),
              isNull(investors.mergedIntoId),
            ),
          );
  return rows.map((row) => row.id).sort((a, b) => a - b);
}

/**
 * The slug for the new name, made as for a new entity. A slug that already
 * is the new name's own slug is kept, so a change of case keeps the URL.
 */
async function slugFor(
  db: Db,
  entityType: MergeEntity,
  current: string,
  newName: string,
): Promise<string> {
  const table = entityType === "company" ? companies : investors;
  if (slugify(newName) === current) return current;
  return allocateSlug(db, table, newName);
}

async function plan(
  db: Db,
  entityType: MergeEntity,
  id: number,
  name: string,
): Promise<RenameResult> {
  const newName = name.trim().replace(/\s+/g, " ");
  if (!newName) throw new Error("The new name is empty");
  if (entityType === "company" && isPlaceholderCompanyName(newName)) {
    throw new Error(`"${newName}" is a placeholder, not a company name`);
  }
  const row = await loadEntity(db, entityType, id);
  const normalise = normaliserFor(entityType);
  const oldNameKeptAsAlias =
    !isPlaceholderCompanyName(row.name) &&
    normalise(row.name) !== normalise(newName);
  return {
    entityType,
    id,
    oldName: row.name,
    newName,
    oldSlug: row.slug,
    newSlug: await slugFor(db, entityType, row.slug, newName),
    oldNameKeptAsAlias,
    sameNameIds: await sameNameIds(db, entityType, id, normalise(newName)),
    applied: false,
  };
}

/** What `renameEntity` would change. Writes nothing. */
export function previewRename(
  db: Db,
  entityType: MergeEntity,
  id: number,
  name: string,
): Promise<RenameResult> {
  return plan(db, entityType, id, name);
}

/**
 * Renames a company or investor by hand (D69): the name, normalised name and
 * slug change together. The old name becomes an alias unless it is a
 * placeholder such as "startup", so it can still match later news. The
 * rename is recorded in `entity_merges` with the entity as both sides and a
 * `rename:` note. Nothing derived caches names, so nothing is rebuilt. The
 * old slug stops resolving.
 */
export async function renameEntity(
  db: Db,
  entityType: MergeEntity,
  id: number,
  name: string,
  options: { note?: string } = {},
): Promise<RenameResult> {
  return db.transaction(async (tx) => {
    const result = await plan(tx, entityType, id, name);
    if (
      result.oldName === result.newName &&
      result.oldSlug === result.newSlug
    ) {
      return result;
    }
    const normalisedName = normaliserFor(entityType)(result.newName);

    if (entityType === "company") {
      await tx
        .update(companies)
        .set({
          name: result.newName,
          normalisedName,
          slug: result.newSlug,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, id));
      if (result.oldNameKeptAsAlias) {
        await tx
          .insert(companyAliases)
          .values({
            companyId: id,
            alias: result.oldName,
            normalisedAlias: normaliseCompanyName(result.oldName),
            source: "manual",
          })
          .onConflictDoNothing({
            target: [companyAliases.companyId, companyAliases.normalisedAlias],
          });
      }
    } else {
      await tx
        .update(investors)
        .set({ name: result.newName, normalisedName, slug: result.newSlug })
        .where(eq(investors.id, id));
      if (result.oldNameKeptAsAlias) {
        await tx
          .insert(investorAliases)
          .values({
            investorId: id,
            alias: result.oldName,
            normalisedAlias: normaliseInvestorName(result.oldName),
            source: "manual",
          })
          .onConflictDoNothing({
            target: [
              investorAliases.investorId,
              investorAliases.normalisedAlias,
            ],
          });
      }
    }

    const note = `rename: "${result.oldName}" (${result.oldSlug}) to "${result.newName}" (${result.newSlug})`;
    await tx.insert(entityMerges).values({
      entityType,
      keptId: id,
      mergedId: id,
      note: options.note ? `${note}; ${options.note}` : note,
    });
    return { ...result, applied: true };
  });
}
