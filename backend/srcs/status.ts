import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { statusPool } from "./db/client.ts";
import { avatarDir } from "./storage.ts";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const backupMaxAgeMs = 36 * 60 * 60 * 1000;

/** Reports dependency health without exposing paths, credentials, or errors. */
export async function getStatus() {
  const startedAtMs = performance.now();
  const [database, storage, backup] = await Promise.allSettled([
    statusPool.query("SELECT 1").then(() => Math.round(performance.now() - startedAtMs)),
    access(avatarDir(), constants.W_OK),
    readFile(process.env.BACKUP_MARKER_PATH ?? "/backups/latest.ok", "utf8"),
  ]);
  const backupAtMs = backup.status === "fulfilled" ? Date.parse(backup.value.trim()) : NaN;
  const lastBackupAt =
    Number.isFinite(backupAtMs) && backupAtMs <= Date.now() ? new Date(backupAtMs).toISOString() : null;
  const databaseDown = database.status === "rejected";
  const storageDown = storage.status === "rejected";
  return {
    status: databaseDown
      ? "down"
      : storageDown || lastBackupAt === null || Date.now() - backupAtMs > backupMaxAgeMs
        ? "degraded"
        : "ok",
    components: {
      database: {
        status: databaseDown ? "down" : "ok",
        latencyMs: database.status === "fulfilled" ? database.value : Math.round(performance.now() - startedAtMs),
      },
      storage: { status: storageDown ? "down" : "ok" },
    },
    uptimeSeconds: Math.floor(process.uptime()),
    version,
    lastBackupAt,
  };
}
