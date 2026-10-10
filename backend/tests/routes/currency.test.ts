import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../srcs/db/client.ts", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as unknown as import("pg").Pool) };
});
vi.mock("../../srcs/auth.ts", () => ({
  requireAuthenticatedUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { currencies } from "../../srcs/db/schema.ts";
import { currenciesRouter } from "../../srcs/routes/currency.ts";
import { dispatch } from "../helpers/dispatch.ts";
import { row } from "../helpers/rows.ts";

beforeEach(() => query.mockReset());

describe("GET /currencies", () => {
  it("returns currency metadata with numeric minor-unit exponents", async () => {
    const currencyRecords = [
      { code: "EUR", name: "Euro", symbol: "€", minorUnit: 2 },
      { code: "JPY", name: "Japanese Yen", symbol: "¥", minorUnit: 0 },
      { code: "KWD", name: "Kuwaiti Dinar", symbol: "KD", minorUnit: 3 },
      { code: "UAH", name: "Ukrainian Hryvnia", symbol: "₴", minorUnit: 2 },
    ];
    query.mockResolvedValueOnce({ rows: currencyRecords.map((currency) => row(currencies, currency)) });

    expect(await dispatch(currenciesRouter, { url: "/" })).toEqual({
      status: 200,
      body: currencyRecords,
    });
    const sql: string = query.mock.calls[0]![0].text;
    expect(sql).toContain('order by "currency"."code"');
    expect(sql).not.toContain(" where ");
    expect(query).toHaveBeenCalledOnce();
  });

  it("returns an empty list before seeding", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await dispatch(currenciesRouter, { url: "/" })).toEqual({ status: 200, body: [] });
  });

  it("forwards database failures", async () => {
    query.mockRejectedValueOnce(new Error("DB down"));
    await expect(dispatch(currenciesRouter, { url: "/" })).rejects.toThrow();
  });
});
