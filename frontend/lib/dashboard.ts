/**
 * Pure helpers for the overview (dashboard) page: month ranges and the totals it derives from
 * `GET /transactions/summary`. Kept free of imports with runtime code so lib/dashboard.check.mjs
 * can run it with plain Node.
 */
import type { TransactionSummaryRow } from "@/lib/types";

export function currentMonth(timeZone: string, now = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "numeric" }).formatToParts(now);
  const part = (type: "year" | "month") => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month") };
}

/**
 * First and last day of a month as `YYYY-MM-DD`, the format of `bookedOn` and the summary filters.
 * `month` is 1–12; 0 means December of the year before (so `month - 1` gives the previous month).
 */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);
  // Date.UTC rolls over out-of-range months, and day 0 is the last day of the month before.
  return { from: isoDate(new Date(Date.UTC(year, month - 1, 1))), to: isoDate(new Date(Date.UTC(year, month, 0))) };
}

export type CategorySpending = { categoryId: string | null; amountMinor: number; share: number };

/**
 * Totals one month's summary rows. Income and expenses are positive amounts; transfers are left
 * out, because moving money between one's own accounts is neither earned nor spent. `spending`
 * has one entry per expense category (null = uncategorised), largest first, with its share of all
 * expenses (0–1).
 */
export function summarizeMonth(rows: TransactionSummaryRow[]): {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  spending: CategorySpending[];
} {
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const row of rows) {
    if (row.type === "income") incomeMinor += row.totalMinor;
    if (row.type === "expense") expenseMinor -= row.totalMinor;
  }
  const spending = rows
    .filter((row) => row.type === "expense")
    .map((row) => ({ categoryId: row.categoryId, amountMinor: -row.totalMinor, share: -row.totalMinor / expenseMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
  return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor, spending };
}

/**
 * Change of this month's net against last month's, relative to last month's size (0.18 = +18%),
 * so going from −200 to −100 is +50%, an improvement. `null` when last month's net was 0: there
 * is nothing to compare against.
 */
export function netChange(currentNetMinor: number, previousNetMinor: number): number | null {
  return previousNetMinor === 0 ? null : (currentNetMinor - previousNetMinor) / Math.abs(previousNetMinor);
}
