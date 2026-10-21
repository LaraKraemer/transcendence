import { ArrowDownLeft, ArrowUpRight, Wallet, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";

import { AccountSwitcher } from "@/components/transactions/account-switcher";
import { DeleteTransactionButton } from "@/components/transactions/delete-transaction-button";
import { EditTransactionButton, NewTransactionButton } from "@/components/transactions/transaction-form-dialog";
import { LiveStatusProvider } from "@/components/ui/live-status";
import {
  fetchApiServer,
  getAccount,
  getAccounts,
  getCategories,
  getCurrencies,
  notFoundOnMissingResource,
} from "@/lib/dal";
import type { AccountBalance, Category, TransactionPage } from "@/lib/types";

const TRANSACTIONS_LIMIT = 200;

const TYPE_FILTERS = ["all", "income", "expense", "transfer"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

// The list heading takes focus after a delete removes the focused row's button.
const LIST_HEADING_ID = "transactions-heading";

const focusRing = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

const filterQuery = (filter: TypeFilter) => (filter === "all" ? "" : `?type=${filter}`);

type RouteParams = { params: Promise<{ accountId: string }> };

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const [{ accountId }, t] = await Promise.all([params, getTranslations()]);
  // A missing account shows the 404 page, with its title instead of "Transactions".
  const account = await getAccount(accountId).catch(notFoundOnMissingResource);
  return { title: t("metadata.accountTransactionsTitle", { account: account.name }) };
}

export default async function AccountTransactionsPage({
  params,
  searchParams,
}: RouteParams & { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ accountId }, { type }] = await Promise.all([params, searchParams]);
  const filter: TypeFilter = type === "income" || type === "expense" || type === "transfer" ? type : "all";

  const [
    t,
    tCategories,
    format,
    account,
    { items, total },
    activeCategories,
    currencies,
    activeAccounts,
    balanceMinor,
  ] = await Promise.all([
    getTranslations("transactions"),
    getTranslations("categories"),
    getFormatter(),
    getAccount(accountId),
    fetchApiServer<TransactionPage>(
      `/transactions?${new URLSearchParams({ accountId, limit: String(TRANSACTIONS_LIMIT) })}`,
    ),
    getCategories(),
    getCurrencies(),
    getAccounts(),
    fetchApiServer<AccountBalance>(`/accounts/${encodeURIComponent(accountId)}/balance`).then(
      (balance) => balance.balanceMinor,
      () => null,
    ),
  ]).catch(notFoundOnMissingResource);
  const categories = new Map(activeCategories.map((c) => [c.id, c]));
  // The system Transfer category is stored in English, so it is shown translated.
  const categoryName = (category: Category) => (category.isSystem ? tCategories("types.transfer") : category.name);
  const switcherAccounts = activeAccounts.some((other) => other.id === account.id)
    ? activeAccounts
    : [account, ...activeAccounts];

  const minorUnit = currencies.find((currency) => currency.code === account.currencyCode)?.minorUnit ?? 2;
  // Built once and passed to every row: the same object is sent to the client only once.
  const accountOption = { id: account.id, name: account.name, currencyCode: account.currencyCode, minorUnit };
  const categoryOptions = activeCategories.map(({ id, name, types }) => ({ id, name, types }));
  const money = (amountMinor: number) =>
    format.number(amountMinor / 10 ** minorUnit, {
      style: "currency",
      currency: account.currencyCode,
      signDisplay: "exceptZero",
    });

  const bookedOn = (date: string) => format.dateTime(new Date(date), { dateStyle: "medium", timeZone: "UTC" });

  const moneyInMinor = items.reduce((sum, tx) => (tx.amountMinor > 0 ? sum + tx.amountMinor : sum), 0);
  const moneyOutMinor = items.reduce((sum, tx) => (tx.amountMinor < 0 ? sum + tx.amountMinor : sum), 0);
  const statNote = total > items.length ? t("latestOnly", { count: items.length }) : undefined;

  const visible = filter === "all" ? items : items.filter((tx) => tx.type === filter);

  return (
    <div className="mx-auto w-full max-w-5xl pt-2">
      {/* User-entered text (names, descriptions, notes) is wrapped in <bdi>, so Latin text in an RTL
          page (or the reverse) keeps its punctuation in place without changing the alignment. */}
      <div className="mb-[18px] flex items-start gap-4 sm:mb-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[26px] font-bold tracking-[-0.02em] break-words">
              {t.rich("heading", { account: account.name, name: (chunks) => <bdi>{chunks}</bdi> })}
            </h1>
            {account.isArchived && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {t("archived")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            {t("subtitle", { count: total, currency: account.currencyCode })}
          </p>
        </div>
        {!account.isArchived && (
          <LiveStatusProvider>
            <NewTransactionButton
              variant="header"
              accounts={[accountOption]}
              allAccounts={activeAccounts.map(({ id, name, currencyCode }) => ({
                id,
                name,
                currencyCode,
                minorUnit: currencies.find((currency) => currency.code === currencyCode)?.minorUnit ?? 2,
              }))}
              categories={categoryOptions}
            />
          </LiveStatusProvider>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:mb-5 sm:grid-cols-3 sm:gap-5">
        <StatCard
          icon={ArrowDownLeft}
          iconClassName="bg-success-bg text-success rtl:-scale-x-100"
          label={t("moneyIn")}
          value={money(moneyInMinor)}
          valueClassName="text-success"
          note={statNote}
        />
        <StatCard
          icon={ArrowUpRight}
          iconClassName="bg-danger-bg text-destructive rtl:-scale-x-100"
          label={t("moneyOut")}
          value={money(moneyOutMinor)}
          valueClassName="text-destructive"
          note={statNote}
        />
        <StatCard
          icon={Wallet}
          iconClassName="bg-muted text-muted-foreground"
          label={t("balance")}
          // Not money(): its signDisplay adds a "+" that suits in/out amounts but not a balance.
          value={
            balanceMinor === null
              ? "—"
              : format.number(balanceMinor / 10 ** minorUnit, { style: "currency", currency: account.currencyCode })
          }
          valueClassName={balanceMinor !== null && balanceMinor < 0 ? "text-destructive" : ""}
          note={balanceMinor === null ? t("balanceUnavailable") : undefined}
          className="max-sm:col-span-2"
        />
      </div>

      <div className="mb-3.5 flex flex-col gap-3 sm:mb-5 sm:flex-row-reverse sm:items-center sm:justify-between">
        <AccountSwitcher accounts={switcherAccounts} currentAccountId={account.id} query={filterQuery(filter)} />
        <nav
          aria-label={t("filterLabel")}
          className="flex gap-1 rounded-[11px] border border-border bg-muted p-1 sm:inline-flex"
        >
          {TYPE_FILTERS.map((option) => (
            <Link
              key={option}
              href={`/accounts/${account.id}/transactions${filterQuery(option)}`}
              scroll={false}
              aria-current={option === filter ? "page" : undefined}
              className={`flex-1 rounded-[8px] px-3.5 py-1.5 text-center text-[13px] font-medium sm:flex-none text-muted-foreground hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-sm ${focusRing}`}
            >
              {t(`filters.${option}`)}
            </Link>
          ))}
        </nav>
      </div>

      <LiveStatusProvider>
        <section aria-labelledby={LIST_HEADING_ID} className="rounded-lg border border-border bg-card">
          <h2
            id={LIST_HEADING_ID}
            tabIndex={-1}
            className={`mx-4 mt-4 mb-2 w-fit rounded-sm text-[15px] font-semibold sm:mx-6 sm:mt-5 sm:mb-3 sm:text-base ${focusRing}`}
          >
            {t("listTitle")}
          </h2>

          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground sm:px-6 sm:py-10 sm:text-sm">
              {total === 0 ? t("empty") : t("emptyFiltered", { filter })}
            </p>
          ) : (
            <table className="w-full text-[13px] sm:text-sm">
              <caption className="sr-only">{t("caption", { account: account.name })}</caption>
              <thead>
                <tr className="bg-muted text-[11px] font-semibold tracking-[.06em] text-muted-foreground uppercase">
                  <th scope="col" className="py-2 ps-4 pe-3 text-start sm:py-3 sm:ps-6">
                    {t("columns.description")}
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-start lg:table-cell">
                    {t("columns.category")}
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-start lg:table-cell">
                    {t("columns.date")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-end sm:px-3 sm:py-3">
                    {t("columns.amount")}
                  </th>
                  <th scope="col" className="py-2 ps-1 pe-2 sm:py-3 sm:pe-4">
                    <span className="sr-only">{t("columns.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((tx) => {
                  const category = tx.categoryId === null ? undefined : categories.get(tx.categoryId);
                  return (
                    <tr key={tx.id} className="border-t border-border">
                      <td className="py-[11px] ps-4 pe-3 sm:py-3.5 sm:ps-6">
                        <div className="font-semibold break-words">
                          <bdi>{tx.description}</bdi>
                        </div>
                        {tx.notes && (
                          <div className="text-xs break-words text-muted-foreground sm:text-[13px]">
                            <bdi>{tx.notes}</bdi>
                          </div>
                        )}
                        <div className="mt-0.5 text-xs text-muted-foreground sm:text-[13px] lg:hidden">
                          {category ? <bdi>{categoryName(category)}</bdi> : t("uncategorised")}
                          <span aria-hidden> · </span>
                          <time dateTime={tx.bookedOn}>{bookedOn(tx.bookedOn)}</time>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3.5 lg:table-cell">
                        {category ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                            <span
                              aria-hidden
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: category.color }}
                            />
                            <bdi>{categoryName(category)}</bdi>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("uncategorised")}</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-3.5 whitespace-nowrap text-muted-foreground lg:table-cell">
                        <time dateTime={tx.bookedOn}>{bookedOn(tx.bookedOn)}</time>
                      </td>
                      <td
                        className={`px-2 py-[11px] text-end font-semibold sm:px-3 sm:py-3.5 whitespace-nowrap tabular-nums ${
                          tx.amountMinor > 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {money(tx.amountMinor)}
                      </td>
                      <td className="py-[11px] ps-1 pe-2 sm:py-3.5 sm:pe-4">
                        <div className="flex justify-end gap-1.5">
                          {/* The backend can't edit transfers; they are deleted and created again. */}
                          {tx.type !== "transfer" && (
                            <EditTransactionButton
                              transaction={tx}
                              account={accountOption}
                              categories={categoryOptions}
                              focusAfterDeleteId={LIST_HEADING_ID}
                            />
                          )}
                          <DeleteTransactionButton
                            transactionId={tx.id}
                            description={tx.description}
                            isTransfer={tx.type === "transfer"}
                            focusAfterDeleteId={LIST_HEADING_ID}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p
            aria-live="polite"
            className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6 sm:py-4 sm:text-[13px]"
          >
            {t("showing", { shown: visible.length, total })}
          </p>
        </section>
      </LiveStatusProvider>
    </div>
  );
}

function StatCard({
  icon: Icon,
  iconClassName,
  label,
  value,
  valueClassName = "",
  note,
  className = "",
}: {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  value: string;
  valueClassName?: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-4 rounded-lg border border-border bg-card p-3.5 sm:p-5 ${className}`}>
      <span className={`flex size-11 shrink-0 max-sm:hidden items-center justify-center rounded-xl ${iconClassName}`}>
        <Icon size={20} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground sm:text-[13px]">{label}</div>
        <div
          className={`truncate text-base font-bold tracking-[-0.02em] tabular-nums sm:text-[22px] ${valueClassName}`}
        >
          {value}
        </div>
        {note && <div className="truncate text-xs text-muted-foreground">{note}</div>}
      </div>
    </div>
  );
}
