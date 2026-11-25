import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { FEEDBACK_MESSAGE_MAX } from "@/core/feedback";
import { startBackfill } from "./backfill-progress";
import type { Db } from "./client";
import { insertFeedback, recentFeedbackCount } from "./feedback";
import * as schema from "./schema";
import { siteFeedback } from "./schema";
import { createTestDb, type TestDb } from "./testing";

describe("site feedback", () => {
  let testDb: TestDb;
  let db: Db;

  beforeEach(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 30_000);

  afterEach(async () => {
    await testDb.close();
  });

  it("has no column that could identify anyone", async () => {
    const result = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'site_feedback'
      ORDER BY ordinal_position
    `);
    const rows = (result as { rows: Array<{ column_name: string }> }).rows;
    expect(rows.map((row) => row.column_name)).toEqual([
      "id",
      "kind",
      "path",
      "filters",
      "message",
      "created_at",
    ]);
  });

  it("stores a cleaned missing-data message", async () => {
    await insertFeedback(db, {
      kind: "missing",
      path: " /companies/acme ",
      filters: "?sector=fintech",
      message: "  No Series B\u0000 for Acme  ",
    });
    const rows = await db.select().from(siteFeedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    expect({ ...rows[0], createdAt: undefined }).toEqual({
      id: 1,
      kind: "missing",
      path: "/companies/acme",
      filters: "sector=fintech",
      message: "No Series B for Acme",
      createdAt: undefined,
    });
  });

  it("stores interest in alerts with no message", async () => {
    await insertFeedback(db, { kind: "alerts_interest", path: "/funding" });
    expect(await db.select().from(siteFeedback)).toMatchObject([
      {
        kind: "alerts_interest",
        path: "/funding",
        filters: null,
        message: null,
      },
    ]);
  });

  it.each([
    ["an empty message", { kind: "missing", path: "/", message: "   " }],
    [
      "an over-long message",
      {
        kind: "missing",
        path: "/",
        message: "a".repeat(FEEDBACK_MESSAGE_MAX + 1),
      },
    ],
    [
      "an over-long path",
      { kind: "missing", path: `/${"a".repeat(200)}`, message: "x" },
    ],
    [
      "over-long filters",
      { kind: "alerts_interest", path: "/", filters: `q=${"a".repeat(499)}` },
    ],
    [
      "an extra field",
      { kind: "missing", path: "/", message: "x", email: "a@b.c" },
    ],
  ])("rejects %s and stores nothing", async (_, input) => {
    await expect(insertFeedback(db, input as never)).rejects.toThrow(ZodError);
    expect(await db.select().from(siteFeedback)).toEqual([]);
  });

  it.each([
    [
      "an over-long message",
      { kind: "missing", path: "/", message: "a".repeat(1001) },
    ],
    ["an empty message", { kind: "missing", path: "/", message: "" }],
    ["a missing-data entry with no message", { kind: "missing", path: "/" }],
    [
      "a message on interest in alerts",
      { kind: "alerts_interest", path: "/", message: "x" },
    ],
    [
      "an over-long path",
      { kind: "missing", path: `/${"a".repeat(200)}`, message: "x" },
    ],
    [
      "a path without a leading slash",
      { kind: "missing", path: "a", message: "x" },
    ],
    ["empty filters", { kind: "alerts_interest", path: "/", filters: "" }],
    [
      "over-long filters",
      { kind: "alerts_interest", path: "/", filters: "a".repeat(501) },
    ],
    ["an unknown kind", { kind: "praise", path: "/", message: "x" }],
  ])("enforces the caps in the database too: %s", async (_, values) => {
    await expect(
      db
        .insert(siteFeedback)
        .values(values as typeof siteFeedback.$inferInsert),
    ).rejects.toThrow();
  });

  it("counts feedback since a time", async () => {
    await db.insert(siteFeedback).values([
      {
        kind: "alerts_interest",
        path: "/",
        createdAt: new Date("2026-12-01T08:59:59Z"),
      },
      {
        kind: "alerts_interest",
        path: "/",
        createdAt: new Date("2026-12-01T09:00:00Z"),
      },
      {
        kind: "missing",
        path: "/",
        message: "x",
        createdAt: new Date("2026-12-01T09:30:00Z"),
      },
    ]);
    expect(
      await recentFeedbackCount(db, new Date("2026-12-01T09:00:00Z")),
    ).toBe(2);
    expect(
      await recentFeedbackCount(db, new Date("2026-12-01T10:00:00Z")),
    ).toBe(0);
  });
});

// Role tests: the web role may insert and count site feedback, never read it.

const ROOT = new URL("../../", import.meta.url);
const MIGRATIONS = fileURLToPath(new URL("drizzle/", ROOT));
const ROLES_SQL = fileURLToPath(new URL("scripts/sql/roles.sql", ROOT));

function migrationStatements(file: string): string[] {
  return readFileSync(`${MIGRATIONS}${file}`, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
}

/**
 * The grant lines of `roles.sql`: everything but the psql-only role creation
 * and passwords. `before0007` leaves out the site_feedback lines, as the script
 * stood before this migration.
 */
function rolesStatements({ before0007 = false } = {}): string[] {
  return readFileSync(ROLES_SQL, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .filter(
      (statement) =>
        !statement.includes(":'") && !statement.includes("\\gexec"),
    )
    .filter(
      (statement) => !(before0007 && statement.includes("site_feedback")),
    );
}

async function exec(client: PGlite, statements: string[]): Promise<void> {
  for (const statement of statements) await client.exec(statement);
}

async function createRoles(client: PGlite): Promise<void> {
  await client.exec(`
    CREATE ROLE signalfeed_ingest;
    CREATE ROLE signalfeed_web;
    CREATE ROLE someone_else;
    GRANT USAGE ON SCHEMA public TO someone_else;
  `);
}

async function asRole<T>(
  client: PGlite,
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await client.exec("RESET ROLE");
  }
}

async function expectDenied(client: PGlite, query: string): Promise<void> {
  await expect(client.query(query), query).rejects.toThrow(/permission denied/);
}

/** What every deployed database must allow and refuse. */
async function expectFeedbackLockedDown(client: PGlite): Promise<void> {
  const db = drizzle({ client, schema }) as unknown as Db;
  const since = new Date(Date.now() - 60_000);
  const before = await recentFeedbackCount(db, since);

  await asRole(client, "signalfeed_web", async () => {
    await insertFeedback(db, {
      kind: "missing",
      path: "/",
      message: "From the site",
    });
    await insertFeedback(db, { kind: "alerts_interest", path: "/funding" });
    expect(await recentFeedbackCount(db, since)).toBe(before + 2);

    for (const query of [
      "SELECT * FROM site_feedback",
      "SELECT count(*) FROM site_feedback",
      "SELECT message FROM site_feedback",
      "UPDATE site_feedback SET path = '/x'",
      "DELETE FROM site_feedback",
      "TRUNCATE site_feedback",
      "INSERT INTO site_feedback (kind, path) VALUES ('alerts_interest', '/') RETURNING id",
      "SELECT last_value FROM site_feedback_id_seq",
      "SELECT nextval('site_feedback_id_seq')",
      "SELECT setval('site_feedback_id_seq', 1)",
      // backfill_progress: read like every other table, never written.
      "INSERT INTO backfill_progress (job) VALUES ('ch_capital_history')",
    ]) {
      await expectDenied(client, query);
    }
    await expect(
      client.query("SELECT * FROM backfill_progress"),
    ).resolves.toBeDefined();
  });

  await asRole(client, "someone_else", async () => {
    await expectDenied(client, "SELECT site_feedback_count_since(now())");
  });

  await asRole(client, "signalfeed_ingest", async () => {
    const rows = await client.query<{ message: string | null }>(
      "SELECT message FROM site_feedback ORDER BY id DESC LIMIT 2",
    );
    expect(rows.rows.map((row) => row.message)).toEqual([
      null,
      "From the site",
    ]);
    await startBackfill(db, "ch_capital_history");
    expect(await recentFeedbackCount(db, since)).toBe(before + 2);
  });
}

describe("site feedback privileges", () => {
  let client: PGlite;

  beforeEach(async () => {
    client = await PGlite.create({ extensions: { vector, pg_trgm } });
  });

  afterEach(async () => {
    await client.close();
  });

  it("hold when the migration runs after the roles script", async () => {
    const files = migrationFiles();
    const index = files.findIndex((file) => file.startsWith("0007_"));
    expect(index).toBeGreaterThan(0);

    for (const file of files.slice(0, index))
      await exec(client, migrationStatements(file));
    await createRoles(client);
    await exec(client, rolesStatements({ before0007: true }));
    // As on merge: default privileges give the web role SELECT, which the migration revokes.
    for (const file of files.slice(index))
      await exec(client, migrationStatements(file));
    await expectFeedbackLockedDown(client);

    // Re-running the roles script afterwards changes nothing.
    await exec(client, rolesStatements());
    await expectFeedbackLockedDown(client);
  }, 60_000);

  it("hold when the roles script runs after every migration", async () => {
    for (const file of migrationFiles())
      await exec(client, migrationStatements(file));
    await createRoles(client);
    await exec(client, rolesStatements());
    await expectFeedbackLockedDown(client);
  }, 60_000);
});
