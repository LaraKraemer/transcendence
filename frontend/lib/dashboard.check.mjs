// Self-check for the pure helpers in dashboard.ts (no test framework in the frontend):
//   node --experimental-strip-types lib/dashboard.check.mjs
import assert from "node:assert/strict";

import { currentMonth, monthRange, netChange, summarizeMonth } from "./dashboard.ts";

// 23:30 UTC on 31 Oct is already November in Berlin (UTC+1 after the DST change).
assert.deepEqual(currentMonth("Europe/Berlin", new Date("2026-10-31T23:30:00Z")), { year: 2026, month: 11 });
assert.deepEqual(currentMonth("UTC", new Date("2026-10-31T23:30:00Z")), { year: 2026, month: 10 });

assert.deepEqual(monthRange(2026, 10), { from: "2026-10-01", to: "2026-10-31" });
assert.deepEqual(monthRange(2026, 0), { from: "2025-12-01", to: "2025-12-31" }); // January's previous month
assert.deepEqual(monthRange(2028, 2), { from: "2028-02-01", to: "2028-02-29" }); // leap year
assert.deepEqual(monthRange(2026, 2), { from: "2026-02-01", to: "2026-02-28" });

const month = summarizeMonth([
  { categoryId: "groceries", type: "expense", totalMinor: -2500, count: 3 },
  { categoryId: "salary", type: "income", totalMinor: 400000, count: 1 },
  { categoryId: null, type: "expense", totalMinor: -7500, count: 1 },
  { categoryId: null, type: "transfer", totalMinor: -100000, count: 1 }, // ignored
  { categoryId: null, type: "income", totalMinor: 1000, count: 1 },
]);
assert.equal(month.incomeMinor, 401000);
assert.equal(month.expenseMinor, 10000);
assert.equal(month.netMinor, 391000);
assert.deepEqual(month.spending, [
  { categoryId: null, amountMinor: 7500, share: 0.75 },
  { categoryId: "groceries", amountMinor: 2500, share: 0.25 },
]);
assert.deepEqual(summarizeMonth([]), { incomeMinor: 0, expenseMinor: 0, netMinor: 0, spending: [] });

assert.equal(netChange(118, 100), 0.18);
assert.equal(netChange(-100, -200), 0.5); // less negative is better
assert.equal(netChange(-100, 100), -2);
assert.equal(netChange(500, 0), null);
console.log("dashboard: ok");
