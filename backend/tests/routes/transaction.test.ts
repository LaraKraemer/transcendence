import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { dispatch } from "../helpers/dispatch.ts";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});
vi.mock("../../srcs/auth.ts", () => ({
  requireAuthenticatedUser: (_req: Request, res: Response, next: () => void) => {
    res.locals.userId = "550e8400-e29b-41d4-a716-446655440001";
    next();
  },
}));

import { TRANSFER_CATEGORY_ID } from "../../srcs/db/categories.ts";
import { transactionsRouter } from "../../srcs/routes/transaction.ts";
import { isUuid } from "../../srcs/validation.ts";
import { accountsRouter } from "../../srcs/routes/account.ts";

const accountId = "550e8400-e29b-41d4-a716-446655440000";
const transactionId = "550e8400-e29b-41d4-a716-446655440003";
const categoryId = "550e8400-e29b-41d4-a716-446655440002";
const userId = "550e8400-e29b-41d4-a716-446655440001";
const otherAccountId = "550e8400-e29b-41d4-a716-446655440005";
const transferGroupId = "550e8400-e29b-41d4-a716-446655440006";

// Transaction row in schema column order:
// id, accountId, categoryId, createdById, type, transferGroupId, amountMinor,
// description, notes, bookedOn, occurredAt, createdAt, updatedAt
function txRow(overrides: Record<string, unknown> = {}) {
  return [
    overrides.id ?? transactionId,
    overrides.accountId ?? accountId,
    overrides.categoryId ?? null,
    overrides.createdById ?? userId,
    overrides.type ?? "expense",
    overrides.transferGroupId ?? null,
    overrides.amountMinor ?? "-1000",
    overrides.description ?? "Coffee",
    overrides.notes ?? null,
    overrides.bookedOn ?? "2025-01-15",
    overrides.occurredAt ?? null,
    overrides.createdAt ?? new Date().toISOString(),
    overrides.updatedAt ?? new Date().toISOString(),
    overrides.accountIsArchived ?? false,
  ];
}

// Account row (all columns): id, userId, name, type, currencyCode, openingBalanceMinor,
// institution, accountRef, isArchived, createdAt, updatedAt
function acctRow(overrides: Record<string, unknown> = {}) {
  return [
    overrides.id ?? accountId,
    overrides.userId ?? userId,
    overrides.name ?? "Checking",
    overrides.type ?? "checking",
    overrides.currencyCode ?? "EUR",
    overrides.openingBalanceMinor ?? "0",
    null,
    null,
    overrides.isArchived ?? false,
    new Date().toISOString(),
    new Date().toISOString(),
  ];
}

function summary(params: Record<string, unknown>) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const req = { method: "GET", url: "/summary", query: params } as Request;
    const res = {
      locals: {},
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        resolve({ status, body });
      },
    } as Response;
    transactionsRouter(req, res, (error?: unknown) => reject(error ?? new Error("Route not found")));
  });
}

beforeEach(() => query.mockReset());

describe("GET /transactions/summary", () => {
  it.each([
    [{}, "accountId is required"],
    [{ accountId: "invalid" }, "accountId must be a valid UUID"],
    [{ accountId, from: "2025-1-01" }, "from must use YYYY-MM-DD format"],
    [{ accountId, to: "invalid" }, "to must use YYYY-MM-DD format"],
    [{ accountId, from: "" }, "from must use YYYY-MM-DD format"],
    [{ accountId, to: ["2025-01-01", "2025-02-01"] }, "to must use YYYY-MM-DD format"],
  ])("rejects invalid parameters %j", async (params, error) => {
    expect(await summary(params)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 when the ownership lookup finds no account", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await summary({ accountId })).toEqual({
      status: 404,
      body: { error: "Account not found" },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0].text).toContain('"account"."user_id" =');
    expect(query.mock.calls[0]![1]).toEqual([accountId, "550e8400-e29b-41d4-a716-446655440001", 1]);
  });

  it("groups remaining transactions by category and converts database totals to numbers", async () => {
    query.mockResolvedValueOnce({ rows: [[accountId]] });
    query.mockResolvedValueOnce({
      rows: [
        [accountId, "expense", "-32000", "2"],
        [null, "income", "100", "1"],
      ],
    });
    expect(await summary({ accountId, from: "2025-01-01", to: "2025-03-31" })).toEqual({
      status: 200,
      body: [
        { categoryId: accountId, type: "expense", totalMinor: -32000, count: 2 },
        { categoryId: null, type: "income", totalMinor: 100, count: 1 },
      ],
    });
    expect(query.mock.calls[0]![0].text.split(" where ")[1]).not.toContain("is_archived");
    const [statement, values] = query.mock.calls[1]!;
    expect(statement.text).toContain('SUM("amount_minor")');
    expect(statement.text).toContain("COUNT(*)");
    expect(statement.text).not.toContain('"status"');
    expect(statement.text).toContain('"transaction"."booked_on" >=');
    expect(statement.text).toContain('"transaction"."booked_on" <=');
    expect(statement.text).toContain('group by "transaction"."category_id", "transaction"."type"');
    expect(values).toEqual([accountId, "2025-01-01", "2025-03-31"]);
  });

  it.each([{}, { from: "2025-01-01" }, { to: "2025-03-31" }])(
    "supports optional date bounds %j and empty results",
    async (dates) => {
      query.mockResolvedValueOnce({ rows: [[accountId]] });
      query.mockResolvedValueOnce({ rows: [] });
      expect(await summary({ accountId, ...dates })).toEqual({ status: 200, body: [] });
      expect(query.mock.calls[1]![1]).toEqual([accountId, ...Object.values(dates)]);
    },
  );

  it("forwards database errors", async () => {
    query.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(summary({ accountId })).rejects.toThrow();
  });

  it("returns 400 for accountId='' (explicit empty string branch)", async () => {
    expect(await summary({ accountId: "" })).toEqual({
      status: 400,
      body: { error: "accountId is required" },
    });
    expect(query).not.toHaveBeenCalled();
  });
});

// ─── GET / ────────────────────────────────────────────────────────────────────

describe("GET /transactions", () => {
  it("rejects an invalid accountId before querying the database", async () => {
    expect(await dispatch(transactionsRouter, { url: "/", query: { accountId: "invalid" } })).toEqual({
      status: 400,
      body: { error: "accountId must be a valid UUID" },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ...["0", "201", "1.5", "20abc", "", ["20", "30"]].map((limit): [Record<string, unknown>, string] => [
      { accountId, limit },
      "limit must be an integer between 1 and 200",
    ]),
    ...["-1", "1.5", "3abc", "", ["0", "1"]].map((offset): [Record<string, unknown>, string] => [
      { accountId, offset },
      "offset must be a non-negative integer",
    ]),
    [{ accountId, from: "2025-1-01" }, "from must use YYYY-MM-DD format"],
    [{ accountId, to: "invalid" }, "to must use YYYY-MM-DD format"],
  ])("rejects invalid list parameters %j", async (params, error) => {
    expect(await dispatch(transactionsRouter, { url: "/", query: params as Record<string, unknown> })).toEqual({
      status: 400,
      body: { error },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["20", "200"])("accepts limit=%s with offset=0 and returns a separate total", async (limit) => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    query.mockResolvedValueOnce({ rows: [["87"]] });
    const result = await dispatch(transactionsRouter, {
      url: "/",
      query: { accountId, limit, offset: "0" },
    });
    expect(result).toMatchObject({
      status: 200,
      body: { items: [{ id: transactionId }], total: 87 },
    });
    expect(query.mock.calls[1]![0].text).toContain("limit $");
    expect(query.mock.calls[1]![1]).toEqual([accountId, Number(limit)]);
    expect(query.mock.calls[2]![0].text).toContain("count(*)");
    expect(query.mock.calls[2]![0].text).not.toMatch(/limit|offset/);
    expect(query.mock.calls[2]![1]).toEqual([accountId]);
  });

  it("applies inclusive dates to both queries", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    query.mockResolvedValueOnce({ rows: [["42"]] });
    const result = await dispatch(transactionsRouter, {
      url: "/",
      query: { accountId, from: "2025-01-01", to: "2025-03-31", limit: "20", offset: "20" },
    });
    expect(result).toMatchObject({ status: 200, body: { items: [{ id: transactionId }], total: 42 } });
    for (const index of [1, 2]) {
      const sql = query.mock.calls[index]![0].text;
      expect(sql).toContain('"transaction"."account_id" =');
      expect(sql).toContain('"transaction"."booked_on" >=');
      expect(sql).toContain('"transaction"."booked_on" <=');
      expect(sql).not.toContain('"status"');
    }
    expect(query.mock.calls[1]![0].text).toMatch(/limit \$\d+ offset \$\d+/);
    expect(query.mock.calls[1]![1]).toEqual([accountId, "2025-01-01", "2025-03-31", 20, 20]);
    expect(query.mock.calls[2]![1]).toEqual([accountId, "2025-01-01", "2025-03-31"]);
  });

  it.each([{}, { from: "2025-01-01" }, { to: "2025-03-31" }])(
    "supports independent optional filters %j and no matches",
    async (filters) => {
      query.mockResolvedValueOnce({ rows: [acctRow()] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [["0"]] });
      expect(await dispatch(transactionsRouter, { url: "/", query: { accountId, ...filters } })).toEqual({
        status: 200,
        body: { items: [], total: 0 },
      });
      expect(query.mock.calls[1]![1]).toEqual([accountId, ...Object.values(filters), 50]);
      expect(query.mock.calls[2]![1]).toEqual([accountId, ...Object.values(filters)]);
    },
  );

  it("preserves total when offset is beyond the last match", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [["3"]] });
    expect(await dispatch(transactionsRouter, { url: "/", query: { accountId, offset: "50" } })).toEqual({
      status: 200,
      body: { items: [], total: 3 },
    });
    expect(query.mock.calls[1]![1]).toEqual([accountId, 50, 50]);
  });

  it("returns 400 when accountId is missing", async () => {
    const result = await dispatch(transactionsRouter, { url: "/" });
    expect(result).toEqual({ status: 400, body: { error: "accountId is required" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 when accountId is an array (repeated param)", async () => {
    const result = await dispatch(transactionsRouter, {
      url: "/",
      query: { accountId: [accountId, accountId] },
    });
    expect(result).toEqual({ status: 400, body: { error: "accountId is required" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 when account not found", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await dispatch(transactionsRouter, { url: "/", query: { accountId } });
    expect(result).toEqual({ status: 404, body: { error: "Account not found" } });
  });

  it("returns transaction list ordered by booked_on desc, created_at desc", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] }); // findOwnedAccount
    query.mockResolvedValueOnce({ rows: [txRow()] }); // listTransactionsByAccount
    query.mockResolvedValueOnce({ rows: [["1"]] });
    const result = await dispatch(transactionsRouter, { url: "/", query: { accountId } });
    expect(result.status).toBe(200);
    const sql: string = query.mock.calls[1]![0].text;
    expect(sql).toContain('order by "transaction"."booked_on" desc, "transaction"."created_at" desc');
    expect(query.mock.calls[1]![1]).toEqual([accountId, 50]);
    expect(result.body).toMatchObject({ items: [{ id: transactionId }], total: 1 });
  });

  it("includes archived account's transactions", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow({ isArchived: true })] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    query.mockResolvedValueOnce({ rows: [["1"]] });
    const result = await dispatch(transactionsRouter, { url: "/", query: { accountId } });
    expect(result.status).toBe(200);
    const listSql: string = query.mock.calls[1]![0].text;
    expect(listSql).not.toContain('"is_archived"');
    const listParams: unknown[] = query.mock.calls[1]![1];
    expect(listParams).toEqual([accountId, 50]);
  });

  it("converts amountMinor bigint string to number", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow({ amountMinor: "-3000" })] });
    query.mockResolvedValueOnce({ rows: [["1"]] });
    const result = await dispatch(transactionsRouter, { url: "/", query: { accountId } });
    const { items: body } = result.body as { items: Array<{ amountMinor: number }> };
    expect(typeof body[0]!.amountMinor).toBe("number");
    expect(body[0]!.amountMinor).toBe(-3000);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(transactionsRouter, { url: "/", query: { accountId } })).rejects.toThrow();
  });
});

// ─── GET /count/:categoryId ───────────────────────────────────────────────────

describe("GET /transactions/count/:categoryId", () => {
  // category row: id, userId, name, icon, color, types, isSystem, createdAt
  const categoryRow = [categoryId, userId, "Food", "🍔", "#2563EB", ["expense"], false, new Date().toISOString()];

  function getCount(id: string) {
    return dispatch(transactionsRouter, { url: `/count/${id}` });
  }

  it("rejects an invalid UUID", async () => {
    expect(await getCount("not-a-uuid")).toEqual({ status: 400, body: { error: "categoryId must be a valid UUID" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or foreign category", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // findVisibleCategory → not found
    expect(await getCount(categoryId)).toEqual({ status: 404, body: { error: "Category not found" } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns { transactionCount: 0 } when no linked transactions", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow] }); // findVisibleCategory
    query.mockResolvedValueOnce({ rows: [[0]] }); // countTransactionsByCategory
    expect(await getCount(categoryId)).toEqual({ status: 200, body: { transactionCount: 0 } });
  });

  it("returns { transactionCount: 3 } when transactions exist", async () => {
    query.mockResolvedValueOnce({ rows: [categoryRow] }); // findVisibleCategory
    query.mockResolvedValueOnce({ rows: [[3]] }); // countTransactionsByCategory
    expect(await getCount(categoryId)).toEqual({ status: 200, body: { transactionCount: 3 } });
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(getCount(categoryId)).rejects.toThrow();
  });
});

// ─── GET /:transactionId ──────────────────────────────────────────────────────

describe("GET /transactions/:transactionId", () => {
  it("rejects an invalid UUID", async () => {
    expect((await dispatch(transactionsRouter, { url: "/not-a-uuid" })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 for missing or foreign transaction", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await dispatch(transactionsRouter, { url: `/${transactionId}` })).status).toBe(404);
  });

  it("returns 200 with transaction columns only (no account fields)", async () => {
    query.mockResolvedValueOnce({ rows: [txRow()] });
    const result = await dispatch(transactionsRouter, { url: `/${transactionId}` });
    expect(result.status).toBe(200);
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('"transaction"."id"');
    expect(sql).not.toContain('"account"."name"');
  });

  it("is readable for transactions belonging to archived accounts (#15 regression)", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ accountIsArchived: true })] });
    const result = await dispatch(transactionsRouter, { url: `/${transactionId}` });
    expect(result.status).toBe(200);
    // findOwnedTransaction uses inner join with no is_archived filter
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).not.toMatch(/where.*is_archived/);
    expect(result.body).not.toHaveProperty("accountIsArchived");
    expect(result.body).not.toHaveProperty("transaction");
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(transactionsRouter, { url: `/${transactionId}` })).rejects.toThrow();
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────

describe("POST /transactions", () => {
  function post(body: unknown) {
    return dispatch(transactionsRouter, { method: "POST", url: "/", body });
  }

  const validBody = {
    accountId,
    type: "expense",
    amountMinor: -1000,
    description: "Coffee",
    bookedOn: "2025-01-15",
  };

  it.each([
    [{ ...validBody, accountId: undefined }, "accountId must be a valid UUID"],
    [{ ...validBody, accountId: "not-a-uuid" }, "accountId must be a valid UUID"],
    [{ ...validBody, type: undefined }, "type must be expense, income, or transfer"],
    [{ ...validBody, type: "savings" }, "type must be expense, income, or transfer"],
    [{ ...validBody, type: "transfer" }, "Transfers are created with POST /transactions/transfers"],
    [{ ...validBody, amountMinor: 1000 }, "amountMinor must be negative for an expense"],
    [{ ...validBody, type: "income" }, "amountMinor must be positive for an income"],
    [{ ...validBody, amountMinor: 0 }, "amountMinor must be a non-zero safe integer"],
    [{ ...validBody, amountMinor: 10.5 }, "amountMinor must be a non-zero safe integer"],
    [{ ...validBody, amountMinor: "100" }, "amountMinor must be a non-zero safe integer"],
    [{ ...validBody, amountMinor: 2 ** 53 }, "amountMinor must be a non-zero safe integer"],
    [{ ...validBody, description: undefined }, "description must be between 1 and 500 characters"],
    [{ ...validBody, description: "  " }, "description must be between 1 and 500 characters"],
    [{ ...validBody, description: "a".repeat(501) }, "description must be between 1 and 500 characters"],
    [{ ...validBody, bookedOn: undefined }, "bookedOn must use YYYY-MM-DD format"],
    [{ ...validBody, bookedOn: "2025/01/01" }, "bookedOn must use YYYY-MM-DD format"],
    [{ ...validBody, bookedOn: "2025-1-1" }, "bookedOn must use YYYY-MM-DD format"],
    [{ ...validBody, notes: 123 }, "notes must be a string"],
    [{ ...validBody, categoryId: "not-a-uuid" }, "categoryId must be a valid UUID"],
    [{ ...validBody, occurredAt: "not-a-date" }, "occurredAt must be a valid ISO 8601 timestamp or null"],
  ])("returns 400 for invalid body %j", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 with no request body", async () => {
    expect((await post(undefined)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("blocks creation on an archived account", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow({ isArchived: true })] });
    const result = await post(validBody);
    expect(result).toEqual({ status: 409, body: { error: "Account is archived. Restore it before making changes." } });
    expect(query).toHaveBeenCalledTimes(1);
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('"is_archived"');
  });

  it("returns 404 for a missing or foreign account", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await post(validBody)).status).toBe(404);
  });

  it("returns 201 on success, uses userId from locals as createdById", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] }); // findOwnedAccount
    query.mockResolvedValueOnce({ rows: [txRow()] }); // insertTransaction
    const result = await post(validBody);
    expect(result.status).toBe(201);
    const insertParams: unknown[] = query.mock.calls[1]![1];
    expect(insertParams).toContain(userId);
  });

  it("trims description and notes", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    await post({ ...validBody, description: "  Coffee  ", notes: "  Note  " });
    const insertParams: unknown[] = query.mock.calls[1]![1];
    expect(insertParams).toContain("Coffee");
    expect(insertParams).toContain("Note");
    expect(insertParams).not.toContain("  Coffee  ");
  });

  it("omits optional fields not sent", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    await post(validBody);
    // Drizzle uses "default" for omitted columns — params won't include explicit notes/occurredAt
    const insertParams: unknown[] = query.mock.calls[1]![1];
    // Only type, amountMinor, description, bookedOn, userId, accountId are bound explicitly
    // notes, occurredAt go in as default → not in params list
    const insertSql: string = query.mock.calls[1]![0].text;
    expect(insertSql).toContain("default"); // confirms defaults are used
    expect(insertSql).not.toContain('"status"');
    expect(insertParams).toEqual([accountId, userId, "expense", -1000, "Coffee", "2025-01-15"]);
  });

  it("does not run category query when categoryId is not sent", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] }); // findOwnedAccount
    query.mockResolvedValueOnce({ rows: [txRow()] }); // insertTransaction
    await post(validBody);
    expect(query).toHaveBeenCalledTimes(2); // no category lookup
  });

  it("accepts occurredAt: null", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    expect((await post({ ...validBody, occurredAt: null })).status).toBe(201);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(post(validBody)).rejects.toThrow();
  });
});

// ─── PATCH /:transactionId ────────────────────────────────────────────────────

describe("PATCH /transactions/:transactionId", () => {
  function patch(id: string, body: unknown) {
    return dispatch(transactionsRouter, { method: "PATCH", url: `/${id}`, body });
  }

  it("rejects an invalid UUID with no query", async () => {
    expect((await patch("not-a-uuid", { amountMinor: -100 })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 for missing/foreign transaction before body validation (pin)", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    // Invalid body but ownership check runs first
    const result = await patch(transactionId, { amountMinor: 0 });
    expect(result.status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ type: "savings" }, "type must be expense or income"],
    [{ type: "transfer" }, "type must be expense or income"],
    [{ amountMinor: 0 }, "amountMinor must be a non-zero safe integer"],
    [{ amountMinor: 1.5 }, "amountMinor must be a non-zero safe integer"],
    [{ amountMinor: "100" }, "amountMinor must be a non-zero safe integer"],
    [{ amountMinor: 2 ** 53 }, "amountMinor must be a non-zero safe integer"],
    [{ categoryId: "not-a-uuid" }, "categoryId must be a valid UUID or null"],
    [{ description: "" }, "description must be between 1 and 500 characters"],
    [{ description: "a".repeat(501) }, "description must be between 1 and 500 characters"],
    [{ notes: 123 }, "notes must be a string or null"],
    [{ bookedOn: "2025/01/01" }, "bookedOn must use YYYY-MM-DD format"],
    [{ occurredAt: "not-a-date" }, "occurredAt must be a valid ISO 8601 timestamp or null"],
  ])("returns 400 for invalid field %j (found tx)", async (body, error) => {
    query.mockResolvedValueOnce({ rows: [txRow()] }); // findOwnedTransaction
    expect(await patch(transactionId, body)).toEqual({ status: 400, body: { error } });
  });

  it("refuses to edit a transfer leg", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ type: "transfer", transferGroupId })] });
    expect(await patch(transactionId, { description: "New" })).toEqual({
      status: 400,
      body: { error: "Transfers cannot be edited. Delete the transfer and create a new one." },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for empty body or only non-editable fields", async () => {
    query.mockResolvedValueOnce({ rows: [txRow()] });
    expect((await patch(transactionId, {})).status).toBe(400);
    query.mockResolvedValueOnce({ rows: [txRow()] });
    expect((await patch(transactionId, { id: "hack", accountId: "hack" })).status).toBe(400);
  });

  it("sets only sent fields plus updated_at", async () => {
    query.mockResolvedValueOnce({ rows: [txRow()] }); // findOwnedTransaction
    query.mockResolvedValueOnce({ rows: [txRow({ amountMinor: "-2000" })] }); // updateTransaction

    await patch(transactionId, { amountMinor: -2000 });

    const updateSql: string = query.mock.calls[1]![0].text;
    expect(updateSql).toContain('"updated_at"');
    // amountMinor sent → bound; description not sent → not in params
    const updateParams: unknown[] = query.mock.calls[1]![1];
    expect(updateParams).toContain(-2000);
    expect(updateParams).not.toContain("Coffee"); // description not updated
  });

  it("null clears notes, categoryId, occurredAt", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId })] }); // findOwnedTransaction
    query.mockResolvedValueOnce({
      rows: [txRow({ notes: null, categoryId: null, occurredAt: null })],
    });

    await patch(transactionId, { notes: null, categoryId: null, occurredAt: null });

    const updateParams: unknown[] = query.mock.calls[1]![1];
    expect(updateParams.filter((p) => p === null).length).toBeGreaterThanOrEqual(2);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(patch(transactionId, { amountMinor: -100 })).rejects.toThrow();
  });
});

// ─── DELETE /:transactionId ───────────────────────────────────────────────────

describe("DELETE /transactions/:transactionId", () => {
  function del(id: string) {
    return dispatch(transactionsRouter, { method: "DELETE", url: `/${id}` });
  }

  it("rejects an invalid UUID", async () => {
    expect((await del("not-a-uuid")).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 for missing or foreign transaction", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await del(transactionId)).status).toBe(404);
  });

  it("returns 204 after permanently deleting the owned transaction", async () => {
    query.mockResolvedValueOnce({ rows: [txRow()] }); // findOwnedTransaction
    query.mockResolvedValueOnce({ rows: [] }); // deleteTransaction

    const result = await del(transactionId);
    expect(result.status).toBe(204);

    const deleteSql: string = query.mock.calls[1]![0].text;
    expect(deleteSql).toContain('delete from "transaction"');
    expect(query.mock.calls[1]![1]).toEqual([transactionId]);
    expect(query.mock.calls[0]![1]).toEqual([transactionId, userId, 1]);
  });

  it("deletes both legs of a transfer", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ type: "transfer", transferGroupId })] }); // findOwnedTransaction
    query.mockResolvedValueOnce({ rows: [] }); // deleteTransaction

    expect((await del(transactionId)).status).toBe(204);

    expect(query.mock.calls[1]![0].text).toContain('"transfer_group_id" =');
    expect(query.mock.calls[1]![1]).toEqual([transferGroupId]);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(del(transactionId)).rejects.toThrow();
  });
});

// ─── Category rule (POST and PATCH) ──────────────────────────────────────────

describe("POST /transactions — category rule", () => {
  const validBody = {
    accountId,
    type: "expense",
    amountMinor: -1000,
    description: "Coffee",
    bookedOn: "2025-01-15",
  };

  function post(body: unknown) {
    return dispatch(transactionsRouter, { method: "POST", url: "/", body });
  }

  it("returns 404 for a missing or foreign category", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] }); // findOwnedAccount
    query.mockResolvedValueOnce({ rows: [] }); // findCategoryTypes → not found
    expect(await post({ ...validBody, categoryId })).toEqual({ status: 404, body: { error: "Category not found" } });
  });

  it("looks up the user's own categories and the system category", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [] });
    await post({ ...validBody, categoryId });
    expect(query.mock.calls[1]![0].text).toContain('"user_id" = $2 or "category"."is_system" = $3');
  });

  it.each([
    ["income", 1000, ["expense"]],
    ["expense", -1000, ["income"]],
    ["expense", -1000, ["transfer"]],
  ])("returns 400 for a %s transaction with a category that only allows %j", async (type, amountMinor, types) => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [[types]] }); // findCategoryTypes
    expect(await post({ ...validBody, type, amountMinor, categoryId })).toEqual({
      status: 400,
      body: { error: `An ${type} transaction requires a category that allows ${type}` },
    });
  });

  it.each([
    ["expense", -1000, ["expense"]],
    ["expense", -1000, ["expense", "income"]],
    ["income", 1000, ["expense", "income"]],
  ])("accepts a %s transaction with a category that allows %j", async (type, amountMinor, types) => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [[types]] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    expect((await post({ ...validBody, type, amountMinor, categoryId })).status).toBe(201);
  });
});

describe("PATCH /transactions/:transactionId — category rule", () => {
  function patch(body: unknown) {
    return dispatch(transactionsRouter, { method: "PATCH", url: `/${transactionId}`, body });
  }

  it("rejects an amount sign that contradicts the type, before any category lookup", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId, amountMinor: "-1000" })] });
    expect(await patch({ amountMinor: 1000 })).toEqual({
      status: 400,
      body: { error: "amountMinor must be negative for an expense" },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("allows flipping the sign together with the type when the category allows both", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId, amountMinor: "-1000" })] });
    query.mockResolvedValueOnce({ rows: [[["expense", "income"]]] }); // findCategoryTypes
    query.mockResolvedValueOnce({ rows: [txRow({ type: "income", categoryId, amountMinor: "1000" })] });
    expect((await patch({ type: "income", amountMinor: 1000 })).status).toBe(200);
  });

  it("returns 400 when changing the type leaves a category that does not allow it", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId, amountMinor: "-1000" })] });
    query.mockResolvedValueOnce({ rows: [[["expense"]]] });
    expect(await patch({ type: "income", amountMinor: 1000 })).toEqual({
      status: 400,
      body: { error: "An income transaction requires a category that allows income" },
    });
  });

  it("returns 400 when the new categoryId does not allow the transaction's type", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ amountMinor: "-1000" })] });
    query.mockResolvedValueOnce({ rows: [[["income"]]] });
    expect(await patch({ categoryId })).toEqual({
      status: 400,
      body: { error: "An expense transaction requires a category that allows expense" },
    });
  });

  it("does not re-check the category on unrelated edits (a category may have dropped the type since)", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId, amountMinor: "-1000" })] }); // findOwnedTransaction
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId, amountMinor: "-2000" })] }); // updateTransaction
    expect((await patch({ amountMinor: -2000, description: "Edited" })).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2); // no category lookup
  });

  it("skips category query when categoryId: null is sent", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId })] }); // findOwnedTransaction
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId: null })] }); // updateTransaction
    expect((await patch({ categoryId: null })).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2); // no category lookup
  });
});

// ─── POST /transfers ─────────────────────────────────────────────────────────

describe("POST /transactions/transfers", () => {
  function post(body: unknown) {
    return dispatch(transactionsRouter, { method: "POST", url: "/transfers", body });
  }

  const validBody = {
    fromAccountId: accountId,
    toAccountId: otherAccountId,
    fromAmountMinor: 5000,
    toAmountMinor: 5000,
    description: "Savings",
    bookedOn: "2025-01-15",
  };

  it.each([
    [{ ...validBody, fromAccountId: "nope" }, "fromAccountId must be a valid UUID"],
    [{ ...validBody, toAccountId: undefined }, "toAccountId must be a valid UUID"],
    [{ ...validBody, toAccountId: accountId }, "fromAccountId and toAccountId must be different"],
    [{ ...validBody, fromAmountMinor: 0 }, "fromAmountMinor must be a positive safe integer"],
    [{ ...validBody, fromAmountMinor: -5000 }, "fromAmountMinor must be a positive safe integer"],
    [{ ...validBody, fromAmountMinor: 1.5 }, "fromAmountMinor must be a positive safe integer"],
    [{ ...validBody, toAmountMinor: "5000" }, "toAmountMinor must be a positive safe integer"],
    [{ ...validBody, toAmountMinor: 2 ** 53 }, "toAmountMinor must be a positive safe integer"],
    [{ ...validBody, description: " " }, "description must be between 1 and 500 characters"],
    [{ ...validBody, bookedOn: "2025/01/15" }, "bookedOn must use YYYY-MM-DD format"],
    [{ ...validBody, notes: 1 }, "notes must be a string"],
    [{ ...validBody, occurredAt: "nope" }, "occurredAt must be a valid ISO 8601 timestamp or null"],
  ])("returns 400 for invalid body %j", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 when either account is missing or foreign", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await post(validBody)).toEqual({ status: 404, body: { error: "Account not found" } });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("blocks a transfer from or to an archived account", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [acctRow({ id: otherAccountId, isArchived: true })] });
    expect(await post(validBody)).toEqual({
      status: 409,
      body: { error: "Account is archived. Restore it before making changes." },
    });
  });

  it("requires equal amounts inside one currency", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [acctRow({ id: otherAccountId })] });
    expect(await post({ ...validBody, toAmountMinor: 4000 })).toEqual({
      status: 400,
      body: { error: "Amounts must be equal when both accounts use the same currency" },
    });
    expect(query).toHaveBeenCalledTimes(2); // nothing inserted
  });

  it("writes both legs in one statement: negative source, positive destination, shared group and system category", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [acctRow({ id: otherAccountId })] });
    const sourceLeg = txRow({ type: "transfer", transferGroupId, amountMinor: "-5000" });
    const destinationLeg = txRow({ accountId: otherAccountId, type: "transfer", transferGroupId, amountMinor: "5000" });
    query.mockResolvedValueOnce({ rows: [sourceLeg, destinationLeg] });

    const result = await post({ ...validBody, description: "  Savings  ", notes: " Monthly " });

    expect(result).toMatchObject({
      status: 201,
      body: { from: { accountId, amountMinor: -5000 }, to: { accountId: otherAccountId, amountMinor: 5000 } },
    });
    expect(query).toHaveBeenCalledTimes(3);
    const insertSql: string = query.mock.calls[2]![0].text;
    expect(insertSql.match(/insert into "transaction"/g)).toHaveLength(1);
    const params: unknown[] = query.mock.calls[2]![1];
    expect(params.filter((param) => param === TRANSFER_CATEGORY_ID)).toHaveLength(2);
    expect(params.filter((param) => param === "transfer")).toHaveLength(2);
    expect(params).toContain(-5000);
    expect(params).toContain(5000);
    expect(params).toContain("Savings");
    expect(params).toContain("Monthly");
    const knownIds = [accountId, otherAccountId, userId, TRANSFER_CATEGORY_ID];
    const groupIds = params.filter((param) => isUuid(param) && !knownIds.includes(param));
    expect(groupIds).toHaveLength(2);
    expect(groupIds[0]).toBe(groupIds[1]);
  });

  it("allows different amounts across currencies", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [acctRow({ id: otherAccountId, currencyCode: "USD" })] });
    query.mockResolvedValueOnce({
      rows: [
        txRow({ type: "transfer", transferGroupId, amountMinor: "-5000" }),
        txRow({ accountId: otherAccountId, type: "transfer", transferGroupId, amountMinor: "5400" }),
      ],
    });
    const result = await post({ ...validBody, toAmountMinor: 5400 });
    expect(result.status).toBe(201);
    expect(query.mock.calls[2]![1]).toContain(5400);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(post(validBody)).rejects.toThrow();
  });
});

describe("archived account transaction writes", () => {
  it.each(["PATCH", "DELETE"])("allows %s without restoring the account", async (method) => {
    query.mockResolvedValueOnce({ rows: [txRow({ accountIsArchived: true })] });
    query.mockResolvedValueOnce({ rows: method === "PATCH" ? [txRow({ description: "New" })] : [] });
    expect(
      await dispatch(transactionsRouter, {
        method,
        url: `/${transactionId}`,
        body: { description: "New" },
      }),
    ).toMatchObject(method === "PATCH" ? { status: 200, body: { description: "New" } } : { status: 204 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![1]).toEqual([transactionId, userId, 1]);
  });
});

describe("restored account writes", () => {
  it("allows account edits and transaction creation, editing, and deletion after restoration", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow({ isArchived: true })] });
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    expect(
      await dispatch(accountsRouter, {
        method: "PATCH",
        url: `/${accountId}`,
        body: { isArchived: false },
      }),
    ).toMatchObject({ status: 200, body: { isArchived: false } });

    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [acctRow({ name: "New" })] });
    expect(
      await dispatch(accountsRouter, {
        method: "PATCH",
        url: `/${accountId}`,
        body: { name: "New" },
      }),
    ).toMatchObject({ status: 200, body: { name: "New" } });

    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    expect(
      (
        await dispatch(transactionsRouter, {
          method: "POST",
          url: "/",
          body: {
            accountId,
            type: "expense",
            amountMinor: -1000,
            description: "Coffee",
            bookedOn: "2025-01-15",
          },
        })
      ).status,
    ).toBe(201);

    query.mockResolvedValueOnce({ rows: [txRow()] });
    query.mockResolvedValueOnce({ rows: [txRow({ description: "New" })] });
    expect(
      await dispatch(transactionsRouter, {
        method: "PATCH",
        url: `/${transactionId}`,
        body: { description: "New" },
      }),
    ).toMatchObject({ status: 200, body: { description: "New" } });

    query.mockResolvedValueOnce({ rows: [txRow()] });
    query.mockResolvedValueOnce({ rows: [] });
    expect(
      (
        await dispatch(transactionsRouter, {
          method: "DELETE",
          url: `/${transactionId}`,
        })
      ).status,
    ).toBe(204);
  });

  it("keeps archived account summaries readable", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow({ isArchived: true })] });
    query.mockResolvedValueOnce({ rows: [[null, "expense", "-1000", "1"]] });
    expect(await summary({ accountId })).toEqual({
      status: 200,
      body: [{ categoryId: null, type: "expense", totalMinor: -1000, count: 1 }],
    });
  });
});
