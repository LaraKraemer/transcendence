// Self-check for the pure helpers in analytics.ts (no test framework in the frontend):
//   node --experimental-strip-types lib/analytics.check.mjs
import assert from "node:assert/strict";

import { granularityFor, isDateOnly, netMinor, reportsByCurrency, resolveRange, todayIn } from "./analytics.ts";

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

const noTransfers = { transferOutMinor: 0, transferInMinor: 0 };
const reports = reportsByCurrency(
  [
    { period: "2026-10-01", currencyCode: "EUR", incomeMinor: 1000, expenseMinor: -300, ...noTransfers },
    { period: "2026-10-01", currencyCode: "USD", incomeMinor: 0, expenseMinor: -50, ...noTransfers },
    {
      period: "2026-10-02",
      currencyCode: "EUR",
      incomeMinor: 0,
      expenseMinor: -200,
      transferOutMinor: -400,
      transferInMinor: 150,
    },
    {
      period: "2026-10-02",
      currencyCode: "USD",
      incomeMinor: 0,
      expenseMinor: 0,
      transferOutMinor: 0,
      transferInMinor: 70,
    },
  ],
  [{ categoryId: null, type: "expense", totalMinor: -50, count: 1, currencyCode: "USD" }],
);
// Never mixed: one report per currency, each with only its own rows and totals.
assert.deepEqual(
  reports.map(({ currencyCode, incomeMinor, expenseMinor, transferOutMinor, transferInMinor, series, categories }) => [
    currencyCode,
    incomeMinor,
    expenseMinor,
    transferOutMinor,
    transferInMinor,
    series.length,
    categories.length,
  ]),
  [
    ["EUR", 1000, -500, -400, 150, 2, 0],
    ["USD", 0, -50, 0, 70, 2, 1],
  ],
);
// Net is the change of balance, transfers included; a transfer-only account still has one.
assert.deepEqual(reports.map(netMinor), [250, 20]);
assert.equal(netMinor(reports[1].series[1]), 70);
assert.equal(
  netMinor({
    incomeMinor: Number.MAX_SAFE_INTEGER,
    expenseMinor: 0,
    transferInMinor: 2,
    transferOutMinor: -Number.MAX_SAFE_INTEGER,
  }),
  2,
);
assert.throws(
  () =>
    reportsByCurrency(
      [
        {
          period: "2026-10-01",
          currencyCode: "EUR",
          incomeMinor: Number.MAX_SAFE_INTEGER,
          expenseMinor: 0,
          ...noTransfers,
        },
        { period: "2026-10-02", currencyCode: "EUR", incomeMinor: 2, expenseMinor: 0, ...noTransfers },
      ],
      [],
    ),
  RangeError,
);

console.log("analytics.ts: all checks passed");
