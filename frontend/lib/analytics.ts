/**
 * Pure helpers for the analytics page: the date range picked in the URL, the chart granularity and
 * the API rows grouped per currency. lib/analytics.check.mjs runs them with plain Node.
 */
import type { CategoryTotalRow, TimeSeriesRow } from "@/lib/types";

import { sumMinorUnits } from "./format.ts";

export const RANGE_PRESETS = ["month", "30d", "year", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export type DateRange = { from: string; to: string };
export type Granularity = "day" | "week" | "month";

/** The longest range the analytics API accepts (about five years). */
export const MAX_RANGE_DAYS = 1827;
const millisecondsPerDay = 86_400_000;
const LAST_DAYS_PRESET_LENGTH = 30;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const daysBetween = ({ from, to }: DateRange) => (Date.parse(to) - Date.parse(from)) / millisecondsPerDay;

/** A real calendar date as `YYYY-MM-DD` (what `<input type="date">` sends), like the backend's isDateOnly. */
export function isDateOnly(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    isoDate(new Date(value)) === value
  );
}

/** Today's date in a time zone as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The inclusive range of a preset up to `today` (this month and this year so far, the last 30 days), or the
 * custom `from`–`to`. `null` when the custom dates are missing, reversed or further apart than the API allows.
 */
export function resolveRange(preset: RangePreset, today: string, from?: string, to?: string): DateRange | null {
  switch (preset) {
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "30d":
      return {
        from: isoDate(new Date(Date.parse(today) - (LAST_DAYS_PRESET_LENGTH - 1) * millisecondsPerDay)),
        to: today,
      };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      return isDateOnly(from) && isDateOnly(to) && from <= to && daysBetween({ from, to }) <= MAX_RANGE_DAYS
        ? { from, to }
        : null;
  }
}

/** Days for up to a month, weeks for up to half a year, months beyond: a readable number of points. */
export function granularityFor(range: DateRange): Granularity {
  const days = daysBetween(range);
  return days <= 31 ? "day" : days <= 183 ? "week" : "month";
}

/** The signed totals of a period or a whole range. */
type Totals = Pick<TimeSeriesRow, "incomeMinor" | "expenseMinor" | "transferOutMinor" | "transferInMinor">;

/**
 * The change of balance: income and expenses plus transfers in and out. Same-currency transfers between the
 * user's own accounts cancel out across all accounts.
 */
export const netMinor = ({ incomeMinor, expenseMinor, transferOutMinor, transferInMinor }: Totals) =>
  sumMinorUnits([incomeMinor, expenseMinor, transferInMinor, transferOutMinor]);

export type CurrencyReport = Totals & {
  currencyCode: string;
  series: Omit<TimeSeriesRow, "currencyCode">[];
  categories: CategoryTotalRow[];
};

/** Splits the API rows into one report per currency (in the API's order), because amounts in different currencies can't be added. */
export function reportsByCurrency(series: TimeSeriesRow[], categories: CategoryTotalRow[]): CurrencyReport[] {
  const reports = new Map<string, CurrencyReport>();
  const reportFor = (currencyCode: string) => {
    let report = reports.get(currencyCode);
    if (!report) {
      report = {
        currencyCode,
        series: [],
        categories: [],
        incomeMinor: 0,
        expenseMinor: 0,
        transferOutMinor: 0,
        transferInMinor: 0,
      };
      reports.set(currencyCode, report);
    }
    return report;
  };
  for (const { currencyCode, ...point } of series) {
    const report = reportFor(currencyCode);
    report.series.push(point);
    report.incomeMinor = sumMinorUnits([report.incomeMinor, point.incomeMinor]);
    report.expenseMinor = sumMinorUnits([report.expenseMinor, point.expenseMinor]);
    report.transferOutMinor = sumMinorUnits([report.transferOutMinor, point.transferOutMinor]);
    report.transferInMinor = sumMinorUnits([report.transferInMinor, point.transferInMinor]);
  }
  for (const row of categories) reportFor(row.currencyCode).categories.push(row);
  return [...reports.values()];
}
