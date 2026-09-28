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

import { transactionsRouter } from "../../srcs/routes/transaction.ts";

const accountId = "550e8400-e29b-41d4-a716-446655440000";
const transactionId = "550e8400-e29b-41d4-a716-446655440003";
const categoryId = "550e8400-e29b-41d4-a716-446655440002";
const userId = "550e8400-e29b-41d4-a716-446655440001";

// Transaction row in schema column order:
// id, accountId, categoryId, createdById, amountMinor, description, notes,
// bookedOn, occurredAt, status, createdAt, updatedAt
function txRow(overrides: Record<string, unknown> = {}) {
  return [
    overrides.id ?? transactionId,
    overrides.accountId ?? accountId,
    overrides.categoryId ?? null,
    overrides.createdById ?? userId,
    overrides.amountMinor ?? "-1000",
    overrides.description ?? "Coffee",
    overrides.notes ?? null,
    overrides.bookedOn ?? "2025-01-15",
    overrides.occurredAt ?? null,
    overrides.status ?? "cleared",
    overrides.createdAt ?? new Date().toISOString(),
    overrides.updatedAt ?? new Date().toISOString(),
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
    null, null,
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
      status(code: number) { status = code; return this; },
      json(body: unknown) { resolve({ status, body }); },
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
    expect(await summary({ accountId })).toEqual({ status: 404, body: { error: "Account not found" } });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0].text).toContain('"account"."user_id" =');
    expect(query.mock.calls[0]![1]).toEqual([accountId, "550e8400-e29b-41d4-a716-446655440001", 1]);
  });

  it("groups by category, excludes voids, and converts database totals to numbers", async () => {
    query.mockResolvedValueOnce({ rows: [[accountId]] });
    query.mockResolvedValueOnce({ rows: [[accountId, "-32000", "2"], [null, "-100", "1"]] });
    expect(await summary({ accountId, from: "2025-01-01", to: "2025-03-31" })).toEqual({
      status: 200,
      body: [
        { categoryId: accountId, totalMinor: -32000, count: 2 },
        { categoryId: null, totalMinor: -100, count: 1 },
      ],
    });
    expect(query.mock.calls[0]![0].text.split(" where ")[1]).not.toContain("is_archived");
    const [statement, values] = query.mock.calls[1]!;
    expect(statement.text).toContain('SUM("amount_minor")');
    expect(statement.text).toContain('COUNT(*)');
    expect(statement.text).toContain('"transaction"."status" <>');
    expect(statement.text).toContain('"transaction"."booked_on" >=');
    expect(statement.text).toContain('"transaction"."booked_on" <=');
    expect(statement.text).toContain('group by "transaction"."category_id"');
    expect(values).toEqual([accountId, "void", "2025-01-01", "2025-03-31"]);
  });

  it.each([{}, { from: "2025-01-01" }, { to: "2025-03-31" }])("supports optional date bounds %j and empty results", async (dates) => {
    query.mockResolvedValueOnce({ rows: [[accountId]] });
    query.mockResolvedValueOnce({ rows: [] });
    expect(await summary({ accountId, ...dates })).toEqual({ status: 200, body: [] });
    expect(query.mock.calls[1]![1]).toEqual([accountId, "void", ...Object.values(dates)]);
  });

  it("forwards database errors", async () => {
    query.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(summary({ accountId })).rejects.toThrow();
  });

  it("returns 400 for accountId='' (explicit empty string branch)", async () => {
    expect(await summary({ accountId: "" })).toEqual({ status: 400, body: { error: "accountId is required" } });
    expect(query).not.toHaveBeenCalled();
  });
});

// ─── GET / ────────────────────────────────────────────────────────────────────

describe("GET /transactions", () => {
  it.each([
    ...["0", "201", "1.5", "20abc", "", ["20", "30"]].map((limit) => [
      { accountId, limit }, "limit must be an integer between 1 and 200",
    ]),
    ...["-1", "1.5", "3abc", "", ["0", "1"]].map((offset) => [
      { accountId, offset }, "offset must be a non-negative integer",
    ]),
    [{ accountId, from: "2025-1-01" }, "from must use YYYY-MM-DD format"],
    [{ accountId, to: "invalid" }, "to must use YYYY-MM-DD format"],
    [{ accountId, status: "invalid" }, "status must be pending, cleared, or void"],
  ])("rejects invalid list parameters %j", async (params, error) => {
    expect(await dispatch(transactionsRouter, { url: "/", query: params as Record<string, unknown> }))
      .toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["20", "200"])("accepts limit=%s with offset=0 and returns a separate total", async (limit) => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    query.mockResolvedValueOnce({ rows: [["87"]] });
    const result = await dispatch(transactionsRouter, { url: "/", query: { accountId, limit, offset: "0" } });
    expect(result).toMatchObject({ status: 200, body: { items: [{ id: transactionId }], total: 87 } });
    expect(query.mock.calls[1]![0].text).toContain("limit $");
    expect(query.mock.calls[1]![1]).toEqual([accountId, Number(limit)]);
    expect(query.mock.calls[2]![0].text).toContain("count(*)");
    expect(query.mock.calls[2]![0].text).not.toMatch(/limit|offset/);
    expect(query.mock.calls[2]![1]).toEqual([accountId]);
  });

  it.each(["pending", "cleared", "void"])("applies inclusive dates and status=%s to both queries", async (status) => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow({ status })] });
    query.mockResolvedValueOnce({ rows: [["42"]] });
    const result = await dispatch(transactionsRouter, {
      url: "/", query: { accountId, from: "2025-01-01", to: "2025-03-31", status, limit: "20", offset: "20" },
    });
    expect(result).toMatchObject({ status: 200, body: { items: [{ status }], total: 42 } });
    for (const index of [1, 2]) {
      const sql = query.mock.calls[index]![0].text;
      expect(sql).toContain('"transaction"."account_id" =');
      expect(sql).toContain('"transaction"."booked_on" >=');
      expect(sql).toContain('"transaction"."booked_on" <=');
      expect(sql).toContain('"transaction"."status" =');
    }
    expect(query.mock.calls[1]![0].text).toMatch(/limit \$\d+ offset \$\d+/);
    expect(query.mock.calls[1]![1]).toEqual([accountId, "2025-01-01", "2025-03-31", status, 20, 20]);
    expect(query.mock.calls[2]![1]).toEqual([accountId, "2025-01-01", "2025-03-31", status]);
  });

  it.each([{}, { from: "2025-01-01" }, { to: "2025-03-31" }, { status: "pending" }])(
    "supports independent optional filters %j and no matches", async (filters) => {
      query.mockResolvedValueOnce({ rows: [acctRow()] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [["0"]] });
      expect(await dispatch(transactionsRouter, { url: "/", query: { accountId, ...filters } }))
        .toEqual({ status: 200, body: { items: [], total: 0 } });
      expect(query.mock.calls[1]![1]).toEqual([accountId, ...Object.values(filters), 50]);
      expect(query.mock.calls[2]![1]).toEqual([accountId, ...Object.values(filters)]);
    },
  );

  it("preserves total when offset is beyond the last match", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [["3"]] });
    expect(await dispatch(transactionsRouter, { url: "/", query: { accountId, offset: "50" } }))
      .toEqual({ status: 200, body: { items: [], total: 3 } });
    expect(query.mock.calls[1]![1]).toEqual([accountId, 50, 50]);
  });

  it("returns 400 when accountId is missing", async () => {
    const result = await dispatch(transactionsRouter, { url: "/" });
    expect(result).toEqual({ status: 400, body: { error: "accountId is required" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 when accountId is an array (repeated param)", async () => {
    const result = await dispatch(transactionsRouter, { url: "/", query: { accountId: [accountId, accountId] } });
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

  it("includes archived account's transactions and void transactions", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow({ isArchived: true })] });
    query.mockResolvedValueOnce({ rows: [txRow({ status: "void" })] });
    query.mockResolvedValueOnce({ rows: [["1"]] });
    const result = await dispatch(transactionsRouter, { url: "/", query: { accountId } });
    expect(result.status).toBe(200);
    // list does not filter by status; WHERE clause only checks accountId
    const listSql: string = query.mock.calls[1]![0].text;
    expect(listSql).not.toContain('"is_archived"');
    // Should NOT exclude void: no "void" in WHERE params
    const listParams: unknown[] = query.mock.calls[1]![1];
    expect(listParams).not.toContain("void");
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
    query.mockResolvedValueOnce({ rows: [txRow()] });
    const result = await dispatch(transactionsRouter, { url: `/${transactionId}` });
    expect(result.status).toBe(200);
    // findOwnedTransaction uses inner join with no is_archived filter
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).not.toContain('"is_archived"');
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
    amountMinor: -1000,
    description: "Coffee",
    bookedOn: "2025-01-15",
  };

  it.each([
    [{ ...validBody, accountId: undefined }, "accountId must be a valid UUID"],
    [{ ...validBody, accountId: "not-a-uuid" }, "accountId must be a valid UUID"],
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
    [{ ...validBody, status: "done" }, "status must be pending, cleared, or void"],
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

  it("returns 404 for an archived account (lookup uses allowArchived=false)", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // findOwnedAccount with is_archived=false → not found
    const result = await post(validBody);
    expect(result.status).toBe(404);
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

  it("omits optional fields not sent (status defaults to cleared)", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    await post(validBody);
    // Drizzle uses "default" for omitted columns — params won't include explicit notes/occurredAt
    const insertParams: unknown[] = query.mock.calls[1]![1];
    // Only amountMinor, description, bookedOn, userId, accountId are bound explicitly
    // notes, status, occurredAt go in as default → not in params list
    const insertSql: string = query.mock.calls[1]![0].text;
    expect(insertSql).toContain("default"); // confirms defaults are used
    // status default is "cleared" (set in schema) — verify no explicit status param
    expect(insertParams).not.toContain("cleared");
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
    [{ amountMinor: 0 }, "amountMinor must be a non-zero safe integer"],
    [{ amountMinor: 1.5 }, "amountMinor must be a non-zero safe integer"],
    [{ amountMinor: "100" }, "amountMinor must be a non-zero safe integer"],
    [{ amountMinor: 2 ** 53 }, "amountMinor must be a non-zero safe integer"],
    [{ categoryId: "not-a-uuid" }, "categoryId must be a valid UUID or null"],
    [{ description: "" }, "description must be between 1 and 500 characters"],
    [{ description: "a".repeat(501) }, "description must be between 1 and 500 characters"],
    [{ notes: 123 }, "notes must be a string or null"],
    [{ bookedOn: "2025/01/01" }, "bookedOn must use YYYY-MM-DD format"],
    [{ status: "done" }, "status must be pending, cleared, or void"],
    [{ occurredAt: "not-a-date" }, "occurredAt must be a valid ISO 8601 timestamp or null"],
  ])("returns 400 for invalid field %j (found tx)", async (body, error) => {
    query.mockResolvedValueOnce({ rows: [txRow()] }); // findOwnedTransaction
    expect(await patch(transactionId, body)).toEqual({ status: 400, body: { error } });
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
    query.mockResolvedValueOnce({ rows: [txRow({ notes: null, categoryId: null, occurredAt: null })] });

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

  it("returns 204 via UPDATE setting status=void and updated_at, never DELETE", async () => {
    query.mockResolvedValueOnce({ rows: [txRow()] }); // findOwnedTransaction
    query.mockResolvedValueOnce({ rows: [] }); // voidTransaction

    const result = await del(transactionId);
    expect(result.status).toBe(204);

    const voidSql: string = query.mock.calls[1]![0].text;
    expect(voidSql.toLowerCase()).toContain("update");
    expect(voidSql.toLowerCase()).not.toContain("delete");
    expect(query.mock.calls[1]![1]).toContain("void");
    expect(voidSql).toContain('"updated_at"');
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(del(transactionId)).rejects.toThrow();
  });
});

// ─── Category rule (POST and PATCH) ──────────────────────────────────────────

describe("POST /transactions — category rule", () => {
  const validBody = { accountId, amountMinor: -1000, description: "Coffee", bookedOn: "2025-01-15" };

  it("returns 404 for a missing or foreign category", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] }); // findOwnedAccount
    query.mockResolvedValueOnce({ rows: [] }); // findCategoryKind → not found
    const result = await dispatch(transactionsRouter, {
      method: "POST", url: "/", body: { ...validBody, categoryId },
    });
    expect(result).toEqual({ status: 404, body: { error: "Category not found" } });
  });

  it("returns 404 for an archived category", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [] }); // findCategoryKind with allowArchived=false → not found
    const result = await dispatch(transactionsRouter, {
      method: "POST", url: "/", body: { ...validBody, categoryId },
    });
    expect(result.status).toBe(404);
  });

  it("returns 400 for expense category with positive amount", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [["expense"]] }); // findCategoryKind → expense kind
    const result = await dispatch(transactionsRouter, {
      method: "POST", url: "/", body: { ...validBody, amountMinor: 1000, categoryId },
    });
    expect(result.status).toBe(400);
  });

  it("returns 400 for income category with negative amount", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [["income"]] }); // income kind
    const result = await dispatch(transactionsRouter, {
      method: "POST", url: "/", body: { ...validBody, amountMinor: -1000, categoryId },
    });
    expect(result.status).toBe(400);
  });

  it("accepts transfer category with any sign", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [["transfer"]] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    const result = await dispatch(transactionsRouter, {
      method: "POST", url: "/", body: { ...validBody, amountMinor: 1000, categoryId },
    });
    expect(result.status).toBe(201);
  });

  it("accepts matching kind (expense + negative amount)", async () => {
    query.mockResolvedValueOnce({ rows: [acctRow()] });
    query.mockResolvedValueOnce({ rows: [["expense"]] });
    query.mockResolvedValueOnce({ rows: [txRow()] });
    const result = await dispatch(transactionsRouter, {
      method: "POST", url: "/", body: { ...validBody, amountMinor: -1000, categoryId },
    });
    expect(result.status).toBe(201);
  });
});

describe("PATCH /transactions/:transactionId — category rule", () => {
  it("returns 400 when changing amount makes existing category mismatch", async () => {
    // Transaction has expense category, we flip amount to positive
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId, amountMinor: "-1000" })] });
    query.mockResolvedValueOnce({ rows: [["expense"]] }); // findCategoryKind
    const result = await dispatch(transactionsRouter, {
      method: "PATCH", url: `/${transactionId}`, body: { amountMinor: 1000 },
    });
    expect(result.status).toBe(400);
  });

  it("returns 400 when new categoryId doesn't match amount sign", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ amountMinor: "-1000" })] });
    query.mockResolvedValueOnce({ rows: [["income"]] }); // income category for negative tx
    const result = await dispatch(transactionsRouter, {
      method: "PATCH", url: `/${transactionId}`, body: { categoryId },
    });
    expect(result.status).toBe(400);
  });

  it("allows keeping an archived category when categoryId is not in the body (allowArchived=true)", async () => {
    // Transaction has archived category, but we only change description
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId, amountMinor: "-1000" })] });
    query.mockResolvedValueOnce({ rows: [["expense"]] }); // findCategoryKind with allowArchived=true
    query.mockResolvedValueOnce({ rows: [txRow({ description: "New desc" })] });
    const result = await dispatch(transactionsRouter, {
      method: "PATCH", url: `/${transactionId}`, body: { description: "New desc" },
    });
    expect(result.status).toBe(200);
  });

  it("returns 404 when sending the unchanged categoryId of an archived category (pin)", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId, amountMinor: "-1000" })] });
    query.mockResolvedValueOnce({ rows: [] }); // findCategoryKind with allowArchived=false → not found
    const result = await dispatch(transactionsRouter, {
      method: "PATCH", url: `/${transactionId}`, body: { categoryId },
    });
    expect(result.status).toBe(404);
  });

  it("skips category query when categoryId: null is sent", async () => {
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId })] }); // findOwnedTransaction
    query.mockResolvedValueOnce({ rows: [txRow({ categoryId: null })] }); // updateTransaction
    const result = await dispatch(transactionsRouter, {
      method: "PATCH", url: `/${transactionId}`, body: { categoryId: null },
    });
    expect(result.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2); // no category lookup
  });
});
