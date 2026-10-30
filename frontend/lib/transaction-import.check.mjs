import assert from "node:assert/strict";
import { parseImportPreview, TRANSACTION_IMPORT_MAX_ROWS } from "./transaction-import.ts";

const entry = { type: "expense", amountMinor: -100, bookedOn: "2026-10-20", description: "Coffee" };
const document = { version: 1, currency: "EUR", transactions: [entry] };
const parse = (value) => parseImportPreview(JSON.stringify(value));
assert.deepEqual(parse(document), document);
assert.deepEqual(parseImportPreview("not JSON"), { error: "invalid" });
for (const value of [
  null,
  [],
  { ...document, version: 2 },
  { ...document, currency: "eur" },
  { ...document, transactions: [] },
  { ...document, transactions: Array(TRANSACTION_IMPORT_MAX_ROWS + 1).fill(entry) },
]) {
  assert.equal(parse(value).error, "invalid");
}
for (const transaction of [
  null,
  { ...entry, type: "transfer" },
  { ...entry, amountMinor: 1.5 },
  { ...entry, amountMinor: 0 },
  { ...entry, amountMinor: 100 },
  { ...entry, type: "income", amountMinor: -100 },
  ...["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "invalid", "2026-10-20T00:00:00Z"].map(
    (bookedOn) => ({ ...entry, bookedOn }),
  ),
  { ...entry, description: {} },
  { ...entry, categoryId: "ignored?" },
  { ...entry, category: 42 },
]) {
  assert.deepEqual(parse({ ...document, transactions: [entry, transaction] }), { error: "invalid", row: 2 });
}
assert.deepEqual(
  parse({ ...document, transactions: Array(TRANSACTION_IMPORT_MAX_ROWS).fill(entry) }).transactions.length,
  TRANSACTION_IMPORT_MAX_ROWS,
);
for (const transaction of [
  { ...entry, bookedOn: "2024-02-29" },
  { ...entry, type: "income", amountMinor: 100 },
]) {
  const valid = { ...document, transactions: [transaction] };
  assert.deepEqual(parse(valid), valid);
}
for (const category of ["Groceries", null, ""]) {
  const categorized = { ...document, transactions: [{ ...entry, category }] };
  assert.deepEqual(parse(categorized), categorized);
}
console.log("JSON import preview checks passed");
