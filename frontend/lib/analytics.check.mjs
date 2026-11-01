// Self-check for the pure helpers in analytics.ts (no test framework in the frontend):
//   node --experimental-strip-types lib/analytics.check.mjs
import assert from "node:assert/strict";

import { granularityFor, isDateOnly, reportsByCurrency, resolveRange, todayIn } from "./analytics.ts";

// 23:30 UTC on 31 Oct is already 1 Nov in Berlin.
assert.equal(todayIn("Europe/Berlin", new Date("2026-10-31T23:30:00Z")), "2026-11-01");
assert.equal(todayIn("UTC", new Date("2026-10-31T23:30:00Z")), "2026-10-31");

assert.ok(isDateOnly("2028-02-29"));
assert.ok(!isDateOnly("2026-02-30"));
assert.ok(!isDateOnly("2026-2-3"));
assert.ok(!isDateOnly(undefined));

assert.deepEqual(resolveRange("month", "2026-10-31"), { from: "2026-10-01", to: "2026-10-31" });
assert.deepEqual(resolveRange("30d", "2026-03-01"), { from: "2026-01-31", to: "2026-03-01" });
assert.deepEqual(resolveRange("year", "2026-10-31"), { from: "2026-01-01", to: "2026-10-31" });
assert.deepEqual(resolveRange("custom", "2026-10-31", "2025-01-01", "2025-01-31"), {
  from: "2025-01-01",
  to: "2025-01-31",
});
assert.equal(resolveRange("custom", "2026-10-31", "2025-02-01", "2025-01-31"), null); // reversed
assert.equal(resolveRange("custom", "2026-10-31", "2020-01-01", "2025-01-31"), null); // more than 1827 days
assert.equal(resolveRange("custom", "2026-10-31", undefined, "2025-01-31"), null);

assert.equal(granularityFor({ from: "2026-10-01", to: "2026-10-31" }), "day");
assert.equal(granularityFor({ from: "2026-05-01", to: "2026-10-31" }), "week");
assert.equal(granularityFor({ from: "2026-01-01", to: "2026-10-31" }), "month");

const reports = reportsByCurrency(
  [
    { period: "2026-10-01", currencyCode: "EUR", incomeMinor: 1000, expenseMinor: -300 },
    { period: "2026-10-01", currencyCode: "USD", incomeMinor: 0, expenseMinor: -50 },
    { period: "2026-10-02", currencyCode: "EUR", incomeMinor: 0, expenseMinor: -200 },
    { period: "2026-10-02", currencyCode: "USD", incomeMinor: 0, expenseMinor: 0 },
  ],
  [{ categoryId: null, type: "expense", totalMinor: -50, count: 1, currencyCode: "USD" }],
);
// Never mixed: one report per currency, each with only its own rows and totals.
assert.deepEqual(
  reports.map(({ currencyCode, incomeMinor, expenseMinor, series, categories }) => [
    currencyCode,
    incomeMinor,
    expenseMinor,
    series.length,
    categories.length,
  ]),
  [
    ["EUR", 1000, -500, 2, 0],
    ["USD", 0, -50, 2, 1],
  ],
);

console.log("analytics.ts: all checks passed");
