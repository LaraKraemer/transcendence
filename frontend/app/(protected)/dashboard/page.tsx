import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import Link from "next/link";

import { Avatar } from "@/components/app-shell/app-shell";
import { CategoryIcon, categoryTileStyle } from "@/components/categories/category-icon";
import { AccountSwitcher } from "@/components/transactions/account-switcher";
import {
  fetchApiServer,
  getAccount,
  getAccounts,
  getCategories,
  getCurrencies,
  getCurrentUser,
  notFoundOnMissingResource,
} from "@/lib/dal";
import { currentMonth, monthRange, netChange, summarizeMonth } from "@/lib/dashboard";
import { formatAmount, transactionLabel } from "@/lib/format";
import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";
import type { AccountBalance, Category, Transaction, TransactionPage, TransactionSummaryRow } from "@/lib/types";

const LATEST_TRANSACTIONS_LIMIT = 5;

const NET_HEADING_ID = "net-balance-heading";
const INCOME_EXPENSE_HEADING_ID = "income-expense-heading";
const SPENDING_HEADING_ID = "spending-heading";
const LATEST_HEADING_ID = "latest-transactions-heading";

const focusRing = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const cardClassName = "rounded-lg border border-border bg-card p-[18px] sm:p-6";
const cardTitleClassName = "text-[15px] font-semibold sm:text-base";
const barTrackClassName = "h-1.5 rounded-md bg-muted sm:h-[7px]";
const barFillClassName = "h-full rounded-md forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none";

const tileColorClassName = (category: Category | undefined) =>
  category ? "ring-1 ring-foreground/15 ring-inset" : "bg-muted text-muted-foreground";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("overview") };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { accountId } = await searchParams;
  // An empty id would request GET /accounts/ (the list), so it counts as none.
  const requestedAccountId = typeof accountId === "string" && accountId !== "" ? accountId : undefined;

  const [t, format, locale, timeZone, user, accounts, categoryList, currencies, cookieStore, requestedAccount] =
    await Promise.all([
      getTranslations(),
      getFormatter(),
      getLocale(),
      getTimeZone(),
      getCurrentUser(),
      getAccounts(),
      getCategories(),
      getCurrencies(),
      cookies(),
      requestedAccountId === undefined ? undefined : getAccount(requestedAccountId),
    ]).catch(notFoundOnMissingResource);

  const lastAccountId = cookieStore.get(LAST_ACCOUNT_COOKIE)?.value;
  const account = requestedAccount ?? accounts.find((other) => other.id === lastAccountId) ?? accounts[0];

  const { year, month } = currentMonth(timeZone);

  const monthLabel = format.dateTime(new Date(Date.UTC(year, month - 1, 1)), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
    calendar: "gregory",
  });

  const header = (
    <div className="mb-[18px] flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold tracking-[-0.02em] break-words sm:text-[26px]">
            {t.rich("dashboard.greeting", {
              displayName: user?.displayName ?? "",
              name: (chunks) => <bdi>{chunks}</bdi>,
            })}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground sm:mt-1 sm:text-sm">
            {t("dashboard.subtitle", { month: monthLabel })}
          </p>
        </div>
        {user && (
          <div className="lg:hidden">
            <Avatar displayName={user.displayName} avatarUrl={user.avatarUrl} label={t("nav.profile")} />
          </div>
        )}
      </div>
      {account && (
        <AccountSwitcher
          accounts={accounts.some((other) => other.id === account.id) ? accounts : [account, ...accounts]}
          currentAccountId={account.id}
          page="dashboard"
        />
      )}
    </div>
  );

  if (!account) {
    return (
      <div className="mx-auto w-full max-w-6xl pt-2">
        {header}
        <section className="rounded-lg border border-border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-6 sm:py-10 sm:text-sm">
          <Link href="/accounts" className={`rounded-sm underline hover:text-foreground ${focusRing}`}>
            {t("accounts.empty")}
          </Link>
        </section>
      </div>
    );
  }

  const summary = (range: { from: string; to: string }) =>
    fetchApiServer<TransactionSummaryRow[]>(`/transactions/summary?${new URLSearchParams({ accountId: account.id, ...range })}`);

  const [thisMonthRows, lastMonthRows, latest, balanceMinor] = await Promise.all([
    summary(monthRange(year, month)),
    summary(monthRange(year, month - 1)).catch(() => null),
    fetchApiServer<TransactionPage>(
      `/transactions?${new URLSearchParams({ accountId: account.id, limit: String(LATEST_TRANSACTIONS_LIMIT) })}`,
    ),
    fetchApiServer<AccountBalance>(`/accounts/${encodeURIComponent(account.id)}/balance`).then(
      (balance) => balance.balanceMinor,
      () => null,
    ),
  ]);

  const categories = new Map(categoryList.map((category) => [category.id, category]));
  const minorUnit = currencies.find((currency) => currency.code === account.currencyCode)?.minorUnit ?? 2;
  const money = (amountMinor: number, signDisplay?: "exceptZero") =>
    formatAmount(amountMinor, account.currencyCode, minorUnit, locale, signDisplay);
  const percent = (ratio: number, signDisplay?: "exceptZero") =>
    format.number(ratio, { style: "percent", maximumFractionDigits: 0, signDisplay });

  const { incomeMinor, expenseMinor, netMinor, spending } = summarizeMonth(thisMonthRows);
  const exactChange = lastMonthRows === null ? null : netChange(netMinor, summarizeMonth(lastMonthRows).netMinor);
  const change = exactChange === null ? null : Math.round(exactChange * 100) / 100;
  const incomeExpenseScale = Math.max(incomeMinor, expenseMinor);

  return (
    <div className="mx-auto w-full max-w-6xl pt-2">
      {header}

      <div className="grid grid-cols-1 items-start gap-3.5 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.18fr)]">
        <div className="flex flex-col gap-3.5 sm:gap-6">
          <section aria-labelledby={NET_HEADING_ID} className={cardClassName}>
            <h2
              id={NET_HEADING_ID}
              className="text-xs font-semibold tracking-[.06em] text-muted-foreground uppercase sm:text-[13px]"
            >
              {t("dashboard.netTitle")}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 sm:mt-2.5">
              <span
                className={`text-[34px] leading-tight font-bold tracking-[-0.02em] tabular-nums wrap-anywhere sm:text-[40px] ${
                  netMinor > 0 ? "text-success" : netMinor < 0 ? "text-destructive" : ""
                }`}
              >
                {money(netMinor, "exceptZero")}
              </span>
              {change !== null && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    change > 0
                      ? "bg-success-bg text-success"
                      : change < 0
                        ? "bg-danger-bg text-destructive"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {change !== 0 && (
                    <TrendIcon icon={change > 0 ? TrendingUp : TrendingDown} />
                  )}
                  {t("dashboard.vsLastMonth", { change: percent(change, "exceptZero") })}
                </span>
              )}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground sm:mt-3.5 sm:text-sm">
              {incomeMinor === 0 && expenseMinor === 0
                ? t("dashboard.noActivity")
                : t("dashboard.summary", { income: money(incomeMinor), expenses: money(expenseMinor) })}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground sm:text-sm">
              {balanceMinor === null
                ? t("transactions.balanceUnavailable")
                : t("dashboard.accountBalance", { balance: money(balanceMinor) })}
            </p>
          </section>

          <section aria-labelledby={INCOME_EXPENSE_HEADING_ID} className={cardClassName}>
            <h2 id={INCOME_EXPENSE_HEADING_ID} className={`mb-3.5 sm:mb-[18px] ${cardTitleClassName}`}>
              {t("dashboard.incomeVsExpense")}
            </h2>
            <dl className="grid grid-cols-2 gap-4 sm:gap-5">
              <IncomeExpenseFigure
                icon={ArrowDownLeft}
                label={t("dashboard.income")}
                value={money(incomeMinor)}
                ratio={incomeExpenseScale === 0 ? 0 : incomeMinor / incomeExpenseScale}
                textClassName="text-success"
                barClassName="bg-success"
              />
              <IncomeExpenseFigure
                icon={ArrowUpRight}
                label={t("dashboard.expenses")}
                value={money(expenseMinor)}
                ratio={incomeExpenseScale === 0 ? 0 : expenseMinor / incomeExpenseScale}
                textClassName="text-destructive"
                barClassName="bg-destructive"
              />
            </dl>
          </section>
        </div>

        <section aria-labelledby={SPENDING_HEADING_ID} className={cardClassName}>
          <h2 id={SPENDING_HEADING_ID} className={`mb-3.5 sm:mb-[18px] ${cardTitleClassName}`}>
            {t("dashboard.spendingByCategory")}
          </h2>
          {spending.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground sm:text-sm">{t("dashboard.noSpending")}</p>
          ) : (
            <ul className="flex flex-col gap-3 sm:gap-4">
              {spending.map(({ categoryId, amountMinor, share }) => {
                const category = categoryId === null ? undefined : categories.get(categoryId);
                return (
                  <li key={categoryId ?? "uncategorised"}>
                    <div className="mb-[7px] flex items-center gap-2.5 sm:mb-2">
                      <span
                        aria-hidden
                        className={`flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[8px] sm:size-[30px] sm:rounded-[9px] ${tileColorClassName(category)}`}
                        style={category && categoryTileStyle(category.color)}
                      >
                        <CategoryIcon icon={category?.icon ?? "tag"} size={15} />
                      </span>
                      <span className="min-w-0 flex-1 text-[13px] font-medium break-words sm:text-sm">
                        {category ? <bdi>{category.name}</bdi> : t("transactions.uncategorised")}
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold whitespace-nowrap tabular-nums sm:text-sm">
                        {money(amountMinor)}
                      </span>
                      <span className="min-w-9 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
                        {percent(share)}
                      </span>
                    </div>
                    <div aria-hidden className={barTrackClassName}>
                      <div className={`bg-primary ${barFillClassName}`} style={{ width: `${share * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby={LATEST_HEADING_ID} className={`mt-3.5 sm:mt-6 ${cardClassName}`}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:mb-2">
          <h2 id={LATEST_HEADING_ID} className={cardTitleClassName}>
            {t("dashboard.latestTransactions")}
          </h2>
          {latest.total > 0 && (
            <Link
              href={`/transactions?accountId=${account.id}`}
              aria-describedby={LATEST_HEADING_ID}
              className={`flex items-center gap-1 rounded-sm text-[13px] font-semibold text-primary hover:underline dark:text-accent-foreground ${focusRing}`}
            >
              {t("dashboard.viewAll")}
              <ArrowRight size={14} aria-hidden className="rtl:-scale-x-100" />
            </Link>
          )}
        </div>

        {latest.items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground sm:text-sm">{t("transactions.empty")}</p>
        ) : (
          <table className="w-full text-[13px] sm:text-sm">
            <caption className="sr-only">{t("dashboard.latestCaption", { account: account.name })}</caption>
            <thead className="max-sm:sr-only">
              <tr className="border-b border-border text-[11px] font-semibold tracking-[.05em] text-muted-foreground uppercase">
                <th scope="col" className="py-3 pe-3 text-start">
                  {t("transactions.columns.description")}
                </th>
                <th scope="col" className="hidden px-3 py-3 text-start sm:table-cell">
                  {t("transactions.columns.category")}
                </th>
                <th scope="col" className="hidden px-3 py-3 text-start sm:table-cell">
                  {t("transactions.columns.date")}
                </th>
                <th scope="col" className="py-3 ps-3 text-end">
                  {t("transactions.columns.amount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {latest.items.map((tx) => (
                <LatestTransactionRow
                  key={tx.id}
                  transaction={tx}
                  typeLabel={t(`transactions.form.types.${tx.type}`)}
                  category={tx.categoryId === null ? undefined : categories.get(tx.categoryId)}
                  noCategoryLabel={
                    tx.type === "transfer" ? t("transactions.form.types.transfer") : t("transactions.uncategorised")
                  }
                  date={format.dateTime(new Date(tx.bookedOn), {
                    dateStyle: "medium",
                    timeZone: "UTC",
                    calendar: "gregory",
                  })}
                  amount={money(tx.amountMinor, "exceptZero")}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function TrendIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon size={14} aria-hidden className="rtl:-scale-x-100" />;
}

function IncomeExpenseFigure({
  icon: Icon,
  label,
  value,
  ratio,
  textClassName,
  barClassName,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  ratio: number;
  textClassName: string;
  barClassName: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-[13px]">
        <Icon size={15} aria-hidden className={`shrink-0 rtl:-scale-x-100 ${textClassName}`} />
        {label}
      </dt>
      <dd className={`mt-1 mb-1.5 text-xl font-bold tabular-nums wrap-anywhere sm:mt-1.5 sm:mb-2 sm:text-2xl ${textClassName}`}>
        {value}
      </dd>
      <dd aria-hidden className={barTrackClassName}>
        <div className={`${barClassName} ${barFillClassName}`} style={{ width: `${ratio * 100}%` }} />
      </dd>
    </div>
  );
}

function LatestTransactionRow({
  transaction: tx,
  category,
  noCategoryLabel,
  typeLabel,
  date,
  amount,
}: {
  transaction: Transaction;
  category: Category | undefined;
  noCategoryLabel: string;
  typeLabel: string;
  date: string;
  amount: string;
}) {
  const categoryLabel = category ? <bdi>{category.name}</bdi> : noCategoryLabel;
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="py-[11px] pe-3 sm:py-3.5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`flex size-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] ${tileColorClassName(category)}`}
            style={category && categoryTileStyle(category.color)}
          >
            {tx.type === "transfer" ? (
              <ArrowLeftRight size={16} aria-hidden />
            ) : (
              <CategoryIcon icon={category?.icon ?? "tag"} size={16} />
            )}
          </span>
          <div className="min-w-0">
            <div className="font-semibold break-words sm:font-medium">
              <bdi>{transactionLabel(tx, category?.name, typeLabel)}</bdi>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
              {categoryLabel}
              <span aria-hidden> · </span>
              <time dateTime={tx.bookedOn}>{date}</time>
            </div>
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-3.5 text-[13px] text-muted-foreground sm:table-cell">{categoryLabel}</td>
      <td className="hidden px-3 py-3.5 text-[13px] whitespace-nowrap text-muted-foreground sm:table-cell">
        <time dateTime={tx.bookedOn}>{date}</time>
      </td>
      <td
        className={`py-[11px] ps-3 text-end font-semibold whitespace-nowrap tabular-nums sm:py-3.5 ${
          tx.amountMinor > 0 ? "text-success" : "text-destructive"
        }`}
      >
        {amount}
      </td>
    </tr>
  );
}
