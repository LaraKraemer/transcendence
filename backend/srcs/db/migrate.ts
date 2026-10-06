import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "./client.ts";

/** Applies committed migrations for both server startup and the standalone CLI. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)) });
}

// Also runnable standalone via `npm run db:migrate`. When imported by
// index.ts this block is skipped, so the pool stays open for the server.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    await runMigrations();
    console.log("Migrations applied");
  } finally {
    await pool.end();
  }
}
