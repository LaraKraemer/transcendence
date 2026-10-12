import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

// Use real auth.ts; mock only the DB so no connection is needed.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});

import { accountsRouter } from "../../srcs/routes/account.ts";
import { categoriesRouter } from "../../srcs/routes/category.ts";
import { currenciesRouter } from "../../srcs/routes/currency.ts";
import { transactionsRouter } from "../../srcs/routes/transaction.ts";
import { dispatch } from "../helpers/dispatch.ts";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

const ROUTES: Array<{ router: Parameters<typeof dispatch>[0]; method: string; url: string }> = [
  { router: accountsRouter, method: "GET", url: "/" },
  { router: accountsRouter, method: "POST", url: "/" },
  { router: accountsRouter, method: "GET", url: `/${validUuid}` },
  { router: accountsRouter, method: "PATCH", url: `/${validUuid}` },
  { router: accountsRouter, method: "GET", url: `/${validUuid}/balance` },
  { router: categoriesRouter, method: "GET", url: "/" },
  { router: categoriesRouter, method: "POST", url: "/" },
  { router: categoriesRouter, method: "GET", url: `/${validUuid}` },
  { router: categoriesRouter, method: "PATCH", url: `/${validUuid}` },
  { router: categoriesRouter, method: "DELETE", url: `/${validUuid}` },
  { router: currenciesRouter, method: "GET", url: "/" },
  { router: transactionsRouter, method: "GET", url: "/" },
  { router: transactionsRouter, method: "GET", url: "/summary" },
  { router: transactionsRouter, method: "GET", url: `/${validUuid}` },
  { router: transactionsRouter, method: "POST", url: "/" },
  { router: transactionsRouter, method: "PATCH", url: `/${validUuid}` },
  { router: transactionsRouter, method: "DELETE", url: `/${validUuid}` },
];

beforeEach(() => query.mockReset());

describe("router protection — no session cookie", () => {
  it.each(ROUTES)("$method $url → 401 with no queries", async ({ router, method, url }) => {
    const result = await dispatch(router, { method, url });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Authentication required" });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("router protection — cookie present, session not found", () => {
  it.each(ROUTES)("$method $url → 401 after exactly one query", async ({ router, method, url }) => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await dispatch(router, {
      method,
      url,
      cookies: { session: "stale-token" },
    });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Authentication required" });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
