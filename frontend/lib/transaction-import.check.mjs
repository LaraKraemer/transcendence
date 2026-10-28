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
for (const category of ["Groceries", null, ""]) {
  const categorized = { ...document, transactions: [{ ...entry, category }] };
  assert.deepEqual(parse(categorized), categorized);
}
console.log("JSON import preview checks passed");
