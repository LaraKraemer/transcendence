import "dotenv/config";

import { pool } from "./client.ts";

/**
 * No default ledger data is created because accounts, categories, and
 * transactions belong to authenticated users.
 */
async function seed(): Promise<void> {
  console.log("No default data to seed");
}

try {
  await seed();
} finally {
  await pool.end();
}