import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});
vi.mock("../auth.ts", () => ({
  requireAuthenticatedUser: (_req: Request, res: Response, next: () => void) => {
    res.locals.userId = "550e8400-e29b-41d4-a716-446655440001";
    next();
  },
}));

import { transactionsRouter } from "./transaction.ts";

const accountId = "550e8400-e29b-41d4-a716-446655440000";

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
});
