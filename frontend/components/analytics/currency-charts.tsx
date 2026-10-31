"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";

import { getDirection, type Locale } from "@/i18n/config";
import type { CurrencyReport, Granularity } from "@/lib/analytics";
import { formatAmount } from "@/lib/format";

const chartHeightPx = 240;
const chartStyle = { width: "100%", height: chartHeightPx };
const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };
const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--foreground)",
  fontSize: 12,
};
const UNCATEGORISED_COLOR = "var(--muted-foreground)";

const cardTitleClassName = "text-[15px] font-semibold sm:text-base";

/**
 * The charts of one currency: income and expenses over time (line), net per period (bar) and totals by
 * category (donut). Each has a "show as table" alternative with the same numbers, for screen readers too.
 */
export function CurrencyCharts({
  report,
  minorUnit,
  granularity,
  type,
  categories,
}: {
  report: CurrencyReport;
  minorUnit: number;
  granularity: Granularity;
  /** The type filter; the donut shows income only when it is "income". */
  type: "income" | "expense" | undefined;
  categories: { id: string; name: string; color: string }[];
}) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const rtl = getDirection(locale as Locale) === "rtl";
  const { currencyCode } = report;

  const money = (amountMinor: number, signDisplay?: "exceptZero") =>
    formatAmount(amountMinor, currencyCode, minorUnit, locale, signDisplay);
  const compactNumber = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const axisMoney = (amountMinor: number) => compactNumber.format(amountMinor / 10 ** minorUnit);
  const periodLabel = (period: string) =>
    format.dateTime(new Date(period), {
      ...(granularity === "month" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" }),
      timeZone: "UTC",
      calendar: "gregory",
    });

  // Expenses are drawn as positive amounts next to income; the net keeps its sign.
  const points = report.series.map(({ period, incomeMinor, expenseMinor }) => ({
    period: periodLabel(period),
    income: incomeMinor,
    expenses: -expenseMinor,
    net: incomeMinor + expenseMinor,
  }));
  const lines = [
    ...(type === "expense" ? [] : [{ key: "income", name: t("analytics.income"), color: "var(--success)" }]),
    ...(type === "income" ? [] : [{ key: "expenses", name: t("analytics.expenses"), color: "var(--destructive)" }]),
  ];

  const sliceType = type ?? "expense";
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const slices = report.categories
    .filter((row) => row.type === sliceType)
    .map((row) => {
      const category = row.categoryId === null ? undefined : categoryById.get(row.categoryId);
      return {
        name: category?.name ?? t("transactions.uncategorised"),
        value: Math.abs(row.totalMinor),
        fill: category?.color ?? UNCATEGORISED_COLOR,
      };
    })
    .sort((a, b) => b.value - a.value);
  const slicesTotal = slices.reduce((sum, slice) => sum + slice.value, 0);
  const percent = (ratio: number) => format.number(ratio, { style: "percent", maximumFractionDigits: 0 });

  const xAxis = <XAxis dataKey="period" tick={axisTick} reversed={rtl} minTickGap={12} />;
  const yAxis = <YAxis tick={axisTick} tickFormatter={axisMoney} orientation={rtl ? "right" : "left"} width="auto" />;
  // Legend text in the page colour: a light category colour would be hard to read as text.
  const legend = <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />;
  const tooltip = (
    <Tooltip
      contentStyle={tooltipStyle}
      formatter={(value) => money(Number(value))}
      cursor={{ fill: "var(--muted)" }}
    />
  );

  const overTimeTitle = t("analytics.overTime");
  const netTitle = t(`analytics.netPer.${granularity}`);
  const categoryTitle = t(sliceType === "income" ? "analytics.incomeByCategory" : "analytics.spendingByCategory");

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <ChartFigure
        title={overTimeTitle}
        table={
          <DataTable
            caption={`${overTimeTitle} (${currencyCode})`}
            columns={[t("analytics.period"), ...lines.map((line) => line.name)]}
            rows={points.map((point) => [
              point.period,
              ...lines.map((line) => money(point[line.key as "income" | "expenses"])),
            ])}
          />
        }
      >
        <LineChart responsive style={chartStyle} data={points} title={`${overTimeTitle} (${currencyCode})`}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {lines.map((line) => (
            <Line
              key={line.key}
              dataKey={line.key}
              name={line.name}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartFigure>

      <ChartFigure
        title={netTitle}
        table={
          <DataTable
            caption={`${netTitle} (${currencyCode})`}
            columns={[t("analytics.period"), t("analytics.net")]}
            rows={points.map((point) => [point.period, money(point.net, "exceptZero")])}
          />
        }
      >
        <BarChart responsive style={chartStyle} data={points} title={`${netTitle} (${currencyCode})`}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          {xAxis}
          {yAxis}
          {tooltip}
          <Bar dataKey="net" name={t("analytics.net")} fill="var(--primary)" isAnimationActive={false} />
        </BarChart>
      </ChartFigure>

      <ChartFigure
        title={categoryTitle}
        table={
          slices.length > 0 && (
            <DataTable
              caption={`${categoryTitle} (${currencyCode})`}
              columns={[t("analytics.category"), t("analytics.amount"), t("analytics.share")]}
              rows={slices.map((slice) => [slice.name, money(slice.value), percent(slice.value / slicesTotal)])}
            />
          )
        }
      >
        {slices.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground sm:text-sm">
            {t("analytics.noCategoryData")}
          </p>
        ) : (
          <PieChart responsive style={chartStyle} title={`${categoryTitle} (${currencyCode})`}>
            {tooltip}
            {legend}
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="55%"
              outerRadius="85%"
              stroke="var(--card)"
              isAnimationActive={false}
            />
          </PieChart>
        )}
      </ChartFigure>
    </div>
  );
}

function ChartFigure({ title, table, children }: { title: string; table: ReactNode; children: ReactNode }) {
  const t = useTranslations("analytics");
  return (
    <figure className="min-w-0 break-inside-avoid print:[&_.recharts-tooltip-wrapper]:hidden">
      <figcaption className={`mb-3 ${cardTitleClassName}`}>{title}</figcaption>
      {children}
      {table && (
        <details className="mt-2 print:hidden">
          <summary className="w-fit cursor-pointer rounded-sm text-[13px] font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-accent-foreground">
            {t("showTable")}
          </summary>
          <div className="mt-2 overflow-x-auto">{table}</div>
        </details>
      )}
    </figure>
  );
}

function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-xs text-muted-foreground">
          {columns.map((column, index) => (
            <th key={column} scope="col" className={`py-2 font-semibold ${index === 0 ? "text-start" : "text-end"}`}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, ...values], rowIndex) => (
          <tr key={rowIndex} className="border-b border-border last:border-b-0">
            <th scope="row" className="py-2 text-start font-medium">
              <bdi>{label}</bdi>
            </th>
            {values.map((value, index) => (
              <td key={index} className="py-2 text-end whitespace-nowrap tabular-nums">
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
