import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});

import { findOwnedAccount, hasTransactions, sumTransactions } from "../../srcs/db/accounts.ts";

const accountId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "550e8400-e29b-41d4-a716-446655440001";

beforeEach(() => query.mockReset());

describe("findOwnedAccount", () => {
  it("includes is_archived filter when allowArchived=false", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await findOwnedAccount(accountId, userId, false);

    const sql: string = query.mock.calls[0]![0].text;
    const params: unknown[] = query.mock.calls[0]![1];
    expect(sql).toContain('"is_archived"');
    expect(params).toContain(false);
  });

  it("omits is_archived filter in WHERE clause when allowArchived=true (default)", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await findOwnedAccount(accountId, userId);

    const sql: string = query.mock.calls[0]![0].text;
    // SELECT always lists is_archived as a column; only the WHERE should be checked
    const wherePart = sql.split(" where ")[1] ?? "";
    expect(wherePart).not.toContain('"is_archived"');
    // allowArchived=true means false is NOT bound
    const params: unknown[] = query.mock.calls[0]![1];
    expect(params).not.toContain(false);
  });

  it("always filters on account id AND user_id", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await findOwnedAccount(accountId, userId, false);

    const sql: string = query.mock.calls[0]![0].text;
    const params: unknown[] = query.mock.calls[0]![1];
    // AND not OR — an OR would expose other users' accounts
    expect(sql).toMatch(/"account"."id" = \$\d+ and "account"."user_id" = \$\d+/);
    expect(params[0]).toBe(accountId);
    expect(params[1]).toBe(userId);
  });
});

describe("sumTransactions", () => {
  it("filters transactions by account_id", async () => {
    query.mockResolvedValueOnce({ rows: [["5000"]] });
    await sumTransactions(accountId);

    const sql: string = query.mock.calls[0]![0].text;
    const params: unknown[] = query.mock.calls[0]![1];
    expect(sql).toMatch(/"transaction"."account_id" = \$\d+/);
    expect(params).toEqual([accountId]);
  });

  it("sums amount_minor", async () => {
    query.mockResolvedValueOnce({ rows: [["5000"]] });
    await sumTransactions(accountId);

    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('sum("amount_minor")');
  });

  it("returns 0 when result is null (no transactions)", async () => {
    query.mockResolvedValueOnce({ rows: [[null]] });
    expect(await sumTransactions(accountId)).toBe(0);
  });

  it("returns the numeric sum", async () => {
    query.mockResolvedValueOnce({ rows: [["3000"]] });
    expect(await sumTransactions(accountId)).toBe(3000);
  });
});

describe("hasTransactions", () => {
  it.each([true, false])("returns %s for current transaction existence", async (exists) => {
    query.mockResolvedValueOnce({ rows: exists ? [["transaction-id"]] : [] });

    expect(await hasTransactions(accountId)).toBe(exists);
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('"transaction"."account_id" = $1');
    expect(sql).toContain("limit $2");
    expect(sql).not.toContain("sum(");
    expect(query.mock.calls[0]![1]).toEqual([accountId, 1]);
  });
});
