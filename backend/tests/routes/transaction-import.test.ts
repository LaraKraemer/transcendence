import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, connect, release } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  class FakePool {
    query = query;
    connect = connect;
  }
  const pool = new FakePool();
  connect.mockResolvedValue({ query, release });
  return { pool, db: drizzle(pool as unknown as import("pg").Pool) };
});
vi.mock("../../srcs/auth.ts", () => ({
  requireAuthenticatedUser: (_req: Request, res: Response, next: () => void) => {
    res.locals.userId = "550e8400-e29b-41d4-a716-446655440001";
    next();
  },
}));

import { transactionsRouter } from "../../srcs/routes/transaction.ts";
import { accounts } from "../../srcs/db/schema.ts";
import { dispatch } from "../helpers/dispatch.ts";
import { row } from "../helpers/rows.ts";

const accountId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "550e8400-e29b-41d4-a716-446655440001";
const entry = { type: "expense", amountMinor: -100, bookedOn: "2026-10-20" };
const document = { version: 1, currency: "EUR", transactions: [entry, { ...entry, type: "income", amountMinor: 200 }] };
const post = (body: unknown = document, id = accountId) =>
  dispatch(transactionsRouter, { method: "POST", url: "/import", query: { accountId: id }, body });
const accountRow = (overrides = {}) =>
  row(accounts, {
    id: accountId,
    userId,
    name: "Checking",
    type: "checking",
    currencyCode: "EUR",
    openingBalanceMinor: 0,
    institution: null,
    accountRef: null,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

beforeEach(() => {
  query.mockReset();
  release.mockClear();
  query.mockResolvedValue({ rows: [] });
});

describe("POST /transactions/import", () => {
  it("rejects invalid account IDs and rows before querying", async () => {
    expect((await post(document, "bad")).status).toBe(400);
    expect((await post({ ...document, transactions: [entry, { ...entry, amountMinor: 1 }] })).body).toEqual({
      error: expect.stringContaining("Row 2:"),
    });
    expect(query).not.toHaveBeenCalled();
  });
  it("returns 404 for missing or foreign accounts, scoped to the authenticated user", async () => {
    expect((await post()).status).toBe(404);
    const [, select] = query.mock.calls;
    expect(select?.[0].text).toContain('"account"."user_id"');
    expect(select?.[1]).toEqual([accountId, userId, 1]);
    expect(query).toHaveBeenCalledTimes(3);
  });
  it.each([
    [{ isArchived: true }, 409],
    [{ currencyCode: "USD" }, 400],
  ])("rejects destination state %j without inserting", async (overrides, status) => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [accountRow(overrides)] });
    expect((await post()).status).toBe(status);
    expect(
      query.mock.calls.some(([statement]) =>
        (typeof statement === "string" ? statement : statement.text).startsWith("insert"),
      ),
    ).toBe(false);
  });
  it("locks the account and inserts the complete uncategorized batch in one statement", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [accountRow()] })
      .mockResolvedValueOnce({ rows: [["id1"], ["id2"]] });
    expect(await post()).toEqual({ status: 201, body: { imported: 2 } });
    expect(query.mock.calls[1]?.[0].text).toContain("for update");
    expect(query.mock.calls[2]?.[0].text).toContain('insert into "transaction"');
    expect(query.mock.calls[2]?.[1]).toContain(userId);
    expect(query.mock.calls[2]?.[1].filter((value: unknown) => value === null)).toHaveLength(8);
    expect(query.mock.calls[3]?.[0].text).toBe("commit");
    expect(release).toHaveBeenCalled();
  });
  it("resolves a category name owned by the user and keeps omitted categories null", async () => {
    const categoryId = "550e8400-e29b-41d4-a716-446655440002";
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [accountRow()] })
      .mockResolvedValueOnce({ rows: [[categoryId, "Food", ["expense"]]] })
      .mockResolvedValueOnce({ rows: [["id1"], ["id2"]] });
    expect(
      await post({ ...document, transactions: [{ ...entry, category: " Food " }, document.transactions[1]] }),
    ).toEqual({ status: 201, body: { imported: 2 } });
    expect(query.mock.calls[2]?.[0].text).toContain('"category"."user_id"');
    expect(query.mock.calls[2]?.[1]).toEqual([userId, "Food"]);
    expect(query.mock.calls[2]?.[0].text).toContain("for share");
    expect(query.mock.calls[3]?.[1]).toContain(categoryId);
    expect(query.mock.calls[3]?.[1].filter((value: unknown) => value === null)).toHaveLength(7);
  });
  it.each([
    [[], "category not found"],
    [[["category-id", "Food", ["income"]]], "category does not allow expense"],
  ])("rejects unknown, foreign or incompatible categories without a partial import", async (categoryRows, error) => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [accountRow()] })
      .mockResolvedValueOnce({ rows: categoryRows });
    expect(await post({ ...document, transactions: [entry, { ...entry, category: "Food" }] })).toEqual({
      status: 400,
      body: { error: `Row 2: ${error}` },
    });
    expect(
      query.mock.calls.some(([statement]) =>
        (typeof statement === "string" ? statement : statement.text).startsWith("insert"),
      ),
    ).toBe(false);
  });
  it("rolls back and propagates insertion failure", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [accountRow()] })
      .mockRejectedValueOnce(new Error("database failure"));
    await expect(post()).rejects.toThrow();
    expect(query.mock.calls[3]?.[0].text).toBe("rollback");
    expect(release).toHaveBeenCalled();
  });
});
