import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});

import { findOwnedAccount } from "../../srcs/db/accounts.ts";

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

  it("always filters on account id and user_id", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await findOwnedAccount(accountId, userId, false);

    const params: unknown[] = query.mock.calls[0]![1];
    expect(params).toContain(accountId);
    expect(params).toContain(userId);
  });
});
