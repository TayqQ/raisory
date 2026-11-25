import type { Db } from "@/db/client";
import {
  formatUkDateTime,
  getIngestHealth,
  INGEST_STALE_AFTER_HOURS,
  isIngestStale,
  successTime,
} from "@/db/queries/status";

export interface HealthResult {
  healthy: boolean;
  /** One line for the log and the alert issue. Never holds a secret. */
  line: string;
}

function hoursAgo(iso: string, now: Date): string {
  const hours = (now.getTime() - new Date(iso).getTime()) / 3_600_000;
  return `${Math.max(0, hours).toFixed(1)} hours ago`;
}

/**
 * `pnpm ingest health`: is the last successful news ingest recent enough?
 * Read-only, and takes no lock, so it runs on the read-only web role (D73).
 */
export async function checkIngestHealth(
  db: Db,
  options: { now: Date; maxAgeHours?: number },
): Promise<HealthResult> {
  const { now } = options;
  const maxAgeHours = options.maxAgeHours ?? INGEST_STALE_AFTER_HOURS;
  const health = await getIngestHealth(db, now);
  const success = health.lastNewsSuccess;
  const at = success ? successTime(success) : null;
  const healthy = !isIngestStale(at, now, maxAgeHours);
  const limit = `limit ${maxAgeHours} hour${maxAgeHours === 1 ? "" : "s"}`;

  let line: string;
  if (at == null) {
    line = `Ingest stale: no successful news ingest recorded (${limit}).`;
  } else {
    line = `Ingest ${healthy ? "healthy" : "stale"}: last news ingest success ${formatUkDateTime(at)} UK time, ${hoursAgo(at, now)} (${limit}).`;
  }

  const latest = health.latestNewsRun;
  if (!healthy && latest && latest.id !== success?.id) {
    line += ` Latest news run ${formatUkDateTime(latest.startedAt)} UK time: ${latest.status}.`;
  }
  if (health.runInProgress) {
    line += ` A run of unknown kind (news or daily) started ${formatUkDateTime(health.runInProgress.startedAt)} UK time is still running.`;
  }
  return { healthy, line };
}

/**
 * Ends a local `pg` pool, so the CLI exits at once rather than waiting for
 * idle connections to time out. Neon's HTTP client holds nothing open.
 */
export async function closeWebDb(db: Db): Promise<void> {
  const client: unknown = (db as { $client?: unknown }).$client;
  if (
    typeof client === "object" &&
    client !== null &&
    "end" in client &&
    typeof client.end === "function"
  ) {
    await (client as { end: () => Promise<void> }).end();
  }
}

const CONNECTION_STRING = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi;

/** Removes anything shaped like a URL, so a driver error cannot leak a password. */
export function redactConnectionStrings(message: string): string {
  return message.replace(CONNECTION_STRING, "[redacted]");
}
