import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatch } from "../helpers/dispatch.ts";
import { row } from "../helpers/rows.ts";

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

import { analyticsRouter } from "../../srcs/routes/analytics.ts";
import { transactionsRouter } from "../../srcs/routes/transaction.ts";
import { accounts, categories } from "../../srcs/db/schema.ts";

const userId = "550e8400-e29b-41d4-a716-446655440001";
const accountId = "550e8400-e29b-41d4-a716-446655440002";
const categoryId = "550e8400-e29b-41d4-a716-446655440003";
const range = { from: "2025-01-01", to: "2025-01-03" };
const routes = [
  { router: analyticsRouter, url: "/timeseries", params: { granularity: "day" } },
  { router: analyticsRouter, url: "/categories", params: {} },
  { router: transactionsRouter, url: "/export", params: { format: "csv" } },
];

beforeEach(() => query.mockReset());

describe.each(routes)("$url reporting filters", ({ router, url, params }) => {
  it.each([
    { from: undefined },
    { to: undefined },
    { from: "2025-02-30" },
    { to: "2025-02-29" },
    { from: "0000-01-01" },
    { to: "not-a-date" },
    { from: ["2025-01-01", "2025-01-02"] },
    { to: "2024-12-31" },
    { to: "2031-01-01" },
    { accountId: "invalid" },
    { categoryId: ["a", "b"] },
    { type: "transfer" },
    { type: ["income", "expense"] },
  ])("rejects invalid parameters %j before querying", async (invalid) => {
    const result = await dispatch(router, { url, query: { ...range, ...params, ...invalid } });
    expect(result).toMatchObject({ status: 400, body: { error: expect.any(String) } });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["accountId", "categoryId"])("returns 404 for a missing or foreign %s", async (field) => {
    query.mockResolvedValueOnce({ rows: [] });
    const id = field === "accountId" ? accountId : categoryId;
    expect(await dispatch(router, { url, query: { ...range, ...params, [field]: id } })).toEqual({
      status: 404,
      body: { error: field === "accountId" ? "Account not found" : "Category not found" },
    });
    expect(query.mock.calls[0]![0].text).toContain('"user_id" =');
    expect(query.mock.calls[0]![1]).toEqual([id, userId, 1]);
  });

  it("accepts owned filters, including an archived account, and scopes the report to the user", async () => {
    query.mockResolvedValueOnce({ rows: [row(accounts, { id: accountId, isArchived: true })] });
    query.mockResolvedValueOnce({ rows: [row(categories, { id: categoryId, types: ["expense"] })] });
    query.mockResolvedValueOnce({ rows: [] });
    const result = await dispatch(router, {
      url,
      query: { ...range, ...params, accountId, categoryId, type: "expense" },
    });
    expect(result.status).toBe(200);
    expect(query.mock.calls[0]![0].text).not.toContain('is_archived" =');
    const [statement, values] = query.mock.calls[2]!;
    expect(statement.text).toContain('"account"."user_id" =');
    expect(statement.text).toContain('"transaction"."category_id" =');
    expect(values).toEqual(expect.arrayContaining([userId, accountId, categoryId, "expense", range.from, range.to]));
    // Only the category summary leaves transfers out.
    if (url === "/categories") expect(statement.text).toContain('"transaction"."type" in');
    else expect(statement.text).not.toContain('"transaction"."type" in');
  });

  it.each([
    { from: "2024-02-29", to: "2024-02-29" },
    { from: "2020-01-01", to: "2025-01-01" },
  ])("accepts same-day and maximum-length ranges %j", async (dates) => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await dispatch(router, { url, query: { ...dates, ...params } })).status).toBe(200);
  });

  it("rejects a range one day beyond the cap", async () => {
    expect((await dispatch(router, { url, query: { from: "2020-01-01", to: "2025-01-02", ...params } })).status).toBe(
      400,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("forwards database errors", async () => {
    query.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(dispatch(router, { url, query: { ...range, ...params } })).rejects.toThrow("Failed query");
  });
});

describe("GET /analytics/timeseries", () => {
  it.each([undefined, "year", "", ["day", "month"]])("rejects granularity %j", async (granularity) => {
    expect(await dispatch(analyticsRouter, { url: "/timeseries", query: { ...range, granularity } })).toEqual({
      status: 400,
      body: { error: "granularity must be day, week, or month" },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["day", "week", "month"])("returns numeric totals and SQL-filled periods for %s", async (granularity) => {
    query.mockResolvedValueOnce({
      rows: [
        ["2025-01-01", "EUR", "1200", "-500", "0", "0"],
        ["2025-01-01", "USD", "700", "0", "0", "0"],
        ["2025-01-02", "EUR", "0", "0", "-300", "0"],
      ],
    });
    expect(await dispatch(analyticsRouter, { url: "/timeseries", query: { ...range, granularity } })).toEqual({
      status: 200,
      body: [
        {
          period: "2025-01-01",
          currencyCode: "EUR",
          incomeMinor: 1200,
          expenseMinor: -500,
          transferOutMinor: 0,
          transferInMinor: 0,
        },
        {
          period: "2025-01-01",
          currencyCode: "USD",
          incomeMinor: 700,
          expenseMinor: 0,
          transferOutMinor: 0,
          transferInMinor: 0,
        },
        {
          period: "2025-01-02",
          currencyCode: "EUR",
          incomeMinor: 0,
          expenseMinor: 0,
          transferOutMinor: -300,
          transferInMinor: 0,
        },
      ],
    });
    expect(query.mock.calls[0]![0].text).toContain("generate_series");
    expect(query.mock.calls[0]![0].text).toContain("date_trunc");
    expect(query.mock.calls[0]![0].text).not.toContain("is_archived");
  });
});

describe("GET /analytics/categories", () => {
  it("returns signed totals, currency codes and uncategorized entries using the shared summary", async () => {
    query.mockResolvedValueOnce({
      rows: [
        [categoryId, "expense", "-500", "2", "EUR"],
        [categoryId, "expense", "-800", "1", "USD"],
        [null, "income", "1000", "1", "USD"],
      ],
    });
    expect(await dispatch(analyticsRouter, { url: "/categories", query: range })).toEqual({
      status: 200,
      body: [
        { categoryId, type: "expense", totalMinor: -500, count: 2, currencyCode: "EUR" },
        { categoryId, type: "expense", totalMinor: -800, count: 1, currencyCode: "USD" },
        { categoryId: null, type: "income", totalMinor: 1000, count: 1, currencyCode: "USD" },
      ],
    });
  });
});

describe("GET /transactions/export", () => {
  it.each([undefined, "json", ["csv", "csv"]])("rejects format %j", async (format) => {
    expect(await dispatch(transactionsRouter, { url: "/export", query: { ...range, format } })).toEqual({
      status: 400,
      body: { error: "format must be csv" },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("quotes UTF-8 text, embedded quotes, commas and newlines, and guards every text column", async () => {
    query.mockResolvedValueOnce({
      rows: [["+Account", "EUR", "2025-01-01", "expense", "-Category", "@Shop", '=Café, "tea"\nnext', "-1234", 2]],
    });
    const result = await dispatch(transactionsRouter, { url: "/export", query: { ...range, format: "csv" } });
    expect(result).toEqual({
      status: 200,
      contentType: "text/csv; charset=utf-8",
      headers: {
        "Content-Disposition": 'attachment; filename="transactions.csv"',
        "Cache-Control": "no-store",
      },
      body: '\uFEFFaccount,currency,date,type,category,merchant,description,amount\r\n"\'+Account","EUR","2025-01-01","expense","\'-Category","\'@Shop","\'=Café, ""tea""\nnext",-12.34\r\n',
    });
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "  =1", "\t=1", "\r=1", "\n=1"])(
    "neutralizes formula description %j",
    async (description) => {
      query.mockResolvedValueOnce({
        rows: [["Checking", "EUR", "2025-01-01", "income", null, null, description, "1", 2]],
      });
      const { body } = await dispatch(transactionsRouter, { url: "/export", query: { ...range, format: "csv" } });
      expect(body).toContain(`"'${description}",0.01\r\n`);
    },
  );

  it("formats zero/three decimals and safe-integer amounts exactly, without floating-point rounding", async () => {
    query.mockResolvedValueOnce({
      rows: [
        ["A", "JPY", "2025-01-01", "income", null, null, null, "15", 0],
        ["A", "KWD", "2025-01-01", "expense", null, null, null, "-5", 3],
        ["A", "EUR", "2025-01-01", "income", null, null, null, "9007199254740991", 2],
      ],
    });
    const { body } = await dispatch(transactionsRouter, { url: "/export", query: { ...range, format: "csv" } });
    expect(body).toContain(',"","",15\r\n');
    expect(body).toContain(',"","",-0.005\r\n');
    expect(body).toContain(',"","",90071992547409.91\r\n');
  });

  it("returns only a BOM and header when no transactions match", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { body } = await dispatch(transactionsRouter, { url: "/export", query: { ...range, format: "csv" } });
    expect(body).toBe("\uFEFFaccount,currency,date,type,category,merchant,description,amount\r\n");
  });
});
