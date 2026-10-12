import "dotenv/config";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Client } from "pg";

// Run with DATABASE_URL set: npx tsx tests/db/remove-user-deleted-at.check.ts
// Temporary tables shadow real tables; no persisted user data is changed.
assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be set");
const client = new Client({ connectionString: process.env.DATABASE_URL });
const migrationSql = await readFile(new URL("../../drizzle/0008_remove_user_deleted_at.sql", import.meta.url), "utf8");

await client.connect();
try {
  await client.query('CREATE TEMP TABLE "app_user" (id integer, deleted_at timestamptz)');
  await client.query('INSERT INTO "app_user" VALUES (1, NULL), (2, NOW())');
  await assert.rejects(client.query(migrationSql), /soft-deleted users exist/);
  const { rows } = await client.query('SELECT id FROM "app_user" WHERE deleted_at IS NOT NULL');
  assert.deepEqual(rows, [{ id: 2 }]);

  await client.query('DELETE FROM "app_user" WHERE id = 2');
  await client.query(migrationSql);
  const { rows: activeUsers } = await client.query('SELECT * FROM "app_user"');
  assert.deepEqual(activeUsers, [{ id: 1 }]);
  console.log("Migration rejects soft-deleted users and preserves active users.");
} finally {
  await client.end();
}
