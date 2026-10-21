import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../srcs/db/client.ts", async () => {
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  return { pool, db: drizzle(pool) };
});

import { createApp } from "../../srcs/app.ts";
import { pool } from "../../srcs/db/client.ts";

// Run after migrations with TEST_DATABASE_URL set. All test data is rolled back.
// The mock uses one real connection so HTTP requests share the rollback transaction.
describe.skipIf(!process.env.TEST_DATABASE_URL)("profile deletion with PostgreSQL", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await pool.connect();
    await pool.query("BEGIN");
    server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query("ROLLBACK");
    await pool.end();
  });

  it("cascades related data, clears the cookie, rejects old sessions and preserves another user", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const accountId = randomUUID();
    const otherAccountId = randomUUID();
    const categoryId = randomUUID();
    for (const id of [userId, otherUserId]) {
      await pool.query("INSERT INTO app_user (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)", [
        id,
        `${id}@example.com`,
        "unused",
        "Deletion check",
      ]);
    }
    for (const [id, ownerId] of [
      [accountId, userId],
      [otherAccountId, otherUserId],
    ]) {
      await pool.query("INSERT INTO account (id, user_id, name, type, is_archived) VALUES ($1, $2, $3, $4, true)", [
        id,
        ownerId,
        "Archived account",
        "checking",
      ]);
    }
    await pool.query("INSERT INTO category (id, user_id, name, icon, color, types) VALUES ($1, $2, $3, $4, $5, $6)", [
      categoryId,
      userId,
      "Expense",
      "cart",
      "#000000",
      ["expense"],
    ]);
    // Exercise both cascade paths, including a creator reference outside the owned account.
    for (const [ledgerId, creatorId, assignedCategoryId] of [
      [accountId, otherUserId, categoryId],
      [otherAccountId, userId, null],
      [otherAccountId, otherUserId, null],
    ]) {
      await pool.query(
        `INSERT INTO "transaction" (account_id, created_by_id, category_id, type, amount_minor, description, booked_on) VALUES ($1, $2, $3, 'expense', -100, $4, CURRENT_DATE)`,
        [ledgerId, creatorId, assignedCategoryId, "Deletion check"],
      );
    }
    const tokens = [randomUUID(), randomUUID()];
    const otherToken = randomUUID();
    for (const token of [...tokens, otherToken]) {
      await pool.query(
        "INSERT INTO session (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')",
        [token === otherToken ? otherUserId : userId, createHash("sha256").update(token).digest("hex")],
      );
    }
    expect((await fetch(`${baseUrl}/auth/me`, { method: "DELETE" })).status).toBe(401);
    // Force a failure after cascades run, then verify PostgreSQL undoes the entire statement.
    await pool.query(`CREATE FUNCTION pg_temp.reject_profile_deletion() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Deletion check failure'; END $$`);
    await pool.query(`CREATE TRIGGER deletion_check_failure AFTER DELETE ON app_user
      FOR EACH ROW WHEN (OLD.id = '${userId}') EXECUTE FUNCTION pg_temp.reject_profile_deletion()`);
    await pool.query("SAVEPOINT failed_deletion");
    const failedResponse = await fetch(`${baseUrl}/auth/me`, {
      method: "DELETE",
      headers: { Cookie: `session=${tokens[0]}` },
    });
    expect(failedResponse.status).toBe(500);
    expect(failedResponse.headers.get("set-cookie")).toBeNull();
    await pool.query("ROLLBACK TO SAVEPOINT failed_deletion");
    expect((await pool.query("SELECT 1 FROM account WHERE id = $1", [accountId])).rowCount).toBe(1);
    expect((await pool.query('SELECT 1 FROM "transaction" WHERE account_id = $1', [accountId])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM session WHERE user_id = $1", [userId])).rowCount).toBe(2);
    await pool.query("DROP TRIGGER deletion_check_failure ON app_user");
    const response = await fetch(`${baseUrl}/auth/me`, {
      method: "DELETE",
      headers: { Cookie: `session=${tokens[0]}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: otherUserId }),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(/session=;.*Expires=Thu, 01 Jan 1970/);
    for (const token of tokens) {
      expect((await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: `session=${token}` } })).status).toBe(401);
    }
    expect((await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: `session=${otherToken}` } })).status).toBe(200);
    for (const table of ["app_user", "account", "category", "session"]) {
      const ownerColumn = table === "app_user" ? "id" : "user_id";
      expect((await pool.query(`SELECT 1 FROM "${table}" WHERE ${ownerColumn} = $1`, [userId])).rows).toEqual([]);
    }
    const { rows } = await pool.query(
      'SELECT account_id, created_by_id FROM "transaction" WHERE account_id IN ($1, $2)',
      [accountId, otherAccountId],
    );
    expect(rows).toEqual([{ account_id: otherAccountId, created_by_id: otherUserId }]);
    expect((await pool.query("SELECT 1 FROM account WHERE id = $1", [otherAccountId])).rowCount).toBe(1);
    // The global Transfer category has no owner, so deleting a user never touches it.
    expect((await pool.query("SELECT 1 FROM category WHERE is_system")).rowCount).toBe(1);
  });
});
