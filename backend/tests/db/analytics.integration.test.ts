import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../srcs/db/client.ts", async () => {
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  return { pool, db: drizzle(pool) };
});

import { pool } from "../../srcs/db/client.ts";
import {
  summarizeTransactionsByCategory,
  transactionsForExport,
  transactionTimeSeries,
} from "../../srcs/db/transactions.ts";

// Run after migrations with TEST_DATABASE_URL set. All test data is rolled back.
describe.skipIf(!process.env.TEST_DATABASE_URL)("analytics with PostgreSQL", () => {
  const userId = randomUUID();
  const foreignUserId = randomUUID();
  const eurId = randomUUID();
  const usdId = randomUUID();
  const emptyEurId = randomUUID();
  const foreignId = randomUUID();
  const categoryId = randomUUID();
  const range = { from: "2025-01-01", to: "2025-01-03" };

  beforeAll(async () => {
    await pool.connect();
    await pool.query("BEGIN");
    for (const id of [userId, foreignUserId]) {
      await pool.query(
        "INSERT INTO app_user (id, email, password_hash, display_name) VALUES ($1, $2, 'unused', 'Analytics check')",
        [id, `${id}@example.com`],
      );
    }
    for (const [id, owner, currency, archived] of [
      [eurId, userId, "EUR", false],
      [usdId, userId, "USD", true],
      [emptyEurId, userId, "EUR", false],
      [foreignId, foreignUserId, "EUR", false],
    ]) {
      await pool.query(
        "INSERT INTO account (id, user_id, name, type, currency_code, is_archived) VALUES ($1, $2, 'Checking', 'checking', $3, $4)",
        [id, owner, currency, archived],
      );
    }
    await pool.query(
      "INSERT INTO category (id, user_id, name, icon, color, types) VALUES ($1, $2, 'Food', 'food', '#000000', ARRAY['expense'])",
      [categoryId, userId],
    );
    const insert = (
      accountId: string,
      creator: string,
      type: string,
      amount: number,
      date: string,
      category: string | null = null,
      group: string | null = null,
    ) =>
      pool.query(
        `INSERT INTO "transaction" (account_id, created_by_id, type, amount_minor, booked_on, category_id, transfer_group_id, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '=Café, "tea"')`,
        [accountId, creator, type, amount, date, category, group],
      );
    await insert(eurId, userId, "income", 10000, "2025-01-01");
    await insert(eurId, userId, "expense", -500, "2025-01-03", categoryId);
    await insert(eurId, userId, "expense", -100, "2025-01-03", categoryId);
    await insert(usdId, userId, "income", 7000, "2025-01-01");
    await insert(usdId, userId, "expense", -800, "2025-01-03", categoryId);
    await insert(eurId, userId, "income", 999, "2024-12-31");
    await insert(eurId, userId, "income", 999, "2025-01-04");
    await insert(eurId, userId, "expense", -250, "2025-02-01");
    const group = randomUUID();
    await insert(eurId, userId, "transfer", -900, "2025-01-02", null, group);
    await insert(usdId, userId, "transfer", 1000, "2025-01-02", null, group);
    await insert(foreignId, foreignUserId, "income", 99999, "2025-01-01");
  });

  afterAll(async () => {
    await pool.query("ROLLBACK");
    await pool.end();
  });

  it("separates currencies, includes archived accounts, deduplicates currencies and reports transfer legs on transfer-only days", async () => {
    expect(await transactionTimeSeries(userId, range, "day")).toEqual([
      {
        period: "2025-01-01",
        currencyCode: "EUR",
        incomeMinor: 10000,
        expenseMinor: 0,
        transferOutMinor: 0,
        transferInMinor: 0,
      },
      {
        period: "2025-01-01",
        currencyCode: "USD",
        incomeMinor: 7000,
        expenseMinor: 0,
        transferOutMinor: 0,
        transferInMinor: 0,
      },
      {
        period: "2025-01-02",
        currencyCode: "EUR",
        incomeMinor: 0,
        expenseMinor: 0,
        transferOutMinor: -900,
        transferInMinor: 0,
      },
      {
        period: "2025-01-02",
        currencyCode: "USD",
        incomeMinor: 0,
        expenseMinor: 0,
        transferOutMinor: 0,
        transferInMinor: 1000,
      },
      {
        period: "2025-01-03",
        currencyCode: "EUR",
        incomeMinor: 0,
        expenseMinor: -600,
        transferOutMinor: 0,
        transferInMinor: 0,
      },
      {
        period: "2025-01-03",
        currencyCode: "USD",
        incomeMinor: 0,
        expenseMinor: -800,
        transferOutMinor: 0,
        transferInMinor: 0,
      },
    ]);
  });

  it("uses Monday week starts and clips totals to the requested dates, not the full period", async () => {
    expect(await transactionTimeSeries(userId, { ...range, accountId: eurId }, "week")).toEqual([
      {
        period: "2024-12-30",
        currencyCode: "EUR",
        incomeMinor: 10000,
        expenseMinor: -600,
        transferOutMinor: -900,
        transferInMinor: 0,
      },
    ]);
  });

  it("zero-fills missing calendar months and handles leap days", async () => {
    expect(
      await transactionTimeSeries(userId, { from: "2023-12-31", to: "2024-03-01", accountId: emptyEurId }, "month"),
    ).toEqual(
      ["2023-12-01", "2024-01-01", "2024-02-01", "2024-03-01"].map((period) => ({
        period,
        currencyCode: "EUR",
        incomeMinor: 0,
        expenseMinor: 0,
        transferOutMinor: 0,
        transferInMinor: 0,
      })),
    );
    expect(
      (await transactionTimeSeries(userId, { from: "2024-02-28", to: "2024-03-01", accountId: eurId }, "day")).map(
        ({ period }) => period,
      ),
    ).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
  });

  it("honors account, category and type filters before aggregation", async () => {
    expect(
      await transactionTimeSeries(userId, { ...range, accountId: usdId, categoryId, type: "expense" }, "day"),
    ).toEqual([
      {
        period: "2025-01-01",
        currencyCode: "USD",
        incomeMinor: 0,
        expenseMinor: 0,
        transferOutMinor: 0,
        transferInMinor: 0,
      },
      {
        period: "2025-01-02",
        currencyCode: "USD",
        incomeMinor: 0,
        expenseMinor: 0,
        transferOutMinor: 0,
        transferInMinor: 0,
      },
      {
        period: "2025-01-03",
        currencyCode: "USD",
        incomeMinor: 0,
        expenseMinor: -800,
        transferOutMinor: 0,
        transferInMinor: 0,
      },
    ]);
  });

  it("groups non-empty months separately and excludes transactions before the partial first month", async () => {
    expect(
      await transactionTimeSeries(userId, { from: "2025-01-02", to: "2025-02-02", accountId: eurId }, "month"),
    ).toEqual([
      {
        period: "2025-01-01",
        currencyCode: "EUR",
        incomeMinor: 999,
        expenseMinor: -600,
        transferOutMinor: -900,
        transferInMinor: 0,
      },
      {
        period: "2025-02-01",
        currencyCode: "EUR",
        incomeMinor: 0,
        expenseMinor: -250,
        transferOutMinor: 0,
        transferInMinor: 0,
      },
    ]);
  });

  it("reuses the category summary without combining currencies or including transfers/foreign transactions", async () => {
    expect(await summarizeTransactionsByCategory(userId, range)).toEqual([
      { categoryId, type: "expense", totalMinor: -600, count: 2, currencyCode: "EUR" },
      { categoryId: null, type: "income", totalMinor: 10000, count: 1, currencyCode: "EUR" },
      { categoryId, type: "expense", totalMinor: -800, count: 1, currencyCode: "USD" },
      { categoryId: null, type: "income", totalMinor: 7000, count: 1, currencyCode: "USD" },
    ]);
    expect(await summarizeTransactionsByCategory(userId, { ...range, accountId: usdId, type: "expense" })).toEqual([
      { categoryId, type: "expense", totalMinor: -800, count: 1, currencyCode: "USD" },
    ]);
  });

  it("exports all matching rows with labels and UI precision, including transfer legs but not foreign data", async () => {
    const rows = await transactionsForExport(userId, range);
    expect(rows).toHaveLength(7);
    expect(rows.filter(({ currencyCode }) => currencyCode === "USD")).toHaveLength(3);
    expect(rows.filter(({ type }) => type === "transfer")).toHaveLength(2);
    expect(await transactionsForExport(userId, { ...range, accountId: usdId, categoryId, type: "expense" })).toEqual([
      {
        account: "Checking",
        currencyCode: "USD",
        bookedOn: "2025-01-03",
        type: "expense",
        category: "Food",
        merchant: null,
        description: '=Café, "tea"',
        amountMinor: -800,
        minorUnit: 2,
      },
    ]);
  });

  it("matches the UI's two-decimal fallback for currencies outside the reference catalog", async () => {
    await pool.query("UPDATE account SET currency_code = 'AAA' WHERE id = $1", [eurId]);
    try {
      const rows = await transactionsForExport(userId, { ...range, accountId: eurId });
      expect(rows).toHaveLength(4);
      expect(rows.every(({ currencyCode, minorUnit }) => currencyCode === "AAA" && minorUnit === 2)).toBe(true);
    } finally {
      await pool.query("UPDATE account SET currency_code = 'EUR' WHERE id = $1", [eurId]);
    }
  });

  it("returns no currency series for a user with no accounts", async () => {
    expect(await transactionTimeSeries(randomUUID(), range, "day")).toEqual([]);
  });
});
