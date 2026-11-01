import type { Metadata } from "next";
import { getFormatter, getLocale, getTimeZone, getTranslations } from "next-intl/server";
import Link from "next/link";

import { AnalyticsFilters } from "@/components/analytics/analytics-filters";
import { AnalyticsRefresh } from "@/components/analytics/analytics-refresh";
import { CurrencyCharts } from "@/components/analytics/currency-charts";
import {
  fetchApiServer,
  getAccounts,
  getArchivedAccounts,
  getCategories,
  getCurrencies,
  notFoundOnMissingResource,
} from "@/lib/dal";
import { granularityFor, RANGE_PRESETS, reportsByCurrency, resolveRange, todayIn } from "@/lib/analytics";
import { formatAmount } from "@/lib/format";
import type { CategoryTotalRow, TimeSeriesRow } from "@/lib/types";

const focusRing = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const cardClassName = "rounded-lg border border-border bg-card p-[18px] sm:p-6";

type SearchParams = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** A single non-empty query parameter; a missing, empty or repeated one counts as none. */
const param = (value: string | string[] | undefined) => (typeof value === "string" && value !== "" ? value : undefined);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("analytics") };
}

/**
 * Income and expenses of a date range as charts, one set per currency (amounts in different currencies are never
 * added up). Filters live in the URL: `range` (a preset or `custom` with `from` and `to`), `accountId`, `categoryId`
 * and `type`. Transfers are left out by the API.
 */
export default async function AnalyticsPage({ searchParams }: SearchParams) {
  const query = await searchParams;
  const [t, format, locale, timeZone, accounts, archivedAccounts, categories, currencies] = await Promise.all([
    getTranslations(),
    getFormatter(),
    getLocale(),
    getTimeZone(),
    getAccounts(),
    getArchivedAccounts(),
    getCategories(),
    getCurrencies(),
  ]);

  const title = <h1 className="text-base font-bold tracking-[-0.02em] sm:text-[26px]">{t("analytics.title")}</h1>;
  if (accounts.length === 0 && archivedAccounts.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl pt-2">
        <div className="mb-[18px] sm:mb-6">{title}</div>
        <section className="rounded-lg border border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-6 sm:py-10 sm:text-sm">
          <Link href="/accounts" className={`rounded-sm underline hover:text-foreground ${focusRing}`}>
            {t("accounts.empty")}
          </Link>
        </section>
      </div>
    );
  }

  const preset = RANGE_PRESETS.find((range) => range === query.range) ?? "month";
  const today = todayIn(timeZone);
  const range = resolveRange(preset, today, param(query.from), param(query.to));
  const accountId = param(query.accountId);
  const categoryId = param(query.categoryId);
  const type = query.type === "income" || query.type === "expense" ? query.type : undefined;
  const granularity = range === null ? null : granularityFor(range);

  const filterQuery = range && {
    ...range,
    ...(accountId === undefined ? {} : { accountId }),
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(type === undefined ? {} : { type }),
  };
  const [series, categoryTotals] =
    filterQuery && granularity
      ? await Promise.all([
          fetchApiServer<TimeSeriesRow[]>(
            `/analytics/timeseries?${new URLSearchParams({ ...filterQuery, granularity })}`,
          ),
          fetchApiServer<CategoryTotalRow[]>(`/analytics/categories?${new URLSearchParams(filterQuery)}`),
        ]).catch(notFoundOnMissingResource)
      : [[], []];
  const reports = reportsByCurrency(series, categoryTotals);

  const currencyByCode = new Map(currencies.map((currency) => [currency.code, currency]));
  const allAccounts = [...accounts, ...archivedAccounts];
  const toOption = ({ id, name }: { id: string; name: string }) => ({ id, name });
  const dateRangeLabel = (from: string, to: string) =>
    format.dateTimeRange(new Date(from), new Date(to), { dateStyle: "medium", timeZone: "UTC", calendar: "gregory" });
  // On paper the filter controls are hidden, so the chosen filters are written out instead.
  const printedFilters = [
    `${t("analytics.account")}: ${allAccounts.find((account) => account.id === accountId)?.name ?? t("analytics.allAccounts")}`,
    `${t("analytics.category")}: ${categories.find((category) => category.id === categoryId)?.name ?? t("analytics.allCategories")}`,
    `${t("analytics.type")}: ${t(type === undefined ? "analytics.allTypes" : type === "income" ? "analytics.income" : "analytics.expenses")}`,
  ].join(" · ");

  return (
    <div className="mx-auto w-full max-w-6xl pt-2">
      <AnalyticsRefresh />
      <div className="mb-[18px] sm:mb-6">
        {title}
        {range && (
          <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">
            {dateRangeLabel(range.from, range.to)}
          </p>
        )}
        <p className="mt-1 hidden text-xs text-muted-foreground print:block">{printedFilters}</p>
      </div>

      <AnalyticsFilters
        filters={{ range: preset, accountId: accountId ?? "", categoryId: categoryId ?? "", type: type ?? "" }}
        customRange={range ?? resolveRange("month", today)!}
        accounts={accounts.map(toOption)}
        archivedAccounts={archivedAccounts.map(toOption)}
        categories={categories.map(toOption)}
        exportHref={
          filterQuery &&
          `${process.env.NEXT_PUBLIC_API_URL}/transactions/export?${new URLSearchParams({ format: "csv", ...filterQuery })}`
        }
      />

      {!range || !granularity ? (
        <p role="alert" className={`${cardClassName} text-center text-[13px] font-medium text-destructive sm:text-sm`}>
          {t("analytics.invalidRange")}
        </p>
      ) : (
        <div className="flex flex-col gap-3.5 sm:gap-6">
          {reports.map((report) => {
            const currency = currencyByCode.get(report.currencyCode);
            const minorUnit = currency?.minorUnit ?? 2;
            const money = (amountMinor: number, signDisplay?: "exceptZero") =>
              formatAmount(amountMinor, report.currencyCode, minorUnit, locale, signDisplay);
            const netMinor = report.incomeMinor + report.expenseMinor;
            const headingId = `currency-${report.currencyCode}`;
            return (
              <section key={report.currencyCode} aria-labelledby={headingId} className={cardClassName}>
                <h2 id={headingId} className="text-lg font-bold sm:text-xl">
                  {currency
                    ? t("analytics.currencyHeading", { code: currency.code, name: currency.name })
                    : report.currencyCode}
                </h2>
                <dl className="mt-3 mb-5 grid grid-cols-1 gap-3 min-[400px]:grid-cols-3 sm:mb-6">
                  <Figure label={t("analytics.income")} value={money(report.incomeMinor)} className="text-success" />
                  <Figure
                    label={t("analytics.expenses")}
                    value={money(-report.expenseMinor)}
                    className="text-destructive"
                  />
                  <Figure
                    label={t("analytics.net")}
                    value={money(netMinor, "exceptZero")}
                    className={netMinor > 0 ? "text-success" : netMinor < 0 ? "text-destructive" : ""}
                  />
                </dl>
                {report.incomeMinor === 0 && report.expenseMinor === 0 ? (
                  <p className="py-6 text-center text-[13px] text-muted-foreground sm:text-sm">
                    {t("analytics.noData")}
                  </p>
                ) : (
                  <CurrencyCharts
                    report={report}
                    minorUnit={minorUnit}
                    granularity={granularity}
                    type={type}
                    categories={categories.map(({ id, name, color }) => ({ id, name, color }))}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground sm:text-[13px]">{label}</dt>
      <dd className={`mt-0.5 text-lg font-bold tabular-nums wrap-anywhere sm:text-xl ${className}`}>{value}</dd>
    </div>
  );
}
