import { describe, expect, it } from "vitest";

import { parseTransactionImport, TRANSACTION_IMPORT_MAX_ROWS } from "../srcs/transaction-import.ts";

const entry = { type: "expense", amountMinor: -100, bookedOn: "2026-10-20" };
const document = { version: 1, currency: "EUR", transactions: [entry] };

describe("transaction import validation", () => {
  it("normalizes optional text and timestamps", () => {
    expect(
      parseTransactionImport({
        ...document,
        transactions: [{ ...entry, description: " Coffee ", notes: " ", occurredAt: "2026-10-20T10:00:00Z" }],
      }),
    ).toEqual({
      currency: "EUR",
      transactions: [{ ...entry, description: "Coffee", notes: null, occurredAt: new Date("2026-10-20T10:00:00Z") }],
    });
  });
  it.each([
    null,
    [],
    {},
    { ...document, version: 2 },
    { ...document, currency: "eur" },
    { ...document, transactions: [] },
    { ...document, transactions: Array(TRANSACTION_IMPORT_MAX_ROWS + 1).fill(entry) },
  ])("rejects invalid envelope %j", (value) => {
    expect(parseTransactionImport(value)).toHaveProperty("error");
  });
  it.each([
    null,
    { ...entry, type: "transfer" },
    { ...entry, amountMinor: 0 },
    { ...entry, amountMinor: 100 },
    { ...entry, amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { ...entry, amountMinor: -1.5 },
    { ...entry, bookedOn: "2026-02-30" },
    { ...entry, description: "x".repeat(501) },
    { ...entry, notes: {} },
    { ...entry, occurredAt: "invalid" },
    { ...entry, categoryId: "injected" },
    { ...entry, category: 42 },
    { ...entry, category: "x".repeat(81) },
    { ...entry, createdById: "injected" },
  ])("reports invalid row %j before writing", (value) => {
    expect(parseTransactionImport({ ...document, transactions: [entry, value] })).toHaveProperty(
      "error",
      expect.stringContaining("Row 2:"),
    );
  });
  it.each([
    [" Coffee ", "Coffee"],
    [" ", null],
    [null, null],
  ])("normalizes optional category %j", (category, expected) => {
    const result = parseTransactionImport({ ...document, transactions: [{ ...entry, category }] });
    expect(result).not.toHaveProperty("error");
    if (!("error" in result)) expect(result.transactions[0]?.category).toBe(expected);
  });
  it("accepts the row limit and positive income", () => {
    const result = parseTransactionImport({
      ...document,
      transactions: Array(TRANSACTION_IMPORT_MAX_ROWS).fill({ ...entry, type: "income", amountMinor: 100 }),
    });
    expect(result).not.toHaveProperty("error");
    if (!("error" in result)) expect(result.transactions).toHaveLength(TRANSACTION_IMPORT_MAX_ROWS);
  });
});
