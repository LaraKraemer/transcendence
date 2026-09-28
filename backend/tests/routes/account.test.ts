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

    expect(await balance()).toEqual({
      status: 200,
      body: { balanceMinor: 3000, currencyCode: "EUR" },
    });
  });

  it("adds transactions to a negative opening balance", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow({ openingBalanceMinor: "-5000" })] });
    query.mockResolvedValueOnce({ rows: [["3000"]] });

    expect(await balance()).toEqual({
      status: 200,
      body: { balanceMinor: -2000, currencyCode: "EUR" },
    });
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

  it.each(["ownership", "aggregate"])(
    "forwards %s query errors to error middleware",
    async (which) => {
      const error = new Error("Database unavailable");
      if (which === "ownership") {
        query.mockRejectedValueOnce(error);
      } else {
        query.mockResolvedValueOnce({ rows: [accountRow()] });
        query.mockRejectedValueOnce(error);
      }

      await expect(balance()).rejects.toThrow();
    },
  );
});

// ─── GET / ────────────────────────────────────────────────────────────────────

describe("GET /accounts", () => {
  it("returns the list from listActiveAccounts", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow()] });
    const result = await dispatch(accountsRouter, { url: "/" });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
  });

  it("filters on user_id and is_archived=false", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await dispatch(accountsRouter, { url: "/" });
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('"user_id"');
    expect(sql).toContain('"is_archived"');
  });

  it("converts opening_balance_minor bigint string to number", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow({ openingBalanceMinor: "-32000" })] });
    const result = await dispatch(accountsRouter, { url: "/" });
    const body = result.body as Array<{ openingBalanceMinor: number }>;
    expect(typeof body[0]!.openingBalanceMinor).toBe("number");
    expect(body[0]!.openingBalanceMinor).toBe(-32000);
  });

  it("returns [] for an empty result", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await dispatch(accountsRouter, { url: "/" })).toEqual({ status: 200, body: [] });
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(accountsRouter, { url: "/" })).rejects.toThrow();
  });
});

// ─── POST / ───────────────────────────────────────────────────────────────────

describe("POST /accounts", () => {
  function post(body: unknown) {
    return dispatch(accountsRouter, { method: "POST", url: "/", body });
  }

  const validBody = { name: "Checking", type: "checking" };

  it.each([
    [{ ...validBody, name: undefined }, "name must be between 1 and 100 characters"],
    [{ ...validBody, name: "  " }, "name must be between 1 and 100 characters"],
    [{ ...validBody, name: "a".repeat(101) }, "name must be between 1 and 100 characters"],
  ])("rejects invalid name", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validBody, type: undefined }, "type must be checking, savings, or cash"],
    [{ ...validBody, type: "credit" }, "type must be checking, savings, or cash"],
  ])("rejects invalid type", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([10.5, "100", null, 2 ** 53])(
    "rejects openingBalanceMinor %j",
    async (openingBalanceMinor) => {
      const result = await post({ ...validBody, openingBalanceMinor });
      expect(result.status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ ...validBody, institution: null }, "institution must be a string"],
    [{ ...validBody, accountRef: 123 }, "accountRef must be a string"],
  ])("rejects non-string institution/accountRef", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [
      { ...validBody, currencyCode: "eur" },
      "currencyCode must be a 3-letter uppercase ISO 4217 code (e.g. EUR, USD)",
    ],
    [
      { ...validBody, currencyCode: "EURO" },
      "currencyCode must be a 3-letter uppercase ISO 4217 code (e.g. EUR, USD)",
    ],
  ])("rejects invalid currencyCode", async (body, error) => {
    expect(await post(body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 with no request body", async () => {
    expect((await post(undefined)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 201 with created account, uses userId from locals", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow()] });
    const result = await post(validBody);
    expect(result.status).toBe(201);
    const insertParams: unknown[] = query.mock.calls[0]![1];
    expect(insertParams).toContain(userId);
  });

  it("trims name, institution, accountRef before inserting", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow()] });
    await post({ ...validBody, name: "  My Bank  ", institution: "  ING  " });
    const insertParams: unknown[] = query.mock.calls[0]![1];
    expect(insertParams).toContain("My Bank");
    expect(insertParams).toContain("ING");
    expect(insertParams).not.toContain("  My Bank  ");
  });

  it("accepts openingBalanceMinor of 0 and negatives", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow({ openingBalanceMinor: "0" })] });
    expect((await post({ ...validBody, openingBalanceMinor: 0 })).status).toBe(201);
    query.mockResolvedValueOnce({ rows: [accountRow({ openingBalanceMinor: "-5000" })] });
    expect((await post({ ...validBody, openingBalanceMinor: -5000 })).status).toBe(201);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(post(validBody)).rejects.toThrow();
  });
});

// ─── GET /:accountId ──────────────────────────────────────────────────────────

describe("GET /accounts/:accountId", () => {
  it("rejects an invalid UUID", async () => {
    expect((await dispatch(accountsRouter, { url: "/not-a-uuid" })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 for missing or foreign account", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await dispatch(accountsRouter, { url: `/${accountId}` })).status).toBe(404);
  });

  it("returns 200 for an archived account", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow({ isArchived: true })] });
    expect((await dispatch(accountsRouter, { url: `/${accountId}` })).status).toBe(200);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(accountsRouter, { url: `/${accountId}` })).rejects.toThrow();
  });
});

// ─── PATCH /:accountId ────────────────────────────────────────────────────────

describe("PATCH /accounts/:accountId", () => {
  function patch(id: string, body: unknown) {
    return dispatch(accountsRouter, { method: "PATCH", url: `/${id}`, body });
  }

  it("rejects an invalid UUID", async () => {
    expect((await patch("not-a-uuid", { name: "New" })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 for empty body or only unknown fields", async () => {
    expect((await patch(accountId, {})).status).toBe(400);
    expect((await patch(accountId, { userId: "hack" })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: "  " }, "name must be between 1 and 100 characters"],
    [{ type: "credit" }, "type must be checking, savings, or cash"],
    [{ openingBalanceMinor: 1.5 }, "openingBalanceMinor must be a safe integer"],
    [{ openingBalanceMinor: null }, "openingBalanceMinor must be a safe integer"],
    [{ institution: 123 }, "institution must be a string or null"],
    [{ accountRef: true }, "accountRef must be a string or null"],
    [
      { currencyCode: "eur" },
      "currencyCode must be a 3-letter uppercase ISO 4217 code (e.g. EUR, USD)",
    ],
    [{ isArchived: "true" }, "isArchived must be a boolean"],
  ])("rejects invalid field %j", async (body, error) => {
    expect(await patch(accountId, body)).toEqual({ status: 400, body: { error } });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 404 when account not found, no UPDATE", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await patch(accountId, { name: "New" })).status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("sets only sent fields plus updated_at, trims strings", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow()] });
    query.mockResolvedValueOnce({ rows: [accountRow({ name: "New" })] });

    await patch(accountId, { name: "  New  " });

    const updateSql: string = query.mock.calls[1]![0].text;
    expect(updateSql).toContain('"updated_at"');
    const updateParams: unknown[] = query.mock.calls[1]![1];
    expect(updateParams).toContain("New");
    expect(updateParams).not.toContain("  New  ");
  });

  it("null clears institution and accountRef", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow()] });
    query.mockResolvedValueOnce({ rows: [accountRow({ institution: null })] });

    await patch(accountId, { institution: null });

    const updateParams: unknown[] = query.mock.calls[1]![1];
    expect(updateParams).toContain(null);
  });

  it("archives account with isArchived: true (#20 regression)", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow()] });
    query.mockResolvedValueOnce({ rows: [accountRow({ isArchived: true })] });
    expect((await patch(accountId, { isArchived: true })).status).toBe(200);
  });

  it("unarchives account with isArchived: false, no is_archived filter on lookup (#20 regression)", async () => {
    query.mockResolvedValueOnce({ rows: [accountRow({ isArchived: true })] });
    query.mockResolvedValueOnce({ rows: [accountRow({ isArchived: false })] });

    const result = await patch(accountId, { isArchived: false });

    expect(result.status).toBe(200);
    // Lookup must not filter on is_archived so archived accounts are still found
    const lookupSql: string = query.mock.calls[0]![0].text;
    expect(lookupSql).not.toMatch(/where.*is_archived/);
  });

  it("forwards errors", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(patch(accountId, { name: "New" })).rejects.toThrow();
  });
});
