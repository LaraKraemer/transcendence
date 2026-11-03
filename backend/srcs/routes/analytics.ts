import { Router } from "express";
import type { RequestHandler } from "express";

import { requireAuthenticatedUser } from "../auth.ts";
import { findOwnedAccount } from "../db/accounts.ts";
import { findOwnedCategory } from "../db/categories.ts";
import { summarizeTransactionsByCategory, transactionsForExport, transactionTimeSeries } from "../db/transactions.ts";
import type { AnalyticsFilters } from "../db/transactions.ts";
import { isDateOnly, isUuid } from "../validation.ts";

const REPORT_TYPES = ["expense", "income"] as const;
const GRANULARITIES = ["day", "week", "month"] as const;

function isReportType(value: unknown): value is (typeof REPORT_TYPES)[number] {
  return REPORT_TYPES.includes(value as (typeof REPORT_TYPES)[number]);
}

function isGranularity(value: unknown): value is (typeof GRANULARITIES)[number] {
  return GRANULARITIES.includes(value as (typeof GRANULARITIES)[number]);
}

/** Validates a bounded, inclusive reporting range and optional transaction filters. */
function parseAnalyticsFilters(query: Record<string, unknown>): AnalyticsFilters | { error: string } {
  const { from, to, accountId, categoryId, type } = query;
  if (!isDateOnly(from)) return { error: "from must be a valid YYYY-MM-DD date" };
  if (!isDateOnly(to)) return { error: "to must be a valid YYYY-MM-DD date" };
  if (from > to) return { error: "from must be on or before to" };
  const millisecondsPerDay = 86_400_000;
  const maxRangeDays = 1827;
  if ((Date.parse(to) - Date.parse(from)) / millisecondsPerDay > maxRangeDays) {
    return { error: `Date range must not exceed ${maxRangeDays} days (about five years)` };
  }
  if (accountId !== undefined && !isUuid(accountId)) return { error: "accountId must be a valid UUID" };
  if (categoryId !== undefined && !isUuid(categoryId)) return { error: "categoryId must be a valid UUID" };
  if (type !== undefined && !isReportType(type)) return { error: "type must be expense or income" };
  return {
    from,
    to,
    ...(accountId === undefined ? {} : { accountId }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(type === undefined ? {} : { type }),
  };
}

/** Validates reporting filters and resolves optional resources without revealing foreign ones. */
async function ownedFilters(query: Record<string, unknown>, userId: string) {
  const filters = parseAnalyticsFilters(query);
  if ("error" in filters) return { ...filters, status: 400 };
  if (filters.accountId !== undefined && !(await findOwnedAccount(filters.accountId, userId))) {
    return { error: "Account not found", status: 404 };
  }
  if (filters.categoryId !== undefined && !(await findOwnedCategory(filters.categoryId, userId))) {
    return { error: "Category not found", status: 404 };
  }
  return filters;
}

export const analyticsRouter = Router();
analyticsRouter.use(requireAuthenticatedUser);

/** Returns signed income/expense totals per period and currency, including zero periods, plus informational transfer-out/in totals (never part of income/expense). */
analyticsRouter.get("/timeseries", async (req, res, next) => {
  const { granularity } = req.query;
  if (!isGranularity(granularity)) {
    res.status(400).json({ error: "granularity must be day, week, or month" });
    return;
  }
  try {
    const filters = await ownedFilters(req.query, res.locals.userId);
    if ("error" in filters) {
      res.status(filters.status).json({ error: filters.error });
      return;
    }
    res.json(await transactionTimeSeries(res.locals.userId, filters, granularity));
  } catch (error) {
    next(error);
  }
});

/** Returns signed category totals by currency, excluding transfers. */
analyticsRouter.get("/categories", async (req, res, next) => {
  try {
    const filters = await ownedFilters(req.query, res.locals.userId);
    if ("error" in filters) {
      res.status(filters.status).json({ error: filters.error });
      return;
    }
    res.json(await summarizeTransactionsByCategory(res.locals.userId, filters));
  } catch (error) {
    next(error);
  }
});

/** Quotes text and neutralizes spreadsheet formulas, including whitespace-prefixed formulas. */
function csvCell(value: string | null): string {
  const text = value ?? "";
  const safeText = /^\s*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

/** Downloads bounded, filtered transactions, including transfer legs, as spreadsheet-safe UTF-8 CSV. */
export const exportTransactionsCsv: RequestHandler = async (req, res, next) => {
  if (req.query.format !== "csv") {
    res.status(400).json({ error: "format must be csv" });
    return;
  }
  try {
    const filters = await ownedFilters(req.query, res.locals.userId);
    if ("error" in filters) {
      res.status(filters.status).json({ error: filters.error });
      return;
    }
    const rows = await transactionsForExport(res.locals.userId, filters);
    const lines = rows.map((row) => {
      const digits = Math.abs(row.amountMinor)
        .toString()
        .padStart(row.minorUnit + 1, "0");
      const magnitude =
        row.minorUnit === 0 ? digits : `${digits.slice(0, -row.minorUnit)}.${digits.slice(-row.minorUnit)}`;
      const amount = `${row.amountMinor < 0 ? "-" : ""}${magnitude}`;
      return [
        ...[row.account, row.currencyCode, row.bookedOn, row.type, row.category, row.merchant, row.description].map(
          csvCell,
        ),
        amount,
      ].join(",");
    });
    res
      .type("text/csv; charset=utf-8")
      .set("Content-Disposition", 'attachment; filename="transactions.csv"')
      .set("Cache-Control", "no-store")
      .send(
        `\uFEFFaccount,currency,date,type,category,merchant,description,amount\r\n${lines.length ? `${lines.join("\r\n")}\r\n` : ""}`,
      );
  } catch (error) {
    next(error);
  }
};
