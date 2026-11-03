import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../srcs/db/client.ts", async () => {
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  return { pool, db: drizzle(pool) };
});

import { pool } from "../../srcs/db/client.ts";
import { listTransactions } from "../../srcs/db/transactions.ts";

// Run after migrations with TEST_DATABASE_URL set. All test data is rolled back.
describe.skipIf(!process.env.TEST_DATABASE_URL)("transaction list with PostgreSQL", () => {
  const userId = randomUUID();
  const [checkingId, savingsId, closedId] = [randomUUID(), randomUUID(), randomUUID()];
  const pairedGroupId = randomUUID();

  beforeAll(async () => {
    await pool.connect();
    await pool.query("BEGIN");
    await pool.query("INSERT INTO app_user (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)", [
      userId,
      `${userId}@example.com`,
      "unused",
      "List check",
    ]);
    for (const id of [checkingId, savingsId, closedId]) {
      await pool.query("INSERT INTO account (id, user_id, name, type) VALUES ($1, $2, $3, 'checking')", [
        id,
        userId,
        id,
      ]);
    }
    const insert = (accountId: string, type: string, amountMinor: number, bookedOn: string, groupId: string | null) =>
      pool.query(
        `INSERT INTO "transaction" (account_id, created_by_id, type, transfer_group_id, amount_minor, booked_on) VALUES ($1, $2, $3, $4, $5, $6)`,
        [accountId, userId, type, groupId, amountMinor, bookedOn],
      );
    await insert(checkingId, "income", 5000, "2025-01-01", null);
    await insert(checkingId, "expense", -700, "2025-01-02", null);
    await insert(checkingId, "transfer", -1000, "2025-01-03", pairedGroupId);
    await insert(savingsId, "transfer", 1100, "2025-01-03", pairedGroupId);
    // Deleting an account leaves the other account's leg behind as a lone leg, in either direction.
    const outgoingGroupId = randomUUID();
    const incomingGroupId = randomUUID();
    await insert(checkingId, "transfer", -200, "2025-01-04", outgoingGroupId);
    await insert(closedId, "transfer", 200, "2025-01-04", outgoingGroupId);
    await insert(closedId, "transfer", -300, "2025-01-05", incomingGroupId);
    await insert(checkingId, "transfer", 300, "2025-01-05", incomingGroupId);
    await pool.query("DELETE FROM account WHERE id = $1", [closedId]);
  });

  afterAll(async () => {
    await pool.query("ROLLBACK");
    await pool.end();
  });

  it("lists a paired transfer once, as its source leg with the other leg's account and amount", async () => {
    const { items, total } = await listTransactions({ userId }, { limit: 200, offset: 0 });
    expect(total).toBe(5);
    expect(items.map(({ amountMinor }) => amountMinor)).toEqual([300, -200, -1000, -700, 5000]);
    expect(items.find((item) => item.transferGroupId === pairedGroupId)).toMatchObject({
      accountId: checkingId,
      transferAccountId: savingsId,
      transferAmountMinor: 1100,
    });
  });

  it("counts transfers once for type, limit and offset across all accounts", async () => {
    const pages = [];
    for (const offset of [0, 1, 2])
      pages.push(await listTransactions({ userId }, { type: "transfer", limit: 1, offset }));
    expect(pages.map(({ total }) => total)).toEqual([3, 3, 3]);
    expect(pages.flatMap(({ items }) => items.map(({ amountMinor }) => amountMinor))).toEqual([300, -200, -1000]);
  });

  it("keeps the destination leg in its own account's list", async () => {
    const { items, total } = await listTransactions({ accountId: savingsId }, { limit: 50, offset: 0 });
    expect(total).toBe(1);
    expect(items).toMatchObject([{ amountMinor: 1100, transferAccountId: checkingId, transferAmountMinor: -1000 }]);
  });
  it("searches literally, combines filters and paginates tied amounts without gaps", async () => {
    await pool.query("SAVEPOINT search_check");
    try {
      const categoryId = randomUUID();
      await pool.query(
        `INSERT INTO category (id, user_id, name, icon, color, types) VALUES ($1, $2, 'Search', 'coffee', '#000000', ARRAY['expense'])`,
        [categoryId, userId],
      );
      const searchAccountId = randomUUID();
      await pool.query(`INSERT INTO account (id, user_id, name, type) VALUES ($1, $2, 'Search', 'checking')`, [
        searchAccountId,
        userId,
      ]);
      const entries = [
        ["Café", null, null, -100, categoryId],
        [null, "CAFE", null, -100, categoryId],
        [null, null, "caf notes", -200, null],
        ["100%", null, null, -300, null],
        [null, "under_score", null, -400, null],
        [null, null, "back\\slash", 500, null],
      ];
      for (const [description, merchant, notes, amount, category] of entries) {
        await pool.query(
          `INSERT INTO "transaction" (account_id, created_by_id, type, amount_minor, description, merchant_name, notes, category_id, booked_on)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2025-02-01')`,
          [
            searchAccountId,
            userId,
            Number(amount) < 0 ? "expense" : "income",
            amount,
            description,
            merchant,
            notes,
            category,
          ],
        );
      }
      const owner = { accountId: searchAccountId };
      for (const [searchTerm, total] of [
        ["caf", 3],
        ["%", 1],
        ["_", 1],
        ["\\", 1],
      ] as const) {
        const result = await listTransactions(owner, { searchTerm, limit: 50, offset: 0 });
        expect(result.total).toBe(total);
        expect(result.items).toHaveLength(total);
      }
      const combined = {
        searchTerm: "caf",
        categoryId,
        type: "expense",
        minAmountMinor: 100,
        maxAmountMinor: 100,
        from: "2025-02-01",
        to: "2025-02-01",
      };
      expect((await listTransactions(owner, { ...combined, limit: 50, offset: 0 })).total).toBe(2);
      expect(await listTransactions(owner, { ...combined, limit: 1, offset: 2 })).toEqual({ items: [], total: 2 });
      expect(
        (await listTransactions(owner, { searchTerm: "caf", categoryId: "none", limit: 50, offset: 0 })).items,
      ).toMatchObject([{ amountMinor: -200, categoryId: null }]);
      for (const order of ["asc", "desc"] as const) {
        const complete = await listTransactions(owner, { sort: "amountMinor", order, limit: 50, offset: 0 });
        const pages = [];
        for (let offset = 0; offset < entries.length; offset++) {
          const page = await listTransactions(owner, { sort: "amountMinor", order, limit: 1, offset });
          expect(page.total).toBe(entries.length);
          pages.push(...page.items);
        }
        expect(pages.map(({ id }) => id)).toEqual(complete.items.map(({ id }) => id));
        expect(new Set(pages.map(({ id }) => id)).size).toBe(entries.length);
        const amounts = pages.map(({ amountMinor }) => amountMinor);
        expect(amounts).toEqual([...amounts].sort((left, right) => (order === "asc" ? left - right : right - left)));
        const tiedIds = pages.filter(({ amountMinor }) => amountMinor === -100).map(({ id }) => id);
        expect(tiedIds).toEqual(order === "asc" ? [...tiedIds].sort() : [...tiedIds].sort().reverse());
      }
    } finally {
      await pool.query("ROLLBACK TO SAVEPOINT search_check");
    }
  });
});
