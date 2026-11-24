import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../client";
import { companies, companyLogos } from "../schema";

/**
 * Company logos are served from `/logos/<companyId>-<hash8>.<ext>` (D72),
 * where `hash8` is the first 8 characters of the image's SHA-256. A new image
 * gets a new address, so each address can be cached for a year.
 */

/** File extensions for the image types the probe accepts. Nothing else is served. */
export const LOGO_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/x-icon": "ico",
  "image/webp": "webp",
  "image/gif": "gif",
};

const LOGO_FILE = /^([1-9]\d{0,9})-([0-9a-f]{8})\.(png|jpg|ico|webp|gif)$/;

export interface LogoFileName {
  companyId: number;
  hash8: string;
  ext: string;
}

/** The logo's address, or null for a type that is never served. */
export function logoUrl(
  companyId: number,
  sha256: string,
  mime: string,
): string | null {
  const ext = LOGO_EXTENSIONS[mime];
  if (!ext || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return `/logos/${companyId}-${sha256.slice(0, 8)}.${ext}`;
}

export function parseLogoFile(file: string): LogoFileName | null {
  const match = LOGO_FILE.exec(file);
  if (!match) return null;
  const companyId = Number(match[1]);
  if (!Number.isSafeInteger(companyId) || companyId > 2_147_483_647) {
    return null;
  }
  return { companyId, hash8: match[2]!, ext: match[3]! };
}

/** Stored, unblocked logos of companies that still have a website. */
const servable = and(
  eq(companyLogos.blocked, false),
  isNotNull(companyLogos.bytes),
  isNotNull(companies.websiteDomain),
);

/**
 * The logo address of each company that has one, in one query. Companies
 * with no logo are left out. A plain object, so it can be cached.
 */
export async function getLogoUrls(
  db: Db,
  companyIds: readonly number[],
): Promise<Record<number, string>> {
  const ids = [...new Set(companyIds)];
  if (ids.length === 0) return {};
  const rows = await db
    .select({
      companyId: companyLogos.companyId,
      sha256: companyLogos.sha256,
      mime: companyLogos.mime,
    })
    .from(companyLogos)
    .innerJoin(companies, eq(companies.id, companyLogos.companyId))
    .where(and(inArray(companyLogos.companyId, ids), servable));
  const out: Record<number, string> = {};
  for (const row of rows) {
    const url =
      row.sha256 && row.mime
        ? logoUrl(row.companyId, row.sha256, row.mime)
        : null;
    if (url) out[row.companyId] = url;
  }
  return out;
}

export interface LogoFile {
  bytes: Uint8Array;
  mime: string;
}

/**
 * The image for a logo address, or null unless the id, the hash and the
 * extension all match a stored, unblocked logo.
 */
export async function getLogoFile(
  db: Db,
  file: string,
): Promise<LogoFile | null> {
  const name = parseLogoFile(file);
  if (!name) return null;
  const [row] = await db
    .select({
      bytes: companyLogos.bytes,
      mime: companyLogos.mime,
      sha256: companyLogos.sha256,
    })
    .from(companyLogos)
    .innerJoin(companies, eq(companies.id, companyLogos.companyId))
    .where(and(eq(companyLogos.companyId, name.companyId), servable));
  if (!row?.bytes || !row.mime || !row.sha256) return null;
  if (!row.sha256.startsWith(name.hash8)) return null;
  if (LOGO_EXTENSIONS[row.mime] !== name.ext) return null;
  return { bytes: row.bytes, mime: row.mime };
}
