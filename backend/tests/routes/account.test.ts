import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});
vi.mock("../../srcs/auth.ts", () => ({
  requireAuthenticatedUser: (_req: Request, res: Response, next: () => void) => {
    res.locals.userId = userId;
    next();
  },
}));

import { accountsRouter } from "../../srcs/routes/account.ts";
import { dispatch } from "../helpers/dispatch.ts";

const accountId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "550e8400-e29b-41d4-a716-446655440001";

// Account row in schema column order:
// id, userId, name, type, currencyCode, openingBalanceMinor, institution, accountRef,
// isArchived, createdAt, updatedAt
function accountRow(overrides: Record<string, unknown> = {}) {
  return [
    overrides.id ?? accountId,
    overrides.userId ?? userId,
    overrides.name ?? "Checking",
    overrides.type ?? "checking",
    overrides.currencyCode ?? "EUR",
    overrides.openingBalanceMinor ?? "10000",
    overrides.institution ?? null,
    overrides.accountRef ?? null,
    overrides.isArchived ?? false,
    overrides.createdAt ?? new Date().toISOString(),
    overrides.updatedAt ?? new Date().toISOString(),
  ];
}

beforeEach(() => query.mockReset());

describe("GET /accounts/:accountId/balance", () => {
  function balance(id = accountId) {
    return dispatch(accountsRouter, { url: `/${id}/balance` });
  }

  it.each([
    ["3000", 13000],
    ["-12000", -2000],
    ["0", 10000],
    [null, 10000],
    ["-10000", 0],
  ])("adds transaction sum %s to the opening balance", async (total, expected) => {
    query.mockResolvedValueOnce({ rows: [accountRow()] });
    query.mockResolvedValueOnce({ rows: [[total]] });

    const result = await balance();

    expect(result).toEqual({ status: 200, body: { balanceMinor: expected, currencyCode: "EUR" } });
  });

  it("returns the transaction sum when the opening balance is zero", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow({ openingBalanceMinor: "0" })] });
    query.mockResolvedValueOnce({ rows: [["3000"]] });

    expect(await balance()).toEqual({ status: 200, body: { balanceMinor: 3000, currencyCode: "EUR" } });
  });

  it("adds transactions to a negative opening balance", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow({ openingBalanceMinor: "-5000" })] });
    query.mockResolvedValueOnce({ rows: [["3000"]] });

    expect(await balance()).toEqual({ status: 200, body: { balanceMinor: -2000, currencyCode: "EUR" } });
  });

  it("sums only non-void transactions", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow()] });
    query.mockResolvedValueOnce({ rows: [[null]] });

    await balance();

    const sumSql = query.mock.calls[1]![0].text as string;
    expect(sumSql).toContain('"transaction"."account_id"');
    expect(sumSql).toContain('"transaction"."status"');
    expect(query.mock.calls[1]![1]).toContain("void");
  });

  it("checks ownership including archived accounts", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow({ isArchived: true, currencyCode: "USD" })] });
    query.mockResolvedValueOnce({ rows: [["3000"]] });

    const result = await balance();

    const ownershipSql = query.mock.calls[0]![0].text as string;
    expect(ownershipSql).not.toMatch(/where.*is_archived/);
    expect(query.mock.calls[0]![1]).toContain(accountId);
    expect(query.mock.calls[0]![1]).toContain(userId);
    expect(result).toEqual({ status: 200, body: { balanceMinor: 13000, currencyCode: "USD" } });
  });

  it("returns 404 when the ownership lookup finds no account", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    expect(await balance()).toEqual({ status: 404, body: { error: "Account not found" } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid UUID before querying the database", async () => {
    expect(await balance("not-a-uuid")).toEqual({
      status: 400,
      body: { error: "accountId must be a valid UUID" },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["ownership", "aggregate"])("forwards %s query errors to error middleware", async (which) => {
    const error = new Error("Database unavailable");
    if (which === "ownership") {
      query.mockRejectedValueOnce(error);
    } else {
      query.mockResolvedValueOnce({ rows: [accountRow()] });
      query.mockRejectedValueOnce(error);
    }

    await expect(balance()).rejects.toThrow();
  });
});
