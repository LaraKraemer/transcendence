import "dotenv/config";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "./client.ts";

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
}

// Also runnable standalone via `npm run db:migrate`. When imported by
// index.ts this block is skipped, so the pool stays open for the server.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runMigrations();
    console.log("Migrations applied");
  } finally {
    await pool.end();
  }
}
