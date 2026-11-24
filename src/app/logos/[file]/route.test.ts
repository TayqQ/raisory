import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, companyLogos } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/testing";
import { GET } from "./route";

const state = vi.hoisted(() => ({ testDb: null as TestDb | null }));

vi.mock("@/db/web", () => ({
  getWebDb: () => state.testDb!.db,
}));

const PNG = new Uint8Array(
  readFileSync(path.join(process.cwd(), "fixtures/logos/square-64.png")),
);
const SHA = createHash("sha256").update(PNG).digest("hex");

let companyId: number;

beforeEach(async () => {
  state.testDb = await createTestDb();
  const db = state.testDb.db;
  const [company] = await db
    .insert(companies)
    .values({
      slug: "acme",
      name: "Acme",
      normalisedName: "acme",
      countryCode: "GB",
      websiteDomain: "acme.example",
    })
    .returning();
  companyId = company!.id;
  await db.insert(companyLogos).values({
    companyId,
    bytes: PNG,
    mime: "image/png",
    width: 64,
    height: 64,
    sha256: SHA,
    sourceUrl: "https://acme.example/apple-touch-icon.png",
    fetchedAt: new Date("2026-11-24T06:00:00Z"),
  });
});

afterEach(async () => {
  await state.testDb?.close();
  state.testDb = null;
});

function get(file: string): Promise<Response> {
  return GET(new Request(`http://localhost/logos/${file}`), {
    params: Promise.resolve({ file }),
  });
}

async function expectNotFound(file: string) {
  const response = await get(file);
  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("GET /logos/[file]", () => {
  it("serves a stored logo with its type and safe headers", async () => {
    const response = await get(`${companyId}-${SHA.slice(0, 8)}.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("returns 404 for a wrong hash or extension", async () => {
    await expectNotFound(`${companyId}-00000000.png`);
    await expectNotFound(`${companyId}-${SHA.slice(0, 8)}.ico`);
    await expectNotFound(`${companyId}-${SHA.slice(0, 8)}.svg`);
  });

  it("returns 404 for a file name that is not a logo address", async () => {
    for (const file of [
      "../secret",
      `${companyId}.png`,
      `0${companyId}-${SHA.slice(0, 8)}.png`,
      `99999999999-${SHA.slice(0, 8)}.png`,
      `${companyId}-${SHA.slice(0, 8).toUpperCase()}.png`,
    ]) {
      await expectNotFound(file);
    }
  });

  it("returns 404 for a blocked logo", async () => {
    await state
      .testDb!.db.update(companyLogos)
      .set({ blocked: true })
      .where(eq(companyLogos.companyId, companyId));
    await expectNotFound(`${companyId}-${SHA.slice(0, 8)}.png`);
  });

  it("returns 404 once the company has no website", async () => {
    await state
      .testDb!.db.update(companies)
      .set({ websiteDomain: null })
      .where(eq(companies.id, companyId));
    await expectNotFound(`${companyId}-${SHA.slice(0, 8)}.png`);
  });
});
