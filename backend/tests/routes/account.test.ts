import type { Request, Response, NextFunction } from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("../../srcs/db/client.ts", () => ({ db: { select: mocks.select } }));
vi.mock("../../srcs/auth.ts", () => ({ requireAuthenticatedUser: vi.fn() }));

import { accountsRouter } from "../../srcs/routes/account.ts";

const accountId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "550e8400-e29b-41d4-a716-446655440001";
const account = {
  id: accountId,
  userId,
  openingBalanceMinor: 10000,
  currencyCode: "EUR",
  isArchived: false,
};

// Exercise the registered handler without a server or a database connection.
const handler = accountsRouter.stack.find(
  (layer) => layer.route?.path === "/:accountId/balance",
)!.route!.stack[0]!.handle;

async function requestBalance(id = accountId) {
  const req = { params: { accountId: id } } as unknown as Request;
  const res = {
    locals: { userId },
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const next = vi.fn();
  await handler(req, res as unknown as Response, next as NextFunction);
  return { res, next };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValueOnce({ limit: mocks.limit });
  mocks.limit.mockResolvedValue([account]);
  mocks.where.mockResolvedValue([{ total: "3000" }]);
});

describe("GET /accounts/:accountId/balance", () => {
  it.each([
    ["3000", 13000],
    ["-12000", -2000],
    ["0", 10000],
    [null, 10000],
	["-10000", 0],
  ])("adds transaction sum %s to the opening balance", async (total, expected) => {
    mocks.where.mockResolvedValue([{ total }]);

    const { res, next } = await requestBalance();

    expect(res.json).toHaveBeenCalledWith({ balanceMinor: expected, currencyCode: "EUR" });
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("returns the transaction sum when the opening balance is zero", async () => {
    mocks.limit.mockResolvedValue([{ ...account, openingBalanceMinor: 0 }]);

    const { res, next } = await requestBalance();

    expect(res.json).toHaveBeenCalledWith({ balanceMinor: 3000, currencyCode: "EUR" });
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("adds transactions to a negative opening balance", async () => {
    mocks.limit.mockResolvedValue([{ ...account, openingBalanceMinor: -5000 }]);

    const { res, next } = await requestBalance();

    expect(res.json).toHaveBeenCalledWith({ balanceMinor: -2000, currencyCode: "EUR" });
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("sums only this account's non-void transactions, including pending and cleared", async () => {
    await requestBalance();

    const dialect = new PgDialect();
    const aggregate = dialect.sqlToQuery(mocks.select.mock.calls[1]![0].total);
    expect(aggregate.sql).toBe('sum("transaction"."amount_minor")');

    // Inspect Drizzle predicate: a mocked result alone cannot verify filtering.
    const filter = dialect.sqlToQuery(mocks.where.mock.calls[1]![0]);
    expect(filter.sql).toBe('("transaction"."account_id" = $1 and "transaction"."status" <> $2)');
    expect(filter.params).toEqual([accountId, "void"]);
  });

  it("checks ownership without excluding archived accounts", async () => {
    mocks.limit.mockResolvedValue([{ ...account, isArchived: true, currencyCode: "USD" }]);

    const { res } = await requestBalance();

    const filter = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
    expect(filter.sql).toBe('("account"."id" = $1 and "account"."user_id" = $2)');
    expect(filter.params).toEqual([accountId, userId]);
    expect(res.json).toHaveBeenCalledWith({ balanceMinor: 13000, currencyCode: "USD" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 404 when the ownership lookup finds no account", async () => {
    mocks.limit.mockResolvedValue([]);

    const { res } = await requestBalance();

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Account not found" });
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid UUID before querying the database", async () => {
    const { res } = await requestBalance("not-a-uuid");

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "accountId must be a valid UUID" });
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each(["ownership", "aggregate"])("forwards %s query errors to error middleware", async (query) => {
    const error = new Error("Database unavailable");
    if (query === "ownership") mocks.limit.mockRejectedValue(error);
    else mocks.where.mockRejectedValue(error);

    const { res, next } = await requestBalance();

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
