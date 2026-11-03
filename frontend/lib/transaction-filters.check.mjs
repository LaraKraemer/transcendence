// Self-check for the /transactions URL filters (no test framework in the frontend):
//   npm run check:filters
import assert from "node:assert/strict";

import {
  DEFAULT_FILTERS,
  isFiltered,
  pageNumbers,
  parseTransactionFilters,
  transactionsApiQuery,
  transactionsHref,
} from "./transaction-filters.ts";

const categoryId = "4f9a6c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";

assert.deepEqual(parseTransactionFilters({}, []), DEFAULT_FILTERS);

const shared = {
  q: "  coffee  ",
  type: "expense",
  categoryId,
  from: "2026-01-01",
  to: "2026-01-31",
  minAmountMinor: "500",
  maxAmountMinor: "2000",
  sort: "amountMinor",
  order: "asc",
  pageSize: "25",
  page: "3",
};
const filters = parseTransactionFilters(shared, [categoryId]);
assert.deepEqual(filters, {
  q: "coffee",
  type: "expense",
  categoryId,
  from: "2026-01-01",
  to: "2026-01-31",
  minAmountMinor: 500,
  maxAmountMinor: 2000,
  sort: "amountMinor:asc",
  pageSize: 25,
  page: 3,
});
// The URL round-trips, so a reload or a shared link shows the same page.
const href = transactionsHref(filters, "acc");
assert.deepEqual(parseTransactionFilters(Object.fromEntries(new URL(href, "http://x").searchParams), [categoryId]), filters);
assert.equal(new URL(href, "http://x").searchParams.get("accountId"), "acc");

// Defaults stay out of the URL.
assert.equal(transactionsHref(DEFAULT_FILTERS), "/transactions");
assert.equal(transactionsHref({ ...DEFAULT_FILTERS, sort: "bookedOn:asc" }), "/transactions?order=asc");
assert.equal(transactionsHref({ ...DEFAULT_FILTERS, sort: "createdAt:desc" }), "/transactions?sort=createdAt");

// Values the backend would reject (400/404) count as not set.
const invalid = parseTransactionFilters(
  {
    q: "x".repeat(600),
    type: "refund",
    categoryId: "someone-elses",
    from: "2026-02-30",
    to: "01/31/2026",
    minAmountMinor: "-5",
    maxAmountMinor: "1.5",
    sort: "description",
    order: "up",
    pageSize: "30",
    page: "0",
  },
  [categoryId],
);
assert.deepEqual(invalid, { ...DEFAULT_FILTERS, q: "x".repeat(500) });
assert.equal(parseTransactionFilters({ from: "9999-99-99" }, []).from, "");
assert.equal(parseTransactionFilters({ categoryId: "none" }, []).categoryId, "none");
assert.equal(parseTransactionFilters({ type: ["income", "expense"] }, []).type, "");
assert.equal(parseTransactionFilters({ page: String(Number.MAX_SAFE_INTEGER) }, []).page, 1);
assert.equal(parseTransactionFilters({ sort: "amountMinor" }, []).sort, "amountMinor:desc");
// A minimum above the maximum is a 400, so the maximum is dropped.
const reversed = parseTransactionFilters({ minAmountMinor: "900", maxAmountMinor: "100" }, []);
assert.equal(reversed.minAmountMinor, 900);
assert.equal(reversed.maxAmountMinor, null);
assert.equal(parseTransactionFilters({ minAmountMinor: "100", maxAmountMinor: "100" }, []).maxAmountMinor, 100);

// The API gets limit and offset instead of pageSize and page.
const api = new URLSearchParams(transactionsApiQuery(filters, "acc", 50));
assert.equal(api.get("limit"), "25");
assert.equal(api.get("offset"), "50");
assert.equal(api.get("pageSize"), null);
assert.equal(api.get("page"), null);
assert.equal(api.get("q"), "coffee");
assert.equal(api.get("order"), "asc");
assert.equal(api.get("accountId"), "acc");

assert.equal(isFiltered(DEFAULT_FILTERS), false);
assert.equal(isFiltered({ ...DEFAULT_FILTERS, sort: "amountMinor:asc", pageSize: 100, page: 4 }), false);
assert.equal(isFiltered({ ...DEFAULT_FILTERS, minAmountMinor: 0 }), true);
assert.equal(isFiltered({ ...DEFAULT_FILTERS, categoryId: "none" }), true);

assert.deepEqual(pageNumbers(1, 1), [1]);
assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
assert.deepEqual(pageNumbers(1, 17), [1, 2, null, 17]);
assert.deepEqual(pageNumbers(3, 17), [1, 2, 3, 4, null, 17]); // a gap of one page shows the page
assert.deepEqual(pageNumbers(9, 17), [1, null, 8, 9, 10, null, 17]);
assert.deepEqual(pageNumbers(17, 17), [1, null, 16, 17]);
assert.deepEqual(pageNumbers(5, 7), [1, null, 4, 5, 6, 7]);

console.log("transaction-filters: all checks passed");
